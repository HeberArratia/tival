import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cases } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import { scheduleMeetingReminder } from "@/inngest/functions/meeting-remind";
import { notifyRescheduleWhatsapp } from "@/lib/integrations/kapso-whatsapp";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

export type RescheduleNotifyEventData = {
  caseId: string;
  calendlyEventUuid?: string | null;
};

/**
 * Post enrich (o intento final): WhatsApp reagenda + encolar reminder T-1h.
 * Solo tiene efecto si el case está pagado.
 */
export const notifyRescheduleWhatsappFn = inngest.createFunction(
  {
    id: "notify-reschedule-whatsapp",
    name: "WhatsApp reschedule + schedule T-1h remind",
    retries: 2,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/reschedule.notify" }],
  },
  async ({ event, step }) => {
    const data = event.data as RescheduleNotifyEventData;
    const caseId = data.caseId;
    if (!caseId) throw new Error("missing_case_id");

    const result = await step.run("whatsapp-and-remind", async () =>
      runReschedulePaidSideEffects(caseId)
    );

    return result;
  }
);

/** WhatsApp reagenda (si aplica) + siempre intenta encolar reminder si pagado. */
export async function runReschedulePaidSideEffects(caseId: string): Promise<{
  paid: boolean;
  whatsapp: Awaited<ReturnType<typeof notifyRescheduleWhatsapp>> | null;
  reminderScheduled: boolean;
}> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);

  if (!row || row.paymentStatus !== "paid") {
    return { paid: false, whatsapp: null, reminderScheduled: false };
  }

  const whatsapp = await notifyRescheduleWhatsapp(row);
  await scheduleMeetingReminder(row);
  return { paid: true, whatsapp, reminderScheduled: true };
}

/** Encola notify de reagenda (post-enrich). Idempotente por case + uuid. */
export async function scheduleRescheduleNotify(
  caseId: string,
  opts?: { calendlyEventUuid?: string | null }
): Promise<void> {
  const uuid = opts?.calendlyEventUuid?.trim() || "na";

  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — reschedule notify inline %s",
      tivalRuntimeEnv(),
      caseId
    );
    await runReschedulePaidSideEffects(caseId);
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn(
      "[inngest] INNGEST_EVENT_KEY missing — reschedule notify inline"
    );
    await runReschedulePaidSideEffects(caseId);
    return;
  }

  try {
    await inngest.send({
      id: `reschedule-notify-${caseId}-${uuid}`,
      name: "case/reschedule.notify",
      data: {
        caseId,
        calendlyEventUuid: opts?.calendlyEventUuid ?? null,
      } satisfies RescheduleNotifyEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] scheduleRescheduleNotify",
      caseId,
      e instanceof Error ? e.message : e
    );
    await runReschedulePaidSideEffects(caseId);
  }
}

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, cases, type CaseRow } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import { notifyMeetingReminderWhatsapp } from "@/lib/integrations/kapso-whatsapp";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

const REMIND_BEFORE_MS = 60 * 60_000;

export type MeetingRemindEventData = {
  caseId: string;
  /** ISO de scheduledAt al encolar — invalida el job si la reunión se reagenda. */
  scheduledAt: string;
};

function eventId(caseId: string, scheduledAt: Date): string {
  return `meeting-remind-${caseId}-${scheduledAt.getTime()}`;
}

/**
 * Recordatorio WhatsApp 1h antes de la reunión (solo cases pagados).
 * Reagenda: nuevo event id + al despertar se compara scheduledAt.
 */
export const remindMeetingWhatsapp = inngest.createFunction(
  {
    id: "remind-meeting-whatsapp",
    name: "WhatsApp meeting reminder T-1h",
    retries: 2,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/meeting.remind" }],
  },
  async ({ event, step }) => {
    const data = event.data as MeetingRemindEventData;
    const caseId = data.caseId;
    const expectedAt = data.scheduledAt;
    if (!caseId || !expectedAt) throw new Error("missing_remind_payload");

    const meetingAt = new Date(expectedAt);
    if (Number.isNaN(meetingAt.getTime())) {
      throw new Error("invalid_scheduled_at");
    }

    const remindAt = new Date(meetingAt.getTime() - REMIND_BEFORE_MS);
    if (remindAt.getTime() > Date.now()) {
      await step.sleepUntil("wait-until-t-minus-1h", remindAt);
    }

    // Reunión ya pasó → no tiene sentido el recordatorio.
    if (meetingAt.getTime() <= Date.now()) {
      await step.run("skip-meeting-passed", async () => {
        const db = await getDb();
        await db.insert(caseEvents).values({
          caseId,
          type: "whatsapp_meeting_remind_skipped",
          payload: { reason: "meeting_already_started", expectedAt },
          actor: "integracion",
        });
      });
      return { ok: false as const, skipped: true, reason: "meeting_already_started" };
    }

    const snapshot = await step.run("load-case", async () => {
      const db = await getDb();
      const [found] = await db
        .select({
          id: cases.id,
          scheduledAt: cases.scheduledAt,
          paymentStatus: cases.paymentStatus,
          status: cases.status,
        })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!found) return null;
      return {
        id: found.id,
        scheduledAt: found.scheduledAt?.toISOString() ?? null,
        paymentStatus: found.paymentStatus,
        status: found.status,
      };
    });

    if (!snapshot) {
      return { ok: false as const, skipped: true, reason: "case_not_found" };
    }

    const currentScheduled = snapshot.scheduledAt
      ? new Date(snapshot.scheduledAt).getTime()
      : null;
    if (currentScheduled !== meetingAt.getTime()) {
      await step.run("skip-rescheduled", async () => {
        const db = await getDb();
        await db.insert(caseEvents).values({
          caseId,
          type: "whatsapp_meeting_remind_skipped",
          payload: {
            reason: "scheduled_at_mismatch",
            expectedAt,
            currentScheduledAt: snapshot.scheduledAt,
          },
          actor: "integracion",
        });
      });
      return {
        ok: false as const,
        skipped: true,
        reason: "scheduled_at_mismatch",
      };
    }

    // Releer el case completo al enviar (Meet puede haberse enriquecido).
    const result = await step.run("send-whatsapp", async () => {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) {
        return {
          ok: false as const,
          skipped: true as const,
          reason: "case_not_found",
        };
      }
      return notifyMeetingReminderWhatsapp(row);
    });

    return result;
  }
);

/**
 * Encola recordatorio T-1h. Solo si el case está pagado y tiene scheduledAt.
 * Seguro llamar en markPaid y en reagenda post-pago.
 */
export async function scheduleMeetingReminder(
  row: Pick<CaseRow, "id" | "paymentStatus" | "scheduledAt" | "status">
): Promise<void> {
  if (row.paymentStatus !== "paid") return;
  if (!row.scheduledAt) return;
  if (["cancelled", "no_show", "rescheduled_away"].includes(row.status)) {
    return;
  }

  const meetingAt = new Date(row.scheduledAt);
  if (Number.isNaN(meetingAt.getTime())) return;

  // Ya empezó o falta menos de ~1 min: no encolar.
  if (meetingAt.getTime() <= Date.now() + 60_000) {
    console.info(
      "[inngest] meeting remind skip — meeting too soon/past %s",
      row.id
    );
    return;
  }

  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — skip meeting remind %s",
      tivalRuntimeEnv(),
      row.id
    );
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn("[inngest] INNGEST_EVENT_KEY missing — skip meeting remind");
    return;
  }

  const scheduledAtIso = meetingAt.toISOString();
  try {
    await inngest.send({
      id: eventId(row.id, meetingAt),
      name: "case/meeting.remind",
      data: {
        caseId: row.id,
        scheduledAt: scheduledAtIso,
      } satisfies MeetingRemindEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] scheduleMeetingReminder",
      row.id,
      e instanceof Error ? e.message : e
    );
  }
}

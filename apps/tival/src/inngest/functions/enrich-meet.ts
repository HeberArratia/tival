import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import { scheduleRescheduleNotify } from "@/inngest/functions/reschedule-notify";
import { enrichMeetForCase } from "@/lib/integrations/enrich-meet";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

export type MeetEnrichEventData = {
  caseId: string;
  /** Para dedupe por slot (reagenda = nuevo uuid → nuevo job). */
  calendlyEventUuid?: string | null;
  /** schedule = agenda inicial; reschedule = reagenda (dispara WhatsApp + remind). */
  reason?: "schedule" | "reschedule";
};

const RETRYABLE_ENRICH_ERRORS = [
  "calendly_calendar_event_missing",
  "meet_link_missing_on_calendar_event",
  "calendly_conference_failed",
];

/**
 * Resuelve Meet real (Calendly → Calendar) fuera del webhook HTTP.
 * Evita que Vercel mate el fire-and-forget al responder Calendly.
 * Si reason=reschedule: tras éxito o fallo final → case/reschedule.notify.
 */
export const enrichMeetArtifacts = inngest.createFunction(
  {
    id: "enrich-meet",
    name: "Enrich Meet from Calendly/Calendar",
    retries: 4,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/meet.enrich" }],
    onFailure: async ({ event }) => {
      const original = event.data.event.data as MeetEnrichEventData;
      if (original?.reason !== "reschedule" || !original.caseId) return;
      await scheduleRescheduleNotify(original.caseId, {
        calendlyEventUuid: original.calendlyEventUuid,
      });
    },
  },
  async ({ event, step }) => {
    const data = event.data as MeetEnrichEventData;
    const caseId = data.caseId;
    if (!caseId) throw new Error("missing_case_id");

    const result = await step.run("enrich-meet", async () =>
      enrichMeetForCase(caseId)
    );

    if (!result.ok) {
      const retryable = RETRYABLE_ENRICH_ERRORS.includes(result.error);
      if (retryable) {
        throw new Error(result.error);
      }
      // Fallo no recuperable: igual avisamos reagenda con el meet que haya.
      if (data.reason === "reschedule") {
        await step.run("notify-reschedule-after-enrich-fail", async () => {
          await scheduleRescheduleNotify(caseId, {
            calendlyEventUuid: data.calendlyEventUuid,
          });
        });
      }
      return { ok: false as const, error: result.error, step: result.step };
    }

    if (data.reason === "reschedule") {
      await step.run("notify-reschedule-after-enrich", async () => {
        await scheduleRescheduleNotify(caseId, {
          calendlyEventUuid: data.calendlyEventUuid,
        });
      });
    }

    return {
      ok: true as const,
      meetUrl: result.meetUrl,
      meetCode: result.meetCode,
      googleCalendarEventId: result.googleCalendarEventId,
    };
  }
);

/**
 * Encola enrich Meet vía Inngest (prod).
 * En local (send disabled): corre inline para no perder el Meet en pruebas.
 */
export async function scheduleMeetEnrichmentJob(
  caseId: string,
  opts?: {
    calendlyEventUuid?: string | null;
    reason?: "schedule" | "reschedule";
  }
): Promise<void> {
  const reason = opts?.reason ?? "schedule";

  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — enrich Meet inline %s",
      tivalRuntimeEnv(),
      caseId
    );
    await runEnrichInlineThenMaybeNotify(caseId, reason, opts?.calendlyEventUuid);
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn("[inngest] INNGEST_EVENT_KEY missing — enrich Meet inline");
    await runEnrichInlineThenMaybeNotify(caseId, reason, opts?.calendlyEventUuid);
    return;
  }

  const uuid = opts?.calendlyEventUuid?.trim() || "na";
  try {
    await inngest.send({
      id: `meet-enrich-${caseId}-${uuid}`,
      name: "case/meet.enrich",
      data: {
        caseId,
        calendlyEventUuid: opts?.calendlyEventUuid ?? null,
        reason,
      } satisfies MeetEnrichEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] scheduleMeetEnrichmentJob",
      caseId,
      e instanceof Error ? e.message : e
    );
    await runEnrichInlineThenMaybeNotify(caseId, reason, opts?.calendlyEventUuid);
  }
}

async function runEnrichInlineThenMaybeNotify(
  caseId: string,
  reason: "schedule" | "reschedule",
  calendlyEventUuid?: string | null
): Promise<void> {
  if (reason === "reschedule") {
    try {
      await enrichMeetForCase(caseId);
    } catch (err) {
      console.error(
        "[enrich-meet]",
        caseId,
        err instanceof Error ? err.message : err
      );
    }
    await scheduleRescheduleNotify(caseId, { calendlyEventUuid });
    return;
  }

  const { scheduleMeetEnrichmentInline } = await import(
    "@/lib/integrations/enrich-meet"
  );
  scheduleMeetEnrichmentInline(caseId);
}

import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import { enrichMeetForCase } from "@/lib/integrations/enrich-meet";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

type MeetEnrichEventData = {
  caseId: string;
  /** Para dedupe por slot (reagenda = nuevo uuid → nuevo job). */
  calendlyEventUuid?: string | null;
};

/**
 * Resuelve Meet real (Calendly → Calendar) fuera del webhook HTTP.
 * Evita que Vercel mate el fire-and-forget al responder Calendly.
 */
export const enrichMeetArtifacts = inngest.createFunction(
  {
    id: "enrich-meet",
    name: "Enrich Meet from Calendly/Calendar",
    retries: 4,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/meet.enrich" }],
  },
  async ({ event, step }) => {
    const data = event.data as MeetEnrichEventData;
    const caseId = data.caseId;
    if (!caseId) throw new Error("missing_case_id");

    const result = await step.run("enrich-meet", async () =>
      enrichMeetForCase(caseId)
    );

    if (!result.ok) {
      // Reintento Inngest si Calendly aún procesa conference / Calendar no listo.
      const retryable = [
        "calendly_calendar_event_missing",
        "meet_link_missing_on_calendar_event",
        "calendly_conference_failed",
      ].includes(result.error);
      if (retryable) {
        throw new Error(result.error);
      }
      return { ok: false as const, error: result.error, step: result.step };
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
  opts?: { calendlyEventUuid?: string | null }
): Promise<void> {
  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — enrich Meet inline %s",
      tivalRuntimeEnv(),
      caseId
    );
    const { scheduleMeetEnrichmentInline } = await import(
      "@/lib/integrations/enrich-meet"
    );
    scheduleMeetEnrichmentInline(caseId);
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn("[inngest] INNGEST_EVENT_KEY missing — enrich Meet inline");
    const { scheduleMeetEnrichmentInline } = await import(
      "@/lib/integrations/enrich-meet"
    );
    scheduleMeetEnrichmentInline(caseId);
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
      } satisfies MeetEnrichEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] scheduleMeetEnrichmentJob",
      caseId,
      e instanceof Error ? e.message : e
    );
    // Fallback: no perder el enrich si Inngest falla al encolar.
    const { scheduleMeetEnrichmentInline } = await import(
      "@/lib/integrations/enrich-meet"
    );
    scheduleMeetEnrichmentInline(caseId);
  }
}

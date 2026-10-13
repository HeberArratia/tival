/**
 * Invita al consultor al evento Calendar (attendee) al asignar / post meet enrich.
 * COHOST Meet es best-effort dentro de grantConsultantMeetAccess — no falla el job.
 */

import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import {
  grantConsultantMeetAccess,
  logGrantResult,
  type GrantConsultantMeetAccessResult,
} from "@/lib/integrations/grant-consultant-meet-access";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

export type GrantConsultantMeetAccessEventData = {
  caseId: string;
  consultantId: string;
  previousConsultantId?: string | null;
  actor?: string;
};

/** Steps de Calendar/token que vale reintentar (no COHOST ni errores permanentes). */
const RETRYABLE_STEPS = new Set(["google_token", "calendar_attendees"]);

function isRetryable(result: GrantConsultantMeetAccessResult): boolean {
  if (result.ok) return false;
  if (result.step && RETRYABLE_STEPS.has(result.step)) {
    // google_not_connected es permanente; refresh fallido sí reintenta.
    if (
      result.step === "google_token" &&
      result.error === "google_not_connected"
    ) {
      return false;
    }
    return true;
  }
  if (result.status && result.status >= 500) return true;
  if (result.status === 429) return true;
  const err = result.error.toLowerCase();
  return (
    err.includes("timeout") ||
    err.includes("econnreset") ||
    err.includes("fetch failed") ||
    err.includes("temporarily")
  );
}

export const grantConsultantMeetAccessFn = inngest.createFunction(
  {
    id: "grant-consultant-meet-access",
    name: "Grant consultant Calendar invite",
    retries: 3,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/consultant.meet-access" }],
  },
  async ({ event, step }) => {
    const data = event.data as GrantConsultantMeetAccessEventData;
    const caseId = data.caseId;
    const consultantId = data.consultantId;
    if (!caseId || !consultantId) throw new Error("missing_grant_payload");

    const actor = data.actor ?? "integracion";
    const previousConsultantId = data.previousConsultantId ?? null;

    const result = await step.run("grant-calendar-invite", async () =>
      grantConsultantMeetAccess({
        caseId,
        consultantId,
        previousConsultantId,
        actor,
      })
    );

    // Reintentar antes de loguear para no duplicar case_events.
    if (!result.ok && isRetryable(result)) {
      throw new Error(result.error);
    }

    await step.run("log-grant-result", async () => {
      await logGrantResult(caseId, result, actor, {
        consultantId,
        previousConsultantId,
      });
    });

    return result;
  }
);

/**
 * Encola invite Calendar vía Inngest (prod).
 * En local (send disabled): corre inline para no perder la invitación.
 */
export async function scheduleGrantConsultantMeetAccessJob(input: {
  caseId: string;
  consultantId: string;
  previousConsultantId?: string | null;
  actor?: string;
}): Promise<void> {
  const actor = input.actor ?? "integracion";
  const previousConsultantId = input.previousConsultantId ?? null;

  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — grant consultant meet inline %s",
      tivalRuntimeEnv(),
      input.caseId
    );
    await runGrantInline({
      caseId: input.caseId,
      consultantId: input.consultantId,
      previousConsultantId,
      actor,
    });
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn(
      "[inngest] INNGEST_EVENT_KEY missing — grant consultant meet inline"
    );
    await runGrantInline({
      caseId: input.caseId,
      consultantId: input.consultantId,
      previousConsultantId,
      actor,
    });
    return;
  }

  try {
    await inngest.send({
      id: `consultant-meet-${input.caseId}-${input.consultantId}-${Date.now()}`,
      name: "case/consultant.meet-access",
      data: {
        caseId: input.caseId,
        consultantId: input.consultantId,
        previousConsultantId,
        actor,
      } satisfies GrantConsultantMeetAccessEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] scheduleGrantConsultantMeetAccessJob",
      input.caseId,
      e instanceof Error ? e.message : e
    );
    await runGrantInline({
      caseId: input.caseId,
      consultantId: input.consultantId,
      previousConsultantId,
      actor,
    });
  }
}

async function runGrantInline(input: {
  caseId: string;
  consultantId: string;
  previousConsultantId: string | null;
  actor: string;
}): Promise<void> {
  try {
    const result = await grantConsultantMeetAccess(input);
    await logGrantResult(input.caseId, result, input.actor, {
      consultantId: input.consultantId,
      previousConsultantId: input.previousConsultantId,
    });
  } catch (err) {
    console.error(
      "[grant-consultant-meet-access]",
      input.caseId,
      err instanceof Error ? err.message : err
    );
    try {
      await logGrantResult(
        input.caseId,
        {
          ok: false,
          error: err instanceof Error ? err.message : "unknown_error",
          step: "unexpected",
        },
        input.actor,
        {
          consultantId: input.consultantId,
          previousConsultantId: input.previousConsultantId,
        }
      );
    } catch {
      // ignore secondary log failure
    }
  }
}

import { createHmac, timingSafeEqual } from "crypto";
import {
  cancelCase,
  findCaseAwaitingReschedule,
  mergeScheduleIntoCase,
  rescheduleCase,
  scheduleCase,
} from "@/lib/cases";
import { isTivalReagendaTracking } from "@/lib/calendly-booking-link";
import {
  findConnectionByWebhookToken,
  touchConnectionEvent,
} from "@/lib/integrations/connections";
import {
  normalizeCalendlyBody,
  parseCalendlyInviteePayload,
  scheduledEventUuidFromCalendlyRef,
} from "@/lib/integrations/calendly-parse";
import { scheduleMeetEnrichmentJob } from "@/inngest/functions/enrich-meet";
import { getWorkspacePack } from "@/lib/workspace/registry";

/**
 * Calendly firma: header `Calendly-Webhook-Signature: t=…,v1=…`
 * HMAC-SHA256(signing_key, `${t}.${rawBody}`).
 */
export function verifyCalendlySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string | null
): { ok: boolean; reason?: string } {
  if (!signingKey) {
    return { ok: false, reason: "missing_signing_key" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "missing_signature_header" };
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.trim().split("=");
      return [k, v];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, reason: "malformed_signature" };

  const expected = createHmac("sha256", signingKey)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(v1, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "bad_signature" };
    }
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}

export async function handleCalendlyWebhook(input: {
  webhookToken: string;
  rawBody: string;
  signatureHeader: string | null;
  /** Dev / CLI: permitir sin firma si la conexión aún no tiene key. */
  allowUnsignedDev?: boolean;
}) {
  const found = await findConnectionByWebhookToken(input.webhookToken);
  if (!found) {
    return {
      status: 404 as const,
      body: { ok: false, error: "unknown_webhook_token" },
    };
  }

  const { connection, workspace, signingKey } = found;

  if (connection.provider !== "calendly") {
    return {
      status: 400 as const,
      body: { ok: false, error: "provider_mismatch" },
    };
  }

  const verify = verifyCalendlySignature(
    input.rawBody,
    input.signatureHeader,
    signingKey
  );

  const unsignedAllowed =
    Boolean(input.allowUnsignedDev) &&
    !signingKey &&
    process.env.NODE_ENV !== "production";

  if (!verify.ok && !unsignedAllowed) {
    await touchConnectionEvent(connection.id, {
      error: verify.reason ?? "signature_failed",
    });
    return {
      status: 401 as const,
      body: { ok: false, error: verify.reason ?? "unauthorized" },
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    return {
      status: 400 as const,
      body: { ok: false, error: "invalid_json" },
    };
  }

  const body = normalizeCalendlyBody(parsedJson);
  const pack = getWorkspacePack(workspace.slug);
  const parsed = parseCalendlyInviteePayload(body, pack.calendlyMapping);
  const event = parsed.event;
  const eventUuid = parsed.eventUuid;
  const eventUri = parsed.eventUri;

  if (!eventUuid) {
    return {
      status: 400 as const,
      body: { ok: false, error: "missing_calendly_event_uuid" },
    };
  }

  const payload = (body.payload ?? body) as Record<string, unknown>;
  /** Reagenda nativa: canceled trae rescheduled+new_invitee; created trae old_invitee. */
  const previousEventUuid = scheduledEventUuidFromCalendlyRef(
    payload.old_invitee
  );
  const isNativeReschedule =
    payload.rescheduled === true ||
    Boolean(payload.old_invitee) ||
    Boolean(payload.new_invitee);

  try {
    if (event.includes("canceled") || event.includes("cancelled")) {
      // El created del slot nuevo hace el merge. Cancelar acá borraría la opp pagada.
      if (isNativeReschedule) {
        await touchConnectionEvent(connection.id);
        return {
          status: 200 as const,
          body: {
            ok: true,
            action: "reschedule_cancel_ignored",
            workspace: workspace.slug,
          },
        };
      }

      const result = await cancelCase({
        workspaceId: workspace.id,
        calendlyEventUuid: eventUuid,
        reason: "calendly_canceled",
        actor: "calendly",
      });
      await touchConnectionEvent(connection.id);
      return {
        status: 200 as const,
        body: {
          ok: true,
          action: "cancelled",
          caseId: result.id,
          workspace: workspace.slug,
        },
      };
    }

    if (previousEventUuid && previousEventUuid !== eventUuid) {
      const q = parsed.qualification;
      const result = await rescheduleCase({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        previousCalendlyEventUuid: previousEventUuid,
        newCalendlyEventUuid: eventUuid,
        calendlyEventUri: eventUri,
        scheduledAt: parsed.scheduledAt,
        meetUrl: parsed.meetUrl,
        contactName: parsed.name,
        contactEmail: parsed.email,
        rescheduleUrl:
          typeof q.reschedule_url === "string" ? q.reschedule_url : null,
        cancelUrl: typeof q.cancel_url === "string" ? q.cancel_url : null,
      });
      await touchConnectionEvent(connection.id);
      await scheduleMeetEnrichmentJob(result.id, {
        calendlyEventUuid: eventUuid,
      });
      return {
        status: 200 as const,
        body: {
          ok: true,
          action: "rescheduled",
          caseId: result.id,
          workspace: workspace.slug,
        },
      };
    }

    const tracking = parsed.tracking as {
      utm_campaign?: string | null;
      utm_content?: string | null;
    };
    const reagendaTrack = isTivalReagendaTracking(tracking);
    const mergeTarget = await findCaseAwaitingReschedule({
      workspaceId: workspace.id,
      caseId: reagendaTrack.caseId,
      email: parsed.email,
    });

    if (mergeTarget) {
      const q = parsed.qualification;
      const result = await mergeScheduleIntoCase({
        caseId: mergeTarget.id,
        calendlyEventUuid: eventUuid,
        calendlyEventUri: eventUri,
        scheduledAt: parsed.scheduledAt,
        meetUrl: parsed.meetUrl,
        rescheduleUrl:
          typeof q.reschedule_url === "string" ? q.reschedule_url : null,
        cancelUrl: typeof q.cancel_url === "string" ? q.cancel_url : null,
      });
      await touchConnectionEvent(connection.id);
      await scheduleMeetEnrichmentJob(result.id, {
        calendlyEventUuid: eventUuid,
      });
      return {
        status: 200 as const,
        body: {
          ok: true,
          action: "rescheduled_merge",
          caseId: result.id,
          workspace: workspace.slug,
        },
      };
    }

    const result = await scheduleCase({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      calendlyEventUuid: eventUuid,
      calendlyEventUri: eventUri,
      contactName: parsed.name,
      contactEmail: parsed.email,
      contactPhone: parsed.phone,
      companyRut: parsed.rutEmpresa,
      scheduledAt: parsed.scheduledAt,
      meetUrl: parsed.meetUrl,
      qualification: parsed.qualification,
      qualificationLogId: parsed.qualificationLogId,
      landingSource: parsed.landingSource,
    });

    await touchConnectionEvent(connection.id);
    await scheduleMeetEnrichmentJob(result.id, {
      calendlyEventUuid: eventUuid,
    });
    return {
      status: 200 as const,
      body: {
        ok: true,
        action: "scheduled",
        caseId: result.id,
        workspace: workspace.slug,
        contact: {
          name: parsed.name,
          email: parsed.email,
          phone: parsed.phone,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    await touchConnectionEvent(connection.id, { error: message });
    return {
      status: 500 as const,
      body: { ok: false, error: message },
    };
  }
}

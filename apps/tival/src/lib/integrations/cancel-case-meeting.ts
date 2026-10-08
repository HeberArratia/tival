/**
 * Al marcar Perdido / no_pago: cancelar la reunión en Calendly → Calendar/Meet.
 * Best-effort: no revierte el cierre CRM si Google/Calendly falla.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, cases, type CaseRow } from "@/db/schema";
import {
  cancelCalendlyScheduledEvent,
} from "@/lib/integrations/calendly-api";
import {
  getCalendlyApiTokenForWorkspace,
  getDriveConnectionForWorkspace,
  persistDriveTokens,
} from "@/lib/integrations/connections";
import { deleteCalendarEvent } from "@/lib/integrations/google-calendar/client";
import { resolveDriveAccessToken } from "@/lib/integrations/google-drive/client";

export type CancelCaseMeetingResult =
  | {
      ok: true;
      skipped: false;
      via: "calendly" | "calendar";
      calendlyEventUuid?: string | null;
      googleCalendarEventId?: string | null;
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
    }
  | {
      ok: false;
      error: string;
      step?: string;
      status?: number;
    };

export async function cancelCaseMeeting(
  caseId: string
): Promise<CancelCaseMeetingResult> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row) return { ok: false, error: "case_not_found", step: "load" };

  if (!row.calendlyEventUuid && !row.googleCalendarEventId) {
    return {
      ok: true,
      skipped: true,
      reason: "no_scheduled_meeting",
    };
  }

  // Preferir Calendly: cancela Calendar/Meet y notifica al invitee.
  if (row.calendlyEventUuid) {
    const apiToken = await getCalendlyApiTokenForWorkspace(row.workspaceId);
    if (apiToken) {
      const canceled = await cancelCalendlyScheduledEvent({
        apiToken,
        eventUuid: row.calendlyEventUuid,
        reason: "No pagó · oportunidad perdida en Tival",
      });
      if (canceled.ok) {
        return {
          ok: true,
          skipped: false,
          via: "calendly",
          calendlyEventUuid: row.calendlyEventUuid,
          googleCalendarEventId: row.googleCalendarEventId,
        };
      }
      // Si Calendly ya está cancelado (404), seguimos a Calendar por si el event quedó.
      if (canceled.status !== 404) {
        console.warn(
          "[cancel-case-meeting] calendly",
          caseId,
          canceled.error
        );
      }
    }
  }

  if (!row.googleCalendarEventId) {
    return {
      ok: true,
      skipped: true,
      reason: "calendar_event_missing",
    };
  }

  const drive = await getDriveConnectionForWorkspace(row.workspaceId);
  if (!drive?.tokens?.refreshToken) {
    return { ok: false, error: "google_not_connected", step: "google_token" };
  }

  let accessToken: string;
  try {
    const resolved = await resolveDriveAccessToken(drive.tokens);
    accessToken = resolved.accessToken;
    if (
      resolved.tokens.accessToken !== drive.tokens.accessToken ||
      resolved.tokens.expiresAt !== drive.tokens.expiresAt
    ) {
      await persistDriveTokens({
        connectionId: drive.connectionId,
        tokens: resolved.tokens,
      });
    }
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "google_token_refresh_failed";
    return { ok: false, error: message, step: "google_token" };
  }

  const deleted = await deleteCalendarEvent({
    accessToken,
    eventId: row.googleCalendarEventId,
  });
  if (!deleted.ok) {
    return {
      ok: false,
      error: deleted.error,
      status: deleted.status,
      step: "calendar_delete",
    };
  }

  return {
    ok: true,
    skipped: false,
    via: "calendar",
    calendlyEventUuid: row.calendlyEventUuid,
    googleCalendarEventId: row.googleCalendarEventId,
  };
}

async function logCancelResult(
  caseId: string,
  result: CancelCaseMeetingResult,
  actor: string
) {
  const db = await getDb();
  if (result.ok && result.skipped) {
    await db.insert(caseEvents).values({
      caseId,
      type: "meeting_cancel_skipped",
      payload: { reason: result.reason },
      actor,
    });
    return;
  }
  if (result.ok) {
    await db.insert(caseEvents).values({
      caseId,
      type: "meeting_canceled",
      payload: {
        via: result.via,
        calendlyEventUuid: result.calendlyEventUuid ?? null,
        googleCalendarEventId: result.googleCalendarEventId ?? null,
      },
      actor,
    });
    return;
  }
  await db.insert(caseEvents).values({
    caseId,
    type: "meeting_cancel_failed",
    payload: {
      error: result.error,
      step: result.step ?? null,
      status: result.status ?? null,
    },
    actor,
  });
}

/** Cancela y deja traza en timeline. Awaitable (seguro en serverless). */
export async function cancelCaseMeetingAndLog(input: {
  caseId: string;
  actor?: string;
}): Promise<CancelCaseMeetingResult> {
  const actor = input.actor ?? "integracion";
  try {
    const result = await cancelCaseMeeting(input.caseId);
    await logCancelResult(input.caseId, result, actor);
    return result;
  } catch (err) {
    console.error(
      "[cancel-case-meeting]",
      input.caseId,
      err instanceof Error ? err.message : err
    );
    try {
      const db = await getDb();
      await db.insert(caseEvents).values({
        caseId: input.caseId,
        type: "meeting_cancel_failed",
        payload: {
          error: err instanceof Error ? err.message : "unknown_error",
          step: "unexpected",
        },
        actor,
      });
    } catch {
      // ignore secondary log failure
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown_error",
      step: "unexpected",
    };
  }
}

/** @deprecated Prefer cancelCaseMeetingAndLog (await). */
export function scheduleCancelCaseMeeting(input: {
  caseId: string;
  actor?: string;
}) {
  void cancelCaseMeetingAndLog(input);
}

/** Helper tipado por si hace falta cancelar desde otro flujo. */
export function caseHasCancelableMeeting(row: CaseRow): boolean {
  return Boolean(row.calendlyEventUuid || row.googleCalendarEventId);
}

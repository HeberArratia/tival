/**
 * Al asignar consultor: invitar al evento Calendar + COHOST en Meet.
 * Best-effort: no revierte la asignación CRM si Google falla.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, cases, type CaseRow } from "@/db/schema";
import {
  getDriveConnectionForWorkspace,
  persistDriveTokens,
} from "@/lib/integrations/connections";
import { patchCalendarEventAttendees } from "@/lib/integrations/google-calendar/client";
import { resolveDriveAccessToken } from "@/lib/integrations/google-drive/client";
import {
  ensureSpaceCohost,
  getSpaceByMeetingCode,
} from "@/lib/integrations/google-meet/client";
import { ensureMemberIsConsultor, listMembers } from "@/lib/members";

export type GrantConsultantMeetAccessResult =
  | {
      ok: true;
      skipped: false;
      calendarAdded: string[];
      calendarRemoved: string[];
      cohostEmail: string;
      spaceName: string;
      alreadyCohost: boolean;
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

async function resolveConsultantEmail(
  consultantId: string
): Promise<string | null> {
  try {
    const m = await ensureMemberIsConsultor(consultantId);
    return m.email?.trim().toLowerCase() || null;
  } catch {
    const all = await listMembers();
    const m = all.find((x) => x.id === consultantId);
    return m?.email?.trim().toLowerCase() || null;
  }
}

async function resolvePreviousConsultantEmail(
  previousConsultantId: string | null | undefined,
  currentEmail: string
): Promise<string | null> {
  if (!previousConsultantId) return null;
  const email = await resolveConsultantEmail(previousConsultantId);
  if (!email || email === currentEmail) return null;
  return email;
}

export async function grantConsultantMeetAccess(input: {
  caseId: string;
  consultantId: string;
  previousConsultantId?: string | null;
  actor?: string;
}): Promise<GrantConsultantMeetAccessResult> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!row) return { ok: false, error: "case_not_found", step: "load" };

  const email = await resolveConsultantEmail(input.consultantId);
  if (!email) {
    return { ok: false, error: "consultant_email_missing", step: "member" };
  }

  const previousEmail = await resolvePreviousConsultantEmail(
    input.previousConsultantId ?? null,
    email
  );

  if (!row.meetCode && !row.googleCalendarEventId) {
    return {
      ok: true,
      skipped: true,
      reason: "meet_not_enriched_yet",
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

  let calendarAdded: string[] = [];
  let calendarRemoved: string[] = [];

  if (row.googleCalendarEventId) {
    const patched = await patchCalendarEventAttendees({
      accessToken,
      eventId: row.googleCalendarEventId,
      addEmails: [email],
      removeEmails: previousEmail ? [previousEmail] : [],
    });
    if (!patched.ok) {
      return {
        ok: false,
        error: patched.error,
        status: patched.status,
        step: "calendar_attendees",
      };
    }
    calendarAdded = patched.added;
    calendarRemoved = patched.removed;
  }

  if (!row.meetCode) {
    return {
      ok: true,
      skipped: true,
      reason: "meet_code_missing",
    };
  }

  const space = await getSpaceByMeetingCode({
    accessToken,
    meetingCode: row.meetCode,
  });
  if (!space.ok) {
    return {
      ok: false,
      error: space.error,
      status: space.status,
      step: "meet_space",
    };
  }

  const cohost = await ensureSpaceCohost({
    accessToken,
    spaceName: space.space.name,
    email,
    previousEmails: previousEmail ? [previousEmail] : [],
  });
  if (!cohost.ok) {
    return {
      ok: false,
      error: cohost.error,
      status: cohost.status,
      step: cohost.step ?? "meet_cohost",
    };
  }

  return {
    ok: true,
    skipped: false,
    calendarAdded,
    calendarRemoved,
    cohostEmail: email,
    spaceName: space.space.name,
    alreadyCohost: cohost.alreadyCohost,
  };
}

async function logGrantResult(
  caseId: string,
  result: GrantConsultantMeetAccessResult,
  actor: string,
  meta: { consultantId: string; previousConsultantId?: string | null }
) {
  const db = await getDb();
  if (result.ok) {
    if (result.skipped) {
      await db.insert(caseEvents).values({
        caseId,
        type: "consultant_meet_access_skipped",
        payload: {
          reason: result.reason,
          consultantId: meta.consultantId,
          previousConsultantId: meta.previousConsultantId ?? null,
        },
        actor,
      });
      return;
    }
    await db.insert(caseEvents).values({
      caseId,
      type: "consultant_meet_access_granted",
      payload: {
        consultantId: meta.consultantId,
        previousConsultantId: meta.previousConsultantId ?? null,
        cohostEmail: result.cohostEmail,
        spaceName: result.spaceName,
        alreadyCohost: result.alreadyCohost,
        calendarAdded: result.calendarAdded,
        calendarRemoved: result.calendarRemoved,
      },
      actor,
    });
    return;
  }
  await db.insert(caseEvents).values({
    caseId,
    type: "consultant_meet_access_failed",
    payload: {
      consultantId: meta.consultantId,
      previousConsultantId: meta.previousConsultantId ?? null,
      error: result.error,
      step: result.step ?? null,
      status: result.status ?? null,
    },
    actor,
  });
}

/** Fire-and-forget tras assignConsultant / meet enrich. */
export function scheduleGrantConsultantMeetAccess(input: {
  caseId: string;
  consultantId: string;
  previousConsultantId?: string | null;
  actor?: string;
}) {
  const actor = input.actor ?? "integracion";
  void grantConsultantMeetAccess(input)
    .then((result) =>
      logGrantResult(input.caseId, result, actor, {
        consultantId: input.consultantId,
        previousConsultantId: input.previousConsultantId,
      })
    )
    .catch(async (err) => {
      console.error(
        "[grant-consultant-meet-access]",
        input.caseId,
        err instanceof Error ? err.message : err
      );
      try {
        const db = await getDb();
        await db.insert(caseEvents).values({
          caseId: input.caseId,
          type: "consultant_meet_access_failed",
          payload: {
            consultantId: input.consultantId,
            previousConsultantId: input.previousConsultantId ?? null,
            error: err instanceof Error ? err.message : "unknown_error",
            step: "unexpected",
          },
          actor,
        });
      } catch {
        // ignore secondary log failure
      }
    });
}

/** Si el case ya tiene consultor al enriquecer Meet, otorga acceso. */
export function scheduleGrantIfConsultantAssigned(row: CaseRow) {
  if (!row.assignedConsultantId) return;
  if (!row.meetCode && !row.googleCalendarEventId) return;
  scheduleGrantConsultantMeetAccess({
    caseId: row.id,
    consultantId: row.assignedConsultantId,
    previousConsultantId: null,
    actor: "integracion",
  });
}

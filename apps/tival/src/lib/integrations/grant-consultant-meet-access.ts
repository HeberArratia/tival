/**
 * Al asignar consultor: invitar al evento Calendar (+ COHOST Meet best-effort).
 * Éxito = attendee en Calendar. COHOST no bloquea (scopes Meet a menudo fallan).
 * No revierte la asignación CRM si Google falla.
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

export type GrantCohostResult =
  | {
      ok: true;
      skipped: false;
      cohostEmail: string;
      spaceName: string;
      alreadyCohost: boolean;
    }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string; step?: string; status?: number };

export type GrantConsultantMeetAccessResult =
  | {
      ok: true;
      skipped: false;
      calendarAdded: string[];
      calendarRemoved: string[];
      consultantEmail: string;
      cohost: GrantCohostResult;
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

async function tryGrantCohost(input: {
  accessToken: string;
  meetCode: string | null;
  email: string;
  previousEmail: string | null;
}): Promise<GrantCohostResult> {
  if (!input.meetCode) {
    return { ok: true, skipped: true, reason: "meet_code_missing" };
  }

  const space = await getSpaceByMeetingCode({
    accessToken: input.accessToken,
    meetingCode: input.meetCode,
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
    accessToken: input.accessToken,
    spaceName: space.space.name,
    email: input.email,
    previousEmails: input.previousEmail ? [input.previousEmail] : [],
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
    cohostEmail: input.email,
    spaceName: space.space.name,
    alreadyCohost: cohost.alreadyCohost,
  };
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

  if (!row.googleCalendarEventId) {
    return {
      ok: true,
      skipped: true,
      reason: row.meetCode ? "calendar_event_missing" : "meet_not_enriched_yet",
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

  // COHOST: best-effort (permisos Meet a menudo insuficientes). No falla el grant.
  let cohost: GrantCohostResult;
  try {
    cohost = await tryGrantCohost({
      accessToken,
      meetCode: row.meetCode,
      email,
      previousEmail,
    });
  } catch (e) {
    cohost = {
      ok: false,
      error: e instanceof Error ? e.message : "cohost_unexpected_error",
      step: "meet_cohost",
    };
  }

  return {
    ok: true,
    skipped: false,
    calendarAdded: patched.added,
    calendarRemoved: patched.removed,
    consultantEmail: email,
    cohost,
  };
}

export async function logGrantResult(
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
        consultantEmail: result.consultantEmail,
        calendarAdded: result.calendarAdded,
        calendarRemoved: result.calendarRemoved,
        cohost: result.cohost,
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

/** Si el case ya tiene consultor al enriquecer Meet, otorga acceso (vía Inngest). */
export function scheduleGrantIfConsultantAssigned(row: CaseRow) {
  if (!row.assignedConsultantId) return;
  if (!row.googleCalendarEventId) return;
  void import("@/inngest/functions/grant-consultant-meet-access")
    .then(({ scheduleGrantConsultantMeetAccessJob }) =>
      scheduleGrantConsultantMeetAccessJob({
        caseId: row.id,
        consultantId: row.assignedConsultantId!,
        previousConsultantId: null,
        actor: "integracion",
      })
    )
    .catch((err) => {
      console.error(
        "[grant-if-consultant-assigned]",
        row.id,
        err instanceof Error ? err.message : err
      );
    });
}

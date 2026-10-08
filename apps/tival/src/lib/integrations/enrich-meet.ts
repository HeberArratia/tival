/**
 * Enrichment Meet: Calendly GET → Calendar events.get → meetUrl/meetCode en el case.
 * Pensado para correr sin bloquear el webhook (fire-and-forget).
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cases } from "@/db/schema";
import { applyMeetEnrichment } from "@/lib/cases";
import { fetchCalendlyScheduledEvent } from "@/lib/integrations/calendly-api";
import {
  getCalendlyApiTokenForWorkspace,
  getDriveConnectionForWorkspace,
  persistDriveTokens,
} from "@/lib/integrations/connections";
import {
  fetchCalendarEventMeet,
  meetCodeFromUrl,
} from "@/lib/integrations/google-calendar/client";
import { resolveDriveAccessToken } from "@/lib/integrations/google-drive/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reintentos mientras location.status === processing. */
const RETRY_DELAYS_MS = [0, 2_000, 5_000, 10_000];

export type EnrichMeetResult =
  | {
      ok: true;
      meetUrl: string;
      meetCode: string;
      googleCalendarEventId: string;
    }
  | { ok: false; error: string; step?: string };

export async function enrichMeetForCase(
  caseId: string
): Promise<EnrichMeetResult> {
  const db = await getDb();
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) return { ok: false, error: "case_not_found", step: "load" };

  const eventUuid = row.calendlyEventUuid;
  if (!eventUuid) {
    return { ok: false, error: "missing_calendly_event_uuid", step: "load" };
  }

  const apiToken = await getCalendlyApiTokenForWorkspace(row.workspaceId);
  if (!apiToken) {
    await applyMeetEnrichment({
      caseId,
      failed: true,
      error: "calendly_api_token_missing",
    });
    return {
      ok: false,
      error: "calendly_api_token_missing",
      step: "calendly_token",
    };
  }

  let externalId: string | null = null;
  let locationStatus: string | null = null;

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    const fetched = await fetchCalendlyScheduledEvent({
      apiToken,
      eventUuid,
    });
    if (!fetched.ok) {
      await applyMeetEnrichment({
        caseId,
        failed: true,
        error: fetched.error,
      });
      return {
        ok: false,
        error: fetched.error,
        step: "calendly_get",
      };
    }

    locationStatus = fetched.resource.location?.status ?? null;
    externalId = fetched.resource.calendar_event?.external_id ?? null;

    if (externalId) break;
    if (locationStatus && locationStatus !== "processing") break;
  }

  if (!externalId) {
    const err =
      locationStatus === "failed"
        ? "calendly_conference_failed"
        : "calendly_calendar_event_missing";
    await applyMeetEnrichment({ caseId, failed: true, error: err });
    return { ok: false, error: err, step: "calendly_external_id" };
  }

  const drive = await getDriveConnectionForWorkspace(row.workspaceId);
  if (!drive?.tokens?.refreshToken) {
    await applyMeetEnrichment({
      caseId,
      failed: true,
      error: "google_not_connected",
    });
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
    const message = e instanceof Error ? e.message : "google_token_refresh_failed";
    await applyMeetEnrichment({ caseId, failed: true, error: message });
    return { ok: false, error: message, step: "google_token" };
  }

  const cal = await fetchCalendarEventMeet({
    accessToken,
    eventId: externalId,
  });
  if (!cal.ok) {
    await applyMeetEnrichment({ caseId, failed: true, error: cal.error });
    return { ok: false, error: cal.error, step: "calendar_get" };
  }

  const meetUrl = cal.event.hangoutLink;
  const meetCode =
    cal.event.conferenceId || meetCodeFromUrl(meetUrl) || null;

  if (!meetUrl || !meetCode) {
    await applyMeetEnrichment({
      caseId,
      failed: true,
      error: "meet_link_missing_on_calendar_event",
      googleCalendarEventId: externalId,
    });
    return {
      ok: false,
      error: "meet_link_missing_on_calendar_event",
      step: "calendar_meet",
    };
  }

  await applyMeetEnrichment({
    caseId,
    meetUrl,
    meetCode,
    googleCalendarEventId: externalId,
  });

  return {
    ok: true,
    meetUrl,
    meetCode,
    googleCalendarEventId: externalId,
  };
}

/** Fallback fire-and-forget (local o si Inngest no encola). */
export function scheduleMeetEnrichmentInline(caseId: string) {
  void enrichMeetForCase(caseId).catch((err) => {
    console.error(
      "[enrich-meet]",
      caseId,
      err instanceof Error ? err.message : err
    );
  });
}

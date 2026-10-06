/** Google Calendar API v3 — lectura de evento (hangoutLink / conferenceId). */

export type CalendarEventMeet = {
  id: string;
  hangoutLink: string | null;
  conferenceId: string | null;
  summary: string | null;
  location: string | null;
};

export async function fetchCalendarEventMeet(input: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
}): Promise<
  | { ok: true; event: CalendarEventMeet }
  | { ok: false; error: string; status?: number }
> {
  const calendarId = encodeURIComponent(input.calendarId || "primary");
  const eventId = encodeURIComponent(input.eventId);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });

  const data = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    summary?: string;
    location?: string;
    conferenceData?: {
      conferenceId?: string;
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    };
    error?: { message?: string; code?: number };
  };

  if (!res.ok || !data.id) {
    return {
      ok: false,
      status: res.status,
      error: data.error?.message || `calendar_event_${res.status}`,
    };
  }

  const fromEntry =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ?? null;
  const hangoutLink = data.hangoutLink || fromEntry || null;
  const conferenceId =
    data.conferenceData?.conferenceId ||
    meetCodeFromUrl(hangoutLink) ||
    null;

  return {
    ok: true,
    event: {
      id: data.id,
      hangoutLink,
      conferenceId,
      summary: data.summary ?? null,
      location: data.location ?? null,
    },
  };
}

export function meetCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(
    /meet\.google\.com\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})/i
  );
  return m ? m[1].toLowerCase() : null;
}

/** Google Calendar API v3 — evento (hangoutLink / conferenceId / attendees). */

export type CalendarEventAttendee = {
  email: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
};

export type CalendarEventMeet = {
  id: string;
  hangoutLink: string | null;
  conferenceId: string | null;
  summary: string | null;
  location: string | null;
  attendees: CalendarEventAttendee[];
};

type CalendarEventRaw = {
  id?: string;
  hangoutLink?: string;
  summary?: string;
  location?: string;
  attendees?: CalendarEventAttendee[];
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  error?: { message?: string; code?: number };
};

function mapCalendarEvent(data: CalendarEventRaw): CalendarEventMeet {
  const fromEntry =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ?? null;
  const hangoutLink = data.hangoutLink || fromEntry || null;
  const conferenceId =
    data.conferenceData?.conferenceId ||
    meetCodeFromUrl(hangoutLink) ||
    null;

  return {
    id: data.id!,
    hangoutLink,
    conferenceId,
    summary: data.summary ?? null,
    location: data.location ?? null,
    attendees: (data.attendees ?? []).filter(
      (a): a is CalendarEventAttendee => Boolean(a?.email)
    ),
  };
}

function calendarEventUrl(eventId: string, calendarId?: string) {
  const cal = encodeURIComponent(calendarId || "primary");
  const ev = encodeURIComponent(eventId);
  return `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${ev}`;
}

export async function fetchCalendarEventMeet(input: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
}): Promise<
  | { ok: true; event: CalendarEventMeet }
  | { ok: false; error: string; status?: number }
> {
  const url = calendarEventUrl(input.eventId, input.calendarId);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });

  const data = (await res.json()) as CalendarEventRaw;

  if (!res.ok || !data.id) {
    return {
      ok: false,
      status: res.status,
      error: data.error?.message || `calendar_event_${res.status}`,
    };
  }

  return { ok: true, event: mapCalendarEvent(data) };
}

/**
 * Invita / quita attendees del evento. No toca organizer.
 * sendUpdates=all notifica a los invitados.
 */
export async function patchCalendarEventAttendees(input: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
  addEmails?: string[];
  removeEmails?: string[];
}): Promise<
  | { ok: true; event: CalendarEventMeet; added: string[]; removed: string[] }
  | { ok: false; error: string; status?: number }
> {
  const fetched = await fetchCalendarEventMeet(input);
  if (!fetched.ok) return fetched;

  const normalize = (e: string) => e.trim().toLowerCase();
  const removeSet = new Set((input.removeEmails ?? []).map(normalize).filter(Boolean));
  const addList = (input.addEmails ?? [])
    .map(normalize)
    .filter((e) => e && !removeSet.has(e));

  const existing = fetched.event.attendees;
  const kept = existing.filter((a) => !removeSet.has(normalize(a.email)));
  const keptEmails = new Set(kept.map((a) => normalize(a.email)));

  const toAdd = addList.filter((e) => !keptEmails.has(e));
  const removed = existing
    .filter((a) => removeSet.has(normalize(a.email)))
    .map((a) => normalize(a.email));

  if (toAdd.length === 0 && removed.length === 0) {
    return {
      ok: true,
      event: fetched.event,
      added: [],
      removed: [],
    };
  }

  const attendees = [
    ...kept.map((a) => ({ email: a.email })),
    ...toAdd.map((email) => ({ email })),
  ];

  const url = `${calendarEventUrl(input.eventId, input.calendarId)}?sendUpdates=all`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ attendees }),
  });

  const data = (await res.json()) as CalendarEventRaw;
  if (!res.ok || !data.id) {
    return {
      ok: false,
      status: res.status,
      error: data.error?.message || `calendar_patch_${res.status}`,
    };
  }

  return {
    ok: true,
    event: mapCalendarEvent(data),
    added: toAdd,
    removed,
  };
}

export function meetCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(
    /meet\.google\.com\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})/i
  );
  return m ? m[1].toLowerCase() : null;
}

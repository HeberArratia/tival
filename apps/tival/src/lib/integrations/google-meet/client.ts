/**
 * Google Meet API v2 (conferenceRecords → smartNotes / recordings / transcripts).
 * Requiere scope meetings.space.readonly + token de la cuenta organizadora.
 */

const MEET_API = "https://meet.googleapis.com/v2";

export type MeetConferenceRecord = {
  name: string;
  startTime?: string;
  endTime?: string;
  space?: string;
};

export type MeetSmartNote = {
  name?: string;
  state?: string;
  docsDestination?: {
    document?: string;
    exportUri?: string;
  };
};

export type MeetRecording = {
  name?: string;
  state?: string;
  driveDestination?: {
    file?: string;
    exportUri?: string;
  };
};

export type MeetTranscript = {
  name?: string;
  state?: string;
  docsDestination?: {
    document?: string;
    exportUri?: string;
  };
};

export type MeetArtifact = {
  kind: "notes" | "recording" | "transcript";
  fileId: string;
  state: string;
  exportUri?: string | null;
};

function extractDriveFileId(resource?: string | null): string | null {
  if (!resource) return null;
  const trimmed = resource.trim();
  if (!trimmed) return null;
  // "documents/xxx", "files/xxx" o id suelto
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

async function meetFetch<T>(
  accessToken: string,
  path: string
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${MEET_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: data.error?.message || `meet_api_${res.status}`,
    };
  }
  return { ok: true, data };
}

export async function listConferenceRecordsByMeetingCode(input: {
  accessToken: string;
  meetingCode: string;
}): Promise<
  | { ok: true; records: MeetConferenceRecord[] }
  | { ok: false; error: string }
> {
  const code = input.meetingCode.trim().toLowerCase();
  const filter = encodeURIComponent(`space.meeting_code="${code}"`);
  const result = await meetFetch<{ conferenceRecords?: MeetConferenceRecord[] }>(
    input.accessToken,
    `/conferenceRecords?filter=${filter}`
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, records: result.data.conferenceRecords ?? [] };
}

export async function listSmartNotes(input: {
  accessToken: string;
  conferenceName: string;
}): Promise<{ ok: true; notes: MeetSmartNote[] } | { ok: false; error: string }> {
  const result = await meetFetch<{
    smartNotes?: MeetSmartNote[];
    smartnotes?: MeetSmartNote[];
  }>(input.accessToken, `/${input.conferenceName}/smartNotes`);
  if (!result.ok) {
    // 404 = aún no hay notas
    if (result.status === 404) return { ok: true, notes: [] };
    return { ok: false, error: result.error };
  }
  const notes = result.data.smartNotes ?? result.data.smartnotes ?? [];
  return { ok: true, notes };
}

export async function listRecordings(input: {
  accessToken: string;
  conferenceName: string;
}): Promise<
  { ok: true; recordings: MeetRecording[] } | { ok: false; error: string }
> {
  const result = await meetFetch<{ recordings?: MeetRecording[] }>(
    input.accessToken,
    `/${input.conferenceName}/recordings`
  );
  if (!result.ok) {
    if (result.status === 404) return { ok: true, recordings: [] };
    return { ok: false, error: result.error };
  }
  return { ok: true, recordings: result.data.recordings ?? [] };
}

export async function listTranscripts(input: {
  accessToken: string;
  conferenceName: string;
}): Promise<
  { ok: true; transcripts: MeetTranscript[] } | { ok: false; error: string }
> {
  const result = await meetFetch<{ transcripts?: MeetTranscript[] }>(
    input.accessToken,
    `/${input.conferenceName}/transcripts`
  );
  if (!result.ok) {
    if (result.status === 404) return { ok: true, transcripts: [] };
    return { ok: false, error: result.error };
  }
  return { ok: true, transcripts: result.data.transcripts ?? [] };
}

const READY_STATES = new Set([
  "FILE_GENERATED",
  "STATE_FILE_GENERATED",
  "GENERATED",
  "READY",
]);

function isReadyState(state?: string | null) {
  if (!state) return false;
  const u = state.toUpperCase();
  return READY_STATES.has(u) || u.includes("GENERATED") || u.includes("READY");
}

/** Artefactos listos para mover (Notas Gemini prioritarias + recording/transcript). */
export async function fetchReadyMeetArtifacts(input: {
  accessToken: string;
  meetingCode: string;
}): Promise<
  | {
      ok: true;
      conference: MeetConferenceRecord | null;
      artifacts: MeetArtifact[];
      ended: boolean;
    }
  | { ok: false; error: string }
> {
  const listed = await listConferenceRecordsByMeetingCode(input);
  if (!listed.ok) return listed;

  const conference = listed.records[0] ?? null;
  if (!conference?.name) {
    return { ok: true, conference: null, artifacts: [], ended: false };
  }

  const ended = Boolean(conference.endTime);
  const artifacts: MeetArtifact[] = [];

  const notes = await listSmartNotes({
    accessToken: input.accessToken,
    conferenceName: conference.name,
  });
  if (!notes.ok) return notes;
  for (const n of notes.notes) {
    const fileId = extractDriveFileId(n.docsDestination?.document);
    if (fileId && isReadyState(n.state)) {
      artifacts.push({
        kind: "notes",
        fileId,
        state: n.state || "READY",
        exportUri: n.docsDestination?.exportUri ?? null,
      });
    }
  }

  const recs = await listRecordings({
    accessToken: input.accessToken,
    conferenceName: conference.name,
  });
  if (!recs.ok) return recs;
  for (const r of recs.recordings) {
    const fileId = extractDriveFileId(r.driveDestination?.file);
    if (fileId && isReadyState(r.state)) {
      artifacts.push({
        kind: "recording",
        fileId,
        state: r.state || "READY",
        exportUri: r.driveDestination?.exportUri ?? null,
      });
    }
  }

  const trs = await listTranscripts({
    accessToken: input.accessToken,
    conferenceName: conference.name,
  });
  if (!trs.ok) return trs;
  for (const t of trs.transcripts) {
    const fileId = extractDriveFileId(t.docsDestination?.document);
    if (fileId && isReadyState(t.state)) {
      artifacts.push({
        kind: "transcript",
        fileId,
        state: t.state || "READY",
        exportUri: t.docsDestination?.exportUri ?? null,
      });
    }
  }

  return { ok: true, conference, artifacts, ended };
}

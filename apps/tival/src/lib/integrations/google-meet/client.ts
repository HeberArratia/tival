/**
 * Google Meet API v2:
 * - conferenceRecords → smartNotes / recordings / transcripts (readonly)
 * - spaces + members → COHOST al asignar consultor (space.created)
 * Token de la cuenta organizadora (host Calendly / Google del workspace).
 */

const MEET_API = "https://meet.googleapis.com/v2";

export type MeetConferenceRecord = {
  name: string;
  startTime?: string;
  endTime?: string;
  space?: string;
};

export type MeetSpace = {
  name: string;
  meetingUri?: string;
  meetingCode?: string;
};

export type MeetSpaceMember = {
  name: string;
  email?: string;
  role?: "ROLE_UNSPECIFIED" | "COHOST" | string;
  user?: string;
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
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const method = init?.method ?? "GET";
  const res = await fetch(`${MEET_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) {
    return { ok: true, data: {} as T };
  }
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

/** Resuelve space real (`spaces/{id}`) desde meeting code (alias). */
export async function getSpaceByMeetingCode(input: {
  accessToken: string;
  meetingCode: string;
}): Promise<
  | { ok: true; space: MeetSpace }
  | { ok: false; error: string; status?: number }
> {
  const code = input.meetingCode.trim().toLowerCase();
  const result = await meetFetch<MeetSpace>(
    input.accessToken,
    `/spaces/${encodeURIComponent(code)}`
  );
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  if (!result.data.name) {
    return { ok: false, error: "meet_space_name_missing" };
  }
  return { ok: true, space: result.data };
}

/**
 * Activa/desactiva host management (= UI "Gestión de anfitrión").
 * Requiere scope meetings.space.settings (válido también en meets de Calendar).
 */
export async function patchSpaceModeration(input: {
  accessToken: string;
  spaceName: string;
  moderation: "ON" | "OFF";
}): Promise<
  | { ok: true; space: MeetSpace }
  | { ok: false; error: string; status?: number }
> {
  const name = input.spaceName.startsWith("spaces/")
    ? input.spaceName
    : `spaces/${input.spaceName}`;
  const result = await meetFetch<MeetSpace>(
    input.accessToken,
    `/${name}?updateMask=config.moderation`,
    {
      method: "PATCH",
      body: {
        config: { moderation: input.moderation },
      },
    }
  );
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, space: result.data };
}

export async function listSpaceMembers(input: {
  accessToken: string;
  spaceName: string;
}): Promise<
  | { ok: true; members: MeetSpaceMember[] }
  | { ok: false; error: string; status?: number }
> {
  const parent = input.spaceName.startsWith("spaces/")
    ? input.spaceName
    : `spaces/${input.spaceName}`;
  const result = await meetFetch<{ members?: MeetSpaceMember[] }>(
    input.accessToken,
    `/${parent}/members`
  );
  if (!result.ok) {
    if (result.status === 404) return { ok: true, members: [] };
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, members: result.data.members ?? [] };
}

export async function createSpaceMember(input: {
  accessToken: string;
  spaceName: string;
  email: string;
  role?: "COHOST" | "ROLE_UNSPECIFIED";
}): Promise<
  | { ok: true; member: MeetSpaceMember }
  | { ok: false; error: string; status?: number }
> {
  const parent = input.spaceName.startsWith("spaces/")
    ? input.spaceName
    : `spaces/${input.spaceName}`;
  const result = await meetFetch<MeetSpaceMember>(
    input.accessToken,
    `/${parent}/members`,
    {
      method: "POST",
      body: {
        email: input.email.trim().toLowerCase(),
        role: input.role ?? "COHOST",
      },
    }
  );
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, member: result.data };
}

export async function deleteSpaceMember(input: {
  accessToken: string;
  memberName: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const name = input.memberName.startsWith("spaces/")
    ? input.memberName
    : input.memberName;
  const result = await meetFetch<Record<string, never>>(
    input.accessToken,
    `/${name}`,
    { method: "DELETE" }
  );
  if (!result.ok) {
    if (result.status === 404) return { ok: true };
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true };
}

/** Quita member por email (si existe) y/o crea COHOST. */
export async function ensureSpaceCohost(input: {
  accessToken: string;
  spaceName: string;
  email: string;
  previousEmails?: string[];
}): Promise<
  | {
      ok: true;
      member: MeetSpaceMember | null;
      removed: string[];
      alreadyCohost: boolean;
    }
  | { ok: false; error: string; status?: number; step?: string }
> {
  const email = input.email.trim().toLowerCase();
  const listed = await listSpaceMembers({
    accessToken: input.accessToken,
    spaceName: input.spaceName,
  });
  if (!listed.ok) {
    return {
      ok: false,
      error: listed.error,
      status: listed.status,
      step: "list_members",
    };
  }

  const removed: string[] = [];
  const prev = new Set(
    (input.previousEmails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && e !== email)
  );

  for (const m of listed.members) {
    const mEmail = (m.email || "").trim().toLowerCase();
    if (!mEmail || !prev.has(mEmail) || !m.name) continue;
    const del = await deleteSpaceMember({
      accessToken: input.accessToken,
      memberName: m.name,
    });
    if (!del.ok) {
      return {
        ok: false,
        error: del.error,
        status: del.status,
        step: "delete_member",
      };
    }
    removed.push(mEmail);
  }

  const existing = listed.members.find(
    (m) => (m.email || "").trim().toLowerCase() === email
  );
  if (existing?.role === "COHOST") {
    return {
      ok: true,
      member: existing,
      removed,
      alreadyCohost: true,
    };
  }

  const created = await createSpaceMember({
    accessToken: input.accessToken,
    spaceName: input.spaceName,
    email,
    role: "COHOST",
  });
  if (!created.ok) {
    // Ya es member con otro rol / duplicado: intentar listar de nuevo
    if (created.status === 409 || /already|exists/i.test(created.error)) {
      const again = await listSpaceMembers({
        accessToken: input.accessToken,
        spaceName: input.spaceName,
      });
      const found = again.ok
        ? again.members.find(
            (m) => (m.email || "").trim().toLowerCase() === email
          )
        : null;
      if (found) {
        return {
          ok: true,
          member: found,
          removed,
          alreadyCohost: found.role === "COHOST",
        };
      }
    }
    return {
      ok: false,
      error: created.error,
      status: created.status,
      step: "create_member",
    };
  }

  return {
    ok: true,
    member: created.member,
    removed,
    alreadyCohost: false,
  };
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

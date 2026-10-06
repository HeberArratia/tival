/**
 * Recolección post-meet: Meet API → mover artefactos a carpeta del case.
 * Orquestado por Inngest (sleep + poll); esta capa es el trabajo real.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, cases, type CaseRow } from "@/db/schema";
import {
  getDriveConnectionForWorkspace,
  persistDriveTokens,
} from "@/lib/integrations/connections";
import {
  moveDriveFile,
  resolveDriveAccessToken,
} from "@/lib/integrations/google-drive/client";
import {
  fetchReadyMeetArtifacts,
  type MeetArtifact,
} from "@/lib/integrations/google-meet/client";

export type PostMeetStatus =
  | "idle"
  | "scheduled"
  | "waiting"
  | "collected"
  | "timeout"
  | "failed";

export type PostMeetState = {
  status: PostMeetStatus;
  updatedAt?: string;
  error?: string | null;
  conferenceName?: string | null;
  endedAt?: string | null;
  moved?: Array<{
    kind: MeetArtifact["kind"];
    fileId: string;
    exportUri?: string | null;
  }>;
};

function readPostMeet(row: CaseRow): PostMeetState {
  const q = (row.qualification ?? {}) as Record<string, unknown>;
  const raw = q.post_meet;
  if (!raw || typeof raw !== "object") return { status: "idle" };
  return raw as PostMeetState;
}

export function getPostMeetState(row: CaseRow): PostMeetState {
  return readPostMeet(row);
}

export async function setPostMeetState(
  caseId: string,
  patch: Partial<PostMeetState> & { status: PostMeetStatus }
): Promise<CaseRow | null> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!current) return null;

  const prev = readPostMeet(current);
  const next: PostMeetState = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const [updated] = await db
    .update(cases)
    .set({
      qualification: {
        ...(current.qualification ?? {}),
        post_meet: next,
      },
      updatedAt: new Date(),
    })
    .where(eq(cases.id, caseId))
    .returning();

  return updated ?? null;
}

export type CollectAttemptResult =
  | {
      ok: true;
      done: true;
      status: "collected" | "already_collected";
      moved: PostMeetState["moved"];
    }
  | {
      ok: true;
      done: false;
      reason:
        | "missing_meet_code"
        | "missing_drive_folder"
        | "google_not_connected"
        | "no_conference"
        | "artifacts_not_ready";
      ended: boolean;
    }
  | { ok: false; error: string };

/** Un intento de recolección (sin sleep). */
export async function attemptPostMeetCollect(
  caseId: string
): Promise<CollectAttemptResult> {
  const db = await getDb();
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) return { ok: false, error: "case_not_found" };

  const prev = readPostMeet(row);
  if (prev.status === "collected" && (prev.moved?.length ?? 0) > 0) {
    return {
      ok: true,
      done: true,
      status: "already_collected",
      moved: prev.moved,
    };
  }

  if (!row.meetCode) {
    return {
      ok: true,
      done: false,
      reason: "missing_meet_code",
      ended: false,
    };
  }
  if (!row.driveFolderId) {
    return {
      ok: true,
      done: false,
      reason: "missing_drive_folder",
      ended: false,
    };
  }

  const drive = await getDriveConnectionForWorkspace(row.workspaceId);
  if (!drive?.tokens?.refreshToken) {
    return {
      ok: true,
      done: false,
      reason: "google_not_connected",
      ended: false,
    };
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
    return {
      ok: false,
      error: e instanceof Error ? e.message : "google_token_refresh_failed",
    };
  }

  const ready = await fetchReadyMeetArtifacts({
    accessToken,
    meetingCode: row.meetCode,
  });
  if (!ready.ok) return { ok: false, error: ready.error };

  if (!ready.conference) {
    return {
      ok: true,
      done: false,
      reason: "no_conference",
      ended: false,
    };
  }

  const notes = ready.artifacts.filter((a) => a.kind === "notes");
  const toMove =
    notes.length > 0
      ? ready.artifacts
      : ready.ended
        ? ready.artifacts
        : [];

  if (toMove.length === 0) {
    await setPostMeetState(caseId, {
      status: "waiting",
      conferenceName: ready.conference.name,
      endedAt: ready.conference.endTime ?? null,
    });
    return {
      ok: true,
      done: false,
      reason: "artifacts_not_ready",
      ended: ready.ended,
    };
  }

  const moved: NonNullable<PostMeetState["moved"]> = [];
  for (const art of toMove) {
    await moveDriveFile({
      fileId: art.fileId,
      destinationFolderId: row.driveFolderId,
      accessToken,
    });
    moved.push({
      kind: art.kind,
      fileId: art.fileId,
      exportUri: art.exportUri,
    });
  }

  await setPostMeetState(caseId, {
    status: "collected",
    conferenceName: ready.conference.name,
    endedAt: ready.conference.endTime ?? null,
    moved,
    error: null,
  });

  await db.insert(caseEvents).values({
    caseId,
    type: "post_meet_collected",
    payload: { moved, conferenceName: ready.conference.name },
    actor: "integracion",
  });

  return { ok: true, done: true, status: "collected", moved };
}

/**
 * Minutos tras `scheduledAt` (inicio reunión) para empezar a mirar artefactos.
 * En la práctica Notas/recording suelen aparecer ~2h después del inicio.
 * Override: `POST_MEET_LOOK_AFTER_MINUTES` en env.
 */
export const POST_MEET_LOOK_AFTER_MINUTES = (() => {
  const raw = process.env.POST_MEET_LOOK_AFTER_MINUTES?.trim();
  const n = raw ? Number(raw) : 120;
  return Number.isFinite(n) && n >= 0 ? n : 120;
})();
/** Intervalo entre polls. */
export const POST_MEET_POLL_INTERVAL = "5m" as const;
/**
 * Máx. polls tras el sleep inicial (~2h de ventana con intervalo 5m).
 * Override: `POST_MEET_MAX_POLLS`.
 */
export const POST_MEET_MAX_POLLS = (() => {
  const raw = process.env.POST_MEET_MAX_POLLS?.trim();
  const n = raw ? Number(raw) : 24;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 24;
})();

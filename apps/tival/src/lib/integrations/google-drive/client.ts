import type { DriveOAuthTokens } from "@/lib/integrations/google-drive/oauth";
import { refreshAccessToken } from "@/lib/integrations/google-drive/oauth";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export type CreateFolderInput = {
  name: string;
  parentId: string;
  accessToken: string;
};

export type CreateFolderResult = {
  id: string;
  name: string;
  webViewLink?: string;
};

/** Access token usable; refresca si falta o está por expirar. */
export async function resolveDriveAccessToken(
  tokens: DriveOAuthTokens
): Promise<{ accessToken: string; tokens: DriveOAuthTokens }> {
  const skewMs = 60_000;
  if (
    tokens.accessToken &&
    tokens.expiresAt &&
    tokens.expiresAt > Date.now() + skewMs
  ) {
    return { accessToken: tokens.accessToken, tokens };
  }

  const refreshed = await refreshAccessToken(tokens.refreshToken);
  return {
    accessToken: refreshed.accessToken!,
    tokens: {
      ...tokens,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType ?? tokens.tokenType,
      scope: refreshed.scope ?? tokens.scope,
    },
  };
}

/** Mueve un archivo a `destinationFolderId` (quita otros parents). */
export async function moveDriveFile(input: {
  fileId: string;
  destinationFolderId: string;
  accessToken: string;
}): Promise<{ id: string; parents?: string[] }> {
  const metaRes = await fetch(
    `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}?fields=id,parents`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    }
  );
  const meta = (await metaRes.json()) as {
    id?: string;
    parents?: string[];
    error?: { message?: string };
  };
  if (!metaRes.ok || !meta.id) {
    throw new Error(meta.error?.message || `drive_get_failed_${metaRes.status}`);
  }

  const previousParents = (meta.parents ?? []).join(",");
  const params = new URLSearchParams({
    addParents: input.destinationFolderId,
    fields: "id,parents",
  });
  if (previousParents) params.set("removeParents", previousParents);

  const res = await fetch(
    `${DRIVE_FILES}/${encodeURIComponent(input.fileId)}?${params}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    }
  );
  const data = (await res.json()) as {
    id?: string;
    parents?: string[];
    error?: { message?: string };
  };
  if (!res.ok || !data.id) {
    throw new Error(
      data.error?.message || `drive_move_failed_${res.status}`
    );
  }
  return { id: data.id, parents: data.parents };
}

export async function createDriveFolder(
  input: CreateFolderInput
): Promise<CreateFolderResult> {
  const res = await fetch(`${DRIVE_FILES}?fields=id,name,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [input.parentId],
    }),
  });

  const data = (await res.json()) as CreateFolderResult & {
    error?: { message?: string };
  };

  if (!res.ok || !data.id) {
    throw new Error(
      data.error?.message || `drive_create_folder_failed_${res.status}`
    );
  }

  return { id: data.id, name: data.name, webViewLink: data.webViewLink };
}

/** Nombre legible (no identidad). Incluye sufijo corto del case para desambiguar en Drive. */
export function buildDriveFolderName(input: {
  contactName?: string | null;
  scheduledAt?: Date | null;
  caseId: string;
}): { folderKey: string; folderName: string } {
  const invitee = (input.contactName || "cliente")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\/]/g, "_");

  const dt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const dateKey = `${yyyy}_${mm}_${dd}`;

  const short = input.caseId.replace(/-/g, "").slice(0, 6);
  const folderKey = `${invitee} y alfondo team - ${dateKey}`;
  const folderName = `${folderKey} · ${short}`;

  return { folderKey, folderName };
}

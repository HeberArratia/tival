import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cases, type CaseRow } from "@/db/schema";
import {
  getDriveConnectionForWorkspace,
  persistDriveTokens,
} from "@/lib/integrations/connections";
import {
  buildDriveFolderName,
  createDriveFolder,
  resolveDriveAccessToken,
} from "@/lib/integrations/google-drive/client";

export type EnsureDriveFolderResult =
  | { ok: true; case: CaseRow; created: boolean; skipped?: false }
  | {
      ok: false;
      case: CaseRow;
      error: string;
      skipped?: boolean;
    };

/**
 * Efecto drive-folder: si el case no tiene drive_folder_id, crea carpeta bajo
 * rootFolderId de la conexión google_drive del workspace.
 */
export async function ensureDriveFolderForCase(
  caseRow: CaseRow
): Promise<EnsureDriveFolderResult> {
  if (caseRow.driveFolderId) {
    void import("@/inngest/functions/post-meet-collect").then(
      ({ schedulePostMeetCollect }) => schedulePostMeetCollect(caseRow.id)
    );
    return { ok: true, case: caseRow, created: false };
  }

  const conn = await getDriveConnectionForWorkspace(caseRow.workspaceId);
  if (!conn) {
    return {
      ok: false,
      case: caseRow,
      error: "drive_not_connected",
      skipped: true,
    };
  }

  const rootFolderId =
    typeof conn.config.rootFolderId === "string"
      ? conn.config.rootFolderId.trim()
      : "";
  if (!rootFolderId) {
    return {
      ok: false,
      case: caseRow,
      error: "drive_root_folder_missing",
      skipped: true,
    };
  }

  if (!conn.tokens?.refreshToken) {
    return {
      ok: false,
      case: caseRow,
      error: "drive_missing_refresh_token",
      skipped: true,
    };
  }

  try {
    const { accessToken, tokens } = await resolveDriveAccessToken(conn.tokens);
    if (
      tokens.accessToken !== conn.tokens.accessToken ||
      tokens.expiresAt !== conn.tokens.expiresAt
    ) {
      await persistDriveTokens({
        connectionId: conn.connectionId,
        tokens: { ...conn.tokens, ...tokens },
      });
    }

    const { getContactById } = await import("@/lib/identity");
    const contact = caseRow.contactId
      ? await getContactById(caseRow.contactId)
      : null;
    const { folderKey, folderName } = buildDriveFolderName({
      contactName: contact?.name ?? null,
      scheduledAt: caseRow.scheduledAt,
      caseId: caseRow.id,
    });

    const folder = await createDriveFolder({
      name: folderName,
      parentId: rootFolderId,
      accessToken,
    });

    const db = await getDb();
    const [updated] = await db
      .update(cases)
      .set({
        driveFolderId: folder.id,
        driveFolderKey: folderKey,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseRow.id))
      .returning();

    const next = updated ?? caseRow;
    // Carpeta lista → encolar post-meet (si ya hay meetCode, Inngest podrá mover).
    void import("@/inngest/functions/post-meet-collect").then(
      ({ schedulePostMeetCollect }) => schedulePostMeetCollect(next.id)
    );

    return {
      ok: true,
      case: next,
      created: true,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "drive_folder_failed";
    return { ok: false, case: caseRow, error: message };
  }
}

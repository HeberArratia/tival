import { createHash, randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  integrationConnections,
  workspaces,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@/db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto-secrets";
import type { DriveOAuthTokens } from "@/lib/integrations/google-drive/oauth";
import { INTEGRATION_PROVIDERS } from "@/lib/integrations/providers";
import type { ConnectionPublic } from "@/lib/integrations/connection-types";
import {
  appBaseUrl,
  calendlyWebhookUrl,
} from "@/lib/integrations/runtime-env";

export type { ConnectionPublic } from "@/lib/integrations/connection-types";
export {
  appBaseUrl,
  calendlyWebhookUrl,
  isLocalAppBaseUrl,
  normalizePublicBaseUrl,
  tivalRuntimeEnv,
} from "@/lib/integrations/runtime-env";

type StoredCredentials = {
  apiToken?: string;
} & Partial<DriveOAuthTokens>;

export const CONNECTABLE_PROVIDERS: IntegrationProvider[] = [
  "calendly",
  "google_drive",
];

/** Carpeta raíz por defecto Alfondo (distinta a n8n). */
export const ALFONDO_DRIVE_ROOT_FOLDER_ID =
  "1EftxI1DYBJiq3BUt-V0uTb7zAL1Y_iXJ";

export function newWebhookToken() {
  return randomBytes(24).toString("base64url");
}

function credentialsFromEnc(
  enc: string | null | undefined
): StoredCredentials {
  const raw = decryptSecret(enc);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return {};
  }
}

function toPublic(
  row: IntegrationConnection,
  workspace: { slug: string; name: string }
): ConnectionPublic {
  const signing = decryptSecret(row.webhookSigningKeyEnc);
  const creds = credentialsFromEnc(row.credentialsEnc);
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const publicBaseUrl =
    typeof cfg.publicBaseUrl === "string" ? cfg.publicBaseUrl : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    provider: row.provider,
    label: row.label,
    status: row.status,
    webhookToken: row.webhookToken,
    webhookUrl:
      row.provider === "calendly"
        ? calendlyWebhookUrl(row.webhookToken, publicBaseUrl)
        : null,
    hasSigningKey: Boolean(signing),
    signingKeyMasked: maskSecret(signing),
    hasApiToken: Boolean(creds.apiToken),
    apiTokenMasked: maskSecret(creds.apiToken),
    hasRefreshToken: Boolean(creds.refreshToken),
    accountEmail: creds.accountEmail ?? null,
    config: (row.config ?? {}) as Record<string, unknown>,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getWorkspaceBySlug(slug: string) {
  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  return ws ?? null;
}

export async function listConnectionsForWorkspace(workspaceSlug: string) {
  const ws = await getWorkspaceBySlug(workspaceSlug);
  if (!ws) throw new Error(`Workspace not found: ${workspaceSlug}`);

  const db = await getDb();
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, ws.id));

  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return INTEGRATION_PROVIDERS.map((meta) => {
    const row = byProvider.get(meta.id);
    return {
      provider: meta,
      connection: row ? toPublic(row, ws) : null,
    };
  });
}

export async function ensureConnection(input: {
  workspaceSlug: string;
  provider: IntegrationProvider;
  label?: string;
}) {
  const ws = await getWorkspaceBySlug(input.workspaceSlug);
  if (!ws) throw new Error(`Workspace not found: ${input.workspaceSlug}`);

  const db = await getDb();
  const [existing] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, ws.id),
        eq(integrationConnections.provider, input.provider)
      )
    )
    .limit(1);

  if (existing) return toPublic(existing, ws);

  const defaultConfig: Record<string, unknown> =
    input.provider === "google_drive" && ws.slug === "alfondo"
      ? { rootFolderId: ALFONDO_DRIVE_ROOT_FOLDER_ID }
      : {};

  const [created] = await db
    .insert(integrationConnections)
    .values({
      workspaceId: ws.id,
      provider: input.provider,
      label: input.label ?? null,
      status: "disconnected",
      webhookToken: newWebhookToken(),
      config: defaultConfig,
    })
    .returning();

  return toPublic(created, ws);
}

export async function updateCalendlyConnection(input: {
  connectionId: string;
  workspaceSlug: string;
  signingKey?: string | null;
  apiToken?: string | null;
  config?: Record<string, unknown>;
  markConnected?: boolean;
}) {
  const ws = await getWorkspaceBySlug(input.workspaceSlug);
  if (!ws) throw new Error(`Workspace not found: ${input.workspaceSlug}`);

  const db = await getDb();
  const [current] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, input.connectionId),
        eq(integrationConnections.workspaceId, ws.id)
      )
    )
    .limit(1);

  if (!current) throw new Error("Connection not found");
  if (current.provider !== "calendly") {
    throw new Error("Use updateDriveConnection for google_drive");
  }

  const patch: Partial<typeof integrationConnections.$inferInsert> = {
    updatedAt: new Date(),
    lastError: null,
  };

  if (input.signingKey !== undefined) {
    patch.webhookSigningKeyEnc = input.signingKey?.trim()
      ? encryptSecret(input.signingKey.trim())
      : null;
  }

  if (input.apiToken !== undefined || input.signingKey !== undefined) {
    const prev = credentialsFromEnc(current.credentialsEnc);
    const next = { ...prev };
    if (input.apiToken !== undefined) {
      if (input.apiToken?.trim()) next.apiToken = input.apiToken.trim();
      else delete next.apiToken;
    }
    patch.credentialsEnc =
      Object.keys(next).length > 0 ? encryptSecret(JSON.stringify(next)) : null;
  }

  if (input.config) {
    patch.config = { ...(current.config ?? {}), ...input.config };
  }

  const signingAfter =
    input.signingKey !== undefined
      ? input.signingKey?.trim() || null
      : decryptSecret(current.webhookSigningKeyEnc);

  if (input.markConnected !== false && signingAfter) {
    patch.status = "connected";
  } else if (!signingAfter) {
    patch.status = "disconnected";
  }

  const [updated] = await db
    .update(integrationConnections)
    .set(patch)
    .where(eq(integrationConnections.id, current.id))
    .returning();

  return toPublic(updated, ws);
}

export async function updateDriveConnection(input: {
  connectionId: string;
  workspaceSlug: string;
  config?: Record<string, unknown>;
  tokens?: DriveOAuthTokens | null;
  markConnected?: boolean;
  lastError?: string | null;
}) {
  const ws = await getWorkspaceBySlug(input.workspaceSlug);
  if (!ws) throw new Error(`Workspace not found: ${input.workspaceSlug}`);

  const db = await getDb();
  const [current] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, input.connectionId),
        eq(integrationConnections.workspaceId, ws.id)
      )
    )
    .limit(1);

  if (!current) throw new Error("Connection not found");
  if (current.provider !== "google_drive") {
    throw new Error("Not a google_drive connection");
  }

  const patch: Partial<typeof integrationConnections.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.lastError !== undefined) {
    patch.lastError = input.lastError;
  } else {
    patch.lastError = null;
  }

  if (input.config) {
    patch.config = { ...(current.config ?? {}), ...input.config };
  }

  if (input.tokens !== undefined) {
    if (input.tokens === null) {
      patch.credentialsEnc = null;
    } else {
      const prev = credentialsFromEnc(current.credentialsEnc);
      const next: StoredCredentials = {
        ...prev,
        refreshToken: input.tokens.refreshToken,
        accessToken: input.tokens.accessToken,
        expiresAt: input.tokens.expiresAt,
        tokenType: input.tokens.tokenType,
        scope: input.tokens.scope,
        accountEmail: input.tokens.accountEmail ?? prev.accountEmail,
      };
      patch.credentialsEnc = encryptSecret(JSON.stringify(next));
    }
  }

  const credsAfter =
    input.tokens === null
      ? {}
      : input.tokens
        ? { ...credentialsFromEnc(current.credentialsEnc), ...input.tokens }
        : credentialsFromEnc(current.credentialsEnc);

  const configAfter = (patch.config ?? current.config ?? {}) as Record<
    string,
    unknown
  >;
  const hasRoot =
    typeof configAfter.rootFolderId === "string" &&
    Boolean(configAfter.rootFolderId.trim());
  const hasRefresh = Boolean(credsAfter.refreshToken);

  if (input.markConnected === false) {
    patch.status = "disconnected";
  } else if (hasRefresh && hasRoot) {
    patch.status = "connected";
  } else if (hasRefresh) {
    patch.status = "connected";
  } else {
    patch.status = "disconnected";
  }

  if (input.lastError) {
    patch.status = "error";
  }

  const [updated] = await db
    .update(integrationConnections)
    .set(patch)
    .where(eq(integrationConnections.id, current.id))
    .returning();

  return toPublic(updated, ws);
}

/** PAT Calendly del workspace, o fallback de env para dev local. */
export async function getCalendlyApiTokenForWorkspace(
  workspaceId: string
): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, workspaceId),
        eq(integrationConnections.provider, "calendly")
      )
    )
    .limit(1);

  if (row?.credentialsEnc) {
    const creds = credentialsFromEnc(row.credentialsEnc);
    if (creds.apiToken?.trim()) return creds.apiToken.trim();
  }

  const fromEnv =
    process.env.TEST_TIVAL_CALENDLY?.trim() ||
    process.env.CALENDLY_ACCESS_TOKEN?.trim();
  return fromEnv || null;
}

export async function getDriveConnectionForWorkspace(workspaceId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, workspaceId),
        eq(integrationConnections.provider, "google_drive")
      )
    )
    .limit(1);

  if (!row) return null;
  const creds = credentialsFromEnc(row.credentialsEnc);
  if (!creds.refreshToken) {
    return {
      connectionId: row.id,
      config: (row.config ?? {}) as Record<string, unknown>,
      tokens: null as DriveOAuthTokens | null,
      status: row.status,
    };
  }

  return {
    connectionId: row.id,
    config: (row.config ?? {}) as Record<string, unknown>,
    tokens: {
      refreshToken: creds.refreshToken,
      accessToken: creds.accessToken,
      expiresAt: creds.expiresAt,
      tokenType: creds.tokenType,
      scope: creds.scope,
      accountEmail: creds.accountEmail,
    } satisfies DriveOAuthTokens,
    status: row.status,
  };
}

export async function persistDriveTokens(input: {
  connectionId: string;
  tokens: DriveOAuthTokens;
}) {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, input.connectionId))
    .limit(1);
  if (!current) return;

  const prev = credentialsFromEnc(current.credentialsEnc);
  const next: StoredCredentials = {
    ...prev,
    refreshToken: input.tokens.refreshToken,
    accessToken: input.tokens.accessToken,
    expiresAt: input.tokens.expiresAt,
    tokenType: input.tokens.tokenType,
    scope: input.tokens.scope,
    accountEmail: input.tokens.accountEmail ?? prev.accountEmail,
  };

  await db
    .update(integrationConnections)
    .set({
      credentialsEnc: encryptSecret(JSON.stringify(next)),
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.id, input.connectionId));
}

export async function findConnectionByWebhookToken(token: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      connection: integrationConnections,
      workspace: workspaces,
    })
    .from(integrationConnections)
    .innerJoin(
      workspaces,
      eq(workspaces.id, integrationConnections.workspaceId)
    )
    .where(eq(integrationConnections.webhookToken, token))
    .limit(1);

  if (!row) return null;
  return {
    connection: row.connection,
    workspace: row.workspace,
    signingKey: decryptSecret(row.connection.webhookSigningKeyEnc),
  };
}

export async function touchConnectionEvent(
  connectionId: string,
  opts?: { error?: string | null }
) {
  const db = await getDb();
  await db
    .update(integrationConnections)
    .set({
      lastEventAt: new Date(),
      lastError: opts?.error ?? null,
      status: opts?.error ? "error" : "connected",
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.id, connectionId));
}

/** Hash estable para logs sin filtrar el token. */
export function shortTokenFingerprint(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}

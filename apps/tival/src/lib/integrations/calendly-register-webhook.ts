/**
 * Registra / actualiza la subscription de webhook en Calendly.
 *
 * El entorno lo define `TIVAL_ENV` (local | production | …).
 * Solo se reemplaza la subscription de ESE entorno; las demás quedan.
 */

import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections, workspaces } from "@/db/schema";
import {
  createCalendlyWebhookSubscription,
  deleteCalendlyWebhookSubscription,
  extractCalendlyUuid,
  fetchCalendlyCurrentUser,
  listCalendlyWebhookSubscriptions,
} from "@/lib/integrations/calendly-api";
import type { ConnectionPublic } from "@/lib/integrations/connection-types";
import { updateCalendlyConnection } from "@/lib/integrations/connections";
import {
  appBaseUrl,
  calendlyWebhookUrl,
  normalizePublicBaseUrl,
  tivalRuntimeEnv,
} from "@/lib/integrations/runtime-env";
import { decryptSecret } from "@/lib/crypto-secrets";

function credentialsApiToken(enc: string | null | undefined): string | null {
  if (!enc) return null;
  const raw = decryptSecret(enc);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { apiToken?: string };
    return j.apiToken?.trim() || null;
  } catch {
    return null;
  }
}

export type RegisterCalendlyWebhookResult =
  | {
      ok: true;
      connection: ConnectionPublic;
      webhookUrl: string;
      action: "created" | "recreated";
      deletedCount: number;
      env: string;
    }
  | { ok: false; error: string };

/** Crea (o recrea) la subscription de este TIVAL_ENV. */
export async function registerCalendlyWebhook(input: {
  connectionId: string;
  workspaceSlug: string;
  /**
   * Override opcional (scripts). La UI/API usan siempre NEXT_PUBLIC_APP_URL.
   */
  publicBaseUrl?: string | null;
}): Promise<RegisterCalendlyWebhookResult> {
  const env = tivalRuntimeEnv();
  const rawBase = input.publicBaseUrl?.trim() || appBaseUrl();
  const base = normalizePublicBaseUrl(rawBase);
  if (!base.ok) return { ok: false, error: base.error };

  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, input.workspaceSlug))
    .limit(1);
  if (!ws) return { ok: false, error: "workspace_not_found" };

  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, input.connectionId),
        eq(integrationConnections.workspaceId, ws.id),
        eq(integrationConnections.provider, "calendly")
      )
    )
    .limit(1);

  if (!row) return { ok: false, error: "connection_not_found" };

  const apiToken = credentialsApiToken(row.credentialsEnc);
  if (!apiToken) {
    return {
      ok: false,
      error: "calendly_api_token_missing",
    };
  }

  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const storedEnv =
    typeof cfg.webhookEnv === "string" ? cfg.webhookEnv.toLowerCase() : null;
  /** Solo tocamos el registro previo si pertenece a este mismo TIVAL_ENV. */
  const ownsPrevious = storedEnv === null || storedEnv === env;

  const previousBase =
    ownsPrevious && typeof cfg.publicBaseUrl === "string"
      ? cfg.publicBaseUrl
      : null;
  const previousSubscriptionUri =
    ownsPrevious && typeof cfg.calendlyWebhookSubscriptionUri === "string"
      ? cfg.calendlyWebhookSubscriptionUri
      : null;
  const previousUrl = previousBase
    ? calendlyWebhookUrl(row.webhookToken, previousBase)
    : null;

  const webhookUrl = calendlyWebhookUrl(row.webhookToken, base.url);
  const me = await fetchCalendlyCurrentUser(apiToken);
  if (!me.ok) return { ok: false, error: me.error };

  const listed = await listCalendlyWebhookSubscriptions({
    apiToken,
    organization: me.user.current_organization,
    scope: "organization",
  });
  if (!listed.ok) return { ok: false, error: listed.error };

  let deletedCount = 0;
  const deletedUuids = new Set<string>();
  for (const sub of listed.collection) {
    const callback = sub.callback_url || "";
    // Exacta de este registro, o la previa de ESTE env (ngrok viejo, etc.).
    // Nunca borramos callbacks de otro entorno (otra URL / otro webhookEnv).
    const isThisEnv =
      callback === webhookUrl ||
      (previousUrl !== null && callback === previousUrl) ||
      (previousSubscriptionUri !== null && sub.uri === previousSubscriptionUri);
    if (!isThisEnv) continue;

    const uuid = extractCalendlyUuid(sub.uri);
    if (!uuid || deletedUuids.has(uuid)) continue;
    const del = await deleteCalendlyWebhookSubscription({
      apiToken,
      subscriptionUuid: uuid,
    });
    if (!del.ok) {
      return {
        ok: false,
        error: `calendly_webhook_delete_failed: ${del.error}`,
      };
    }
    deletedUuids.add(uuid);
    deletedCount += 1;
  }

  const signingKey = randomBytes(32).toString("base64url");
  const created = await createCalendlyWebhookSubscription({
    apiToken,
    url: webhookUrl,
    organization: me.user.current_organization,
    scope: "organization",
    signingKey,
  });
  if (!created.ok) return { ok: false, error: created.error };

  const connection = await updateCalendlyConnection({
    connectionId: row.id,
    workspaceSlug: input.workspaceSlug,
    signingKey,
    markConnected: true,
    config: {
      webhookEnv: env,
      publicBaseUrl: base.url,
      calendlyWebhookSubscriptionUri: created.resource.uri,
      calendlyOrganization: me.user.current_organization,
    },
  });

  return {
    ok: true,
    connection,
    webhookUrl,
    action: deletedCount > 0 ? "recreated" : "created",
    deletedCount,
    env,
  };
}

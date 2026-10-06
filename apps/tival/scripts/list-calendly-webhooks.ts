/**
 * Lista subscriptions de webhook en Calendly y las compara con la DB local.
 *
 *   npx tsx scripts/list-calendly-webhooks.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { integrationConnections, workspaces } from "../src/db/schema";
import { decryptSecret } from "../src/lib/crypto-secrets";
import {
  fetchCalendlyCurrentUser,
  listCalendlyWebhookSubscriptions,
} from "../src/lib/integrations/calendly-api";
import {
  calendlyWebhookUrl,
  tivalRuntimeEnv,
} from "../src/lib/integrations/runtime-env";

async function main() {
  const slug =
    process.argv
      .find((a) => a.startsWith("--workspace="))
      ?.split("=")[1] ?? "alfondo";

  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new Error(`Workspace no encontrado: ${slug}`);

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, ws.id));
  const cal = rows.find((r) => r.provider === "calendly");
  if (!cal) throw new Error("No hay conexión Calendly");

  const cfg = (cal.config ?? {}) as Record<string, unknown>;
  const credsRaw = decryptSecret(cal.credentialsEnc);
  let apiToken: string | null = null;
  try {
    apiToken = credsRaw
      ? ((JSON.parse(credsRaw) as { apiToken?: string }).apiToken ?? null)
      : null;
  } catch {
    apiToken = null;
  }

  const expectedUrl =
    typeof cfg.publicBaseUrl === "string"
      ? calendlyWebhookUrl(cal.webhookToken, cfg.publicBaseUrl)
      : calendlyWebhookUrl(cal.webhookToken);

  console.log("=== DB (esta instancia) ===");
  console.log("status:", cal.status);
  console.log("TIVAL_ENV:", tivalRuntimeEnv());
  console.log("webhookEnv:", cfg.webhookEnv ?? "(sin set)");
  console.log("publicBaseUrl:", cfg.publicBaseUrl ?? "(sin set)");
  console.log(
    "subscriptionUri:",
    cfg.calendlyWebhookSubscriptionUri ?? "(sin set)"
  );
  console.log("expected callback:", expectedUrl);
  console.log("hasSigningKey:", Boolean(decryptSecret(cal.webhookSigningKeyEnc)));
  console.log("hasPat:", Boolean(apiToken));
  console.log("lastEventAt:", cal.lastEventAt?.toISOString() ?? "(nunca)");
  console.log("lastError:", cal.lastError ?? "(ninguno)");

  if (!apiToken) {
    console.error("\nSin PAT — no puedo listar en Calendly.");
    process.exit(1);
  }

  const me = await fetchCalendlyCurrentUser(apiToken);
  if (!me.ok) {
    console.error("users/me failed:", me.error);
    process.exit(1);
  }

  const listed = await listCalendlyWebhookSubscriptions({
    apiToken,
    organization: me.user.current_organization,
    scope: "organization",
  });
  if (!listed.ok) {
    console.error("list failed:", listed.error);
    process.exit(1);
  }

  console.log("\n=== Calendly org subscriptions ===");
  console.log("org user:", me.user.email ?? me.user.uri);
  console.log("count:", listed.collection.length);
  let matched = false;
  for (const sub of listed.collection) {
    const mine =
      sub.callback_url === expectedUrl ||
      sub.uri === cfg.calendlyWebhookSubscriptionUri;
    if (mine) matched = true;
    console.log("---");
    console.log("callback:", sub.callback_url);
    console.log("state:", sub.state ?? "?");
    console.log("events:", (sub.events ?? []).join(", "));
    console.log("uri:", sub.uri);
    console.log("match this env:", mine ? "YES" : "no");
  }

  console.log("\n=== Resultado ===");
  if (matched) {
    console.log("OK · hay una subscription que coincide con esta instancia.");
  } else {
    console.log("NO · no hay subscription matching en Calendly.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

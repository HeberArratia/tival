/**
 * Simula un webhook Calendly invitee.created con data distinta cada vez.
 *
 * Uso:
 *   npm run fake:calendly
 *   npm run fake:calendly -- --http
 *   npm run fake:calendly -- --n8n-array
 *
 * Por defecto llama al handler en proceso (no hace falta túnel ni Next).
 * Con --http POST a NEXT_PUBLIC_APP_URL (el server debe estar arriba).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { integrationConnections, workspaces } from "../src/db/schema";
import { decryptSecret } from "../src/lib/crypto-secrets";
import { handleCalendlyWebhook } from "../src/lib/integrations/calendly-webhook";
import {
  buildFakeCalendlyInviteeCreated,
  signCalendlyBody,
} from "../src/lib/integrations/fake-calendly";

async function resolveCalendlyConnection(workspaceSlug: string) {
  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!ws) throw new Error(`Workspace no encontrado: ${workspaceSlug}`);

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, ws.id));

  const calendly = rows.find((c) => c.provider === "calendly");
  if (!calendly) {
    throw new Error(
      "No hay conexión Calendly. Abrí /integraciones o corré db:seed."
    );
  }

  return {
    workspace: ws,
    connection: calendly,
    signingKey: decryptSecret(calendly.webhookSigningKeyEnc),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const useHttp = args.includes("--http");
  const asN8nArray = args.includes("--n8n-array");
  const workspaceSlug =
    args.find((a) => a.startsWith("--workspace="))?.split("=")[1] ?? "alfondo";

  const { connection, signingKey, workspace } =
    await resolveCalendlyConnection(workspaceSlug);

  const { body, summary } = buildFakeCalendlyInviteeCreated();
  const payload = asN8nArray ? [body] : body;
  const rawBody = JSON.stringify(payload);

  console.log("→ Fake Calendly invitee.created");
  console.log(`  workspace   ${workspace.slug}`);
  console.log(`  contact     ${summary.name} <${summary.email}>`);
  console.log(`  phone       ${summary.phone}`);
  console.log(
    summary.rut
      ? `  company     ${summary.company} · RUT ${summary.rut}`
      : `  company     (sin RUT — persona natural)`
  );
  console.log(`  meeting     ${summary.start}`);
  console.log(`  eventUuid   ${summary.eventUuid}`);
  console.log(`  project     ${summary.project.slice(0, 72)}…`);

  if (useHttp) {
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      "http://localhost:3000";
    const url = `${base}/api/webhooks/calendly/${connection.webhookToken}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (signingKey) {
      headers["Calendly-Webhook-Signature"] = signCalendlyBody(
        rawBody,
        signingKey
      );
    }
    console.log(`  POST ${url}`);
    const res = await fetch(url, { method: "POST", headers, body: rawBody });
    const json = await res.json().catch(() => ({}));
    console.log(`← ${res.status}`, json);
    if (!res.ok) process.exit(1);
  } else {
    const signatureHeader = signingKey
      ? signCalendlyBody(rawBody, signingKey)
      : null;
    const result = await handleCalendlyWebhook({
      webhookToken: connection.webhookToken,
      rawBody,
      signatureHeader,
      allowUnsignedDev: true,
    });
    console.log(`← ${result.status}`, result.body);
    if (result.status >= 400) process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

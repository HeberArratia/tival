/**
 * Diagnóstico rápido post-booking Calendly.
 *   npx tsx scripts/debug-calendly-intake.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { desc, eq } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  cases,
  integrationConnections,
  workspaces,
} from "../src/db/schema";
import { calendlyWebhookUrl } from "../src/lib/integrations/runtime-env";

async function main() {
  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "alfondo"))
    .limit(1);
  if (!ws) throw new Error("no workspace");

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, ws.id));
  const calendly = rows.find((r) => r.provider === "calendly");
  if (!calendly) throw new Error("no calendly");

  const cfg = (calendly.config ?? {}) as Record<string, unknown>;
  const url =
    typeof cfg.publicBaseUrl === "string"
      ? calendlyWebhookUrl(calendly.webhookToken, cfg.publicBaseUrl)
      : calendlyWebhookUrl(calendly.webhookToken);

  console.log("=== conexión ===");
  console.log("lastEventAt:", calendly.lastEventAt?.toISOString() ?? "(nunca)");
  console.log("lastError:", calendly.lastError ?? "(ninguno)");
  console.log("updatedAt:", calendly.updatedAt.toISOString());
  console.log("callback:", url);

  const recent = await db
    .select({
      id: cases.id,
      status: cases.status,
      createdAt: cases.createdAt,
      calendlyEventUuid: cases.calendlyEventUuid,
      meetUrl: cases.meetUrl,
      scheduledAt: cases.scheduledAt,
    })
    .from(cases)
    .where(eq(cases.workspaceId, ws.id))
    .orderBy(desc(cases.createdAt))
    .limit(8);

  console.log("\n=== últimos casos ===");
  if (recent.length === 0) console.log("(ninguno)");
  for (const c of recent) {
    console.log(
      `${c.createdAt.toISOString()} · ${c.status} · cal=${c.calendlyEventUuid ?? "-"} · when=${c.scheduledAt?.toISOString() ?? "-"} · meet=${c.meetUrl ?? "-"}`
    );
  }

  console.log("\n=== probe túnel (GET callback) ===");
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    console.log("status:", res.status);
    console.log("body:", text.slice(0, 400));
  } catch (e) {
    console.log("túnel/unreachable:", e instanceof Error ? e.message : e);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

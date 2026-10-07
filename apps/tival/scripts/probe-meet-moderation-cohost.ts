/**
 * Prueba: moderation ON (host management) → COHOST.
 *
 *   npx tsx scripts/probe-meet-moderation-cohost.ts --from-db --code=nsy-yurq-rki --email=nico@jarascript.cl
 *
 * Si falta meetings.space.settings:
 *   npx tsx scripts/probe-meet-moderation-cohost.ts --reconnect
 *   (autorizá como hablemos@… y re-corré --from-db)
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomBytes } from "crypto";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

function argValue(prefix: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function loadDriveCreds() {
  const { getDb } = await import("../src/db/index");
  const { integrationConnections, workspaces } = await import(
    "../src/db/schema"
  );
  const { eq, and } = await import("drizzle-orm");
  const { decryptSecret } = await import("../src/lib/crypto-secrets");

  const slug = process.env.DEFAULT_WORKSPACE_SLUG || "alfondo";
  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new Error(`workspace_not_found:${slug}`);

  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, ws.id),
        eq(integrationConnections.provider, "google_drive")
      )
    )
    .limit(1);
  if (!conn) throw new Error("drive_connection_missing");

  const raw = decryptSecret(conn.credentialsEnc);
  const creds = raw
    ? (JSON.parse(raw) as {
        refreshToken?: string;
        accessToken?: string;
        expiresAt?: number;
        scope?: string;
        accountEmail?: string;
      })
    : {};

  return { ws, conn, creds };
}

async function accessTokenFromCreds(creds: {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  scope?: string;
}) {
  const { refreshAccessToken } = await import(
    "../src/lib/integrations/google-drive/oauth"
  );
  if (!creds.refreshToken) throw new Error("missing_refresh_token");
  if (
    creds.accessToken &&
    creds.expiresAt &&
    Date.now() < creds.expiresAt - 60_000
  ) {
    return { accessToken: creds.accessToken, scope: creds.scope };
  }
  const refreshed = await refreshAccessToken(creds.refreshToken);
  return { accessToken: refreshed.accessToken!, scope: refreshed.scope };
}

async function reconnect() {
  const {
    buildDriveAuthUrl,
    signOAuthState,
    DRIVE_OAUTH_SCOPES,
  } = await import("../src/lib/integrations/google-drive/oauth");
  const { ensureConnection } = await import(
    "../src/lib/integrations/connections"
  );

  const slug = process.env.DEFAULT_WORKSPACE_SLUG || "alfondo";
  const connection = await ensureConnection({
    workspaceSlug: slug,
    provider: "google_drive",
    label: "Google",
  });

  const before = await loadDriveCreds();
  const beforeUpdated = before.conn.updatedAt?.getTime?.() ?? 0;

  const state = signOAuthState({
    workspaceSlug: slug,
    connectionId: connection.id,
    nonce: randomBytes(8).toString("hex"),
    exp: Date.now() + 15 * 60 * 1000,
  });

  const url = buildDriveAuthUrl(state);
  console.log("→ Scopes:\n ", DRIVE_OAUTH_SCOPES);
  console.log("\n→ Abrí esta URL e iniciá sesión como hablemos@alfondo.cl:\n");
  console.log(url);
  console.log("\nEsperando tokens (hasta 3 min)…");

  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const { conn, creds } = await loadDriveCreds();
    const updated = conn.updatedAt?.getTime?.() ?? 0;
    const hasSettings = String(creds.scope || "").includes(
      "meetings.space.settings"
    );
    if (updated > beforeUpdated && hasSettings) {
      console.log("→ Tokens con meetings.space.settings. OK.");
      return;
    }
    if (updated > beforeUpdated) {
      console.log("→ Tokens actualizados; scopes:", creds.scope);
      if (!hasSettings) {
        console.log("⚠ Aún sin meetings.space.settings — revisá consent.");
      }
      return;
    }
  }
  throw new Error("timeout_waiting_reconnect");
}

async function fromDb() {
  const code = argValue("--code=") || "nsy-yurq-rki";
  const email = argValue("--email=") || "nico@jarascript.cl";

  const { creds } = await loadDriveCreds();
  console.log("→ Account:", creds.accountEmail ?? "(unknown)");
  console.log("→ Stored scopes:", creds.scope ?? "(unknown)");
  const { accessToken, scope } = await accessTokenFromCreds(creds);
  const scopeStr = String(scope || creds.scope || "");
  console.log("→ Token scopes include settings?", scopeStr.includes("meetings.space.settings"));

  if (!scopeStr.includes("meetings.space.settings")) {
    console.log(
      "\n⚠ Falta meetings.space.settings. Corré:\n  npx tsx scripts/probe-meet-moderation-cohost.ts --reconnect\n"
    );
  }

  const {
    getSpaceByMeetingCode,
    patchSpaceModeration,
    listSpaceMembers,
    ensureSpaceCohost,
  } = await import("../src/lib/integrations/google-meet/client");

  console.log("\n1) GET space…");
  const space = await getSpaceByMeetingCode({ accessToken, meetingCode: code });
  console.log(JSON.stringify(space, null, 2));
  if (!space.ok) process.exit(1);

  const beforeMod =
    (space.space as { config?: { moderation?: string } }).config?.moderation ??
    "(n/a)";
  console.log("→ moderation antes:", beforeMod);

  console.log("\n2) PATCH moderation ON…");
  const patched = await patchSpaceModeration({
    accessToken,
    spaceName: space.space.name,
    moderation: "ON",
  });
  console.log(JSON.stringify(patched, null, 2));
  if (!patched.ok) {
    console.log("\nFAIL en moderation. Si es scope, usá --reconnect.");
    process.exit(1);
  }

  console.log("\n3) LIST members…");
  const members = await listSpaceMembers({
    accessToken,
    spaceName: space.space.name,
  });
  console.log(JSON.stringify(members, null, 2));

  console.log("\n4) ENSURE COHOST…");
  const cohost = await ensureSpaceCohost({
    accessToken,
    spaceName: space.space.name,
    email,
  });
  console.log(JSON.stringify(cohost, null, 2));

  if (!cohost.ok) {
    console.log(
      "\n→ Moderación ON pero COHOST falló: el bloqueo no era (solo) host management."
    );
    process.exit(1);
  }

  console.log("\nOK: moderation ON + COHOST listo.");
}

async function main() {
  loadEnvLocal();
  if (process.argv.includes("--reconnect")) {
    await reconnect();
    return;
  }
  if (process.argv.includes("--from-db")) {
    await fromDb();
    return;
  }
  console.log(
    "Usá:\n  npx tsx scripts/probe-meet-moderation-cohost.ts --from-db --code=xxx --email=user@x.com\n  npx tsx scripts/probe-meet-moderation-cohost.ts --reconnect"
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});

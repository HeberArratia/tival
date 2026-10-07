/**
 * Valida Meet spaces.members COHOST sobre una meet real (p. ej. creada por Calendly).
 *
 *   npx tsx scripts/probe-meet-cohost.ts --from-db --code=abc-defg-hij --email=alguien@dominio.com
 *
 * Si faltan scopes (meetings.space.created / calendar.events):
 *   npx tsx scripts/probe-calendar-event.ts --reconnect
 *   (pide los scopes actuales de DRIVE_OAUTH_SCOPES)
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
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

  return { creds };
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

async function main() {
  loadEnvLocal();

  if (!process.argv.includes("--from-db")) {
    console.log(
      "Usá:\n  npx tsx scripts/probe-meet-cohost.ts --from-db --code=xxx-xxxx-xxx --email=user@example.com"
    );
    process.exit(1);
  }

  const code = argValue("--code=");
  const email = argValue("--email=");
  if (!code || !email) {
    throw new Error("faltan --code= y/o --email=");
  }

  const { creds } = await loadDriveCreds();
  console.log("→ Account:", creds.accountEmail ?? "(unknown)");
  console.log("→ Stored scopes:", creds.scope ?? "(unknown)");

  const { accessToken, scope } = await accessTokenFromCreds(creds);
  console.log("→ Token scopes:", scope ?? "(n/a)");

  const scopeStr = String(scope || creds.scope || "");
  if (!scopeStr.includes("meetings.space.created")) {
    console.log(
      "⚠ Sin meetings.space.created. Reconectá Google:\n  npx tsx scripts/probe-calendar-event.ts --reconnect"
    );
  }

  const {
    getSpaceByMeetingCode,
    listSpaceMembers,
    ensureSpaceCohost,
  } = await import("../src/lib/integrations/google-meet/client");

  console.log("→ GET space by meeting code…");
  const space = await getSpaceByMeetingCode({
    accessToken,
    meetingCode: code,
  });
  console.log(JSON.stringify(space, null, 2));
  if (!space.ok) {
    process.exit(1);
  }

  console.log("→ LIST members…");
  const members = await listSpaceMembers({
    accessToken,
    spaceName: space.space.name,
  });
  console.log(JSON.stringify(members, null, 2));

  console.log("→ ENSURE COHOST…");
  const cohost = await ensureSpaceCohost({
    accessToken,
    spaceName: space.space.name,
    email,
  });
  console.log(JSON.stringify(cohost, null, 2));

  if (!cohost.ok) {
    console.log(
      "\nSi el error indica que el space no fue creado por la app, members.create puede no aplicar a meets de Calendly/Calendar."
    );
    process.exit(1);
  }

  console.log("\nOK: COHOST listo (o ya existía).");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});

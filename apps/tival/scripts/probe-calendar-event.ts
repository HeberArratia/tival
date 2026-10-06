/**
 * Prueba Calendar: GET event por external_id de Calendly.
 *
 * Flujo recomendado (usa redirect ya registrado de Drive):
 *   npx tsx scripts/probe-calendar-event.ts --reconnect
 *   → abrí la URL, autorizá como hablemos@alfondo.cl
 *   → el script espera y hace el GET solo
 *
 * Solo GET con tokens ya guardados:
 *   npx tsx scripts/probe-calendar-event.ts --from-db
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomBytes } from "crypto";

const DEFAULT_EVENT_ID = "aoji65mpc3km5fv9h3li06g9o8";

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

function eventIdFromArgs() {
  const arg = process.argv.find((a) => a.startsWith("--event="));
  return arg ? arg.slice("--event=".length) : DEFAULT_EVENT_ID;
}

async function getCalendarEvent(accessToken: string, eventId: string) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

function printEvent(status: number, data: Record<string, unknown>) {
  console.log("→ HTTP", status);
  console.log(
    JSON.stringify(
      {
        id: data.id,
        status: data.status,
        summary: data.summary,
        hangoutLink: data.hangoutLink ?? null,
        location: data.location ?? null,
        htmlLink: data.htmlLink ?? null,
        conferenceData: data.conferenceData ?? null,
        attendees: data.attendees ?? null,
        description: data.description
          ? String(data.description).slice(0, 800)
          : null,
        error: data.error ?? null,
      },
      null,
      2
    )
  );
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

async function fromDb(eventId: string) {
  const { creds } = await loadDriveCreds();
  console.log("→ Account:", creds.accountEmail ?? "(unknown)");
  console.log("→ Stored scopes:", creds.scope ?? "(unknown)");
  const { accessToken, scope } = await accessTokenFromCreds(creds);
  console.log("→ Token scopes:", scope ?? "(n/a)");
  if (!String(scope || creds.scope || "").includes("calendar")) {
    console.log(
      "⚠ Sin scope calendar. Corré: npx tsx scripts/probe-calendar-event.ts --reconnect"
    );
  }
  const { status, data } = await getCalendarEvent(accessToken, eventId);
  printEvent(status, data);
}

async function reconnectAndProbe(eventId: string) {
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
  console.log("→ Scopes que se van a pedir:\n ", DRIVE_OAUTH_SCOPES);
  console.log(
    "\n→ Abrí esta URL e iniciá sesión como hablemos@alfondo.cl:\n"
  );
  console.log(url);
  console.log(
    "\nEsperando que el callback de Drive guarde tokens (hasta 3 min)…"
  );

  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const { conn, creds } = await loadDriveCreds();
    const updated = conn.updatedAt?.getTime?.() ?? 0;
    const hasCalendar = String(creds.scope || "").includes("calendar");
    if (updated > beforeUpdated && hasCalendar) {
      console.log("→ Tokens actualizados con calendar. Continuando…");
      console.log("→ Account:", creds.accountEmail ?? "(unknown)");
      await fromDb(eventId);
      return;
    }
    if (updated > beforeUpdated && !hasCalendar) {
      console.log(
        "→ Tokens actualizados pero sin calendar en scope guardado:",
        creds.scope
      );
      console.log("→ Igual intento el GET…");
      await fromDb(eventId);
      return;
    }
  }
  throw new Error("timeout_waiting_reconnect");
}

async function main() {
  loadEnvLocal();
  const eventId = eventIdFromArgs();

  if (process.argv.includes("--reconnect")) {
    await reconnectAndProbe(eventId);
    return;
  }
  if (process.argv.includes("--from-db")) {
    await fromDb(eventId);
    return;
  }

  console.log(
    "Usá:\n  npx tsx scripts/probe-calendar-event.ts --reconnect\n  npx tsx scripts/probe-calendar-event.ts --from-db"
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});

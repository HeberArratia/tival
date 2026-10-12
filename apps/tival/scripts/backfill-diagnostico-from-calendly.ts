/**
 * Recupera tracking Calendly (utm_content → qualification_log_id) en cases
 * que se crearon sin persistirlo, y enriquece vía API Alfondo.
 *
 *   npm run backfill:diagnostico-calendly
 *   npm run backfill:diagnostico-calendly -- --case=<uuid>
 *   npm run backfill:diagnostico-calendly -- --dry
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { eq, isNull, or } from "drizzle-orm";
import { getDb } from "../src/db";
import { caseEvents, cases, contacts } from "../src/db/schema";
import { enrichDiagnosticoForCase } from "../src/lib/integrations/enrich-diagnostico";
import { getCalendlyApiTokenForWorkspace } from "../src/lib/integrations/connections";
import { isDiagnosticoLogId } from "../src/lib/integrations/alfondo-diagnostico";
import { normalizeLandingSource } from "../src/lib/workspace/calendly-map";
import { getWorkspacePack } from "../src/lib/workspace/registry";

type InviteeTracking = {
  utm_campaign?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  salesforce_uuid?: string | null;
};

async function fetchInviteeTracking(
  apiToken: string,
  eventUuid: string
): Promise<InviteeTracking | null> {
  const res = await fetch(
    `https://api.calendly.com/scheduled_events/${eventUuid}/invitees?count=5`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const data = (await res.json().catch(() => ({}))) as {
    collection?: Array<{ tracking?: InviteeTracking }>;
  };
  if (!res.ok) {
    throw new Error(
      `calendly invitees ${eventUuid}: ${res.status} ${JSON.stringify(data).slice(0, 120)}`
    );
  }
  return data.collection?.[0]?.tracking ?? null;
}

function isDiagQualTracking(t: InviteeTracking | null): boolean {
  if (!t) return false;
  const campaign = t.utm_campaign ? String(t.utm_campaign) : "";
  const content = t.utm_content ? String(t.utm_content) : "";
  return (
    campaign === "diag_qual" && isDiagnosticoLogId(content)
  );
}

async function previousEventUuid(caseId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId));
  for (const ev of rows) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (typeof p.previousCalendlyEventUuid === "string") {
      return p.previousCalendlyEventUuid;
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const caseArg = args.find((a) => a.startsWith("--case="))?.split("=")[1];
  const pack = getWorkspacePack();
  const allowed = pack.calendlyMapping.allowedLandings ?? null;

  const db = await getDb();
  const rows = caseArg
    ? await db
        .select({
          id: cases.id,
          workspaceId: cases.workspaceId,
          calendlyEventUuid: cases.calendlyEventUuid,
          qualificationLogId: cases.qualificationLogId,
          landingSource: cases.landingSource,
          qualification: cases.qualification,
          name: contacts.name,
        })
        .from(cases)
        .leftJoin(contacts, eq(contacts.id, cases.contactId))
        .where(eq(cases.id, caseArg))
    : await db
        .select({
          id: cases.id,
          workspaceId: cases.workspaceId,
          calendlyEventUuid: cases.calendlyEventUuid,
          qualificationLogId: cases.qualificationLogId,
          landingSource: cases.landingSource,
          qualification: cases.qualification,
          name: contacts.name,
        })
        .from(cases)
        .leftJoin(contacts, eq(contacts.id, cases.contactId))
        .where(
          or(
            isNull(cases.qualificationLogId),
            eq(cases.qualificationLogId, "")
          )
        );

  console.log(`candidates: ${rows.length}${dry ? " (dry)" : ""}`);

  for (const row of rows) {
    const label = row.name ?? row.id;
    if (!row.calendlyEventUuid) {
      console.log(`SKIP ${label}: no calendly_event_uuid`);
      continue;
    }

    const apiToken = await getCalendlyApiTokenForWorkspace(row.workspaceId);
    if (!apiToken) {
      console.log(`SKIP ${label}: no Calendly PAT`);
      continue;
    }

    let tracking = await fetchInviteeTracking(
      apiToken,
      row.calendlyEventUuid
    );

    // Reagenda Tival: utm_content = caseId; buscar evento original.
    if (!isDiagQualTracking(tracking)) {
      const prev = await previousEventUuid(row.id);
      if (prev) {
        const prevTrack = await fetchInviteeTracking(apiToken, prev);
        if (isDiagQualTracking(prevTrack)) {
          console.log(`  ${label}: usando evento previo ${prev}`);
          tracking = prevTrack;
        }
      }
    }

    if (!isDiagQualTracking(tracking)) {
      console.log(
        `SKIP ${label}: sin diag_qual/utm_content (tracking=${JSON.stringify(tracking)})`
      );
      continue;
    }

    const logId = String(tracking!.utm_content).trim();
    const landing = normalizeLandingSource(
      tracking!.utm_medium ? String(tracking!.utm_medium) : null,
      allowed
    );

    console.log(
      `${dry ? "DRY " : ""}${label}: log=${logId} landing=${landing ?? "null"}`
    );

    if (dry) continue;

    const q = {
      ...((row.qualification ?? {}) as Record<string, unknown>),
      tracking,
    };

    await db
      .update(cases)
      .set({
        qualificationLogId: logId,
        landingSource: landing,
        qualification: q,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, row.id));

    const enrich = await enrichDiagnosticoForCase(row.id, {
      force: true,
      logId,
    });
    console.log(`  enrich:`, enrich);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

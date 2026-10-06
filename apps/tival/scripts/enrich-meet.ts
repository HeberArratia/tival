/**
 * Corre enrichment Meet sobre un case (o por calendly event uuid).
 *
 *   npx tsx scripts/enrich-meet.ts --case=<uuid>
 *   npx tsx scripts/enrich-meet.ts --calendly=22f5ed01-3a38-4077-baed-0b7531479f64
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  try {
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
  } catch {
    /* opcional */
  }
}

function arg(name: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : null;
}

async function main() {
  loadEnvLocal();
  const caseId = arg("case");
  const calendly = arg("calendly");
  if (!caseId && !calendly) {
    console.error(
      "Usá --case=<uuid> o --calendly=<scheduled_event_uuid>"
    );
    process.exit(1);
  }

  const { enrichMeetForCase } = await import(
    "../src/lib/integrations/enrich-meet"
  );
  const { findCaseByCalendlyUuid } = await import("../src/lib/cases");

  let id = caseId;
  if (!id && calendly) {
    const row = await findCaseByCalendlyUuid(calendly);
    if (!row) {
      console.error("No hay case con ese calendlyEventUuid");
      process.exit(1);
    }
    id = row.id;
    console.log("→ Case", id);
  }

  const result = await enrichMeetForCase(id!);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});

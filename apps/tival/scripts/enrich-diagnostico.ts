/**
 * Prueba / backfill enrichment Alfondo → case.
 *
 *   npx tsx scripts/enrich-diagnostico.ts
 *   npx tsx scripts/enrich-diagnostico.ts --case=ae1aeeff-73ac-4e3b-97b9-da96f8198786
 *   npx tsx scripts/enrich-diagnostico.ts --log=bb1e915c-a05c-402d-8e46-f7bb15554fb9
 *   npx tsx scripts/enrich-diagnostico.ts --log=bb1e915c-… --dry-api   # solo GET Alfondo
 *   npx tsx scripts/enrich-diagnostico.ts --force
 */
import { config } from "dotenv";
// override: la key puede tener >/= y quedar truncada en el env del shell/IDE.
config({ path: ".env.local", override: true });

process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "../src/db";
import { cases } from "../src/db/schema";
import {
  alfondoBaseUrl,
  fetchDiagnosticoLog,
} from "../src/lib/integrations/alfondo-diagnostico";
import { enrichDiagnosticoForCase } from "../src/lib/integrations/enrich-diagnostico";

async function resolveCaseId(args: string[]) {
  const caseArg = args.find((a) => a.startsWith("--case="))?.split("=")[1];
  const logArg = args.find((a) => a.startsWith("--log="))?.split("=")[1];
  if (caseArg) {
    if (logArg) return { caseId: caseArg, logId: logArg };
    const db = await getDb();
    const [row] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseArg))
      .limit(1);
    return {
      caseId: caseArg,
      logId: row?.qualificationLogId ?? null,
    };
  }

  const db = await getDb();
  if (logArg) {
    const [row] = await db
      .select()
      .from(cases)
      .where(eq(cases.qualificationLogId, logArg))
      .orderBy(desc(cases.createdAt))
      .limit(1);
    if (row) return { caseId: row.id, logId: logArg };
    return { caseId: null, logId: logArg };
  }

  const [row] = await db
    .select()
    .from(cases)
    .where(
      and(
        isNotNull(cases.qualificationLogId),
        ne(cases.qualificationLogId, "")
      )
    )
    .orderBy(desc(cases.createdAt))
    .limit(1);
  if (!row) {
    throw new Error(
      "No hay case con qualification_log_id. Pasá --case= o --log=."
    );
  }
  return { caseId: row.id, logId: row.qualificationLogId };
}

async function main() {
  const args = process.argv.slice(2);
  const dryApi = args.includes("--dry-api");
  const force = args.includes("--force");
  const logOnly = args.find((a) => a.startsWith("--log="))?.split("=")[1];

  console.log("ALFONDO_BASE_URL:", alfondoBaseUrl());
  console.log(
    "ALFONDO_API_KEY:",
    process.env.ALFONDO_API_KEY || process.env.TIVAL_API_KEY
      ? "(set)"
      : "(missing)"
  );

  if (dryApi) {
    if (!logOnly) throw new Error("--dry-api requiere --log=");
    console.log("logId:", logOnly);
    const res = await fetchDiagnosticoLog(logOnly);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const { caseId, logId } = await resolveCaseId(args);
  console.log("caseId:", caseId ?? "(none)");
  console.log("logId:", logId ?? "(none)");

  if (!caseId) {
    throw new Error(
      `Hay log ${logId} pero no hay case asociado. Creá la opp o pasá --case=.`
    );
  }

  const result = await enrichDiagnosticoForCase(caseId, {
    force,
    logId,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Invita al consultor al evento Calendar (inline).
 *
 *   npx tsx scripts/grant-consultant-meet.ts --case=<uuid>
 *   npx tsx scripts/grant-consultant-meet.ts --case=<uuid> --consultant=<uuid>
 */
import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { cases } from "../src/db/schema";
import { scheduleGrantConsultantMeetAccessJob } from "../src/inngest/functions/grant-consultant-meet-access";

async function main() {
  const args = process.argv.slice(2);
  const caseId = args.find((a) => a.startsWith("--case="))?.split("=")[1];
  const consultantArg = args
    .find((a) => a.startsWith("--consultant="))
    ?.split("=")[1];

  if (!caseId) {
    console.error(
      "Uso: npx tsx scripts/grant-consultant-meet.ts --case=<uuid> [--consultant=<uuid>]"
    );
    process.exit(1);
  }

  const db = await getDb();
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) throw new Error(`Caso no encontrado: ${caseId}`);

  const consultantId = consultantArg ?? row.assignedConsultantId;
  if (!consultantId) {
    throw new Error(`Caso ${caseId} sin assigned_consultant_id (pasá --consultant=)`);
  }

  console.log("→ Grant consultant meet access");
  console.log(`  caseId       ${caseId}`);
  console.log(`  consultantId ${consultantId}`);
  console.log(`  calendarId   ${row.googleCalendarEventId ?? "—"}`);
  console.log(`  meetCode     ${row.meetCode ?? "—"}`);

  await scheduleGrantConsultantMeetAccessJob({
    caseId,
    consultantId,
    previousConsultantId: null,
    actor: "ops_script",
  });

  console.log("← done (ver case_events consultant_meet_access_*)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

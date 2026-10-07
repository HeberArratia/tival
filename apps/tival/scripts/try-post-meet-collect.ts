/**
 * Un intento de post-meet collect (sin Inngest).
 *   npx tsx scripts/try-post-meet-collect.ts <caseId>
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.USE_PGLITE = "0";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { cases } from "../src/db/schema";
import { attemptPostMeetCollect } from "../src/lib/integrations/post-meet-collect";

async function main() {
  const caseId = process.argv[2]?.trim();
  if (!caseId) {
    console.error("Uso: npx tsx scripts/try-post-meet-collect.ts <caseId>");
    process.exit(1);
  }

  const db = await getDb();
  const [row] = await db
    .select({
      id: cases.id,
      meetCode: cases.meetCode,
      driveFolderId: cases.driveFolderId,
      scheduledAt: cases.scheduledAt,
      qualification: cases.qualification,
    })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);

  console.log("case", JSON.stringify(row, null, 2));
  if (!row) process.exit(1);

  const result = await attemptPostMeetCollect(caseId);
  console.log("result", JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Borra contactos, empresas, oportunidades y eventos.
 * No toca workspaces, playbooks, productos, integraciones ni users.
 *
 *   npm run db:wipe-opps
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = postgres(url, { max: 1 });

  await sql.begin(async (tx) => {
    const ev = await tx`DELETE FROM case_events`;
    const ca = await tx`DELETE FROM cases`;
    const cc = await tx`DELETE FROM contact_companies`;
    const cp = await tx`DELETE FROM contact_phones`;
    const co = await tx`DELETE FROM contacts`;
    const cm = await tx`DELETE FROM companies`;
    console.log("Borrados:");
    console.log(`  case_events        ${ev.count}`);
    console.log(`  cases              ${ca.count}`);
    console.log(`  contact_companies  ${cc.count}`);
    console.log(`  contact_phones     ${cp.count}`);
    console.log(`  contacts           ${co.count}`);
    console.log(`  companies          ${cm.count}`);
  });

  await sql.end();
  console.log("✓ Limpio. Workspace / playbooks / productos intactos.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

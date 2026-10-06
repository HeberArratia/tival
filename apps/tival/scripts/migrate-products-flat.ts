/**
 * Simplifica products a catálogo plano (sin service_type / fund_* / institution).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = postgres(url, { max: 1 });

  await sql.unsafe(`
    ALTER TABLE products DROP COLUMN IF EXISTS service_type;
    ALTER TABLE products DROP COLUMN IF EXISTS fund_key;
    ALTER TABLE products DROP COLUMN IF EXISTS fund_name;
    ALTER TABLE products DROP COLUMN IF EXISTS institution;
    DROP INDEX IF EXISTS products_workspace_fund;
  `);

  console.log("products → flat OK");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

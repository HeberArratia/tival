/**
 * Agrega `gmail` al enum integration_provider (Postgres).
 * PGlite: confiar en bootstrap de src/db/index.ts (SCHEMA_ENSURE_VERSION).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    throw new Error("DATABASE_URL de Postgres requerida");
  }

  const sql = postgres(url, { max: 1 });

  console.log("Agregando gmail a integration_provider…");

  await sql.unsafe(`
    DO $$ BEGIN
      ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'gmail';
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  console.log("OK");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

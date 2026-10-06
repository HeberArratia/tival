/**
 * Legacy — ver migrate-drop-won-lost-status.ts para el modelo actual
 * (sin won/lost en status; cierre = etapa).
 *
 * open | cancelled | no_show | rescheduled_away
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

  console.log("Migrando case_status…");

  await sql.unsafe(`
    DO $$ BEGIN
      CREATE TYPE case_status_new AS ENUM (
        'open','cancelled','no_show','won','lost','rescheduled_away'
      );
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  await sql.unsafe(`
    ALTER TABLE cases
      ALTER COLUMN status DROP DEFAULT;
  `);

  await sql.unsafe(`
    ALTER TABLE cases
      ALTER COLUMN status TYPE case_status_new
      USING (
        CASE status::text
          WHEN 'cancelled' THEN 'cancelled'::case_status_new
          WHEN 'no_show' THEN 'no_show'::case_status_new
          WHEN 'won' THEN 'won'::case_status_new
          WHEN 'lost' THEN 'lost'::case_status_new
          WHEN 'rescheduled_away' THEN 'rescheduled_away'::case_status_new
          ELSE 'open'::case_status_new
        END
      );
  `);

  await sql.unsafe(`DROP TYPE IF EXISTS case_status;`);
  await sql.unsafe(`ALTER TYPE case_status_new RENAME TO case_status;`);
  await sql.unsafe(
    `ALTER TABLE cases ALTER COLUMN status SET DEFAULT 'open'::case_status;`
  );

  const counts = await sql`
    SELECT status::text, count(*)::int AS n
    FROM cases
    GROUP BY 1
    ORDER BY 1
  `;
  console.log("OK — distribución:", counts);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

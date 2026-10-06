/**
 * Quita won/lost de case_status.
 * Cierre ganado/perdido vive en la etapa (+ lost_reason).
 *
 * Uso: npx tsx scripts/migrate-drop-won-lost-status.ts
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
  console.log("Migrando: status won/lost → open (cierre = etapa)…");

  // Por si quedaron filas con won/lost antes de recrear el enum
  await sql.unsafe(`
    UPDATE cases
    SET status = 'open'
    WHERE status::text IN ('won', 'lost');
  `);

  await sql.unsafe(`
    DO $$ BEGIN
      CREATE TYPE case_status_new AS ENUM (
        'open','cancelled','no_show','rescheduled_away'
      );
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  await sql.unsafe(`ALTER TABLE cases ALTER COLUMN status DROP DEFAULT;`);

  await sql.unsafe(`
    ALTER TABLE cases
      ALTER COLUMN status TYPE case_status_new
      USING (
        CASE status::text
          WHEN 'cancelled' THEN 'cancelled'::case_status_new
          WHEN 'no_show' THEN 'no_show'::case_status_new
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
  const stages = await sql`
    SELECT ps.key, count(*)::int AS n
    FROM cases c
    LEFT JOIN playbook_stages ps ON ps.id = c.current_stage_id
    GROUP BY 1
    ORDER BY 1
  `;
  console.log("OK — status:", counts);
  console.log("OK — etapas:", stages);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

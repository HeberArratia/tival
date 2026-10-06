/**
 * Migra cases legacy (contact_*) → contacts / companies / contact_phones.
 * Dropea columnas legacy. Idempotente.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "crypto";
import postgres from "postgres";

function normEmail(v: unknown) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s || null;
}
function normPhone(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = postgres(url, { max: 1 });

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS contacts (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      email text,
      name text,
      primary_phone text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contacts_workspace ON contacts(workspace_id);
    CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_email
      ON contacts(workspace_id, email);

    CREATE TABLE IF NOT EXISTS contact_phones (
      id uuid PRIMARY KEY,
      contact_id uuid NOT NULL REFERENCES contacts(id),
      phone text NOT NULL,
      source text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_contact_phone
      ON contact_phones(contact_id, phone);

    CREATE TABLE IF NOT EXISTS companies (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      rut text,
      name text,
      society_type text,
      antiquity text,
      sales_12m text,
      sales_12m_at timestamptz,
      region text,
      giro text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS companies_workspace ON companies(workspace_id);
    CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_rut
      ON companies(workspace_id, rut);

    CREATE TABLE IF NOT EXISTS contact_companies (
      id uuid PRIMARY KEY,
      contact_id uuid NOT NULL REFERENCES contacts(id),
      company_id uuid NOT NULL REFERENCES companies(id),
      role text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS contact_companies_pair
      ON contact_companies(contact_id, company_id);

    ALTER TABLE cases ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id);
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
    CREATE INDEX IF NOT EXISTS cases_contact ON cases(contact_id);
    CREATE INDEX IF NOT EXISTS cases_company ON cases(company_id);
  `);

  const cols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'cases' AND column_name IN (
      'contact_name','contact_email','contact_phone','company_name'
    )
  `;
  if (cols.length === 0) {
    console.log("Sin columnas legacy — schema ya migrado.");
    await sql.end();
    return;
  }

  const rows = await sql<
    {
      id: string;
      workspace_id: string;
      contact_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      company_name: string | null;
      contact_id: string | null;
      company_id: string | null;
      qualification: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >`SELECT id, workspace_id, contact_name, contact_email, contact_phone,
           company_name, contact_id, company_id, qualification,
           created_at, updated_at
    FROM cases`;

  const contactByEmail = new Map<string, string>();
  const companyByKey = new Map<string, string>();

  for (const row of rows) {
    let contactId = row.contact_id;
    const email = normEmail(row.contact_email);
    const phone = normPhone(row.contact_phone);
    const name = row.contact_name?.trim() || null;

    if (!contactId && email) {
      const key = `${row.workspace_id}:${email}`;
      contactId = contactByEmail.get(key) ?? null;
      if (!contactId) {
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM contacts
          WHERE workspace_id = ${row.workspace_id} AND email = ${email}
          LIMIT 1`;
        contactId = existing[0]?.id ?? null;
      }
      if (!contactId) {
        contactId = randomUUID();
        await sql`
          INSERT INTO contacts (id, workspace_id, email, name, primary_phone, created_at, updated_at)
          VALUES (${contactId}, ${row.workspace_id}, ${email}, ${name}, ${phone},
                  ${row.created_at}, ${row.updated_at})`;
      }
      contactByEmail.set(key, contactId);
    }

    if (!contactId) {
      contactId = randomUUID();
      await sql`
        INSERT INTO contacts (id, workspace_id, email, name, primary_phone, created_at, updated_at)
        VALUES (${contactId}, ${row.workspace_id}, ${null}, ${name}, ${phone},
                ${row.created_at}, ${row.updated_at})`;
    }

    await sql`UPDATE cases SET contact_id = ${contactId} WHERE id = ${row.id}`;

    if (phone) {
      const phoneExists = await sql`
        SELECT 1 FROM contact_phones
        WHERE contact_id = ${contactId} AND phone = ${phone} LIMIT 1`;
      if (phoneExists.length === 0) {
        await sql`
          INSERT INTO contact_phones (id, contact_id, phone, source, created_at)
          VALUES (${randomUUID()}, ${contactId}, ${phone}, 'legacy', now())`;
      }
    }

    const q = row.qualification ?? {};
    const rutRaw =
      typeof q.rut_facturacion === "string" ? q.rut_facturacion : null;
    const rut = rutRaw
      ? rutRaw.trim().toUpperCase().replace(/\./g, "").replace(/\s/g, "")
      : null;
    const companyName = row.company_name?.trim() || null;
    let companyId = row.company_id;

    if (!companyId && (rut || companyName)) {
      const key = rut
        ? `${row.workspace_id}:rut:${rut}`
        : `${row.workspace_id}:name:${companyName}`;
      companyId = companyByKey.get(key) ?? null;
      if (!companyId && rut) {
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM companies
          WHERE workspace_id = ${row.workspace_id} AND rut = ${rut}
          LIMIT 1`;
        companyId = existing[0]?.id ?? null;
      }
      if (!companyId) {
        companyId = randomUUID();
        await sql`
          INSERT INTO companies (id, workspace_id, rut, name, created_at, updated_at)
          VALUES (${companyId}, ${row.workspace_id}, ${rut}, ${companyName},
                  ${row.created_at}, ${row.updated_at})`;
      }
      companyByKey.set(key, companyId);
    }

    if (companyId) {
      await sql`UPDATE cases SET company_id = ${companyId} WHERE id = ${row.id}`;
      const linkExists = await sql`
        SELECT 1 FROM contact_companies
        WHERE contact_id = ${contactId} AND company_id = ${companyId} LIMIT 1`;
      if (linkExists.length === 0) {
        await sql`
          INSERT INTO contact_companies (id, contact_id, company_id, created_at)
          VALUES (${randomUUID()}, ${contactId}, ${companyId}, now())`;
      }
    }
  }

  await sql.unsafe(`
    ALTER TABLE cases DROP COLUMN IF EXISTS contact_name;
    ALTER TABLE cases DROP COLUMN IF EXISTS contact_email;
    ALTER TABLE cases DROP COLUMN IF EXISTS contact_phone;
    ALTER TABLE cases DROP COLUMN IF EXISTS company_name;
  `);

  console.log(`Migrados ${rows.length} cases → contacts/companies. Legacy drop OK.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

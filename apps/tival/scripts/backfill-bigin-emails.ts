/**
 * Completa el email de los contactos importados desde Bigin.
 * El export de tratos no trae correo; vive en Contactos_*.csv, por Contact Id.
 *
 * No pisa emails que ya existían. Si un contacto importado quedó unido
 * por teléfono y Bigin tiene varios correos, separa los tratos.
 *
 *   tsx scripts/backfill-bigin-emails.ts
 *   tsx scripts/backfill-bigin-emails.ts --apply
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import postgres from "postgres";

config({ path: path.resolve(__dirname, "../.env.local") });

const CSV_PATH = path.resolve(
  __dirname,
  "../../../insumos/Contactos_2026_10_20.csv"
);

type CsvContact = { email: string; name: string | null };

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return rows
    .slice(1)
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? "";
      });
      return record;
    });
}

function loadContacts(): Map<string, CsvContact> {
  const map = new Map<string, CsvContact>();
  for (const row of parseCsv(readFileSync(CSV_PATH, "utf8"))) {
    const id = (row["Contact Id"] ?? "").trim();
    const email = (row["Correo electrónico"] ?? "").trim().toLowerCase();
    const name = (row["Contact Name"] ?? "").trim() || null;
    if (!id || !email || !email.includes("@")) continue;
    map.set(id, { email, name });
  }
  return map;
}

type CaseLink = {
  caseId: string;
  contactId: string;
  companyId: string | null;
  email: string | null;
  desired: string;
  csvName: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.env.USE_PGLITE === "1") {
    throw new Error("USE_PGLITE=1. Este backfill va a Postgres.");
  }
  if (!process.env.DATABASE_URL?.startsWith("postgres")) {
    throw new Error("DATABASE_URL no apunta a Postgres.");
  }

  const byBiginId = loadContacts();
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: "require",
    max: 1,
    prepare: false,
  });

  const cases = await sql<
    {
      case_id: string;
      contact_id: string;
      company_id: string | null;
      email: string | null;
      bigin_contact_id: string | null;
      workspace_id: string;
      phone: string | null;
    }[]
  >`
    select c.id as case_id,
           c.contact_id,
           c.company_id,
           ct.email,
           ct.primary_phone as phone,
           ct.workspace_id,
           c.qualification->>'bigin_contact_id' as bigin_contact_id
    from cases c
    join contacts ct on ct.id = c.contact_id
    where c.qualification->>'imported_from' = 'bigin'
  `;

  const pending: CaseLink[] = [];
  let already = 0;
  let keptExisting = 0;
  let noMatch = 0;

  for (const row of cases) {
    const csv = row.bigin_contact_id
      ? byBiginId.get(row.bigin_contact_id)
      : undefined;
    if (!csv) {
      noMatch += 1;
      continue;
    }
    if (row.email && row.email.toLowerCase() === csv.email) {
      already += 1;
      continue;
    }
    if (row.email) {
      keptExisting += 1;
      continue;
    }
    pending.push({
      caseId: row.case_id,
      contactId: row.contact_id,
      companyId: row.company_id,
      email: row.email,
      desired: csv.email,
      csvName: csv.name,
    });
  }

  const groups = new Map<string, CaseLink[]>();
  for (const link of pending) {
    const list = groups.get(link.contactId) ?? [];
    list.push(link);
    groups.set(link.contactId, list);
  }

  const simple: { contactId: string; email: string }[] = [];
  const splits: {
    contactId: string;
    primaryEmail: string;
    extras: { email: string; name: string | null; caseIds: string[]; companyIds: string[] }[];
  }[] = [];

  for (const [contactId, links] of groups) {
    const byEmail = new Map<string, CaseLink[]>();
    for (const link of links) {
      const list = byEmail.get(link.desired) ?? [];
      list.push(link);
      byEmail.set(link.desired, list);
    }
    const ranked = [...byEmail.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );
    const [primaryEmail] = ranked[0];
    simple.push({ contactId, email: primaryEmail });
    if (ranked.length === 1) continue;
    splits.push({
      contactId,
      primaryEmail,
      extras: ranked.slice(1).map(([email, emailLinks]) => ({
        email,
        name: emailLinks.find((l) => l.csvName)?.csvName ?? null,
        caseIds: emailLinks.map((l) => l.caseId),
        companyIds: [
          ...new Set(
            emailLinks
              .map((l) => l.companyId)
              .filter((id): id is string => !!id)
          ),
        ],
      })),
    });
  }

  console.log(
    `Casos importados ${cases.length}. Ya con ese mail ${already}. Mail de un contacto previo, sin tocar ${keptExisting}. Sin match en el CSV ${noMatch}.`
  );
  console.log(
    `Contactos a completar ${simple.length}. De esos, ${splits.length} tenían varios mails y se separan (${splits.reduce((n, s) => n + s.extras.length, 0)} contactos nuevos).`
  );
  for (const split of splits) {
    console.log(
      `  ${split.primaryEmail} se queda · salen ${split.extras.map((e) => e.email).join(", ")}`
    );
  }

  if (!apply) {
    console.log("Dry-run. Para escribir: tsx scripts/backfill-bigin-emails.ts --apply");
    await sql.end();
    process.exit(0);
  }

  const phoneByContact = new Map(
    cases
      .filter((row) => row.phone)
      .map((row) => [row.contact_id, row.phone as string])
  );
  const workspaceId = cases[0]?.workspace_id;
  if (!workspaceId) throw new Error("No hay casos importados.");

  await sql.begin(async (tx) => {
    if (simple.length) {
      const values = simple.map((row) => [row.contactId, row.email]);
      await tx`
        update contacts as ct
        set email = src.email, updated_at = now()
        from (values ${tx(values)}) as src(id, email)
        where ct.id = src.id::uuid
          and ct.email is null
      `;
    }

    for (const split of splits) {
      const phone = phoneByContact.get(split.contactId) ?? null;
      for (const extra of split.extras) {
        const [found] = await tx<{ id: string }[]>`
          select id from contacts
          where workspace_id = ${workspaceId}
            and lower(email) = ${extra.email}
          limit 1
        `;
        let contactId = found?.id;
        if (!contactId) {
          contactId = randomUUID();
          await tx`
            insert into contacts (id, workspace_id, email, name, primary_phone)
            values (
              ${contactId},
              ${workspaceId},
              ${extra.email},
              ${extra.name},
              ${phone}
            )
          `;
          if (phone) {
            await tx`
              insert into contact_phones (id, contact_id, phone, source)
              values (${randomUUID()}, ${contactId}, ${phone}, 'bigin')
              on conflict (contact_id, phone) do nothing
            `;
          }
        }
        await tx`
          update cases
          set contact_id = ${contactId}
          where id in ${tx(extra.caseIds)}
        `;
        for (const companyId of extra.companyIds) {
          await tx`
            insert into contact_companies (id, contact_id, company_id)
            values (${randomUUID()}, ${contactId}, ${companyId})
            on conflict (contact_id, company_id) do nothing
          `;
        }
      }
    }
  });

  const check = await sql<{ n: number }[]>`
    select count(*)::int as n
    from cases c
    join contacts ct on ct.id = c.contact_id
    where c.qualification->>'imported_from' = 'bigin'
      and ct.email is not null
  `;
  console.log(`Listo. Casos importados con email: ${check[0]?.n ?? 0} de ${cases.length}.`);
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

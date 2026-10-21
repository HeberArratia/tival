/**
 * Importa tratos históricos de Bigin.
 *
 * No actualiza casos, contactos ni empresas que ya existían.
 * Omite «Fue reagendada» y el Diagnóstico Agendado cuyo teléfono
 * ya pertenece a un caso vivo.
 *
 *   tsx scripts/import-bigin.ts           # dry-run
 *   tsx scripts/import-bigin.ts --apply
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";

config({ path: path.resolve(__dirname, "../.env.local") });

import { getDb } from "../src/db";
import {
  caseEvents,
  cases,
  companies,
  contactCompanies,
  contactPhones,
  contacts,
  playbookStages,
  playbooks,
  users,
  workspaces,
} from "../src/db/schema";
import { normalizePhone } from "../src/lib/identity";
import {
  fold,
  isDiagnosticoAgendado,
  isReagendada,
  parseRut,
  phoneKey,
  planBiginCase,
  rowFromCsvRecord,
  type PlannedBiginCase,
} from "../src/lib/integrations/bigin-import";

const CSV_PATH = path.resolve(
  __dirname,
  "../../../insumos/Ciclos_de_venta_2026_10_20.csv"
);

type SkipReason =
  | "reagendada"
  | "already_imported"
  | "live_agendado"
  | "missing_id"
  | "unknown_phase";

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
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return rows.slice(1).filter((cells) => cells.some((cell) => cell.trim())).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.env.USE_PGLITE === "1") {
    throw new Error("USE_PGLITE=1. Este import va a Postgres, no a la base local.");
  }
  if (!process.env.DATABASE_URL?.startsWith("postgres")) {
    throw new Error("DATABASE_URL no apunta a Postgres.");
  }

  const records = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const db = await getDb();

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "alfondo"))
    .limit(1);
  if (!workspace) throw new Error("Workspace alfondo no existe.");

  const playbookRows = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.workspaceId, workspace.id));
  const playbook =
    playbookRows.find((p) => p.slug === "consultoria" && p.isActive) ??
    playbookRows.find((p) => p.isActive);
  if (!playbook) throw new Error("Playbook consultoría activo no existe.");

  const stages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id));
  const stageIdByKey = new Map(stages.map((s) => [s.key, s.id]));

  const userRows = await db.select().from(users);
  const userIdByName = new Map(userRows.map((u) => [fold(u.name), u.id]));
  const ownerIds: Record<string, string> = {};
  for (const [key, name] of [
    ["nico", "nico jara"],
    ["aylin", "aylin jara"],
    ["marcelo", "marcelo esperguel"],
    ["cristian", "cristian oyarzun"],
    ["walter", "walter noack"],
  ] as const) {
    const id = userIdByName.get(name);
    if (!id) throw new Error(`Usuario no encontrado: ${name}`);
    ownerIds[key] = id;
  }

  const existingCases = await db
    .select({
      id: cases.id,
      contactId: cases.contactId,
      updatedAt: cases.updatedAt,
      qualification: cases.qualification,
    })
    .from(cases)
    .where(eq(cases.workspaceId, workspace.id));
  const existingCaseIds = existingCases.map((c) => c.id);
  const contactsWithCases = new Set(
    existingCases.map((c) => c.contactId).filter((id): id is string => !!id)
  );
  const importedIds = new Set(
    existingCases
      .map((c) => {
        const q = c.qualification as Record<string, unknown> | null;
        return typeof q?.bigin_deal_id === "string" ? q.bigin_deal_id : null;
      })
      .filter((id): id is string => !!id)
  );

  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.workspaceId, workspace.id));
  const phoneRows = await db.select().from(contactPhones);
  const contactByPhone = new Map<string, string>();
  for (const contact of contactRows) {
    const key = phoneKey(contact.primaryPhone);
    if (key && !contactByPhone.has(key)) contactByPhone.set(key, contact.id);
  }
  for (const phone of phoneRows) {
    const key = phoneKey(phone.phone);
    if (key && !contactByPhone.has(key)) contactByPhone.set(key, phone.contactId);
  }
  const preexistingPhones = new Map(contactByPhone);

  const companyRows = await db
    .select()
    .from(companies)
    .where(eq(companies.workspaceId, workspace.id));
  const companyByRut = new Map<string, string>();
  for (const company of companyRows) {
    if (!company.rut) continue;
    companyByRut.set(company.rut, company.id);
    const parsed = parseRut(company.rut);
    if (parsed) companyByRut.set(parsed.formatted, company.id);
  }
  const preexistingCompanyIds = new Set(companyRows.map((c) => c.id));

  const linkRows = await db.select().from(contactCompanies);
  const linked = new Set(linkRows.map((l) => `${l.contactId}:${l.companyId}`));

  const contactSnapshot = new Map(
    contactRows.map((c) => [
      c.id,
      `${c.name ?? ""}|${c.primaryPhone ?? ""}|${c.email ?? ""}|${c.updatedAt.toISOString()}`,
    ])
  );
  const companySnapshot = new Map(
    companyRows.map((c) => [
      c.id,
      `${c.name ?? ""}|${c.rut ?? ""}|${c.updatedAt.toISOString()}`,
    ])
  );
  const caseSnapshot = new Map(
    existingCases.map((c) => [
      c.id,
      `${c.updatedAt.toISOString()}|${JSON.stringify(c.qualification ?? null)}`,
    ])
  );

  const skips = new Map<SkipReason, number>();
  const bump = (reason: SkipReason) => skips.set(reason, (skips.get(reason) ?? 0) + 1);
  const planned: PlannedBiginCase[] = [];
  let linkedExistingContact = 0;

  for (const record of records) {
    const row = rowFromCsvRecord(record);
    const tratoId = row.tratoId.trim();
    if (!tratoId) {
      bump("missing_id");
      continue;
    }
    if (isReagendada(row.lostReasonRaw)) {
      bump("reagendada");
      continue;
    }
    if (importedIds.has(tratoId)) {
      bump("already_imported");
      continue;
    }
    const plan = planBiginCase(row);
    if (!plan) {
      bump("unknown_phase");
      continue;
    }
    const key = phoneKey(plan.phone);
    const existingContactId = key ? preexistingPhones.get(key) : undefined;
    if (
      isDiagnosticoAgendado(row.phase) &&
      existingContactId &&
      contactsWithCases.has(existingContactId)
    ) {
      bump("live_agendado");
      continue;
    }
    if (existingContactId) linkedExistingContact += 1;
    planned.push(plan);
  }

  const withProduct = planned.filter((p) => p.productKey).length;
  const withConvocatoriaOnly = planned.filter(
    (p) => p.convocatoria && !p.productKey
  ).length;
  const stagesCount = new Map<string, number>();
  for (const plan of planned) {
    stagesCount.set(plan.stageKey, (stagesCount.get(plan.stageKey) ?? 0) + 1);
  }

  console.log(`CSV ${records.length} tratos`);
  console.log(`A insertar ${planned.length}`);
  console.log(
    `Omitidos ${[...skips.entries()].map(([k, n]) => `${k}=${n}`).join(" ")}`
  );
  console.log(
    `Etapas ${[...stagesCount.entries()].map(([k, n]) => `${k}=${n}`).join(" ")}`
  );
  console.log(
    `Producto ${withProduct} · convocatoria sin producto ${withConvocatoriaOnly} · contacto ya existente ${linkedExistingContact}`
  );
  console.log(
    `Segmento ${planned.filter((p) => p.segmento).length} · sin fit ${planned.filter((p) => p.dealFit).length} · temperatura ${planned.filter((p) => p.closingScore).length} · región ${planned.filter((p) => p.region).length} · empresa ${planned.filter((p) => p.companyRut).length}`
  );

  if ((skips.get("unknown_phase") ?? 0) > 0) {
    throw new Error("Hay fases sin mapear. No se importa.");
  }
  for (const plan of planned) {
    if (!stageIdByKey.has(plan.stageKey)) {
      throw new Error(`Etapa no está en el playbook: ${plan.stageKey}`);
    }
  }
  if (!apply) {
    console.log("Dry-run. Para escribir: tsx scripts/import-bigin.ts --apply");
    process.exit(0);
  }

  const companyNameByRut = new Map<string, string>();
  for (const plan of planned) {
    if (plan.companyRut && plan.companyName && !companyNameByRut.has(plan.companyRut)) {
      companyNameByRut.set(plan.companyRut, plan.companyName);
    }
  }
  const createdCompanyIds = new Set<string>();
  const contactByBigin = new Map<string, string>();

  await db.transaction(async (tx) => {
    for (const plan of planned) {
      const stageId = stageIdByKey.get(plan.stageKey);
      if (!stageId) throw new Error(`Etapa faltante: ${plan.stageKey}`);

      let contactId: string | null = null;
      const biginContact = plan.biginContactId;
      const key = phoneKey(plan.phone);
      if (biginContact && contactByBigin.has(biginContact)) {
        contactId = contactByBigin.get(biginContact) ?? null;
      } else if (key && contactByPhone.has(key)) {
        contactId = contactByPhone.get(key) ?? null;
        if (biginContact && contactId) contactByBigin.set(biginContact, contactId);
      } else if (plan.contactName || key) {
        contactId = randomUUID();
        const phone = normalizePhone(plan.phone);
        await tx.insert(contacts).values({
          id: contactId,
          workspaceId: workspace.id,
          name: plan.contactName,
          primaryPhone: phone,
        });
        if (phone) {
          await tx.insert(contactPhones).values({
            contactId,
            phone,
            source: "bigin",
          });
        }
        if (biginContact) contactByBigin.set(biginContact, contactId);
        if (key) contactByPhone.set(key, contactId);
      }

      let companyId: string | null = null;
      if (plan.companyRut) {
        companyId = companyByRut.get(plan.companyRut) ?? null;
        if (!companyId) {
          companyId = randomUUID();
          await tx.insert(companies).values({
            id: companyId,
            workspaceId: workspace.id,
            rut: plan.companyRut,
            name: companyNameByRut.get(plan.companyRut) ?? null,
          });
          companyByRut.set(plan.companyRut, companyId);
          createdCompanyIds.add(companyId);
        }
      }

      if (contactId && companyId) {
        const pair = `${contactId}:${companyId}`;
        if (!linked.has(pair)) {
          await tx.insert(contactCompanies).values({
            contactId,
            companyId,
          });
          linked.add(pair);
        }
      }

      const caseId = randomUUID();
      await tx.insert(cases).values({
        id: caseId,
        workspaceId: workspace.id,
        playbookId: playbook.id,
        currentStageId: stageId,
        status: "open",
        contactId,
        companyId,
        scheduledAt: plan.meetingAt,
        landingSource: plan.landingSource,
        qualification: plan.qualification,
        segmento: plan.segmento,
        paymentStatus: "none",
        lostReason: plan.lostReason,
        assignedConsultantId: plan.ownerKey ? ownerIds[plan.ownerKey] : null,
        driveFolderId: plan.driveFolderId,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      });
      await tx.insert(caseEvents).values({
        caseId,
        type: "imported_bigin",
        payload: {
          biginDealId: plan.biginDealId,
          stageKey: plan.stageKey,
        },
        actor: "sistema",
      });
    }
  });

  if (existingCaseIds.length) {
    const afterCases = await db
      .select({
        id: cases.id,
        updatedAt: cases.updatedAt,
        qualification: cases.qualification,
      })
      .from(cases)
      .where(inArray(cases.id, existingCaseIds));
    for (const row of afterCases) {
      const before = caseSnapshot.get(row.id);
      const after = `${row.updatedAt.toISOString()}|${JSON.stringify(row.qualification ?? null)}`;
      if (before !== after) {
        throw new Error(`El caso existente ${row.id} cambió durante el import.`);
      }
    }
  }

  const preexistingContactIds = [...contactSnapshot.keys()];
  if (preexistingContactIds.length) {
    const afterContacts = await db
      .select()
      .from(contacts)
      .where(inArray(contacts.id, preexistingContactIds));
    for (const row of afterContacts) {
      const after = `${row.name ?? ""}|${row.primaryPhone ?? ""}|${row.email ?? ""}|${row.updatedAt.toISOString()}`;
      if (contactSnapshot.get(row.id) !== after) {
        throw new Error(`El contacto existente ${row.id} cambió durante el import.`);
      }
    }
  }

  const preexistingCompanyIdList = [...preexistingCompanyIds];
  if (preexistingCompanyIdList.length) {
    const afterCompanies = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, workspace.id),
          inArray(companies.id, preexistingCompanyIdList)
        )
      );
    for (const row of afterCompanies) {
      const after = `${row.name ?? ""}|${row.rut ?? ""}|${row.updatedAt.toISOString()}`;
      if (companySnapshot.get(row.id) !== after) {
        throw new Error(`La empresa existente ${row.id} cambió durante el import.`);
      }
    }
  }

  const imported = await db
    .select({ id: cases.id })
    .from(cases)
    .where(eq(cases.workspaceId, workspace.id));
  console.log(
    `Listo. Casos en el workspace: ${imported.length} (antes ${existingCaseIds.length}). Empresas nuevas: ${createdCompanyIds.size}.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

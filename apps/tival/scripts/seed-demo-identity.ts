/**
 * Persiste el dataset demo (FAKE_*) en Postgres real.
 * - Crea tablas identidad si faltan (vía migrate)
 * - Upsert contacts / phones / companies / links
 * - Upsert oportunidades de consultoría (+ persona natural)
 *
 * Uso:
 *   npm run db:migrate-contacts
 *   npm run db:seed-demo
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
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
  workspaces,
} from "../src/db/schema";
import {
  FAKE_CASES,
  FAKE_COMPANIES,
  FAKE_CONTACT_COMPANIES,
  FAKE_CONTACT_PHONES,
  FAKE_CONTACTS,
  FAKE_PLAYBOOKS,
  FAKE_STAGES,
  PB_CONSULTORIA,
} from "../src/lib/fake-data";
import { ALFONDO_CONSULTORIA_STAGES } from "../src/workspaces/alfondo/playbook-consultoria";

/** case-* fake ids → UUID estable para Postgres. */
function demoCaseUuid(fakeId: string) {
  const h = createHash("sha256").update(`tival-demo-case:${fakeId}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "4" + h.slice(13, 16),
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") +
      h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

function stageKeyFromFakeId(stageId: string | null): string | null {
  if (!stageId) return null;
  const hit = FAKE_STAGES.find((s) => s.id === stageId);
  if (hit) return hit.key;
  // captación usa ids tipo guia-nurture
  for (const pb of FAKE_PLAYBOOKS) {
    const s = pb.stages.find((x) => x.id === stageId);
    if (s) return s.key;
  }
  return null;
}

async function main() {
  process.env.USE_FAKE_DATA = "0";

  console.log("→ Migrando schema identidad (si hace falta)…");
  const { spawnSync } = await import("child_process");
  const mig = spawnSync("npx", ["tsx", "scripts/migrate-contacts-companies.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (mig.status !== 0) {
    throw new Error("migrate-contacts-companies falló");
  }

  const db = await getDb();

  let [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "alfondo"))
    .limit(1);
  if (!workspace) {
    [workspace] = await db
      .insert(workspaces)
      .values({ name: "Alfondo", slug: "alfondo" })
      .returning();
  }

  let [playbook] = await db
    .select()
    .from(playbooks)
    .where(
      and(
        eq(playbooks.workspaceId, workspace.id),
        eq(playbooks.slug, "consultoria")
      )
    )
    .limit(1);
  if (!playbook) {
    [playbook] = await db
      .insert(playbooks)
      .values({
        workspaceId: workspace.id,
        name: "Consultoría",
        slug: "consultoria",
        isActive: true,
      })
      .returning();
  }

  for (const def of ALFONDO_CONSULTORIA_STAGES) {
    const [existing] = await db
      .select()
      .from(playbookStages)
      .where(
        and(
          eq(playbookStages.playbookId, playbook.id),
          eq(playbookStages.key, def.key)
        )
      )
      .limit(1);
    if (!existing) {
      await db.insert(playbookStages).values({
        playbookId: playbook.id,
        ...def,
      });
    }
  }

  const stages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id));
  const stageByKey = Object.fromEntries(stages.map((s) => [s.key, s]));

  console.log("→ Upsert contacts…");
  for (const c of FAKE_CONTACTS) {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, c.id))
      .limit(1);
    if (existing) {
      await db
        .update(contacts)
        .set({
          workspaceId: workspace.id,
          email: c.email,
          name: c.name,
          primaryPhone: c.primaryPhone,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, c.id));
    } else if (c.email) {
      const [byEmail] = await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, workspace.id),
            eq(contacts.email, c.email)
          )
        )
        .limit(1);
      if (byEmail) {
        await db
          .update(contacts)
          .set({
            name: c.name,
            primaryPhone: c.primaryPhone,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, byEmail.id));
        // Remap: keep existing id — cases below use FAKE ids; prefer insert with FAKE id
        // If email taken by other id, skip insert of FAKE id
        continue;
      }
      await db.insert(contacts).values({
        ...c,
        workspaceId: workspace.id,
      });
    } else {
      await db.insert(contacts).values({
        ...c,
        workspaceId: workspace.id,
      });
    }
  }

  // Re-read contacts by email to build id remap if email collision
  const dbContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.workspaceId, workspace.id));
  const contactIdByEmail = new Map(
    dbContacts
      .filter((c) => c.email)
      .map((c) => [c.email!.toLowerCase(), c.id])
  );
  const resolveContactId = (fakeId: string) => {
    const fake = FAKE_CONTACTS.find((c) => c.id === fakeId);
    if (!fake?.email) return fakeId;
    return contactIdByEmail.get(fake.email.toLowerCase()) ?? fakeId;
  };

  console.log("→ Upsert contact phones…");
  for (const p of FAKE_CONTACT_PHONES) {
    const contactId = resolveContactId(p.contactId);
    const [existing] = await db
      .select()
      .from(contactPhones)
      .where(
        and(
          eq(contactPhones.contactId, contactId),
          eq(contactPhones.phone, p.phone)
        )
      )
      .limit(1);
    if (!existing) {
      await db.insert(contactPhones).values({
        id: randomUUID(),
        contactId,
        phone: p.phone,
        source: p.source,
        createdAt: p.createdAt,
      });
    }
  }

  console.log("→ Upsert companies…");
  for (const co of FAKE_COMPANIES) {
    const [existing] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, co.id))
      .limit(1);
    if (existing) {
      await db
        .update(companies)
        .set({
          workspaceId: workspace.id,
          rut: co.rut,
          name: co.name,
          societyType: co.societyType,
          antiquity: co.antiquity,
          sales12m: co.sales12m,
          sales12mAt: co.sales12mAt,
          region: co.region,
          giro: co.giro,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, co.id));
      continue;
    }
    if (co.rut) {
      const [byRut] = await db
        .select()
        .from(companies)
        .where(
          and(
            eq(companies.workspaceId, workspace.id),
            eq(companies.rut, co.rut)
          )
        )
        .limit(1);
      if (byRut) {
        await db
          .update(companies)
          .set({
            name: co.name,
            societyType: co.societyType,
            antiquity: co.antiquity,
            sales12m: co.sales12m,
            sales12mAt: co.sales12mAt,
            region: co.region,
            giro: co.giro,
            updatedAt: new Date(),
          })
          .where(eq(companies.id, byRut.id));
        continue;
      }
    }
    await db.insert(companies).values({
      ...co,
      workspaceId: workspace.id,
    });
  }

  const dbCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.workspaceId, workspace.id));
  const companyIdByRut = new Map(
    dbCompanies.filter((c) => c.rut).map((c) => [c.rut!, c.id])
  );
  const resolveCompanyId = (fakeId: string | null) => {
    if (!fakeId) return null;
    const fake = FAKE_COMPANIES.find((c) => c.id === fakeId);
    if (fake?.rut && companyIdByRut.has(fake.rut)) {
      return companyIdByRut.get(fake.rut)!;
    }
    const byId = dbCompanies.find((c) => c.id === fakeId);
    return byId?.id ?? fakeId;
  };

  console.log("→ Upsert contact↔company…");
  for (const link of FAKE_CONTACT_COMPANIES) {
    const contactId = resolveContactId(link.contactId);
    const companyId = resolveCompanyId(link.companyId);
    if (!companyId) continue;
    const [existing] = await db
      .select()
      .from(contactCompanies)
      .where(
        and(
          eq(contactCompanies.contactId, contactId),
          eq(contactCompanies.companyId, companyId)
        )
      )
      .limit(1);
    if (!existing) {
      await db.insert(contactCompanies).values({
        id: randomUUID(),
        contactId,
        companyId,
        role: link.role,
        createdAt: link.createdAt,
      });
    }
  }

  const consultoriaCases = FAKE_CASES.filter(
    (c) => c.playbookId === PB_CONSULTORIA
  );

  // Asegura rut_facturacion en qualification cuando hay empresa con RUT.
  console.log(`→ Upsert ${consultoriaCases.length} oportunidades consultoría…`);
  for (const c of consultoriaCases) {
    const caseId = demoCaseUuid(c.id);
    const contactId = resolveContactId(c.contactId!);
    const companyId = resolveCompanyId(c.companyId);
    const stageKey = stageKeyFromFakeId(c.currentStageId) ?? "lead";
    const stage = stageByKey[stageKey] ?? stageByKey.lead;
    if (!stage) throw new Error(`Stage ${stageKey} no existe en DB`);

    const [existing] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);

    const fakeCo = c.companyId
      ? FAKE_COMPANIES.find((x) => x.id === c.companyId)
      : null;
    const q = {
      ...((c.qualification ?? {}) as Record<string, unknown>),
    };
    if (fakeCo?.rut && !q.rut_facturacion) {
      q.rut_facturacion = fakeCo.rut;
    }

    const values = {
      workspaceId: workspace.id,
      playbookId: playbook.id,
      currentStageId: stage.id,
      status: c.status,
      contactId,
      companyId,
      calendlyEventUuid: c.calendlyEventUuid,
      calendlyEventUri: c.calendlyEventUri,
      calendlyRoute: c.calendlyRoute,
      scheduledAt: c.scheduledAt,
      meetUrl: c.meetUrl,
      qualification: q,
      landingSource: c.landingSource,
      paymentMethod: c.paymentMethod,
      paymentStatus: c.paymentStatus,
      paidAt: c.paidAt,
      paymentConfirmedBy: c.paymentConfirmedBy,
      lostReason: c.lostReason,
      assignedConsultantId: c.assignedConsultantId,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(cases).set(values).where(eq(cases.id, caseId));
    } else if (c.calendlyEventUuid) {
      const [byCal] = await db
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.workspaceId, workspace.id),
            eq(cases.calendlyEventUuid, c.calendlyEventUuid)
          )
        )
        .limit(1);
      if (byCal) {
        await db
          .update(cases)
          .set(values)
          .where(eq(cases.id, byCal.id));
      } else {
        await db.insert(cases).values({ id: caseId, ...values });
        await db.insert(caseEvents).values({
          caseId,
          type: "demo_seeded",
          payload: { fakeId: c.id, personaNatural: !companyId },
          actor: "seed-demo",
        });
      }
    } else {
      await db.insert(cases).values({ id: caseId, ...values });
      await db.insert(caseEvents).values({
        caseId,
        type: "demo_seeded",
        payload: { fakeId: c.id, personaNatural: !companyId },
        actor: "seed-demo",
      });
    }
  }

  const nContacts = (
    await db.select().from(contacts).where(eq(contacts.workspaceId, workspace.id))
  ).length;
  const nCompanies = (
    await db
      .select()
      .from(companies)
      .where(eq(companies.workspaceId, workspace.id))
  ).length;
  const nCases = (
    await db.select().from(cases).where(eq(cases.workspaceId, workspace.id))
  ).length;

  console.log("✓ Demo identidad en DB:");
  console.log(`  contacts   ${nContacts}`);
  console.log(`  companies  ${nCompanies}`);
  console.log(`  cases      ${nCases}`);
  console.log(`  persona natural demo: Jorge Valdés (company_id null)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

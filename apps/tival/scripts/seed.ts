import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE || "1";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import {
  caseEvents,
  cases,
  integrationConnections,
  playbookStages,
  playbooks,
  workspaces,
} from "../src/db/schema";
import {
  ALFONDO_DRIVE_ROOT_FOLDER_ID,
  newWebhookToken,
} from "../src/lib/integrations/connections";
import { seedWorkspaceUsers } from "../src/lib/auth/seed";
import { SEED_DEFAULT_PASSWORD } from "../src/lib/auth/seed-users";
import {
  linkContactCompany,
  resolveCompany,
  resolveContact,
} from "../src/lib/identity";
import { seedProductsIfEmpty } from "../src/lib/products-db";
import { ALFONDO_CONSULTORIA_STAGES } from "../src/workspaces/alfondo/playbook-consultoria";

const STAGES = ALFONDO_CONSULTORIA_STAGES;
async function main() {
  console.log(
    `Seeding Tival (${process.env.USE_PGLITE === "1" ? "PGlite" : "Postgres"})…`
  );
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

  const connectionRows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, workspace.id));

  if (!connectionRows.some((r) => r.provider === "calendly")) {
    await db.insert(integrationConnections).values({
      workspaceId: workspace.id,
      provider: "calendly",
      label: "Calendly Alfondo",
      status: "disconnected",
      webhookToken: newWebhookToken(),
      config: {},
    });
  }

  const driveRow = connectionRows.find((r) => r.provider === "google_drive");
  if (!driveRow) {
    await db.insert(integrationConnections).values({
      workspaceId: workspace.id,
      provider: "google_drive",
      label: "Google Alfondo",
      status: "disconnected",
      webhookToken: newWebhookToken(),
      config: { rootFolderId: ALFONDO_DRIVE_ROOT_FOLDER_ID },
    });
  } else {
    const cfg = (driveRow.config ?? {}) as Record<string, unknown>;
    const nextCfg = cfg.rootFolderId
      ? cfg
      : { ...cfg, rootFolderId: ALFONDO_DRIVE_ROOT_FOLDER_ID };
    await db
      .update(integrationConnections)
      .set({
        label: "Google Alfondo",
        config: nextCfg,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.id, driveRow.id));
  }

  let [playbook] = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.slug, "consultoria"))
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

  const existingStages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id));

  if (existingStages.length === 0) {
    await db.insert(playbookStages).values(
      STAGES.map((s) => ({
        playbookId: playbook.id,
        ...s,
      }))
    );
  } else {
    /**
     * Semántica vieja → nueva:
     *   pago (espera cobro)     → lead (si no pagó) / pagado (si ya pagó)
     *   reunion (post-pago)     → pagado  (no era “realizado”)
     *   propuesta               → propuesta_enviada
     * Keys de stage se renombran/crean; los casos se reapuntan aparte.
     */
    const stagesNow = () =>
      db
        .select()
        .from(playbookStages)
        .where(eq(playbookStages.playbookId, playbook.id));

    let rows = await stagesNow();

    async function ensureStage(def: (typeof STAGES)[number]) {
      const hit = rows.find((s) => s.key === def.key);
      if (hit) {
        await db
          .update(playbookStages)
          .set({
            name: def.name,
            description: def.description,
            sortOrder: def.sortOrder,
            requiresPayment: def.requiresPayment,
            requiresHuman: def.requiresHuman,
            actor: def.actor,
          })
          .where(eq(playbookStages.id, hit.id));
        rows = await stagesNow();
        return rows.find((s) => s.key === def.key)!;
      }
      const [created] = await db
        .insert(playbookStages)
        .values({ playbookId: playbook.id, ...def })
        .returning();
      rows = await stagesNow();
      return created;
    }

    const lead = await ensureStage(STAGES.find((s) => s.key === "lead")!);
    const pagado = await ensureStage(STAGES.find((s) => s.key === "pagado")!);
    await ensureStage(STAGES.find((s) => s.key === "realizado")!);
    const propuestaEnviada = await ensureStage(
      STAGES.find((s) => s.key === "propuesta_enviada")!
    );
    await ensureStage(STAGES.find((s) => s.key === "seguimiento")!);
    await ensureStage(STAGES.find((s) => s.key === "ganado")!);
    await ensureStage(STAGES.find((s) => s.key === "perdido")!);

    const legacyPago = rows.find((s) => s.key === "pago");
    const legacyReunion = rows.find((s) => s.key === "reunion");
    const legacyPropuesta = rows.find((s) => s.key === "propuesta");

    if (legacyPago) {
      // No pagados en “pago” → lead; pagados → pagado
      const onPago = await db
        .select()
        .from(cases)
        .where(eq(cases.currentStageId, legacyPago.id));
      for (const c of onPago) {
        const targetId =
          c.paymentStatus === "paid" ? pagado.id : lead.id;
        await db
          .update(cases)
          .set({ currentStageId: targetId })
          .where(eq(cases.id, c.id));
      }
      await db.delete(playbookStages).where(eq(playbookStages.id, legacyPago.id));
    }

    if (legacyReunion) {
      // Vieja “reunión” = post-pago → Diagnóstico pagado
      await db
        .update(cases)
        .set({ currentStageId: pagado.id })
        .where(eq(cases.currentStageId, legacyReunion.id));
      await db
        .delete(playbookStages)
        .where(eq(playbookStages.id, legacyReunion.id));
    }

    if (legacyPropuesta) {
      await db
        .update(cases)
        .set({ currentStageId: propuestaEnviada.id })
        .where(eq(cases.currentStageId, legacyPropuesta.id));
      await db
        .delete(playbookStages)
        .where(eq(playbookStages.id, legacyPropuesta.id));
    }
  }

  const stages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id));

  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));

  const existingCases = await db.select().from(cases).limit(1);
  if (existingCases.length === 0) {
    const demo = [
      {
        status: "open" as const,
        contactName: "Camila Reyes",
        companyName: "Norte Logística",
        contactEmail: "camila@nortelogistica.cl",
        companyRut: "76.123.456-7",
        calendlyEventUuid: "seed-norte-001",
        scheduledAt: new Date(Date.now() + 86400000 * 2),
        meetUrl: "https://meet.google.com/seed-norte",
        calendlyRoute: "A",
        paymentMethod: "transferencia" as const,
        paymentStatus: "pending" as const,
        currentStageId: byKey.lead.id,
        landingSource: "diagnostico-innovacion",
      },
      {
        status: "open" as const,
        contactName: "Felipe Mora",
        companyName: "Andes Food",
        contactEmail: "felipe@andesfood.cl",
        companyRut: "76.234.567-8",
        calendlyEventUuid: "seed-andes-002",
        scheduledAt: new Date(Date.now() + 86400000),
        meetUrl: "https://meet.google.com/seed-andes",
        calendlyRoute: "A",
        paymentMethod: "mercadopago" as const,
        paymentStatus: "paid" as const,
        paidAt: new Date(),
        paymentConfirmedBy: "seed",
        currentStageId: byKey.pagado.id,
        landingSource: "diagnostico-landing",
      },
      {
        status: "open" as const,
        contactName: "María Soto",
        companyName: "Meridian Tech",
        contactEmail: "maria@meridian.cl",
        companyRut: "76.345.678-9",
        calendlyEventUuid: "seed-meridian-003",
        scheduledAt: new Date(Date.now() + 86400000 * 3),
        meetUrl: "https://meet.google.com/seed-meridian",
        calendlyRoute: "B",
        paymentStatus: "none" as const,
        currentStageId: byKey.lead.id,
        landingSource: "guia-ley-id",
      },
    ];

    for (const row of demo) {
      const contact = await resolveContact({
        workspaceId: workspace.id,
        email: row.contactEmail,
        name: row.contactName,
        phoneSource: "seed",
      });
      const company = await resolveCompany({
        workspaceId: workspace.id,
        rut: row.companyRut,
        name: row.companyName,
      });
      if (company) await linkContactCompany(contact.id, company.id);

      const {
        contactName: _n,
        companyName: _co,
        contactEmail: _e,
        companyRut: _r,
        ...caseFields
      } = row;

      const [created] = await db
        .insert(cases)
        .values({
          workspaceId: workspace.id,
          playbookId: playbook.id,
          contactId: contact.id,
          companyId: company?.id ?? null,
          ...caseFields,
        })
        .returning();

      await db.insert(caseEvents).values({
        caseId: created.id,
        type: "calendly_scheduled",
        payload: { seed: true },
        actor: "seed",
      });

      if (row.paymentStatus === "paid") {
        await db.insert(caseEvents).values({
          caseId: created.id,
          type: "payment_approved",
          payload: { seed: true },
          actor: "seed",
        });
      }
      if (row.paymentStatus === "pending") {
        await db.insert(caseEvents).values({
          caseId: created.id,
          type: "checkout_started",
          payload: { method: "transferencia", seed: true },
          actor: "seed",
        });
      }
    }
  }

  const productsSeed = await seedProductsIfEmpty({
    workspaceSlug: workspace.slug,
  });
  console.log(
    productsSeed.skipped
      ? "Productos: ya existían (seed omitido)"
      : `Productos: insertados ${productsSeed.inserted}`
  );

  const usersSeed = await seedWorkspaceUsers(workspace.slug);
  console.log(
    `Usuarios: ${usersSeed.total} (nuevos ${usersSeed.created}, actualizados ${usersSeed.updated}) · pass default "${SEED_DEFAULT_PASSWORD}"`
  );

  // Migrar assigned_consultant_id legacy (pack members) → seed UUIDs
  const legacyMap: Record<string, string> = {
    "member-ops": "a0000000-0000-4000-8000-000000000001",
    "member-nico-jara": "a0000000-0000-4000-8000-000000000002",
    "member-marcelo-esperguel": "a0000000-0000-4000-8000-000000000003",
  };
  for (const [from, to] of Object.entries(legacyMap)) {
    await db
      .update(cases)
      .set({ assignedConsultantId: to, updatedAt: new Date() })
      .where(eq(cases.assignedConsultantId, from));
  }

  console.log(
    "Seed OK — workspace Alfondo / playbook Consultoría / usuarios / Calendly + Google / Productos"
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

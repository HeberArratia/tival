import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE || "1";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import {
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

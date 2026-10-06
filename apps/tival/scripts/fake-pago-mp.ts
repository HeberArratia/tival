/**
 * Simula el POST que Alfondo enviaría a Tival tras MP approved.
 *
 * Uso:
 *   npm run fake:pago-mp
 *   npm run fake:pago-mp -- --case=<uuid>
 *   npm run fake:pago-mp -- --calendly=<uuid>
 *   npm run fake:pago-mp -- --latest   (última opp open no pagada)
 *
 * Referencia: external_reference = diag_{calendlyEventUuid}
 */
import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../src/db";
import { cases } from "../src/db/schema";
import { markPaid } from "../src/lib/cases";
import { getContactById } from "../src/lib/identity";
import { toPaymentExternalReference } from "../src/lib/payments/refs";
import { defaultWorkspaceSlug } from "../src/lib/workspace/registry";

async function resolveTarget(args: string[]) {
  const caseArg = args.find((a) => a.startsWith("--case="))?.split("=")[1];
  const calendlyArg = args
    .find((a) => a.startsWith("--calendly="))
    ?.split("=")[1];
  const useLatest =
    args.includes("--latest") || (!caseArg && !calendlyArg);

  const db = await getDb();

  if (caseArg) {
    const [row] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseArg))
      .limit(1);
    if (!row) throw new Error(`Caso no encontrado: ${caseArg}`);
    return row;
  }

  if (calendlyArg) {
    const [row] = await db
      .select()
      .from(cases)
      .where(eq(cases.calendlyEventUuid, calendlyArg))
      .limit(1);
    if (!row) throw new Error(`Caso no encontrado calendly=${calendlyArg}`);
    return row;
  }

  if (useLatest) {
    const [row] = await db
      .select()
      .from(cases)
      .where(
        and(eq(cases.status, "open"), ne(cases.paymentStatus, "paid"))
      )
      .orderBy(desc(cases.createdAt))
      .limit(1);
    if (!row) {
      throw new Error(
        "No hay opp open sin pagar. Corré npm run fake:calendly primero."
      );
    }
    return row;
  }

  throw new Error("Indicá --case, --calendly o --latest");
}

async function main() {
  const args = process.argv.slice(2);
  const useHttp = args.includes("--http");
  const workspaceSlug = defaultWorkspaceSlug();
  const target = await resolveTarget(args);

  if (!target.calendlyEventUuid) {
    throw new Error(`Caso ${target.id} sin calendly_event_uuid`);
  }

  const external_reference = toPaymentExternalReference(
    target.calendlyEventUuid,
    workspaceSlug
  );
  const mpPaymentId = `sim-${Date.now()}`;

  const contact = target.contactId
    ? await getContactById(target.contactId)
    : null;

  console.log("→ Fake pago MP (POST Alfondo → Tival)");
  console.log(`  caseId       ${target.id}`);
  console.log(
    `  contact      ${contact?.name ?? "—"} <${contact?.email ?? "—"}>`
  );
  console.log(`  reference    ${external_reference}`);
  console.log(`  mpPaymentId  ${mpPaymentId}`);

  const payload = {
    action: "payment_approved",
    external_reference,
    calendlyEventUuid: target.calendlyEventUuid,
    caseId: target.id,
    mpPaymentId,
    method: "mercadopago",
    confirmedBy: "alfondo_mp_sim",
    workspaceSlug,
  };

  if (useHttp) {
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      "http://localhost:3000";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const key = process.env.TIVAL_INTERNAL_KEY;
    if (key) headers["x-tival-key"] = key;
    const res = await fetch(`${base}/api/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    console.log(`← ${res.status}`, json);
    if (!res.ok) process.exit(1);
  } else {
    const result = await markPaid({
      caseId: target.id,
      calendlyEventUuid: target.calendlyEventUuid,
      method: "mercadopago",
      mpPaymentId,
      confirmedBy: "alfondo_mp_sim",
    });
    console.log("← ok", {
      caseId: result.case.id,
      alreadyPaid: result.alreadyPaid,
      paymentStatus: result.case.paymentStatus,
      stageId: result.case.currentStageId,
    });
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

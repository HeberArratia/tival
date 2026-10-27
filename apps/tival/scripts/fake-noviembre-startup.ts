/**
 * Prueba el intake de noviembre-startup.
 *
 *   npm run fake:noviembre-startup
 *   npm run fake:noviembre-startup -- --http
 *
 * Sin --http llama al dominio directo (no hace falta el server).
 * Con --http hace POST a NEXT_PUBLIC_APP_URL con x-tival-api-key.
 *
 * Cubre:
 *   1. Start-Up Chile + revisión (el ejemplo de Alfondo)
 *   2. Semilla Inicia + formulación (program y review_progress en null)
 *   3. Reenvío del mismo submission_id (idempotencia)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

process.env.USE_PGLITE = process.env.USE_PGLITE || "1";

import { ingestNoviembreStartup } from "../src/lib/integrations/noviembre-startup";

const STARTUP_CHILE_ID = "6f1c2a4e-8d0b-4b7e-9a51-2f3c9e7d1a20";
const SEMILLA_ID = "a1b2c3d4-e5f6-4123-8abc-def012345678";

const startupChile = {
  schema_version: "noviembre-startup-v1",
  source: "noviembre-startup",
  submission_id: STARTUP_CHILE_ID,
  submitted_at: "2026-10-27T01:23:45.000Z",
  contact: {
    full_name: "Camila Rojas",
    email: "camila@miproyecto.cl",
    phone: "+56912345678",
    company: "Mi Proyecto SpA",
    website: "miproyecto.cl",
  },
  fund: {
    id: "startup-chile",
    label: "Start-Up Chile by Corfo",
    program: { id: "ignite", label: "Ignite" },
  },
  service: { id: "review", label: "Revisión profesional" },
  review_progress: {
    id: "some-answers",
    label: "Tengo algunas respuestas preparadas.",
  },
  project_description: "Texto libre, hasta 800 caracteres.",
  declarations: [
    {
      id: "innovative",
      text: "Declaro que mi proyecto es innovador. No es abrir ni ampliar un negocio con un modelo tradicional (barbería, restaurante, compra y venta, importación, etc.).",
    },
    {
      id: "startup-scalable",
      text: "Declaro que puede escalar más allá de un negocio local.",
    },
    {
      id: "startup-venture",
      text: "Declaro que mi proyecto es una startup.",
    },
  ],
  budget_intent: "willing-to-invest",
  contact_consent: {
    accepted: true,
    text: "Autorizo a Alfondo a contactarme respecto de mi solicitud.",
  },
};

const semillaInicia = {
  schema_version: "noviembre-startup-v1",
  source: "noviembre-startup",
  submission_id: SEMILLA_ID,
  submitted_at: "2026-10-27T02:00:00.000Z",
  contact: {
    full_name: "Pedro Soto",
    email: "pedro@semilla.cl",
    phone: "+56987654321",
    company: "Semilla Demo",
    website: null,
  },
  fund: {
    id: "semilla-inicia",
    label: "Semilla Inicia",
    program: null,
  },
  service: { id: "formulation", label: "Formulación completa" },
  review_progress: null,
  project_description: "Queremos formular la postulación a Semilla Inicia.",
  declarations: [
    {
      id: "innovative",
      text: "Declaro que mi proyecto es innovador.",
    },
    {
      id: "inicia-without-sales",
      text: "Declaro que todavía no tengo ventas formales.",
    },
  ],
  budget_intent: "willing-to-invest",
  contact_consent: {
    accepted: true,
    text: "Autorizo a Alfondo a contactarme respecto de mi solicitud.",
  },
};

async function postHttp(body: unknown) {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const key =
    process.env.ALFONDO_API_KEY?.trim() ||
    process.env.TIVAL_API_KEY?.trim() ||
    "";
  const res = await fetch(
    `${base}/api/integrations/alfondo/noviembre-startup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tival-api-key": key,
      },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  return { status: res.status, json };
}

async function runOne(label: string, body: unknown, viaHttp: boolean) {
  if (viaHttp) {
    const result = await postHttp(body);
    console.log(label, result.status, result.json);
    return result.json as { opportunity_id?: string };
  }
  const result = await ingestNoviembreStartup(body);
  console.log(label, result.created ? 201 : 200, {
    ok: true,
    opportunity_id: result.opportunityId,
    created: result.created,
  });
  return { opportunity_id: result.opportunityId };
}

async function main() {
  const viaHttp = process.argv.includes("--http");
  const first = await runOne("startup-chile", startupChile, viaHttp);
  const second = await runOne("semilla-inicia", semillaInicia, viaHttp);
  const replay = await runOne("reenvio startup-chile", startupChile, viaHttp);

  if (!first.opportunity_id || !second.opportunity_id || !replay.opportunity_id) {
    throw new Error("Faltó opportunity_id en alguna respuesta.");
  }
  if (first.opportunity_id !== replay.opportunity_id) {
    throw new Error(
      `Idempotencia falló: ${first.opportunity_id} ≠ ${replay.opportunity_id}`
    );
  }
  if (first.opportunity_id === second.opportunity_id) {
    throw new Error("Semilla Inicia no debía reutilizar la oportunidad de Start-Up Chile.");
  }
  console.log("OK — idempotencia por submission_id.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

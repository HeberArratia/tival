/**
 * Pack Alfondo — lógica de negocio de esta organización.
 * Plantillas reutilizables pueden vivir en `src/playbooks/templates`;
 * lo específico de Alfondo (segmentos, Q&A, aliases UTM) vive aquí.
 */
import { SEED_USERS } from "@/lib/auth/seed-users";
import { CONSULTORIA_FIELDS } from "@/lib/opportunity-fields";
import type { WorkspaceSegment } from "@/lib/segments";
import type { WorkspaceMember, WorkspacePack } from "@/lib/workspace/types";

/** Personas del workspace — espejo del seed Bigin (auth real en DB). */
export const ALFONDO_MEMBERS: WorkspaceMember[] = SEED_USERS.map((u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  roles: u.roles,
}));

export const ALFONDO_SEGMENTS: WorkspaceSegment[] = [
  {
    id: "s1",
    code: "S1",
    name: "Sin ventas formales / validación inicial",
    blurb:
      "El subsidio es el centro: suele necesitar el fondo para avanzar. Busca “a qué postular”. Atención estandarizada y delegada (poca hora senior).",
    criteria: [
      {
        key: "ventas",
        label: "Ventas / escala",
        hint: "Sin ventas formales o validación inicial",
      },
      {
        key: "logica",
        label: "Lógica comercial",
        hint: "Alta dependencia de subsidio; el fondo habilita el avance",
      },
      {
        key: "atencion",
        label: "Atención / instrumentos",
        hint: "Estandarizada · Semilla Inicia, SU Chile Build",
      },
    ],
  },
  {
    id: "s2",
    code: "S2",
    name: "Operación real y crecimiento",
    blurb:
      "Ya factura y opera. Quiere crecer o innovar; el financiamiento es palanca, no única condición. Atención consultiva + estructuración.",
    criteria: [
      {
        key: "ventas",
        label: "Ventas / escala",
        hint: "< ~$500MM CLP (orientativo)",
      },
      {
        key: "logica",
        label: "Lógica comercial",
        hint: "Crece/innova; el subsidio es palanca, no condición única",
      },
      {
        key: "atencion",
        label: "Atención / instrumentos",
        hint: "Consultiva · Semilla Expande, Ignite/Growth, Súmate, Innova Región, Escalamiento",
      },
    ],
  },
  {
    id: "s2s3",
    code: "S2S3",
    name: "Complejidad media-alta",
    blurb:
      "Misma lógica de crecimiento, con más complejidad (técnica, decisores, ticket). Suele pedir arquitectura/priorización senior antes de formular. Puente entre S2 y S3.",
    criteria: [
      {
        key: "ventas",
        label: "Ventas / escala",
        hint: "~$500MM–$2.000MM CLP o complejidad equivalente",
      },
      {
        key: "logica",
        label: "Lógica comercial",
        hint: "Crecimiento + complejidad; arquitectura senior antes de formular",
      },
      {
        key: "atencion",
        label: "Atención / instrumentos",
        hint: "Senior en priorización · puente S2→S3",
      },
    ],
  },
  {
    id: "s3",
    code: "S3",
    name: "Estratégico / alta facturación",
    blurb:
      "Innovación por estrategia; el subsidio es herramienta (eficiencia de capital, riesgo, retorno). Conversación B2B senior: portafolio, Ley I+D, continuidad. No vender “postulación” commodity.",
    criteria: [
      {
        key: "ventas",
        label: "Ventas / escala",
        hint: "> ~$2.000MM CLP (orientativo)",
      },
      {
        key: "logica",
        label: "Lógica comercial",
        hint: "Estrategia primero; el subsidio optimiza capital/riesgo/retorno",
      },
      {
        key: "atencion",
        label: "Atención / instrumentos",
        hint: "B2B senior · portafolio, Ley I+D, continuidad (no postulación commodity)",
      },
    ],
  },
];

export const alfondoPack: WorkspacePack = {
  slug: "alfondo",
  name: "Alfondo",
  timezone: "America/Santiago",
  locale: "es-CL",
  defaultPlaybookSlug: "consultoria",
  segments: ALFONDO_SEGMENTS,
  members: ALFONDO_MEMBERS,
  consultoriaFields: CONSULTORIA_FIELDS,
  calendlyMapping: {
    phoneQuestion: [/tel[eé]fono/i, /phone/i, /whatsapp/i],
    mensajeQuestion: [
      /proyecto/i,
      /cu[eé]ntenos/i,
      /descripci[oó]n/i,
      /mensaje/i,
    ],
    rutQuestion: [/rut/i, /factura/i, /empresa/i],
    landingFromTracking: "utm_medium",
    allowedLandings: [
      "diagnostico",
      "diagnostico-landing",
      "diagnostico-innovacion",
    ],
  },
  landingAliases: [
    { match: /diagnostico|diag/, initiativeSlug: "diagnostico" },
    { match: /ley|guia/, initiativeSlug: "guia-ley-id" },
    { match: /webinar/, initiativeSlug: "webinar-start-2026" },
  ],
  mpExternalRefPrefix: "diag_",
};

export const ALFONDO = alfondoPack;

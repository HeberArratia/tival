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
    name: "Emprendedores iniciales",
    blurb: "Equipos chicos, ventas bajas, explorando financiamiento o I+D.",
    criteria: [
      {
        key: "ventas",
        label: "Ventas anuales",
        hint: "Hasta ~80M CLP (orientativo)",
      },
      { key: "equipo", label: "Tamaño", hint: "1–10 personas" },
      {
        key: "busca",
        label: "Qué busca",
        hint: "Orientación, fondos tempranos, primeros pasos I+D",
      },
    ],
  },
  {
    id: "s2",
    code: "S2",
    name: "Mediana empresa",
    blurb: "Operación estable; innovar o formalizar I+D / fondos.",
    criteria: [
      {
        key: "ventas",
        label: "Ventas anuales",
        hint: "~80M–800M CLP (orientativo)",
      },
      { key: "equipo", label: "Tamaño", hint: "11–50 personas" },
      {
        key: "busca",
        label: "Qué busca",
        hint: "Diagnóstico, Ley I+D, portafolio de innovación",
      },
    ],
  },
  {
    id: "s3",
    code: "S3",
    name: "Empresa grande",
    blurb: "Escala corporativa; proyectos formales y compliance.",
    criteria: [
      {
        key: "ventas",
        label: "Ventas anuales",
        hint: "Sobre ~800M CLP (orientativo)",
      },
      { key: "equipo", label: "Tamaño", hint: "50+ personas" },
      {
        key: "busca",
        label: "Qué busca",
        hint: "Gobernanza I+D, certificaciones, proyectos grandes",
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
  },
  landingAliases: [
    { match: /diagnostico|diag/, initiativeSlug: "diagnostico" },
    { match: /ley|guia/, initiativeSlug: "guia-ley-id" },
    { match: /webinar/, initiativeSlug: "webinar-start-2026" },
  ],
  mpExternalRefPrefix: "diag_",
};

export const ALFONDO = alfondoPack;

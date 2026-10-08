import type {
  CaseEvent,
  CaseRow,
  CompanyRow,
  ContactCompanyRow,
  ContactPhoneRow,
  ContactRow,
  Playbook,
  PlaybookStage,
  Workspace,
} from "@/db/schema";
import {
  initiativeTypeById,
  type InitiativeTypeId,
} from "@/lib/initiative-types";
import {
  CAPTACION_GUIA_FIELDS,
  CAPTACION_WEBINAR_FIELDS,
  CONSULTORIA_FIELDS,
  FUNDER_FIELDS,
  type OpportunityFieldDef,
} from "@/lib/opportunity-fields";
import type { SegmentId, SegmentMode } from "@/lib/segments";
import { segmentById } from "@/lib/segments";
import { getWorkspacePack } from "@/lib/workspace/registry";

const hours = (h: number) => new Date(Date.now() + h * 3600_000);
const days = (d: number) => new Date(Date.now() + d * 86400_000);
const ago = (h: number) => new Date(Date.now() - h * 3600_000);

const WS = "00000000-0000-4000-8000-000000000001";
export const PB_CONSULTORIA = "00000000-0000-4000-8000-000000000002";
/** @deprecated usar PB_CAPTACION_GUIA */
export const PB_CAPTACION = "00000000-0000-4000-8000-000000000003";
export const PB_CAPTACION_GUIA = "00000000-0000-4000-8000-000000000003";
export const PB_CAPTACION_WEBINAR = "00000000-0000-4000-8000-000000000005";
export const PB_FUNDER = "00000000-0000-4000-8000-000000000004";

export type FakePlaybookMeta = {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  /** Tipos de iniciativa que pueden usar este playbook */
  compatibleTypes: InitiativeTypeId[];
  /** Contrato: campos de la oportunidad en este proceso */
  opportunityFields: OpportunityFieldDef[];
  /** UI-only: playbook aún no operativo en V1 */
  comingSoon?: boolean;
  stages: PlaybookStage[];
};

/** Iniciativa = oferta/campaña concreta que usa un playbook. */
export type FakeInitiative = {
  id: string;
  playbookId: string;
  typeId: InitiativeTypeId;
  name: string;
  slug: string;
  blurb: string;
  config?: Record<string, string>;
  /** Defaults de campos del playbook (asset, evento, etc.) */
  fieldDefaults?: Record<string, string>;
  /** Segmentos a los que apunta esta oferta */
  targetSegmentIds?: SegmentId[];
  /**
   * classify = form/reglas resuelven segmento (ej. Diagnóstico).
   * fixed = entra ya tagged al target (ej. guía S2).
   */
  segmentMode?: SegmentMode;
  /** UI preview — aún no cableada */
  comingSoon?: boolean;
  /** Creada desde la UI (localStorage) */
  userCreated?: boolean;
};

export const INI_DIAGNOSTICO = "ini-diagnostico";
export const INI_LEY_ID = "ini-ley-id";
export const INI_WEBINAR = "ini-webinar";
export const INI_CONTACTO = "ini-contacto";
export const INI_FUNDER = "ini-funder-demo";


export const FAKE_WORKSPACE: Workspace = {
  id: WS,
  name: "Alfondo",
  slug: "alfondo",
  createdAt: ago(1000),
};

export const FAKE_STAGES_CONSULTORIA: PlaybookStage[] = [
  {
    id: "stage-lead",
    playbookId: PB_CONSULTORIA,
    key: "lead",
    name: "Lead entrante",
    description: "Agendó / capturó; aún sin pago confirmado",
    sortOrder: 1,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    id: "stage-pagado",
    playbookId: PB_CONSULTORIA,
    key: "pagado",
    name: "Diagnóstico pagado",
    description: "Pago confirmado (MP o transferencia)",
    sortOrder: 2,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    id: "stage-realizado",
    playbookId: PB_CONSULTORIA,
    key: "realizado",
    name: "Diagnóstico realizado",
    description: "La reunión de diagnóstico ya ocurrió",
    sortOrder: 3,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
  {
    id: "stage-propuesta-enviada",
    playbookId: PB_CONSULTORIA,
    key: "propuesta_enviada",
    name: "Propuesta enviada",
    description: "Se envió la propuesta al cliente",
    sortOrder: 4,
    requiresPayment: false,
    requiresHuman: true,
    actor: "agente",
  },
  {
    id: "stage-seguimiento",
    playbookId: PB_CONSULTORIA,
    key: "seguimiento",
    name: "Seguimiento",
    description: "Cadencias post-propuesta",
    sortOrder: 5,
    requiresPayment: false,
    requiresHuman: false,
    actor: "agente",
  },
  {
    id: "stage-ganado",
    playbookId: PB_CONSULTORIA,
    key: "ganado",
    name: "Ganado",
    description: "Cierre ganado — trato cerrado",
    sortOrder: 6,
    requiresPayment: false,
    requiresHuman: false,
    actor: "humano",
  },
  {
    id: "stage-perdido",
    playbookId: PB_CONSULTORIA,
    key: "perdido",
    name: "Perdido",
    description: "Cierre no ganado — motivo en lost_reason (no_pago, no_compra, …)",
    sortOrder: 7,
    requiresPayment: false,
    requiresHuman: false,
    actor: "humano",
  },
];
/** Captación guía / form — sin etapa de asistencia. */
export const FAKE_STAGES_CAPTACION_GUIA: PlaybookStage[] = [
  {
    id: "guia-inbound",
    playbookId: PB_CAPTACION_GUIA,
    key: "inbound",
    name: "Lead inbound",
    description: "Descarga o form enviado",
    sortOrder: 1,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    id: "guia-nurture",
    playbookId: PB_CAPTACION_GUIA,
    key: "nurture",
    name: "Nurture",
    description: "Sequenzy / contenido / WA",
    sortOrder: 2,
    requiresPayment: false,
    requiresHuman: false,
    actor: "agente",
  },
  {
    id: "guia-calificado",
    playbookId: PB_CAPTACION_GUIA,
    key: "calificado",
    name: "Calificado",
    description: "Listo para promover a Consultoría",
    sortOrder: 3,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
];

/** Captación webinar — incluye asistencia. */
export const FAKE_STAGES_CAPTACION_WEBINAR: PlaybookStage[] = [
  {
    id: "web-reg",
    playbookId: PB_CAPTACION_WEBINAR,
    key: "registrado",
    name: "Registrado",
    description: "Se inscribió al webinar",
    sortOrder: 1,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    id: "web-asist",
    playbookId: PB_CAPTACION_WEBINAR,
    key: "asistencia",
    name: "Asistencia",
    description: "Asistió / no asistió al vivo",
    sortOrder: 2,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    id: "web-nurture",
    playbookId: PB_CAPTACION_WEBINAR,
    key: "nurture",
    name: "Nurture",
    description: "Sequenzy post-evento",
    sortOrder: 3,
    requiresPayment: false,
    requiresHuman: false,
    actor: "agente",
  },
  {
    id: "web-cal",
    playbookId: PB_CAPTACION_WEBINAR,
    key: "calificado",
    name: "Calificado",
    description: "Listo para promover a Consultoría",
    sortOrder: 4,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
];

/** @deprecated */
export const FAKE_STAGES_CAPTACION = FAKE_STAGES_CAPTACION_GUIA;

/** Preview UI — aún no operativo. */
export const FAKE_STAGES_FUNDER: PlaybookStage[] = [
  {
    id: "funder-lead",
    playbookId: PB_FUNDER,
    key: "lead",
    name: "Lead wizard",
    description: "Entrada al autodiagnóstico",
    sortOrder: 1,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    id: "funder-match",
    playbookId: PB_FUNDER,
    key: "match",
    name: "Match fondos",
    description: "Elegibilidad y ruta",
    sortOrder: 2,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
  {
    id: "funder-cierre",
    playbookId: PB_FUNDER,
    key: "cierre",
    name: "Cierre programa",
    description: "Inscripción / pago programa",
    sortOrder: 3,
    requiresPayment: true,
    requiresHuman: false,
    actor: "integracion",
  },
];

export const FAKE_PLAYBOOKS: FakePlaybookMeta[] = [
  {
    id: PB_CONSULTORIA,
    slug: "consultoria",
    name: "Consultoría",
    blurb:
      "Lead → diagnóstico pagado → realizado → propuesta enviada. Default para tipo agenda.",
    compatibleTypes: ["agenda"],
    opportunityFields: CONSULTORIA_FIELDS,
    stages: FAKE_STAGES_CONSULTORIA,
  },
  {
    id: PB_CAPTACION_GUIA,
    slug: "captacion-guia",
    name: "Captación guía",
    blurb:
      "Inbound form → nurture → calificado. Default para tipos guía y form (mismas etapas).",
    compatibleTypes: ["guia", "form"],
    opportunityFields: CAPTACION_GUIA_FIELDS,
    stages: FAKE_STAGES_CAPTACION_GUIA,
  },
  {
    id: PB_CAPTACION_WEBINAR,
    slug: "captacion-webinar",
    name: "Captación webinar",
    blurb:
      "Registrado → asistencia → nurture → calificado. Etapas propias del tipo webinar.",
    compatibleTypes: ["webinar"],
    opportunityFields: CAPTACION_WEBINAR_FIELDS,
    stages: FAKE_STAGES_CAPTACION_WEBINAR,
  },
  {
    id: PB_FUNDER,
    slug: "wizard-autodiagnostico",
    name: "Wizard autodiagnóstico",
    blurb: "Autodiagnóstico guiado. Default para tipo programa.",
    compatibleTypes: ["programa"],
    comingSoon: true,
    opportunityFields: FUNDER_FIELDS,
    stages: FAKE_STAGES_FUNDER,
  },
];

export const FAKE_INITIATIVES: FakeInitiative[] = [
  {
    id: INI_DIAGNOSTICO,
    playbookId: PB_CONSULTORIA,
    typeId: "agenda",
    name: "Diagnóstico",
    slug: "diagnostico",
    blurb: "Landing + form pre-agenda + Calendly A/B. Clasifica S1–S3.",
    targetSegmentIds: ["s1", "s2", "s3"],
    segmentMode: "classify",
    config: {
      landingUrl: "https://alfondo.cl/diagnostico-innovacion",
      calendlyUrl: "https://calendly.com/alfondo/diagnostico",
    },
  },
  {
    id: INI_LEY_ID,
    playbookId: PB_CAPTACION_GUIA,
    typeId: "guia",
    name: "Guía Ley I+D",
    slug: "guia-ley-id",
    blurb: "Magnet · target S2–S3 (mediana / grande).",
    targetSegmentIds: ["s2", "s3"],
    segmentMode: "fixed",
    fieldDefaults: {
      asset: "Guía Ley I+D",
      tag_secuencia: "sequenzy_ley_id",
    },
    config: { asset: "guia-ley-id.pdf" },
  },
  {
    id: INI_WEBINAR,
    playbookId: PB_CAPTACION_WEBINAR,
    typeId: "webinar",
    name: "Webinar Start 2026",
    slug: "webinar-start-2026",
    blurb: "Evento para emprendedores iniciales (S1).",
    targetSegmentIds: ["s1"],
    segmentMode: "fixed",
    fieldDefaults: {
      evento: "Webinar Start 2026",
      fecha_evento: "2026-03-15T18:00:00-03:00",
    },
    config: { eventAt: "2026-03-15" },
  },
  {
    id: INI_CONTACTO,
    playbookId: PB_CAPTACION_GUIA,
    typeId: "form",
    name: "Formulario contacto",
    slug: "contacto",
    blurb: "Tipo form · abierto; clasifica si hay señales.",
    targetSegmentIds: ["s1", "s2", "s3"],
    segmentMode: "classify",
    fieldDefaults: {
      asset: "Contacto web",
    },
  },
  {
    id: INI_FUNDER,
    playbookId: PB_FUNDER,
    typeId: "programa",
    name: "Wizard autodiagnóstico (demo)",
    slug: "wizard-autodiagnostico-demo",
    blurb: "Placeholder · S1–S2.",
    targetSegmentIds: ["s1", "s2"],
    segmentMode: "classify",
    fieldDefaults: {
      wizard: "Wizard autodiagnóstico",
    },
    comingSoon: true,
  },
];

/** caseId → initiativeId (UI / fake architecture) */
const CASE_INITIATIVE: Record<string, string> = {
  "case-norte": INI_DIAGNOSTICO,
  "case-andes": INI_DIAGNOSTICO,
  "case-costa": INI_DIAGNOSTICO,
  "case-quinta": INI_DIAGNOSTICO,
  "case-puerto": INI_DIAGNOSTICO,
  "case-aurora": INI_DIAGNOSTICO,
  "case-horizon": INI_DIAGNOSTICO,
  "case-lumen": INI_DIAGNOSTICO,
  "case-meridian": INI_DIAGNOSTICO,
  "case-vita": INI_DIAGNOSTICO,
  "case-guia-ley": INI_LEY_ID,
  "case-webinar": INI_WEBINAR,
  "case-contacto": INI_CONTACTO,
  "case-calificado": INI_LEY_ID,
};

/** caseId → segmento resuelto (concepto UI) */
const CASE_SEGMENT: Record<string, SegmentId> = {
  "case-norte": "s2",
  "case-andes": "s2",
  "case-meridian": "s1",
  "case-vita": "s1",
  "case-costa": "s3",
  "case-quinta": "s2",
  "case-puerto": "s1",
  "case-aurora": "s2",
  "case-horizon": "s2",
  "case-lumen": "s3",
  "case-guia-ley": "s2",
  "case-webinar": "s1",
  "case-contacto": "s1",
  "case-calificado": "s3",
};

/** Valores de campos de proceso (lo que escribió el flujo). */
const CASE_FIELD_VALUES: Record<string, Record<string, string>> = {
  "case-norte": {
    mensaje_usuario: "Queremos ordenar el portafolio de innovación",
    agendado_en: "2026-09-08T14:22:00-03:00",
    fecha_reunion: "2026-09-14T10:00:00-03:00",
    meet_url: "https://meet.google.com/fake-norte",
    ruta_calendly: "B",
  },
  "case-andes": {
    mensaje_usuario: "Revisión post-pago · brief listo",
    agendado_en: "2026-09-05T11:00:00-03:00",
    fecha_reunion: "2026-09-13T16:00:00-03:00",
    meet_url: "https://meet.google.com/fake-andes",
    ruta_calendly: "B",
  },
  "case-meridian": {
    mensaje_usuario: "Emprendedor · primera vez con fondos",
    agendado_en: "2026-09-09T09:10:00-03:00",
    fecha_reunion: "2026-09-15T11:00:00-03:00",
    ruta_calendly: "A",
  },
  "case-guia-ley": {
    mensaje_usuario: "Descargó guía desde ads S2",
  },
  "case-webinar": {
    asistio: "si",
  },
  "case-contacto": {
    mensaje_usuario: "Quiero saber de fondos",
  },
  "case-calificado": {
    mensaje_usuario: "Hot lead · promover a diagnóstico",
    tag_secuencia: "sequenzy_ley_id",
  },
};

/** Extras = solo atribución / IDs de origen (no ficha ops). */
const CASE_EXTRAS: Record<string, Record<string, string>> = {
  "case-norte": {
    utm_campaign: "diag_meta_s2",
    calendly_event_uuid: "fake-norte",
    landing_source: "diagnostico-innovacion",
  },
  "case-guia-ley": {
    fbclid: "IwAR0fake",
    landing_source: "guia-ley-id",
  },
};

/** @deprecated use FAKE_PLAYBOOKS[0] — kept for getActivePlaybook compat */
export const FAKE_STAGES = FAKE_STAGES_CONSULTORIA;

export const FAKE_PLAYBOOK: Playbook = {
  id: PB_CONSULTORIA,
  workspaceId: WS,
  name: "Consultoría",
  slug: "consultoria",
  isActive: true,
  createdAt: ago(1000),
};

export function playbookMetaById(playbookId: string | null | undefined) {
  return (
    FAKE_PLAYBOOKS.find((p) => p.id === playbookId) ?? FAKE_PLAYBOOKS[0]
  );
}

export function playbookBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  return FAKE_PLAYBOOKS.find((p) => p.slug === slug) ?? null;
}

export function playbookLabel(playbookId: string | null | undefined) {
  return playbookMetaById(playbookId).name;
}

export function initiativesForPlaybook(playbookId: string) {
  return FAKE_INITIATIVES.filter((i) => i.playbookId === playbookId);
}

export function playbooksCompatibleWithType(typeId: InitiativeTypeId) {
  return FAKE_PLAYBOOKS.filter((p) => p.compatibleTypes.includes(typeId));
}

export function defaultPlaybookForType(typeId: InitiativeTypeId) {
  const t = initiativeTypeById(typeId);
  if (!t) return FAKE_PLAYBOOKS[0];
  return playbookBySlug(t.defaultPlaybookSlug) ?? FAKE_PLAYBOOKS[0];
}

export function initiativeById(id: string | null | undefined) {
  if (!id) return null;
  return FAKE_INITIATIVES.find((i) => i.id === id) ?? null;
}

export function initiativeForCase(caseRow: {
  id: string;
  landingSource?: string | null;
  playbookId: string;
}) {
  const byId = CASE_INITIATIVE[caseRow.id];
  if (byId) return initiativeById(byId);

  const source = (caseRow.landingSource ?? "").toLowerCase();
  if (source) {
    const bySlug = FAKE_INITIATIVES.find((i) => i.slug === source);
    if (bySlug) return bySlug;

    // Aliases UTM del workspace pack (no hardcodear org en el core)
    try {
      const pack = getWorkspacePack();
      for (const rule of pack.landingAliases) {
        if (rule.match.test(source)) {
          const ini = FAKE_INITIATIVES.find(
            (i) => i.slug === rule.initiativeSlug
          );
          if (ini) return ini;
        }
      }
    } catch {
      /* pack ausente */
    }
  }

  return (
    FAKE_INITIATIVES.find((i) => i.playbookId === caseRow.playbookId) ??
    FAKE_INITIATIVES[0] ??
    null
  );
}

/** URL canónica: oportunidad siempre bajo su iniciativa. */
export function opportunityHref(caseRow: {
  id: string;
  playbookId: string;
  landingSource?: string | null;
}) {
  const ini = initiativeForCase(caseRow);
  const slug = ini?.slug ?? "sin-iniciativa";
  return `/iniciativas/${slug}/oportunidades/${caseRow.id}`;
}

/** Segmento resuelto en la oportunidad (UI). */
export function segmentForCase(caseRow: { id: string }) {
  const id = CASE_SEGMENT[caseRow.id];
  return segmentById(id);
}

export type ResolvedOpportunityField = {
  def: OpportunityFieldDef;
  value: string | null;
  /** default = solo iniciativa; value = escrito en la opp; empty = vacío */
  source: "default" | "value" | "empty";
};

/** Une esquema playbook + defaults iniciativa + valores de la opp (DB o fake). */
export function resolveOpportunityFields(caseRow: {
  id: string;
  playbookId: string;
  landingSource?: string | null;
  meetUrl?: string | null;
  scheduledAt?: Date | string | null;
  createdAt?: Date | string | null;
  calendlyRoute?: string | null;
  driveFolderId?: string | null;
  driveFolderKey?: string | null;
  qualification?: Record<string, unknown> | null;
}): ResolvedOpportunityField[] {
  const pb = playbookMetaById(caseRow.playbookId);
  const ini = initiativeForCase(caseRow);
  const fakeValues = CASE_FIELD_VALUES[caseRow.id] ?? {};
  const defaults = ini?.fieldDefaults ?? {};
  const q = (caseRow.qualification ?? {}) as Record<string, unknown>;

  const driveFolderUrl = caseRow.driveFolderId
    ? `https://drive.google.com/drive/folders/${caseRow.driveFolderId}`
    : null;

  const fromCase: Record<string, string | null> = {
    meet_url:
      caseRow.meetUrl ??
      (typeof q.meet_url === "string" ? q.meet_url : null),
    drive_folder_url: driveFolderUrl,
    fecha_reunion: caseRow.scheduledAt
      ? new Date(caseRow.scheduledAt).toISOString()
      : typeof q.fecha_reunion === "string"
        ? q.fecha_reunion
        : null,
    agendado_en:
      typeof q.agendado_en === "string"
        ? q.agendado_en
        : caseRow.createdAt
          ? new Date(caseRow.createdAt).toISOString()
          : null,
    mensaje_usuario:
      typeof q.mensaje_usuario === "string" ? q.mensaje_usuario : null,
    rut_facturacion:
      typeof q.rut_facturacion === "string" ? q.rut_facturacion : null,
    asset: typeof q.asset === "string" ? q.asset : null,
    evento: typeof q.evento === "string" ? q.evento : null,
    wizard: typeof q.wizard === "string" ? q.wizard : null,
    closing_score:
      typeof q.closing_score === "string" ? q.closing_score : null,
    region: typeof q.region === "string" ? q.region : null,
    ruta_calendly: caseRow.calendlyRoute ?? null,
  };

  return (pb.opportunityFields ?? []).map((def) => {
    const raw =
      fakeValues[def.key] ??
      fromCase[def.key] ??
      defaults[def.key] ??
      null;
    const value =
      raw !== null && raw !== undefined && String(raw).trim() !== ""
        ? String(raw)
        : null;

    if (fakeValues[def.key] || fromCase[def.key]) {
      return { def, value, source: "value" as const };
    }
    if (defaults[def.key]) {
      return { def, value, source: "default" as const };
    }
    return { def, value: null, source: "empty" as const };
  });
}

/**
 * Solo atribución / IDs de origen — no datos ops (esos van en el esquema del playbook).
 */
export function extrasForCase(caseRow: {
  id: string;
  qualification?: Record<string, unknown> | null;
  landingSource?: string | null;
  calendlyEventUuid?: string | null;
}) {
  const fromFake = CASE_EXTRAS[caseRow.id];
  if (fromFake) return fromFake;

  const q = caseRow.qualification ?? {};
  const extras: Record<string, string> = {};
  if (caseRow.landingSource) extras.landing_source = caseRow.landingSource;
  if (caseRow.calendlyEventUuid)
    extras.calendly_event_uuid = caseRow.calendlyEventUuid;
  if (typeof q.host_email === "string") extras.host = q.host_email;
  const tracking = q.tracking as Record<string, unknown> | undefined;
  if (tracking?.utm_campaign)
    extras.utm_campaign = String(tracking.utm_campaign);
  if (tracking?.utm_source) extras.utm_source = String(tracking.utm_source);
  if (tracking?.utm_medium) extras.utm_medium = String(tracking.utm_medium);
  if (tracking?.utm_content)
    extras.utm_content = String(tracking.utm_content);
  if (tracking?.fbclid) extras.fbclid = String(tracking.fbclid);
  return extras;
}

/** Ruta de enrutado demo (A/B) ligada al segmento — no es el segmento. */
export function routeHintForSegment(segmentId: SegmentId | null | undefined) {
  if (segmentId === "s1") return "Calendly ruta A";
  if (segmentId === "s2") return "Calendly ruta B";
  if (segmentId === "s3") return "Calendly ruta C · handoff";
  return null;
}

const CT = {
  camila: "c0000000-0000-4000-8000-000000000001",
  felipe: "c0000000-0000-4000-8000-000000000002",
  maria: "c0000000-0000-4000-8000-000000000003",
  paula: "c0000000-0000-4000-8000-000000000004",
  diego: "c0000000-0000-4000-8000-000000000005",
  vale: "c0000000-0000-4000-8000-000000000006",
  rodrigo: "c0000000-0000-4000-8000-000000000007",
  tomas: "c0000000-0000-4000-8000-000000000008",
  andrea: "c0000000-0000-4000-8000-000000000009",
  caro: "c0000000-0000-4000-8000-00000000000a",
  luis: "c0000000-0000-4000-8000-00000000000b",
  bea: "c0000000-0000-4000-8000-00000000000c",
  /** Persona natural — sin empresa / RUT */
  jorge: "c0000000-0000-4000-8000-00000000000d",
} as const;

const CO = {
  norte: "b0000000-0000-4000-8000-000000000001",
  norteSpa: "b0000000-0000-4000-8000-000000000010",
  andes: "b0000000-0000-4000-8000-000000000002",
  meridian: "b0000000-0000-4000-8000-000000000003",
  vita: "b0000000-0000-4000-8000-000000000004",
  costa: "b0000000-0000-4000-8000-000000000005",
  quinta: "b0000000-0000-4000-8000-000000000006",
  puerto: "b0000000-0000-4000-8000-000000000007",
  horizon: "b0000000-0000-4000-8000-000000000008",
  lumen: "b0000000-0000-4000-8000-000000000009",
  soft: "b0000000-0000-4000-8000-00000000000a",
  fabrica: "b0000000-0000-4000-8000-00000000000b",
  nova: "b0000000-0000-4000-8000-00000000000c",
} as const;

function fakeContact(
  partial: Partial<ContactRow> & Pick<ContactRow, "id" | "name" | "email">
): ContactRow {
  return {
    workspaceId: WS,
    primaryPhone: "+56912345678",
    createdAt: ago(72),
    updatedAt: ago(1),
    ...partial,
  };
}

function fakeCompany(
  partial: Partial<CompanyRow> & Pick<CompanyRow, "id" | "name">
): CompanyRow {
  return {
    workspaceId: WS,
    rut: null,
    societyType: null,
    antiquity: null,
    sales12m: null,
    sales12mAt: null,
    region: null,
    giro: null,
    createdAt: ago(72),
    updatedAt: ago(1),
    ...partial,
  };
}

export const FAKE_CONTACTS: ContactRow[] = [
  fakeContact({
    id: CT.camila,
    name: "Camila Reyes",
    email: "camila@nortelogistica.cl",
    primaryPhone: "+56987654321",
  }),
  fakeContact({
    id: CT.felipe,
    name: "Felipe Mora",
    email: "felipe@andesfood.cl",
  }),
  fakeContact({
    id: CT.maria,
    name: "María Soto",
    email: "maria@meridian.cl",
  }),
  fakeContact({
    id: CT.paula,
    name: "Paula Núñez",
    email: "paula@vitasalud.cl",
  }),
  fakeContact({
    id: CT.diego,
    name: "Diego Rivas",
    email: "diego@costaretail.cl",
  }),
  fakeContact({
    id: CT.vale,
    name: "Valentina Muñoz",
    email: "vale@quintastudio.cl",
  }),
  fakeContact({
    id: CT.rodrigo,
    name: "Rodrigo Alarcón",
    email: "rodrigo@puertoverde.cl",
  }),
  fakeContact({
    id: CT.tomas,
    name: "Tomás Berger",
    email: "tomas@horizon.cl",
  }),
  fakeContact({
    id: CT.andrea,
    name: "Andrea Pino",
    email: "andrea@lumen.cl",
  }),
  fakeContact({
    id: CT.caro,
    name: "Carolina Méndez",
    email: "caro@softpatagonia.cl",
  }),
  fakeContact({
    id: CT.luis,
    name: "Luis Ortega",
    email: "luis@fabricasur.cl",
  }),
  fakeContact({
    id: CT.bea,
    name: "Beatriz Soto",
    email: "bea@novaagro.cl",
  }),
  fakeContact({
    id: CT.jorge,
    name: "Jorge Valdés",
    email: "jorge.valdes@gmail.com",
    primaryPhone: "+56955556666",
  }),
];

export const FAKE_COMPANIES: CompanyRow[] = [
  fakeCompany({
    id: CO.norte,
    name: "Norte Logística",
    rut: "76.123.456-7",
    societyType: "SpA",
    antiquity: "8 años",
    sales12m: "$420M",
    sales12mAt: ago(24),
    region: "antofagasta",
    giro: "Logística y transporte",
  }),
  fakeCompany({
    id: CO.norteSpa,
    name: "Norte Servicios SpA",
    rut: "77.987.654-3",
    societyType: "SpA",
    region: "antofagasta",
    giro: "Servicios de consultoría",
  }),
  fakeCompany({
    id: CO.andes,
    name: "Andes Food",
    rut: "76.234.567-8",
    region: "metropolitana",
    giro: "Alimentos",
  }),
  fakeCompany({
    id: CO.meridian,
    name: "Meridian Tech",
    rut: "76.345.678-9",
    region: "valparaiso",
    giro: "Software",
  }),
  fakeCompany({ id: CO.vita, name: "Vita Salud Spa", rut: "76.456.789-0" }),
  fakeCompany({ id: CO.costa, name: "Costa Retail", rut: "76.567.890-1" }),
  fakeCompany({ id: CO.quinta, name: "Quinta Studio", rut: "76.678.901-2" }),
  fakeCompany({ id: CO.puerto, name: "Puerto Verde", rut: "76.789.012-3" }),
  fakeCompany({
    id: CO.horizon,
    name: "Horizon Energy",
    rut: "76.890.123-4",
    giro: "Energía",
  }),
  fakeCompany({ id: CO.lumen, name: "Lumen Digital", rut: "76.901.234-5" }),
  fakeCompany({ id: CO.soft, name: "SoftPatagonia", rut: "77.012.345-6" }),
  fakeCompany({ id: CO.fabrica, name: "Fábrica Sur", rut: "77.123.456-7" }),
  fakeCompany({ id: CO.nova, name: "Nova Agro", rut: "77.234.567-8" }),
];

export const FAKE_CONTACT_PHONES: ContactPhoneRow[] = [
  {
    id: "f0000000-0000-4000-8000-000000000001",
    contactId: CT.camila,
    phone: "+56987654321",
    source: "calendly",
    createdAt: ago(48),
  },
  {
    id: "f0000000-0000-4000-8000-000000000002",
    contactId: CT.camila,
    phone: "+56911112222",
    source: "form",
    createdAt: ago(10),
  },
  {
    id: "f0000000-0000-4000-8000-000000000003",
    contactId: CT.felipe,
    phone: "+56912345678",
    source: "calendly",
    createdAt: ago(40),
  },
  {
    id: "f0000000-0000-4000-8000-000000000004",
    contactId: CT.jorge,
    phone: "+56955556666",
    source: "calendly",
    createdAt: ago(12),
  },
];

export const FAKE_CONTACT_COMPANIES: ContactCompanyRow[] = [
  {
    id: "cc000000-0000-4000-8000-000000000001",
    contactId: CT.camila,
    companyId: CO.norte,
    role: "representante",
    createdAt: ago(48),
  },
  {
    id: "cc000000-0000-4000-8000-000000000002",
    contactId: CT.camila,
    companyId: CO.norteSpa,
    role: "representante",
    createdAt: ago(40),
  },
  ...[
    [CT.felipe, CO.andes],
    [CT.maria, CO.meridian],
    [CT.paula, CO.vita],
    [CT.diego, CO.costa],
    [CT.vale, CO.quinta],
    [CT.rodrigo, CO.puerto],
    [CT.tomas, CO.horizon],
    [CT.andrea, CO.lumen],
    [CT.caro, CO.soft],
    [CT.luis, CO.fabrica],
    [CT.bea, CO.nova],
  ].map(([contactId, companyId], i) => ({
    id: `cc000000-0000-4000-8000-${(i + 3).toString(16).padStart(12, "0")}`,
    contactId,
    companyId,
    role: "representante" as string | null,
    createdAt: ago(48),
  })),
];

function base(
  partial: Partial<CaseRow> &
    Pick<CaseRow, "id" | "status" | "contactId"> & { companyId?: string | null }
): CaseRow {
  return {
    workspaceId: WS,
    playbookId: PB_CONSULTORIA,
    currentStageId: "stage-pagado",
    companyId: null,
    calendlyEventUuid: null,
    calendlyEventUri: null,
    calendlyRoute: "A",
    scheduledAt: days(2),
    meetUrl: null,
    meetCode: null,
    googleCalendarEventId: null,
    qualification: { biz: "biz_tech_company", goal: "goal_innovation" },
    landingSource: "diagnostico-innovacion",
    qualificationLogId: null,
    paymentMethod: null,
    paymentStatus: "none",
    mpPaymentId: null,
    paidAt: null,
    paymentConfirmedBy: null,
    cancelReason: null,
    lostReason: null,
    assignedConsultantId: null,
    driveFolderId: null,
    driveFolderKey: null,
    createdAt: ago(48),
    updatedAt: ago(1),
    ...partial,
  };
}

export const FAKE_CASES: CaseRow[] = [
  base({
    id: "case-norte",
    status: "open",
    contactId: CT.camila,
    companyId: CO.norte,
    calendlyEventUuid: "fake-norte",
    scheduledAt: days(2),
    meetUrl: "https://meet.google.com/fake-norte",
    paymentMethod: "transferencia",
    paymentStatus: "pending",
    currentStageId: "stage-pagado",
    landingSource: "diagnostico-innovacion",
    qualification: {
      biz: "biz_tech_company",
      goal: "goal_innovation",
      rut_facturacion: "76.123.456-7",
    },
    updatedAt: ago(0.2),
  }),
  base({
    id: "case-andes",
    status: "open",
    contactId: CT.felipe,
    companyId: CO.andes,
    calendlyEventUuid: "fake-andes",
    scheduledAt: hours(18),
    meetUrl: "https://meet.google.com/fake-andes",
    paymentMethod: "mercadopago",
    paymentStatus: "paid",
    paidAt: ago(5),
    paymentConfirmedBy: "mp_webhook",
    currentStageId: "stage-realizado",
    assignedConsultantId: "a0000000-0000-4000-8000-000000000002",
    landingSource: "diagnostico-landing",
    qualification: {
      biz: "biz_tech_company",
      goal: "goal_innovation",
      rut_facturacion: "76.234.567-8",
    },
    updatedAt: ago(5),
  }),
  base({
    id: "case-meridian",
    status: "open",
    contactId: CT.maria,
    companyId: CO.meridian,
    calendlyEventUuid: "fake-meridian",
    scheduledAt: days(3),
    calendlyRoute: "B",
    paymentStatus: "none",
    currentStageId: "stage-pagado",
    landingSource: "diagnostico-landing",
    updatedAt: ago(3),
  }),
  base({
    id: "case-vita",
    status: "open",
    contactId: CT.paula,
    companyId: CO.vita,
    calendlyEventUuid: "fake-vita",
    scheduledAt: days(1),
    paymentMethod: "transferencia",
    paymentStatus: "pending",
    currentStageId: "stage-pagado",
    landingSource: "diagnostico-innovacion",
    updatedAt: ago(2),
  }),
  base({
    id: "case-costa",
    status: "open",
    contactId: CT.diego,
    companyId: CO.costa,
    calendlyEventUuid: "fake-costa",
    scheduledAt: days(4),
    paymentMethod: "mercadopago",
    paymentStatus: "paid",
    paidAt: ago(20),
    paymentConfirmedBy: "ops_ui",
    currentStageId: "stage-realizado",
    assignedConsultantId: "a0000000-0000-4000-8000-000000000003",
    updatedAt: ago(20),
  }),
  base({
    id: "case-quinta",
    status: "open",
    contactId: CT.vale,
    companyId: CO.quinta,
    calendlyEventUuid: "fake-quinta",
    scheduledAt: ago(24),
    paymentMethod: "mercadopago",
    paymentStatus: "paid",
    paidAt: ago(72),
    paymentConfirmedBy: "mp_webhook",
    currentStageId: "stage-propuesta-enviada",
    assignedConsultantId: "a0000000-0000-4000-8000-000000000002",
    updatedAt: ago(6),
  }),
  base({
    id: "case-puerto",
    status: "open",
    contactId: CT.rodrigo,
    companyId: CO.puerto,
    calendlyEventUuid: "fake-puerto",
    scheduledAt: days(5),
    paymentStatus: "none",
    lostReason: "no_pago",
    currentStageId: "stage-perdido",
    updatedAt: ago(12),
  }),
  base({
    id: "case-horizon",
    status: "open",
    contactId: CT.tomas,
    companyId: CO.horizon,
    calendlyEventUuid: "fake-horizon",
    scheduledAt: days(6),
    calendlyRoute: "A",
    paymentStatus: "none",
    currentStageId: "stage-pagado",
    landingSource: "diagnostico",
    qualification: {
      biz: "biz_innovation_focus",
      goal: "goal_tech_product",
      sales: "p3_10to80m",
    },
    updatedAt: ago(8),
  }),
  base({
    id: "case-lumen",
    status: "open",
    contactId: CT.andrea,
    companyId: CO.lumen,
    calendlyEventUuid: "fake-lumen",
    scheduledAt: hours(30),
    paymentMethod: "mercadopago",
    paymentStatus: "pending",
    currentStageId: "stage-pagado",
    updatedAt: ago(0.5),
  }),
  /** Persona natural: sin companyId (RUT facturación vacío). */
  base({
    id: "case-jorge-pn",
    status: "open",
    contactId: CT.jorge,
    companyId: null,
    calendlyEventUuid: "fake-jorge-pn",
    scheduledAt: days(1),
    meetUrl: "https://meet.google.com/fake-jorge",
    paymentStatus: "none",
    currentStageId: "stage-pagado",
    landingSource: "diagnostico-landing",
    qualification: {
      mensaje_usuario: "Quiero diagnosticar mi proyecto como persona natural",
    },
    updatedAt: ago(1.2),
  }),
  base({
    id: "case-guia-ley",
    playbookId: PB_CAPTACION_GUIA,
    status: "open",
    contactId: CT.camila,
    companyId: CO.norte,
    currentStageId: "guia-nurture",
    landingSource: "guia-ley-id",
    calendlyEventUuid: null,
    scheduledAt: null,
    meetUrl: null,
    calendlyRoute: null,
    paymentStatus: "none",
    qualification: { magnet: "guia_ley_id", tag: "sequenzy" },
    updatedAt: ago(1.5),
  }),
  base({
    id: "case-webinar",
    playbookId: PB_CAPTACION_WEBINAR,
    status: "open",
    contactId: CT.caro,
    companyId: CO.soft,
    currentStageId: "web-asist",
    landingSource: "webinar-start-2026",
    calendlyEventUuid: null,
    scheduledAt: null,
    meetUrl: null,
    calendlyRoute: null,
    paymentStatus: "none",
    qualification: { event: "webinar", attended: true },
    updatedAt: ago(4),
  }),
  base({
    id: "case-contacto",
    playbookId: PB_CAPTACION_GUIA,
    status: "open",
    contactId: CT.luis,
    companyId: CO.fabrica,
    currentStageId: "guia-inbound",
    landingSource: "contacto",
    calendlyEventUuid: null,
    scheduledAt: null,
    meetUrl: null,
    calendlyRoute: null,
    paymentStatus: "none",
    qualification: { form: "contacto", mensaje: "Quiero saber de fondos" },
    updatedAt: ago(9),
  }),
  base({
    id: "case-calificado",
    playbookId: PB_CAPTACION_GUIA,
    status: "open",
    contactId: CT.bea,
    companyId: CO.nova,
    currentStageId: "guia-calificado",
    landingSource: "guia-ley-id",
    calendlyEventUuid: null,
    scheduledAt: null,
    meetUrl: null,
    calendlyRoute: null,
    paymentStatus: "none",
    qualification: {
      magnet: "guia_ley_id",
      score: "hot",
      next: "promover_consultoria",
    },
    updatedAt: ago(0.8),
  }),
];

export { CT as FAKE_CONTACT_IDS, CO as FAKE_COMPANY_IDS };

export function fakeEventsFor(caseId: string): CaseEvent[] {
  const c = FAKE_CASES.find((x) => x.id === caseId);
  if (!c) return [];

  const meta = playbookMetaById(c.playbookId);

  if (meta.slug.startsWith("captacion")) {
    const events: CaseEvent[] = [
      {
        id: `${caseId}-e1`,
        caseId,
        type:
          c.landingSource === "webinar-start-2026"
            ? "webinar_registered"
            : c.landingSource === "contacto"
              ? "contact_form_submitted"
              : "guide_downloaded",
        payload: { source: c.landingSource, fake: true },
        actor: "integracion",
        createdAt: ago(40),
      },
    ];
    if (c.currentStageId === "cap-nurture" || c.currentStageId === "cap-calificado") {
      events.push({
        id: `${caseId}-e2`,
        caseId,
        type: "nurture_enrolled",
        payload: { channel: "sequenzy" },
        actor: "sistema",
        createdAt: ago(30),
      });
    }
    if (c.currentStageId === "cap-calificado") {
      events.push({
        id: `${caseId}-e3`,
        caseId,
        type: "lead_qualified",
        payload: { next: "promover a Consultoría" },
        actor: "humano",
        createdAt: ago(2),
      });
    }
    return events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  const events: CaseEvent[] = [
    {
      id: `${caseId}-e1`,
      caseId,
      type: "calendly_scheduled",
      payload: { calendlyEventUuid: c.calendlyEventUuid, fake: true },
      actor: "calendly",
      createdAt: ago(40),
    },
  ];

  if (c.paymentStatus === "pending" || c.paymentStatus === "paid") {
    events.push({
      id: `${caseId}-e2`,
      caseId,
      type: "checkout_started",
      payload: { method: c.paymentMethod },
      actor: "sistema",
      createdAt: ago(30),
    });
  }

  if (c.paymentStatus === "paid") {
    events.push({
      id: `${caseId}-e3`,
      caseId,
      type:
        c.paymentMethod === "transferencia"
          ? "transfer_confirmed"
          : "payment_approved",
      payload: { method: c.paymentMethod },
      actor: c.paymentConfirmedBy ?? "sistema",
      createdAt: ago(20),
    });
  }

  if (c.status === "no_show") {
    events.push({
      id: `${caseId}-e4`,
      caseId,
      type: "no_show_marked",
      payload: {},
      actor: "ops_ui",
      createdAt: ago(4),
    });
  }

  if (c.status === "cancelled") {
    events.push({
      id: `${caseId}-e5`,
      caseId,
      type: "calendly_canceled",
      payload: { reason: c.cancelReason },
      actor: "ops_ui",
      createdAt: ago(12),
    });
  }

  if (c.currentStageId === "stage-perdido" || c.lostReason) {
    events.push({
      id: `${caseId}-e-lost`,
      caseId,
      type: "marked_lost",
      payload: { reason: c.lostReason ?? "no_pago" },
      actor: "ops_ui",
      createdAt: ago(12),
    });
  }

  if (c.currentStageId === "stage-propuesta-enviada") {
    events.push({
      id: `${caseId}-e6`,
      caseId,
      type: "session_completed",
      payload: { note: "Reunión realizada — pendiente propuesta" },
      actor: "humano",
      createdAt: ago(6),
    });
  }

  return events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function isFakeDataEnabled() {
  return process.env.USE_FAKE_DATA !== "0";
}

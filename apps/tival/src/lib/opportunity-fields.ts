/**
 * Campos de oportunidad — contrato del playbook.
 * Iniciativa aporta defaults; oportunidad guarda valores.
 *
 * Identidad (fuera de este contrato):
 *   - Contacto (email, teléfonos) → contacts
 *   - Empresa primaria → companies (opcional; persona natural = null)
 *
 * De la opp (no de empresa):
 *   - `rut_facturacion` — con qué RUT facturar este diagnóstico
 *   - `region` — región ops de este deal (sirve con o sin empresa)
 * Si hay RUT, además se puede resolver/crear empresa primaria.
 *
 * Tracking / IDs de origen van en extras, no en la ficha ops.
 */

import { CHILE_REGION_KEYS } from "@/lib/chile-regions";
import { CLOSING_SCORE_KEYS } from "@/lib/closing-scores";

export type OpportunityFieldType =
  | "text"
  | "longtext"
  | "datetime"
  | "url"
  | "select";

export type OpportunityFieldDef = {
  key: string;
  label: string;
  type: OpportunityFieldType;
  /** Etapa donde suele completarse (hint UI) */
  filledAtStage?: string;
  /** Quién suele escribirlo */
  filledBy?: string;
  required?: boolean;
  options?: string[];
};

export const CONSULTORIA_FIELDS: OpportunityFieldDef[] = [
  {
    key: "mensaje_usuario",
    label: "Mensaje / descripción",
    type: "longtext",
    filledAtStage: "lead",
    filledBy: "Form pre-agenda · Q&A Calendly",
  },
  {
    key: "rut_facturacion",
    label: "RUT facturación",
    type: "text",
    filledAtStage: "lead",
    filledBy: "Q&A Calendly · con qué RUT facturar este diagnóstico",
  },
  {
    key: "agendado_en",
    label: "Fecha en que se agendó",
    type: "datetime",
    filledAtStage: "lead",
    filledBy: "Efecto Calendly",
  },
  {
    key: "fecha_reunion",
    label: "Fecha de la reunión",
    type: "datetime",
    filledAtStage: "lead",
    filledBy: "Efecto Calendly",
    required: true,
  },
  {
    key: "meet_url",
    label: "Link Meet",
    type: "url",
    filledAtStage: "lead",
    filledBy: "Calendly → Calendar (enrichment)",
  },
  {
    key: "drive_folder_url",
    label: "Carpeta Drive",
    type: "url",
    filledAtStage: "pagado",
    filledBy: "Efecto drive-folder",
  },
  {
    key: "closing_score",
    label: "Closing score",
    type: "select",
    options: [...CLOSING_SCORE_KEYS],
    filledAtStage: "realizado",
    filledBy: "Ops · post diagnóstico",
  },
  {
    key: "region",
    label: "Región",
    type: "select",
    options: [...CHILE_REGION_KEYS],
    filledAtStage: "realizado",
    filledBy: "Ops · post diagnóstico",
  },
];
// Teléfono / razón social → Contacto / Empresa (no playbook).

export const CAPTACION_GUIA_FIELDS: OpportunityFieldDef[] = [
  {
    key: "asset",
    label: "Asset / magnet",
    type: "text",
    filledAtStage: "inbound",
    filledBy: "Default iniciativa",
    required: true,
  },
  {
    key: "mensaje_usuario",
    label: "Mensaje",
    type: "longtext",
    filledAtStage: "inbound",
    filledBy: "Form",
  },
  {
    key: "tag_secuencia",
    label: "Tag secuencia",
    type: "text",
    filledAtStage: "nurture",
    filledBy: "Efecto Sequenzy",
  },
];

export const CAPTACION_WEBINAR_FIELDS: OpportunityFieldDef[] = [
  {
    key: "evento",
    label: "Evento",
    type: "text",
    filledAtStage: "registrado",
    filledBy: "Default iniciativa",
    required: true,
  },
  {
    key: "fecha_evento",
    label: "Fecha del webinar",
    type: "datetime",
    filledAtStage: "registrado",
    filledBy: "Default iniciativa",
  },
  {
    key: "asistio",
    label: "Asistió",
    type: "select",
    options: ["si", "no", "pendiente"],
    filledAtStage: "asistencia",
    filledBy: "Efecto zoom/registro",
  },
];

export const FUNDER_FIELDS: OpportunityFieldDef[] = [
  {
    key: "wizard",
    label: "Wizard",
    type: "text",
    filledAtStage: "lead",
    filledBy: "Default iniciativa",
    required: true,
  },
  {
    key: "mensaje_usuario",
    label: "Qué busca",
    type: "longtext",
    filledAtStage: "lead",
    filledBy: "Form",
  },
  {
    key: "resultado_wizard",
    label: "Resultado",
    type: "text",
    filledAtStage: "match",
    filledBy: "Efecto wizard",
  },
];

export function formatFieldValue(
  type: OpportunityFieldType,
  value: unknown
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "datetime" && (typeof value === "string" || value instanceof Date)) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("es-CL", { timeZone: "America/Santiago" });
  }
  return String(value);
}

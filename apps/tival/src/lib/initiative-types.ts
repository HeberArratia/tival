/**
 * Tipos de iniciativa + compatibilidad con playbooks.
 * Tipo define entry + playbook por defecto; playbook declara compatibleTypes.
 */

export type InitiativeTypeId =
  | "agenda"
  | "guia"
  | "form"
  | "webinar"
  | "programa";

export type InitiativeEntry = "calendly" | "form" | "registro_evento";

export type InitiativeTypeDef = {
  id: InitiativeTypeId;
  name: string;
  blurb: string;
  entry: InitiativeEntry;
  /** Playbook slug por defecto al crear */
  defaultPlaybookSlug: string;
  /** Campos de config que pide el wizard (UI) */
  configFields: { key: string; label: string; placeholder?: string }[];
};

export const INITIATIVE_TYPES: InitiativeTypeDef[] = [
  {
    id: "agenda",
    name: "Agenda / diagnóstico",
    blurb: "Calendly + pago. Playbook Consultoría.",
    entry: "calendly",
    defaultPlaybookSlug: "consultoria",
    configFields: [
      { key: "landingUrl", label: "Landing", placeholder: "https://…" },
      { key: "calendlyUrl", label: "Calendly", placeholder: "https://calendly.com/…" },
    ],
  },
  {
    id: "guia",
    name: "Guía / magnet",
    blurb: "Form de descarga. Playbook Captación guía.",
    entry: "form",
    defaultPlaybookSlug: "captacion-guia",
    configFields: [
      { key: "landingUrl", label: "Landing", placeholder: "https://…" },
      { key: "asset", label: "Asset / PDF", placeholder: "guia-ley-id.pdf" },
    ],
  },
  {
    id: "form",
    name: "Formulario contacto",
    blurb: "Form genérico. Mismo playbook que guía (etapas iguales).",
    entry: "form",
    defaultPlaybookSlug: "captacion-guia",
    configFields: [
      { key: "landingUrl", label: "URL del form", placeholder: "https://…" },
    ],
  },
  {
    id: "webinar",
    name: "Webinar",
    blurb: "Registro + asistencia. Playbook Captación webinar (etapas propias).",
    entry: "registro_evento",
    defaultPlaybookSlug: "captacion-webinar",
    configFields: [
      { key: "landingUrl", label: "Landing registro", placeholder: "https://…" },
      { key: "eventAt", label: "Fecha evento", placeholder: "2026-03-15" },
    ],
  },
  {
    id: "programa",
    name: "Programa / wizard",
    blurb: "Wizard autodiagnóstico. Placeholder.",
    entry: "form",
    defaultPlaybookSlug: "wizard-autodiagnostico",
    configFields: [
      { key: "landingUrl", label: "Landing", placeholder: "https://…" },
    ],
  },
];

export function initiativeTypeById(id: string | null | undefined) {
  return INITIATIVE_TYPES.find((t) => t.id === id) ?? null;
}

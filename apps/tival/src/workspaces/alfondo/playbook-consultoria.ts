/**
 * Playbook Consultoría Alfondo — etapas como hechos (no intenciones).
 *
 * lead → pagado → realizado → propuesta_enviada → seguimiento
 *   ↘ perdido + lost_reason                     ↗ ganado
 */
import type { stageActorEnum } from "@/db/schema";

type Actor = (typeof stageActorEnum.enumValues)[number];

export type ConsultoriaStageDef = {
  key: string;
  name: string;
  description: string;
  sortOrder: number;
  requiresPayment: boolean;
  requiresHuman: boolean;
  actor: Actor;
};

export const ALFONDO_CONSULTORIA_STAGES: ConsultoriaStageDef[] = [
  {
    key: "lead",
    name: "Lead entrante",
    description: "Agendó / capturó; aún sin pago confirmado",
    sortOrder: 1,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    key: "pagado",
    name: "Diagnóstico pagado",
    description: "Pago confirmado (MP o transferencia)",
    sortOrder: 2,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    key: "realizado",
    name: "Diagnóstico realizado",
    description: "La reunión de diagnóstico ya ocurrió",
    sortOrder: 3,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
  {
    key: "propuesta_enviada",
    name: "Propuesta enviada",
    description: "Se envió la propuesta al cliente",
    sortOrder: 4,
    requiresPayment: false,
    requiresHuman: true,
    actor: "agente",
  },
  {
    key: "seguimiento",
    name: "Seguimiento",
    description: "Cadencias post-propuesta",
    sortOrder: 5,
    requiresPayment: false,
    requiresHuman: false,
    actor: "agente",
  },
  {
    key: "ganado",
    name: "Ganado",
    description: "Cierre ganado — trato cerrado",
    sortOrder: 6,
    requiresPayment: false,
    requiresHuman: false,
    actor: "humano",
  },
  {
    key: "perdido",
    name: "Perdido",
    description: "Cierre no ganado — motivo en lost_reason (no_pago, no_compra, …)",
    sortOrder: 7,
    requiresPayment: false,
    requiresHuman: false,
    actor: "humano",
  },
];

/** Keys legacy → nuevas (referencia). La migración semántica de casos está en seed. */
export const CONSULTORIA_STAGE_KEY_MIGRATION: Record<string, string> = {
  /** Espera cobro → lead (no pagado) o pagado */
  pago: "pagado",
  /** Post-pago (viejo) → Diagnóstico pagado — no “realizado” */
  reunion: "pagado",
  propuesta: "propuesta_enviada",
};

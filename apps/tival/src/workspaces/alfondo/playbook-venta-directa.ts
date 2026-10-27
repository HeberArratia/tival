/**
 * Playbook Venta directa — cierre sin diagnóstico.
 *
 * lead → contactado → propuesta_enviada → ganado
 *   ↘ perdido
 */
import type { stageActorEnum } from "@/db/schema";

type Actor = (typeof stageActorEnum.enumValues)[number];

export type VentaDirectaStageDef = {
  key: string;
  name: string;
  description: string;
  sortOrder: number;
  requiresPayment: boolean;
  requiresHuman: boolean;
  actor: Actor;
};

export const VENTA_DIRECTA_SLUG = "venta-directa";

export const ALFONDO_VENTA_DIRECTA_STAGES: VentaDirectaStageDef[] = [
  {
    key: "lead",
    name: "Lead entrante",
    description: "Llegó la solicitud. Todavía nadie la contactó.",
    sortOrder: 1,
    requiresPayment: false,
    requiresHuman: false,
    actor: "integracion",
  },
  {
    key: "contactado",
    name: "Contactado",
    description: "Hubo conversación con la persona.",
    sortOrder: 2,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
  {
    key: "propuesta_enviada",
    name: "Propuesta enviada",
    description: "Se envió la propuesta.",
    sortOrder: 3,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
  {
    key: "ganado",
    name: "Ganado",
    description: "Cierre ganado de esta oportunidad.",
    sortOrder: 4,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
  {
    key: "perdido",
    name: "Perdido",
    description: "Cierre no ganado. El motivo queda en lost_reason.",
    sortOrder: 5,
    requiresPayment: false,
    requiresHuman: true,
    actor: "humano",
  },
];

/** Desde cada etapa, a qué etapas se puede pasar a mano. */
export const VENTA_DIRECTA_MOVES: Record<string, string[]> = {
  lead: ["contactado", "perdido"],
  contactado: ["propuesta_enviada", "perdido"],
  propuesta_enviada: ["ganado", "perdido"],
};

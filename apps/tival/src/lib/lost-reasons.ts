/** Motivos de cierre en etapa Perdido (no son etapas distintas). */
export const LOST_REASONS = {
  no_pago: "Sin pago",
  no_compra: "No compró",
  no_califica: "No califica",
  otro: "Otro",
} as const;

export type LostReason = keyof typeof LOST_REASONS;

export function isLostReason(value: string | null | undefined): value is LostReason {
  return !!value && value in LOST_REASONS;
}

export function lostReasonLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isLostReason(value)) return LOST_REASONS[value];
  return value.replace(/_/g, " ");
}

/** Temperatura comercial (momentum). Independiente del fit del deal. */

export const CLOSING_SCORES = {
  hot: {
    emoji: "🔥",
    label: "Caliente",
    description: "Quiere avanzar ahora y tiene cómo hacerlo",
  },
  warm: {
    emoji: "🌤️",
    label: "Templado",
    description: "Interesado, pero aún le falta madurar",
  },
  cold: {
    emoji: "❄️",
    label: "Frío",
    description: "Busca información sin intención inmediata",
  },
} as const;

export type ClosingScore = keyof typeof CLOSING_SCORES;

export const CLOSING_SCORE_KEYS = Object.keys(CLOSING_SCORES) as ClosingScore[];

/** Valor legacy: `no_fit` vivía aquí; ahora es `deal_fit`. */
export const LEGACY_CLOSING_NO_FIT = "no_fit";

export function isClosingScore(
  value: string | null | undefined
): value is ClosingScore {
  return !!value && value in CLOSING_SCORES;
}

export function closingScoreLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (isClosingScore(value)) {
    const s = CLOSING_SCORES[value];
    return `${s.emoji} ${s.label}`;
  }
  return value.replace(/_/g, " ");
}

/**
 * Si `closing_score` es el legacy `no_fit`, lo mueve a `deal_fit`
 * (solo si deal_fit está vacío) y limpia temperatura.
 */
export function migrateLegacyClosingNoFit(
  qualification: Record<string, unknown>
): Record<string, unknown> {
  if (qualification.closing_score !== LEGACY_CLOSING_NO_FIT) {
    return qualification;
  }
  const next = { ...qualification };
  delete next.closing_score;
  if (next.deal_fit == null || next.deal_fit === "") {
    next.deal_fit = LEGACY_CLOSING_NO_FIT;
  }
  return next;
}

/** Closing score post-diagnóstico (temperatura comercial). */

export const CLOSING_SCORES = {
  hot: {
    emoji: "🔥",
    label: "Hot",
    description: "Quiere avanzar ahora y tiene cómo hacerlo",
  },
  warm: {
    emoji: "🌤️",
    label: "Warm",
    description: "Interesado, pero aún le falta madurar",
  },
  cold: {
    emoji: "❄️",
    label: "Cold",
    description: "Busca información sin intención inmediata",
  },
  no_fit: {
    emoji: "🚫",
    label: "No fit",
    description: "No hace match con producto o perfil",
  },
} as const;

export type ClosingScore = keyof typeof CLOSING_SCORES;

export const CLOSING_SCORE_KEYS = Object.keys(CLOSING_SCORES) as ClosingScore[];

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

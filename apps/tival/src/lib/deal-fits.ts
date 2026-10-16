/** Calificación del deal (fit del proyecto). Independiente de la temperatura. */

export const DEAL_FITS = {
  alto: {
    emoji: "✅",
    label: "Alto",
    description: "Buen match: proyecto, ticket y perfil",
  },
  medio: {
    emoji: "🟡",
    label: "Medio",
    description: "Encaja, con reservas",
  },
  bajo: {
    emoji: "🟠",
    label: "Bajo",
    description: "Encaje débil; solo si hay razón fuerte",
  },
  no_fit: {
    emoji: "🚫",
    label: "Sin fit",
    description: "No hace match con producto o perfil",
  },
} as const;

export type DealFit = keyof typeof DEAL_FITS;

export const DEAL_FIT_KEYS = Object.keys(DEAL_FITS) as DealFit[];

export function isDealFit(
  value: string | null | undefined
): value is DealFit {
  return !!value && value in DEAL_FITS;
}

export function dealFitLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (isDealFit(value)) {
    const s = DEAL_FITS[value];
    return `${s.emoji} ${s.label}`;
  }
  return value.replace(/_/g, " ");
}

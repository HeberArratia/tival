/**
 * Regiones de Chile — catálogo compartido (keys estables).
 * Los playbooks que usen el campo `region` referencian estas keys.
 */

export const CHILE_REGIONS = {
  arica_parinacota: "Arica y Parinacota",
  tarapaca: "Tarapacá",
  antofagasta: "Antofagasta",
  atacama: "Atacama",
  coquimbo: "Coquimbo",
  valparaiso: "Valparaíso",
  metropolitana: "Metropolitana",
  ohiggins: "O'Higgins",
  maule: "Maule",
  nuble: "Ñuble",
  biobio: "Biobío",
  araucania: "La Araucanía",
  los_rios: "Los Ríos",
  los_lagos: "Los Lagos",
  aysen: "Aysén",
  magallanes: "Magallanes",
} as const;

export type ChileRegion = keyof typeof CHILE_REGIONS;

export const CHILE_REGION_KEYS = Object.keys(CHILE_REGIONS) as ChileRegion[];

export function isChileRegion(
  value: string | null | undefined
): value is ChileRegion {
  return !!value && value in CHILE_REGIONS;
}

export function chileRegionLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  if (isChileRegion(value)) return CHILE_REGIONS[value];
  return value.replace(/_/g, " ");
}

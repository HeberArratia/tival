/**
 * Productos del workspace — catálogo plano (nombre + precio).
 */

export type ProductSeed = {
  key: string;
  name: string;
  priceListClp?: number | null;
  paymentLink?: string | null;
  active?: boolean;
};

/** Opción liviana para selects en oportunidades. */
export type ProductOption = {
  key: string;
  name: string;
  priceListClp: number | null;
};

export function formatClp(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function toProductOption(p: {
  key: string;
  name: string;
  priceListClp: number | null;
}): ProductOption {
  return {
    key: p.key,
    name: p.name,
    priceListClp: p.priceListClp,
  };
}

/** Keys del catálogo en la oportunidad (`qualification.productos`). */
export function productKeysFromQualification(
  qualification: Record<string, unknown> | null | undefined
): string[] {
  if (!qualification) return [];
  const multi = qualification.productos;
  if (!Array.isArray(multi)) return [];
  const keys = multi
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim());
  return [...new Set(keys)];
}

export function sumProductPrices(
  keys: string[],
  options: ProductOption[]
): number {
  const byKey = new Map(options.map((o) => [o.key, o.priceListClp]));
  let total = 0;
  for (const key of keys) {
    const price = byKey.get(key);
    if (typeof price === "number" && !Number.isNaN(price)) total += price;
  }
  return total;
}

export function productNamesForKeys(
  keys: string[],
  options: ProductOption[]
): string[] {
  const byKey = new Map(options.map((o) => [o.key, o.name]));
  return keys.map((k) => byKey.get(k) ?? k);
}

export function productDisplayLabel(
  key: string | null | undefined,
  options: ProductOption[]
): string | null {
  if (!key) return null;
  const hit = options.find((o) => o.key === key);
  if (!hit) return key;
  const price = formatClp(hit.priceListClp);
  return price === "—" ? hit.name : `${hit.name} · ${price}`;
}

export function slugifyProductKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

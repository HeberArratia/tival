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

/** Crédito del diagnóstico pagado, en pesos. Se resta por producto en esa iniciativa. */
export const DIAGNOSTICO_CREDIT_CLP = 40_800;

/** Línea de producto en una oportunidad. `priceClp` es el monto de ese deal. */
export type OpportunityProductLine = {
  key: string;
  priceClp: number | null;
};

type StoredProductLine = {
  key: string;
  priceClp: number | null;
  /** El monto está guardado en la oportunidad, no se recalcula. */
  explicit: boolean;
};

export function diagnosticoCreditForSlug(
  slug: string | null | undefined
): number {
  if (!slug) return 0;
  if (slug === "diagnostico" || slug.startsWith("diagnostico")) {
    return DIAGNOSTICO_CREDIT_CLP;
  }
  return 0;
}

export function defaultOpportunityPrice(
  listPriceClp: number | null | undefined,
  creditClp: number
): number | null {
  if (listPriceClp == null || Number.isNaN(listPriceClp)) return null;
  const credit = creditClp > 0 ? creditClp : 0;
  return Math.max(0, Math.round(listPriceClp) - credit);
}

function parseStoredPrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  if (typeof raw === "string" && raw.trim()) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseStoredLine(item: unknown): StoredProductLine | null {
  if (typeof item === "string" && item.trim()) {
    return { key: item.trim(), priceClp: null, explicit: false };
  }
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const key = typeof rec.key === "string" ? rec.key.trim() : "";
  if (!key) return null;
  const hasPrice = "priceClp" in rec && rec.priceClp != null && rec.priceClp !== "";
  return {
    key,
    priceClp: hasPrice ? parseStoredPrice(rec.priceClp) : null,
    explicit: hasPrice && parseStoredPrice(rec.priceClp) != null,
  };
}

/** Líneas guardadas. Una key suelta no trae precio (hay que cotizarla). */
export function storedProductLines(
  qualification: Record<string, unknown> | null | undefined
): StoredProductLine[] {
  if (!qualification) return [];
  const multi = qualification.productos;
  if (!Array.isArray(multi)) return [];
  const seen = new Set<string>();
  const lines: StoredProductLine[] = [];
  for (const item of multi) {
    const line = parseStoredLine(item);
    if (!line || seen.has(line.key)) continue;
    seen.add(line.key);
    lines.push(line);
  }
  return lines;
}

/** Keys del catálogo en la oportunidad (`qualification.productos`). */
export function productKeysFromQualification(
  qualification: Record<string, unknown> | null | undefined
): string[] {
  return storedProductLines(qualification).map((line) => line.key);
}

export function importeClpFromQualification(
  qualification: Record<string, unknown> | null | undefined
): number | null {
  if (!qualification) return null;
  const raw = qualification.importe_clp;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === "string" && raw.trim()) return parseStoredPrice(raw);
  return null;
}

/**
 * Precio que se muestra y se suma.
 * Si la línea ya tiene monto, ese gana.
 * Si hay un solo producto y Bigin dejó `importe_clp`, se usa ese importe.
 * Si no, lista menos el crédito de diagnóstico (cuando aplica).
 */
export function quoteProductLines(
  qualification: Record<string, unknown> | null | undefined,
  options: ProductOption[],
  opts: { creditClp: number }
): OpportunityProductLine[] {
  const stored = storedProductLines(qualification);
  const byKey = new Map(options.map((o) => [o.key, o.priceListClp]));
  const importe =
    stored.length === 1 ? importeClpFromQualification(qualification) : null;
  return stored.map((line) => {
    if (line.explicit) return { key: line.key, priceClp: line.priceClp };
    if (importe != null) return { key: line.key, priceClp: importe };
    return {
      key: line.key,
      priceClp: defaultOpportunityPrice(byKey.get(line.key) ?? null, opts.creditClp),
    };
  });
}

export function sumQuotedPrices(lines: OpportunityProductLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (typeof line.priceClp === "number" && !Number.isNaN(line.priceClp)) {
      total += line.priceClp;
    }
  }
  return total;
}

/** Arma el monto a persistir. Un precio enviado se respeta; si falta, se cotiza. */
export function materializeOpportunityPrices(
  incoming: { key: string; priceClp: number | null }[],
  options: ProductOption[],
  ctx: { creditClp: number; importeClp: number | null }
): OpportunityProductLine[] {
  const byKey = new Map(options.map((o) => [o.key, o.priceListClp]));
  const seen = new Set<string>();
  const lines: OpportunityProductLine[] = [];
  for (const item of incoming) {
    const key = item.key.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (typeof item.priceClp === "number" && Number.isFinite(item.priceClp)) {
      lines.push({ key, priceClp: Math.max(0, Math.round(item.priceClp)) });
      continue;
    }
    lines.push({ key, priceClp: null });
  }
  const importe = lines.length === 1 ? ctx.importeClp : null;
  return lines.map((line) => {
    if (line.priceClp != null) return line;
    if (importe != null) return { key: line.key, priceClp: Math.max(0, Math.round(importe)) };
    return {
      key: line.key,
      priceClp: defaultOpportunityPrice(byKey.get(line.key) ?? null, ctx.creditClp),
    };
  });
}

/** Acepta `[{ key, priceClp }]` o una lista de keys. */
export function parseProductLineInputs(
  raw: unknown
): OpportunityProductLine[] | null {
  if (!Array.isArray(raw)) return null;
  const lines: OpportunityProductLine[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const key = item.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push({ key, priceClp: null });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const price =
      rec.priceClp == null || rec.priceClp === ""
        ? null
        : parseStoredPrice(rec.priceClp);
    lines.push({ key, priceClp: price });
  }
  return lines;
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

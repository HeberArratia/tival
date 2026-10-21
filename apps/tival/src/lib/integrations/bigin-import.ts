/**
 * Mapeo puro del export de tratos de Zoho Bigin → oportunidad Tival.
 * No toca la base. El script de import aplica el plan.
 */

import { ALFONDO_PRODUCTS_SEED } from "@/lib/products-seed-data";
import { normalizeSegmentCode } from "@/lib/segments";
import type { ChileRegion } from "@/lib/chile-regions";
import type { ClosingScore } from "@/lib/closing-scores";
import type { DealFit } from "@/lib/deal-fits";
import type { LostReason } from "@/lib/lost-reasons";

export type BiginDealRow = {
  tratoId: string;
  ownerName: string;
  dealName: string;
  contactId: string;
  contactName: string;
  companyName: string;
  phase: string;
  amountRaw: string;
  closeDate: string;
  tagsRaw: string;
  createdAt: string;
  updatedAt: string;
  projectStory: string;
  rutRaw: string;
  meetingDate: string;
  folderUrl: string;
  source: string;
  phone: string;
  closingScoreRaw: string;
  convocatoriaRaw: string;
  regionRaw: string;
  lostReasonRaw: string;
};

export type BiginSkipReason =
  | "reagendada"
  | "already_imported"
  | "live_agendado"
  | "missing_id";

export type PlannedBiginCase = {
  biginDealId: string;
  biginContactId: string | null;
  stageKey: string;
  lostReason: LostReason | null;
  contactName: string | null;
  phone: string | null;
  companyRut: string | null;
  companyName: string | null;
  rutFacturacion: string | null;
  rutFacturaRaw: string | null;
  segmento: string | null;
  dealFit: DealFit | null;
  closingScore: ClosingScore | null;
  region: ChileRegion | null;
  regiones: ChileRegion[] | null;
  productKey: string | null;
  convocatoria: string | null;
  landingSource: string | null;
  mensajeUsuario: string | null;
  importeClp: number | null;
  fechaCierre: string | null;
  meetingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  ownerKey: string | null;
  qualification: Record<string, unknown>;
};

const STAGE_BY_PHASE: Record<string, string> = {
  "diagnostico agendado": "lead",
  "diagnostico pagado": "pagado",
  "diagnostico realizado": "realizado",
  "propuesta enviada": "propuesta_enviada",
  "cerrado ganado": "ganado",
  "cerrado perdido": "perdido",
};

const LOST_BY_REASON: Record<string, LostReason> = {
  "sesion no pagada": "no_pago",
  "servicio no contratado": "no_compra",
  "no llego (rechazado)": "no_asistio",
};

/** Fondo Bigin → keys del catálogo (revisión, formulación). */
const FUND_KEYS: Record<string, string[]> = {
  crece: ["revision_crece", "formulacion_crece"],
  "semilla inicia": ["revision_semilla_inicia", "formulacion_semilla_inicia"],
  "desarrolla inversion": [
    "revision_desarrolla_inversion",
    "formulacion_desarrolla_inversion",
  ],
  "semilla expande": [
    "revision_semilla_expande",
    "formulacion_semilla_expande",
  ],
  "innova region": ["revision_innova_region", "formulacion_innova_region"],
  "semilla emprende": [
    "revision_semilla_emprende",
    "formulacion_semilla_emprende",
  ],
  "sup build": [
    "revision_startup_chile_build",
    "formulacion_startup_chile_build",
  ],
  "consultoria exploratoria": ["consultoria_innovacion_i_d"],
  "sumate a innovar": [
    "revision_sumate_a_innovar",
    "formulacion_sumate_a_innovar",
  ],
  abeja: ["revision_capital_abeja", "formulacion_capital_abeja"],
  "crece sostenible": [
    "revision_crece_sostenible",
    "formulacion_crece_sostenible",
  ],
  "crea y valida": ["revision_crea_y_valida", "formulacion_crea_y_valida"],
  escalamiento: ["revision_escalamiento", "formulacion_escalamiento"],
  "sup ignite": [
    "revision_startup_chile_ignite",
    "formulacion_startup_chile_ignite",
  ],
  "sup growth": [
    "revision_startup_chile_growth",
    "formulacion_startup_chile_growth",
  ],
  "consolida y expande": [
    "revision_consolida_y_expande",
    "formulacion_consolida_y_expande",
  ],
};

const REGION_BY_NAME: Record<string, ChileRegion> = {
  "region de arica y parinacota": "arica_parinacota",
  "region de tarapaca": "tarapaca",
  "region de antofagasta": "antofagasta",
  "region de atacama": "atacama",
  "region de coquimbo": "coquimbo",
  "region de valparaiso": "valparaiso",
  "region metropolitana de santiago": "metropolitana",
  "region del libertador general bernardo o'higgins": "ohiggins",
  "region del maule": "maule",
  "region de nuble": "nuble",
  "region del biobio": "biobio",
  "region de la araucania": "araucania",
  "region de los rios": "los_rios",
  "region de los lagos": "los_lagos",
  "region de aysen": "aysen",
  "region de aysen del general carlos ibanez del campo": "aysen",
  "region de magallanes y de la antartica chilena": "magallanes",
};

const OWNER_KEYS: Record<string, string> = {
  "alfondo team alfondo team": "nico",
  "alfondo team": "nico",
  "aylin jara": "aylin",
  "marcelo esperguel": "marcelo",
  "cristian oyarzun": "cristian",
  "walter noack": "walter",
};

/** El importe de Bigin suele quedar hasta ~40 mil bajo el precio de lista. */
const PRICE_UNDER_MAX = 80_000;
const PRICE_OVER_MAX = 20_000;
const COMPANY_RUT_MIN = 50_000_000;

const priceByKey = new Map(
  ALFONDO_PRODUCTS_SEED.filter(
    (p): p is typeof p & { priceListClp: number } =>
      typeof p.priceListClp === "number"
  ).map((p) => [p.key, p.priceListClp])
);

export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith("9")) return `56${digits}`;
  if (digits.length >= 11) return digits.slice(-11);
  return digits;
}

export function cleanPersonName(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .replace(/[\s\-—–]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function dealNameFallback(dealName: string): string | null {
  return cleanPersonName(dealName.replace(/^trato de\s+/i, ""));
}

/** Interpreta una fecha naive del export como hora de Santiago. */
export function santiagoToUtc(raw: string, dateOnly = false): Date | null {
  const value = raw.trim();
  if (!value) return null;
  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/);
  const dateTimeMatch = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/
  );
  const local = dateOnly || dateOnlyMatch
    ? dateOnlyMatch
      ? `${dateOnlyMatch[1]}T12:00:00`
      : null
    : dateTimeMatch
      ? `${dateTimeMatch[1]}T${dateTimeMatch[2]}`
      : null;
  if (!local) return null;
  const guess = new Date(`${local}Z`);
  if (Number.isNaN(guess.getTime())) return null;
  const offset = timeZoneOffsetMs(guess, "America/Santiago");
  return new Date(guess.getTime() - offset);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = pick("hour") === 24 ? 0 : pick("hour");
  const asUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    hour,
    pick("minute"),
    pick("second")
  );
  return asUtc - date.getTime();
}

export function parseRut(
  raw: string | null | undefined
): { body: number; dv: string; formatted: string } | null {
  const match = (raw ?? "").match(
    /(\d{1,2}(?:\.\d{3}){2}|\d{7,9})\s*[-_]?\s*([\dkK])/
  );
  if (!match) return null;
  const body = Number(match[1].replace(/\D/g, ""));
  const dv = match[2].toUpperCase();
  if (!Number.isFinite(body) || body <= 0) return null;
  if (rutDv(body) !== dv) return null;
  return { body, dv, formatted: `${body}-${dv}` };
}

function rutDv(body: number): string {
  let sum = 0;
  let mul = 2;
  const digits = String(body);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += Number(digits[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return "0";
  if (rest === 10) return "K";
  return String(rest);
}

function splitList(raw: string, sep: string): string[] {
  return raw
    .split(sep)
    .map((part) => part.trim())
    .filter(Boolean);
}

function mapRegions(raw: string): ChileRegion[] {
  const keys: ChileRegion[] = [];
  for (const part of splitList(raw, ";")) {
    const key = REGION_BY_NAME[fold(part)];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function mapClosingScore(raw: string): ClosingScore | null {
  const text = fold(raw);
  if (!text) return null;
  if (text.includes("cold") || text.includes("busca informacion")) return "cold";
  if (text.includes("warm") || text.includes("aun le falta madurar")) return "warm";
  if (text.includes("hot") || text.includes("quiere avanzar ahora")) return "hot";
  return null;
}

function mapTags(raw: string): { segmento: string | null; dealFit: DealFit | null } {
  const tokens = splitList(raw, ",").map(fold);
  const segmentToken = tokens.find((token) =>
    ["s1", "s2", "s2s3", "s3"].includes(token)
  );
  const segmento = segmentToken
    ? normalizeSegmentCode(segmentToken, "alfondo")
    : null;
  const dealFit: DealFit | null = tokens.includes("s0") ? "no_fit" : null;
  return { segmento, dealFit };
}

function mapProduct(raw: string, amount: number | null): string | null {
  const names = splitList(raw, ";").map(fold);
  if (names.length !== 1 || amount == null) return null;
  const keys = FUND_KEYS[names[0]];
  if (!keys) return null;
  let best: { key: string; distance: number } | null = null;
  for (const key of keys) {
    const price = priceByKey.get(key);
    if (price == null) continue;
    const under = price - amount;
    if (under < -PRICE_OVER_MAX || under > PRICE_UNDER_MAX) continue;
    const distance = Math.abs(under);
    if (!best || distance < best.distance) {
      best = { key, distance };
    } else if (distance === best.distance) {
      return null;
    }
  }
  return best?.key ?? null;
}

function driveFolderId(url: string): string | null {
  const match = url.match(/\/folders\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function isReagendada(lostReasonRaw: string): boolean {
  return fold(lostReasonRaw) === "fue reagendada";
}

export function isDiagnosticoAgendado(phase: string): boolean {
  return fold(phase) === "diagnostico agendado";
}

/**
 * Pagado si la etapa es Diagnóstico pagado o una posterior.
 * Perdido solo cuenta si el motivo es no compró (ya pasó el diagnóstico).
 * Sesión no pagada, no asistió y perdido sin motivo quedan sin pago.
 */
export function biginPaymentStatus(
  stageKey: string,
  lostReason: string | null
): "paid" | "none" {
  if (
    stageKey === "pagado" ||
    stageKey === "realizado" ||
    stageKey === "propuesta_enviada" ||
    stageKey === "ganado"
  ) {
    return "paid";
  }
  if (stageKey === "perdido" && lostReason === "no_compra") return "paid";
  return "none";
}

export function planBiginCase(row: BiginDealRow): PlannedBiginCase | null {
  const stageKey = STAGE_BY_PHASE[fold(row.phase)];
  if (!stageKey) return null;

  const amount = row.amountRaw.trim()
    ? Math.round(Number(row.amountRaw.replace(",", ".")))
    : null;
  const importeClp = amount != null && Number.isFinite(amount) ? amount : null;
  const regions = mapRegions(row.regionRaw);
  const tags = mapTags(row.tagsRaw);
  const productKey = mapProduct(row.convocatoriaRaw, importeClp);
  const convocatoria = row.convocatoriaRaw.trim() || null;
  const parsedRut = parseRut(row.rutRaw);
  const companyRut =
    parsedRut && parsedRut.body >= COMPANY_RUT_MIN ? parsedRut.formatted : null;
  const rutFacturacion = parsedRut?.formatted ?? null;
  const rutFacturaRaw =
    !parsedRut && row.rutRaw.trim() ? row.rutRaw.trim() : null;
  const lostReason =
    stageKey === "perdido"
      ? LOST_BY_REASON[fold(row.lostReasonRaw)] ?? "otro"
      : null;
  const createdAt = santiagoToUtc(row.createdAt) ?? new Date();
  const updatedAt = santiagoToUtc(row.updatedAt) ?? createdAt;
  const meetingAt = santiagoToUtc(row.meetingDate, true);
  const folderUrl = row.folderUrl.trim() || null;
  const closingScore = mapClosingScore(row.closingScoreRaw);
  const contactName =
    cleanPersonName(row.contactName) ?? dealNameFallback(row.dealName);
  const mensaje = row.projectStory.trim() || null;
  const fechaCierre = row.closeDate.trim() || null;
  const landingSource = row.source.trim() || null;

  const qualification: Record<string, unknown> = {
    imported_from: "bigin",
    bigin_deal_id: row.tratoId.trim(),
  };
  if (row.contactId.trim()) qualification.bigin_contact_id = row.contactId.trim();
  if (mensaje) qualification.mensaje_usuario = mensaje;
  if (rutFacturacion) qualification.rut_facturacion = rutFacturacion;
  if (rutFacturaRaw) qualification.rut_factura_raw = rutFacturaRaw;
  if (meetingAt) qualification.fecha_reunion = meetingAt.toISOString();
  if (folderUrl) qualification.drive_folder_url = folderUrl;
  if (closingScore) qualification.closing_score = closingScore;
  if (tags.dealFit) qualification.deal_fit = tags.dealFit;
  if (regions[0]) qualification.region = regions[0];
  if (regions.length > 1) qualification.regiones = regions;
  if (productKey) qualification.productos = [productKey];
  if (convocatoria) qualification.convocatoria = convocatoria;
  if (importeClp != null) qualification.importe_clp = importeClp;
  if (fechaCierre) qualification.fecha_cierre = fechaCierre;
  if (tags.segmento) qualification.segmento_confirmado = tags.segmento;

  return {
    biginDealId: row.tratoId.trim(),
    biginContactId: row.contactId.trim() || null,
    stageKey,
    lostReason,
    contactName,
    phone: row.phone.trim() || null,
    companyRut,
    companyName: row.companyName.trim() || null,
    rutFacturacion,
    rutFacturaRaw,
    segmento: tags.segmento,
    dealFit: tags.dealFit,
    closingScore,
    region: regions[0] ?? null,
    regiones: regions.length > 1 ? regions : null,
    productKey,
    convocatoria,
    landingSource,
    mensajeUsuario: mensaje,
    importeClp,
    fechaCierre,
    meetingAt,
    createdAt,
    updatedAt,
    driveFolderId: folderUrl ? driveFolderId(folderUrl) : null,
    driveFolderUrl: folderUrl,
    ownerKey: OWNER_KEYS[fold(row.ownerName)] ?? null,
    qualification,
  };
}

export function rowFromCsvRecord(
  record: Record<string, string>
): BiginDealRow {
  const get = (key: string) => record[key] ?? "";
  return {
    tratoId: get("Trato Id"),
    ownerName: get("Propietario de Trato"),
    dealName: get("Nombre de Trato"),
    contactId: get("Nombre de Contacto.id"),
    contactName: get("Nombre de Contacto"),
    companyName: get("Nombre de Empresa"),
    phase: get("Fase"),
    amountRaw: get("Importe"),
    closeDate: get("Fecha de cierre"),
    tagsRaw: get("Etiqueta"),
    createdAt: get("Hora de creación"),
    updatedAt: get("Hora de modificación"),
    projectStory: get("Cuentanos Proyecto"),
    rutRaw: get("Rut Factura"),
    meetingDate: get("Fecha Reunion"),
    folderUrl: get("Folder Url"),
    source: get("Fuente"),
    phone: get("Telefono"),
    closingScoreRaw: get("Closing Score"),
    convocatoriaRaw: get("Convocatoria"),
    regionRaw: get("Region"),
    lostReasonRaw: get("Razon Perdida"),
  };
}

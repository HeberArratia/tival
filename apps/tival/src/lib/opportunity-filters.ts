/**
 * Filtros del canvas de Diagnóstico.
 * Misma query para tablero, listado y handoff. Entre dimensiones es Y;
 * dentro de una dimensión, O. `none` es el balde “sin dato”.
 */

import {
  CLOSING_SCORE_KEYS,
  LEGACY_CLOSING_NO_FIT,
  closingScoreLabel,
  isClosingScore,
} from "@/lib/closing-scores";
import { CHILE_REGION_KEYS, chileRegionLabel, isChileRegion } from "@/lib/chile-regions";
import { DEAL_FIT_KEYS, dealFitLabel, isDealFit } from "@/lib/deal-fits";
import { productKeysFromQualification } from "@/lib/products";

export const FILTER_NONE = "none";

export const DIAGNOSTICO_CANVAS_PATH = "/procesos/diagnostico";

export type DiagnosticoView = "tablero" | "listado" | "handoff";

export const FILTER_DIMENSIONS = [
  { id: "consultor", label: "Consultor", chip: "Consultor" },
  { id: "temp", label: "Temperatura", chip: "Temperatura" },
  { id: "fit", label: "Fit", chip: "Fit" },
  { id: "reunion", label: "Fecha de reunión", chip: "Reunión" },
  { id: "region", label: "Región", chip: "Región" },
  { id: "producto", label: "Producto", chip: "Producto" },
] as const;

export type FilterDimensionId = (typeof FILTER_DIMENSIONS)[number]["id"];

export type OpportunityFilterState = {
  segment: string | null;
  consultants: string[];
  temperatures: string[];
  fits: string[];
  regions: string[];
  products: string[];
  meetingFrom: string | null;
  meetingTo: string | null;
  meetingMissing: boolean;
};

export const EMPTY_OPPORTUNITY_FILTERS: OpportunityFilterState = {
  segment: null,
  consultants: [],
  temperatures: [],
  fits: [],
  regions: [],
  products: [],
  meetingFrom: null,
  meetingTo: null,
  meetingMissing: false,
};

const SANTIAGO = "America/Santiago";
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type MeetingDatePreset = {
  id: string;
  label: string;
  desde: string;
  hasta: string;
};

type SearchParamValue = string | string[] | undefined;

function firstParam(value: SearchParamValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parseTokens(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token || out.includes(token)) continue;
    out.push(token);
    if (out.length >= 40) break;
  }
  return out;
}

function parseAllowed(raw: string, allowed: readonly string[]): string[] {
  const allow = new Set<string>(allowed);
  return parseTokens(raw).filter((token) => allow.has(token));
}

function parseDay(raw: string): string | null {
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, date! + delta));
  return next.toISOString().slice(0, 10);
}

function santiagoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SANTIAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    weekIndex: WEEKDAY_INDEX[pick("weekday")] ?? 0,
  };
}

export function santiagoDateKey(date: Date): string {
  const parts = santiagoParts(date);
  return ymd(parts.year, parts.month, parts.day);
}

export function meetingDatePresets(now = new Date()): MeetingDatePreset[] {
  const today = santiagoParts(now);
  const todayKey = ymd(today.year, today.month, today.day);
  const sinceMonday = (today.weekIndex + 6) % 7;
  const weekStart = addDays(todayKey, -sinceMonday);
  const prev =
    today.month === 1
      ? { year: today.year - 1, month: 12 }
      : { year: today.year, month: today.month - 1 };
  const prevLast = new Date(Date.UTC(prev.year, prev.month, 0)).getUTCDate();
  const thisLast = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();

  return [
    {
      id: "semana",
      label: "Esta semana",
      desde: weekStart,
      hasta: addDays(weekStart, 6),
    },
    {
      id: "mes",
      label: "Este mes",
      desde: ymd(today.year, today.month, 1),
      hasta: ymd(today.year, today.month, thisLast),
    },
    {
      id: "mes-anterior",
      label: "Mes anterior",
      desde: ymd(prev.year, prev.month, 1),
      hasta: ymd(prev.year, prev.month, prevLast),
    },
    {
      id: "90",
      label: "Últimos 90 días",
      desde: addDays(todayKey, -89),
      hasta: todayKey,
    },
    {
      id: "anio",
      label: "Este año",
      desde: ymd(today.year, 1, 1),
      hasta: ymd(today.year, 12, 31),
    },
  ];
}

export function parseOpportunityFilters(
  raw: Record<string, SearchParamValue>
): OpportunityFilterState {
  const segment = firstParam(raw.segment).trim();
  return {
    segment: segment || null,
    consultants: parseTokens(firstParam(raw.consultor)),
    temperatures: parseAllowed(firstParam(raw.temp), [
      ...CLOSING_SCORE_KEYS,
      FILTER_NONE,
    ]),
    fits: parseAllowed(firstParam(raw.fit), [...DEAL_FIT_KEYS, FILTER_NONE]),
    regions: parseAllowed(firstParam(raw.region), [
      ...CHILE_REGION_KEYS,
      FILTER_NONE,
    ]),
    products: parseTokens(firstParam(raw.producto)),
    meetingFrom: parseDay(firstParam(raw.desde)),
    meetingTo: parseDay(firstParam(raw.hasta)),
    meetingMissing: firstParam(raw.reunion).trim() === FILTER_NONE,
  };
}

export function diagnosticoHref(
  view: DiagnosticoView,
  filters: OpportunityFilterState
): string {
  const query = new URLSearchParams();
  if (view !== "tablero") query.set("view", view);
  if (filters.segment) query.set("segment", filters.segment);
  if (filters.consultants.length) {
    query.set("consultor", filters.consultants.join(","));
  }
  if (filters.temperatures.length) query.set("temp", filters.temperatures.join(","));
  if (filters.fits.length) query.set("fit", filters.fits.join(","));
  if (filters.regions.length) query.set("region", filters.regions.join(","));
  if (filters.products.length) query.set("producto", filters.products.join(","));
  if (filters.meetingFrom) query.set("desde", filters.meetingFrom);
  if (filters.meetingTo) query.set("hasta", filters.meetingTo);
  if (filters.meetingMissing) query.set("reunion", FILTER_NONE);
  const search = query.toString();
  return search ? `${DIAGNOSTICO_CANVAS_PATH}?${search}` : DIAGNOSTICO_CANVAS_PATH;
}

export function dimensionActive(
  filters: OpportunityFilterState,
  id: FilterDimensionId
): boolean {
  switch (id) {
    case "consultor":
      return filters.consultants.length > 0;
    case "temp":
      return filters.temperatures.length > 0;
    case "fit":
      return filters.fits.length > 0;
    case "reunion":
      return filters.meetingMissing || !!filters.meetingFrom || !!filters.meetingTo;
    case "region":
      return filters.regions.length > 0;
    case "producto":
      return filters.products.length > 0;
  }
}

export function clearDimension(
  filters: OpportunityFilterState,
  id: FilterDimensionId
): OpportunityFilterState {
  switch (id) {
    case "consultor":
      return { ...filters, consultants: [] };
    case "temp":
      return { ...filters, temperatures: [] };
    case "fit":
      return { ...filters, fits: [] };
    case "reunion":
      return {
        ...filters,
        meetingFrom: null,
        meetingTo: null,
        meetingMissing: false,
      };
    case "region":
      return { ...filters, regions: [] };
    case "producto":
      return { ...filters, products: [] };
  }
}

export function filtersActive(filters: OpportunityFilterState): boolean {
  return (
    !!filters.segment ||
    FILTER_DIMENSIONS.some((dimension) => dimensionActive(filters, dimension.id))
  );
}

export function toggleToken(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, date)));
}

function formatRange(from: string | null, to: string | null): string {
  if (from && to) return `${formatDay(from)} – ${formatDay(to)}`;
  if (from) return `desde ${formatDay(from)}`;
  if (to) return `hasta ${formatDay(to)}`;
  return "";
}

function joinLabels(labels: string[]): { short: string; full: string } {
  const full = labels.join(", ");
  if (labels.length <= 2) return { short: full, full };
  return {
    short: `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`,
    full,
  };
}

export function dimensionSummary(
  id: FilterDimensionId,
  filters: OpportunityFilterState,
  names: {
    consultant: (id: string) => string;
    product: (key: string) => string;
  },
  now = new Date()
): { short: string; full: string } {
  if (id === "reunion") {
    const range = formatRange(filters.meetingFrom, filters.meetingTo);
    const preset = meetingDatePresets(now).find(
      (item) =>
        item.desde === filters.meetingFrom && item.hasta === filters.meetingTo
    );
    const window = preset && !filters.meetingMissing ? preset.label : range;
    if (filters.meetingMissing && window) {
      const full = `${window} o sin fecha`;
      return { short: full, full };
    }
    if (filters.meetingMissing) return { short: "sin fecha", full: "sin fecha" };
    return { short: window, full: window };
  }

  const labels =
    id === "consultor"
      ? filters.consultants.map((id) =>
          id === FILTER_NONE ? "sin consultor" : names.consultant(id)
        )
      : id === "temp"
        ? filters.temperatures.map((value) =>
            value === FILTER_NONE
              ? "sin temperatura"
              : (closingScoreLabel(value) ?? value)
          )
        : id === "fit"
          ? filters.fits.map((value) =>
              value === FILTER_NONE ? "sin fit" : (dealFitLabel(value) ?? value)
            )
          : id === "region"
            ? filters.regions.map(
                (value) =>
                  value === FILTER_NONE
                    ? "sin región"
                    : (chileRegionLabel(value) ?? value)
              )
            : filters.products.map((value) =>
                value === FILTER_NONE ? "sin producto" : names.product(value)
              );

  return joinLabels(labels);
}

type FilterSubject = {
  scheduledAt?: Date | null;
  assignedConsultantId?: string | null;
  qualification?: Record<string, unknown> | null;
};

function temperatureOf(
  qualification: Record<string, unknown> | null | undefined
): string | null {
  const raw = qualification?.closing_score;
  return typeof raw === "string" && isClosingScore(raw) ? raw : null;
}

function fitOf(
  qualification: Record<string, unknown> | null | undefined
): string | null {
  const raw = qualification?.deal_fit;
  if (typeof raw === "string" && isDealFit(raw)) return raw;
  if (qualification?.closing_score === LEGACY_CLOSING_NO_FIT) {
    return LEGACY_CLOSING_NO_FIT;
  }
  return null;
}

function regionOf(
  qualification: Record<string, unknown> | null | undefined
): string | null {
  const raw = qualification?.region;
  return typeof raw === "string" && isChileRegion(raw) ? raw : null;
}

function matchesToken(selected: readonly string[], value: string | null): boolean {
  if (selected.length === 0) return true;
  if (!value) return selected.includes(FILTER_NONE);
  return selected.includes(value);
}

function matchesProducts(selected: readonly string[], keys: readonly string[]): boolean {
  if (selected.length === 0) return true;
  if (keys.length === 0) return selected.includes(FILTER_NONE);
  return keys.some((key) => selected.includes(key));
}

function meetingDay(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return santiagoDateKey(date);
}

function matchesMeeting(
  scheduledAt: Date | null | undefined,
  filters: OpportunityFilterState
): boolean {
  const hasRange = !!(filters.meetingFrom || filters.meetingTo);
  if (!hasRange && !filters.meetingMissing) return true;
  const day = meetingDay(scheduledAt);
  if (!day) return filters.meetingMissing;
  if (!hasRange) return false;
  if (filters.meetingFrom && day < filters.meetingFrom) return false;
  if (filters.meetingTo && day > filters.meetingTo) return false;
  return true;
}

export function caseMatchesFilters(
  row: FilterSubject,
  filters: OpportunityFilterState,
  segmentId: string | null
): boolean {
  if (filters.segment && segmentId !== filters.segment) return false;
  if (!matchesToken(filters.consultants, row.assignedConsultantId?.trim() || null)) {
    return false;
  }
  const qualification = row.qualification ?? null;
  if (!matchesToken(filters.temperatures, temperatureOf(qualification))) return false;
  if (!matchesToken(filters.fits, fitOf(qualification))) return false;
  if (!matchesToken(filters.regions, regionOf(qualification))) return false;
  if (!matchesProducts(filters.products, productKeysFromQualification(qualification))) {
    return false;
  }
  return matchesMeeting(row.scheduledAt, filters);
}

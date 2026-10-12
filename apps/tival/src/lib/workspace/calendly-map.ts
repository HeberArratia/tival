import type { CalendlyQa } from "@/lib/integrations/calendly-parse";
import type { CalendlyInviteeMapping } from "@/lib/workspace/types";

export function findQaAnswer(
  qas: CalendlyQa[],
  patterns: RegExp[] | undefined
): string | null {
  if (!patterns?.length) return null;
  for (const qa of qas) {
    const q = String(qa.question ?? "");
    if (patterns.some((re) => re.test(q))) {
      const a = String(qa.answer ?? "").trim();
      return a || null;
    }
  }
  return null;
}

export function mapCalendlyQa(
  qas: CalendlyQa[],
  mapping: CalendlyInviteeMapping
) {
  return {
    phone: findQaAnswer(qas, mapping.phoneQuestion),
    mensajeUsuario: findQaAnswer(qas, mapping.mensajeQuestion),
    rutEmpresa: findQaAnswer(qas, mapping.rutQuestion),
  };
}

/** Filtra a la lista blanca del pack (si existe). */
export function normalizeLandingSource(
  raw: string | null | undefined,
  allowed?: string[] | null
): string | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  if (!allowed?.length) return value;
  const allowedSet = new Set(allowed.map((s) => s.toLowerCase()));
  return allowedSet.has(value.toLowerCase()) ? value : null;
}

export function resolveLandingSource(
  tracking: Record<string, unknown>,
  mapping: CalendlyInviteeMapping
): string | null {
  const medium = tracking.utm_medium ? String(tracking.utm_medium).trim() : null;
  const source = tracking.utm_source ? String(tracking.utm_source).trim() : null;
  const mode = mapping.landingFromTracking ?? "either";
  // utm_medium: solo medium (no caer a utm_source=alfondo).
  let raw: string | null;
  if (mode === "utm_medium") raw = medium || null;
  else if (mode === "utm_source") raw = source || medium || null;
  else raw = medium || source || null;
  return normalizeLandingSource(raw, mapping.allowedLandings);
}

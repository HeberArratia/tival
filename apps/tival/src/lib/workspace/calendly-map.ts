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

export function resolveLandingSource(
  tracking: Record<string, unknown>,
  mapping: CalendlyInviteeMapping
): string | null {
  const medium = tracking.utm_medium ? String(tracking.utm_medium) : null;
  const source = tracking.utm_source ? String(tracking.utm_source) : null;
  const mode = mapping.landingFromTracking ?? "either";
  if (mode === "utm_medium") return medium ?? source;
  if (mode === "utm_source") return source ?? medium;
  return medium ?? source;
}

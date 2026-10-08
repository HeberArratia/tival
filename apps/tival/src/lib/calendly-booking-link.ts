/**
 * Arma URL de booking Calendly con prefills + tracking para merge post no-show.
 *
 * Custom answers (`a1`…) siguen el orden de preguntas del event type Alfondo:
 *   a1 = teléfono, a2 = proyecto, a3 = RUT facturación.
 */

export const CALENDLY_REAGENDA_UTM_CAMPAIGN = "tival_reagenda";

export type CalendlyBookingPrefill = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  mensaje?: string | null;
  rut?: string | null;
  /** UUID del case → utm_content (merge fuerte). */
  caseId?: string | null;
  /** Prefill de reagenda controlada por Tival. */
  reagenda?: boolean;
};

/** Base del event type (sin slot fijo). */
export function calendlyEventTypeBase(calendlyUrl: string): string {
  try {
    const u = new URL(calendlyUrl);
    // /user/event/2026-10-14T16:00:00-03:00 → /user/event
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 3 && /\d{4}-\d{2}-\d{2}T/.test(parts[2]!)) {
      u.pathname = `/${parts[0]}/${parts[1]}`;
    }
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return calendlyUrl.split("?")[0]?.replace(/\/$/, "") ?? calendlyUrl;
  }
}

export function buildCalendlyBookingLink(
  calendlyUrl: string,
  prefill: CalendlyBookingPrefill
): string {
  const base = calendlyEventTypeBase(calendlyUrl);
  const params = new URLSearchParams();

  if (prefill.name?.trim()) params.set("name", prefill.name.trim());
  if (prefill.email?.trim()) params.set("email", prefill.email.trim());
  if (prefill.phone?.trim()) params.set("a1", prefill.phone.trim());
  if (prefill.mensaje?.trim()) params.set("a2", prefill.mensaje.trim());
  if (prefill.rut?.trim()) params.set("a3", prefill.rut.trim());

  if (prefill.reagenda) {
    params.set("utm_campaign", CALENDLY_REAGENDA_UTM_CAMPAIGN);
  }
  if (prefill.caseId?.trim()) {
    params.set("utm_content", prefill.caseId.trim());
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function isTivalReagendaTracking(tracking: {
  utm_campaign?: string | null;
  utm_content?: string | null;
}): { reagenda: boolean; caseId: string | null } {
  const campaign = tracking.utm_campaign
    ? String(tracking.utm_campaign)
    : null;
  const content = tracking.utm_content ? String(tracking.utm_content) : null;
  const caseId =
    content && /^[0-9a-f-]{36}$/i.test(content) ? content : null;
  return {
    reagenda: campaign === CALENDLY_REAGENDA_UTM_CAMPAIGN,
    caseId,
  };
}

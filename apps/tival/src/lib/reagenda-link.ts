/**
 * Link propio de Tival para reagenda.
 * Destino Calendly se resuelve al abrir (nativo vs booking prefildado).
 */
import {
  isAwaitingRescheduleActive,
} from "@/lib/awaiting-reschedule";
import { buildCalendlyBookingLink } from "@/lib/calendly-booking-link";
import { initiativeForCase } from "@/lib/fake-data";
import { appBaseUrl } from "@/lib/integrations/runtime-env";
import type { CaseWithIdentity } from "@/lib/cases";

export function buildTivalReagendaPath(caseId: string): string {
  return `/r/${caseId}`;
}

export function buildTivalReagendaUrl(caseId: string): string {
  return `${appBaseUrl()}${buildTivalReagendaPath(caseId)}`;
}

export type ReagendaDestination =
  | {
      ok: true;
      url: string;
      kind: "native_reschedule" | "prefilled_booking";
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "closed"
        | "expired"
        | "no_calendly"
        | "unavailable";
      message: string;
    };

/** ¿Tiene sentido ofrecer “copiar link reagenda” en la UI? */
export function canShareReagendaLink(input: {
  status: string;
  scheduledAt?: Date | null;
  qualification?: Record<string, unknown> | null;
  hasRescheduleUrl?: boolean;
  hasCalendlyBase?: boolean;
}): boolean {
  const awaiting = isAwaitingRescheduleActive(input.qualification);
  if (awaiting || input.status === "no_show") {
    return Boolean(input.hasCalendlyBase);
  }
  if (input.status === "open") {
    const meetingPassed = input.scheduledAt
      ? input.scheduledAt.getTime() < Date.now()
      : false;
    if (!meetingPassed && input.hasRescheduleUrl) return true;
  }
  return false;
}

/**
 * Resuelve a dónde mandar al cliente ahora.
 * Misma regla que usaba la UI al copiar el link Calendly crudo.
 */
export function resolveReagendaDestination(
  c: CaseWithIdentity,
  opts?: { phone?: string | null }
): ReagendaDestination {
  if (["cancelled", "rescheduled_away"].includes(c.status)) {
    return {
      ok: false,
      reason: "closed",
      message: "Este link de reagenda ya no está disponible.",
    };
  }

  const qualification = (c.qualification ?? {}) as Record<string, unknown>;
  const awaitingActive = isAwaitingRescheduleActive(qualification);
  const rescheduleUrl =
    typeof qualification.reschedule_url === "string"
      ? qualification.reschedule_url
      : null;
  const meetingPassed = c.scheduledAt
    ? c.scheduledAt.getTime() < Date.now()
    : false;

  const ini = initiativeForCase(c);
  const calendlyBase =
    typeof ini?.config?.calendlyUrl === "string"
      ? ini.config.calendlyUrl
      : null;

  const prefilled =
    calendlyBase && (awaitingActive || c.status === "no_show")
      ? buildCalendlyBookingLink(calendlyBase, {
          name: c.contact?.name,
          email: c.contact?.email,
          phone: opts?.phone ?? c.contact?.primaryPhone,
          mensaje:
            typeof qualification.mensaje_usuario === "string"
              ? qualification.mensaje_usuario
              : null,
          rut:
            typeof qualification.rut_facturacion === "string"
              ? qualification.rut_facturacion
              : null,
          caseId: c.id,
          reagenda: true,
        })
      : null;

  const native =
    rescheduleUrl && !meetingPassed && c.status === "open"
      ? rescheduleUrl
      : null;

  if (awaitingActive) {
    if (!prefilled) {
      return {
        ok: false,
        reason: "no_calendly",
        message: "No hay link de reagenda configurado para esta oportunidad.",
      };
    }
    return { ok: true, url: prefilled, kind: "prefilled_booking" };
  }

  if (native) {
    return { ok: true, url: native, kind: "native_reschedule" };
  }

  if (prefilled) {
    return { ok: true, url: prefilled, kind: "prefilled_booking" };
  }

  if (c.status === "no_show" && !calendlyBase) {
    return {
      ok: false,
      reason: "no_calendly",
      message: "No hay link de reagenda configurado para esta oportunidad.",
    };
  }

  return {
    ok: false,
    reason: "unavailable",
    message: "Este link de reagenda no está disponible en este momento.",
  };
}

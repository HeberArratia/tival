/**
 * Parseo genérico del payload Calendly → campos de oportunidad.
 * El mapeo de Q&A viene del workspace pack (no del core).
 * Productos del catálogo se cargan después en Ops (`qualification.productos`).
 */

import {
  mapCalendlyQa,
  resolveLandingSource,
} from "@/lib/workspace/calendly-map";
import type { CalendlyInviteeMapping } from "@/lib/workspace/types";

export type CalendlyQa = {
  question?: string;
  answer?: string;
  position?: number;
};

export type ParsedCalendlyInvitee = {
  event: string;
  eventUuid: string | null;
  eventUri: string | null;
  inviteeUri: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  mensajeUsuario: string | null;
  rutEmpresa: string | null;
  scheduledAt: Date | null;
  meetUrl: string | null;
  eventName: string | null;
  timezone: string | null;
  hostName: string | null;
  hostEmail: string | null;
  tracking: Record<string, unknown>;
  questionsAndAnswers: CalendlyQa[];
  qualificationLogId: string | null;
  landingSource: string | null;
  qualification: Record<string, unknown>;
  createdAt: string | null;
};

function extractUuid(uriOrId?: string | null) {
  if (!uriOrId) return null;
  const parts = String(uriOrId).split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

/**
 * UUID del scheduled event en URIs Calendly.
 * Invitee: `…/scheduled_events/{event}/invitees/{invitee}` → event (no el último segmento).
 * Event: `…/scheduled_events/{event}` → event.
 */
export function scheduledEventUuidFromCalendlyRef(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === "string") return eventUuidFromCalendlyUri(ref);
  if (typeof ref === "object") {
    const o = ref as Record<string, unknown>;
    return (
      eventUuidFromCalendlyUri(typeof o.event === "string" ? o.event : null) ??
      eventUuidFromCalendlyUri(typeof o.uri === "string" ? o.uri : null)
    );
  }
  return null;
}

function eventUuidFromCalendlyUri(uri: string | null): string | null {
  if (!uri) return null;
  const parts = uri.split("/").filter(Boolean);
  const i = parts.indexOf("scheduled_events");
  if (i >= 0 && parts[i + 1]) return parts[i + 1]!;
  if (parts.length === 1) return parts[0]!;
  return null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Acepta el objeto Calendly o el array que n8n entrega (`[{ event, payload }]`).
 */
export function normalizeCalendlyBody(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw) && raw[0]) return asRecord(raw[0]);
  return asRecord(raw);
}

export function parseCalendlyInviteePayload(
  body: Record<string, unknown>,
  mapping: CalendlyInviteeMapping = {}
): ParsedCalendlyInvitee {
  const event = String(body.event ?? "");
  const payload = asRecord(body.payload ?? body);
  const invitee = asRecord(payload.invitee ?? payload);
  const scheduledEvent = asRecord(
    payload.scheduled_event ?? invitee.scheduled_event ?? {}
  );
  const location = asRecord(scheduledEvent.location);
  const tracking = asRecord(invitee.tracking ?? payload.tracking);
  const memberships = Array.isArray(scheduledEvent.event_memberships)
    ? scheduledEvent.event_memberships
    : [];
  const host = asRecord(memberships[0]);

  const qas = (
    Array.isArray(invitee.questions_and_answers)
      ? invitee.questions_and_answers
      : Array.isArray(payload.questions_and_answers)
        ? payload.questions_and_answers
        : []
  ) as CalendlyQa[];

  const eventUri =
    (scheduledEvent.uri as string | undefined) ??
    (typeof invitee.event === "string" ? invitee.event : null) ??
    (typeof payload.event === "string" &&
    String(payload.event).includes("scheduled_events")
      ? (payload.event as string)
      : null);

  const eventUuid = extractUuid(eventUri);
  const joinedName = [invitee.first_name, invitee.last_name]
    .filter(Boolean)
    .join(" ");

  const mapped = mapCalendlyQa(qas, mapping);
  const utmContent = tracking.utm_content
    ? String(tracking.utm_content)
    : null;
  const qualificationLogId =
    utmContent && /^[0-9a-f-]{36}$/i.test(utmContent) ? utmContent : null;

  const landingSource = resolveLandingSource(tracking, mapping);
  const createdAt =
    (invitee.created_at as string | undefined) ??
    (body.created_at as string | undefined) ??
    null;

  const eventName = (scheduledEvent.name as string | undefined) ?? null;

  const qualification: Record<string, unknown> = {
    mensaje_usuario: mapped.mensajeUsuario,
    /** RUT con el que quieren facturar este diagnóstico (campo de la opp). */
    rut_facturacion: mapped.rutEmpresa,
    agendado_en: createdAt,
    fecha_reunion: scheduledEvent.start_time ?? null,
    meet_url: location.join_url ?? location.location ?? null,
    timezone: invitee.timezone ?? null,
    event_name: eventName,
    host_name: host.user_name ?? null,
    host_email: host.user_email ?? null,
    questions_and_answers: qas,
    tracking,
    cancel_url: invitee.cancel_url ?? null,
    reschedule_url: invitee.reschedule_url ?? null,
  };

  return {
    event,
    eventUuid,
    eventUri: eventUri ?? null,
    inviteeUri: (invitee.uri as string | undefined) ?? null,
    name: (invitee.name as string | undefined) ?? (joinedName || null),
    email: (invitee.email as string | undefined) ?? null,
    phone: mapped.phone,
    mensajeUsuario: mapped.mensajeUsuario,
    rutEmpresa: mapped.rutEmpresa,
    scheduledAt: scheduledEvent.start_time
      ? new Date(String(scheduledEvent.start_time))
      : null,
    meetUrl:
      (location.join_url as string | undefined) ??
      (location.location as string | undefined) ??
      null,
    eventName,
    timezone: (invitee.timezone as string | undefined) ?? null,
    hostName: (host.user_name as string | undefined) ?? null,
    hostEmail: (host.user_email as string | undefined) ?? null,
    tracking,
    questionsAndAnswers: qas,
    qualificationLogId,
    landingSource,
    qualification,
    createdAt,
  };
}

/**
 * Envío WhatsApp vía Kapso (Cloud API proxy).
 * - Pedido de comprobante (lead)
 * - Confirmación de pago + Meet (markPaid)
 * - Cancelación por no pago (markLost · no_pago, opcional)
 * - Aviso propuesta enviada al correo (markPropuestaEnviada)
 * - Recordatorio T-1h (Inngest, solo pagados)
 * - Reagenda post-enrich (Inngest, solo pagados)
 * - Bloqueo de usuario (block_users)
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  caseEvents,
  cases,
  contacts,
  contactPhones,
  type CaseRow,
} from "@/db/schema";
import { normalizePhone } from "@/lib/identity";
import {
  getKapsoCredentialsForWorkspace,
  type KapsoCredentials,
} from "@/lib/integrations/connections";

const TIMEZONE = "America/Santiago";
const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";
/** Templates Meta en Kapso (proyecto tival / WABA Alfondo). */
const PAYMENT_REQUEST_TEMPLATE = "confirmacion_pago_diagnostico";
const PAYMENT_CONFIRMED_TEMPLATE = "pago_diagnostico_confirmado";
const PROPUESTA_ENVIADA_TEMPLATE = "propuesta_enviada_diagnostico";
const MEETING_REMIND_TEMPLATE = "recordatorio_diagnostico_1h";
const RESCHEDULE_TEMPLATE = "reagenda_diagnostico";
/** Cancelación por falta de confirmación de pago (ops · No pagó). */
const NO_PAGO_CANCELLED_TEMPLATE = "sesion_cancelada_no_pago";
const TEMPLATE_LANGUAGE = "es";

const CLOSED_STATUSES = ["cancelled", "no_show", "rescheduled_away"] as const;

/** Digits-only E.164-ish for Cloud API `to` (sin +). */
export function toWhatsAppRecipient(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  let digits = normalized.replace(/[^\d]/g, "");
  // Chile móvil local 9XXXXXXXX → 569XXXXXXXX
  if (digits.length === 9 && digits.startsWith("9")) {
    digits = `56${digits}`;
  }
  if (digits.length < 8) return null;
  return digits;
}

export function formatMeetingParts(at: Date): { fecha: string; hora: string } {
  const fecha = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: TIMEZONE,
  }).format(at);
  const hora = new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIMEZONE,
  }).format(at);
  return { fecha, hora };
}

function firstName(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return "ahí";
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

async function resolveContactPhone(
  contactId: string
): Promise<{ name: string | null; phone: string | null }> {
  const db = await getDb();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!contact) return { name: null, phone: null };

  let rawPhone = contact.primaryPhone;
  if (!rawPhone) {
    const [phoneRow] = await db
      .select()
      .from(contactPhones)
      .where(eq(contactPhones.contactId, contact.id))
      .limit(1);
    rawPhone = phoneRow?.phone ?? null;
  }
  return { name: contact.name, phone: rawPhone };
}

type KapsoSendResult =
  | { ok: true; wamid: string | null }
  | { ok: false; status: number; error: string };

async function sendTemplate(input: {
  creds: KapsoCredentials;
  to: string;
  template: string;
  parameters?: { parameter_name: string; text: string }[];
}): Promise<KapsoSendResult> {
  const parameters = input.parameters ?? [];
  const res = await fetch(
    `${KAPSO_BASE}/${input.creds.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": input.creds.apiKey,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: input.template,
          language: { code: TEMPLATE_LANGUAGE },
          ...(parameters.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: parameters.map((p) => ({
                      type: "text",
                      parameter_name: p.parameter_name,
                      text: p.text,
                    })),
                  },
                ],
              }
            : {}),
        },
      }),
    }
  );

  const text = await res.text().catch(() => "");
  type KapsoResponse = {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  };
  let parsed: KapsoResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as KapsoResponse) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      parsed?.error?.message ||
      (text ? text.slice(0, 200) : `http_${res.status}`);
    console.error("[kapso.whatsapp] send failed", res.status, msg);
    return { ok: false, status: res.status, error: msg };
  }

  return { ok: true, wamid: parsed?.messages?.[0]?.id ?? null };
}

export type RequestPaymentWhatsappResult =
  | {
      ok: true;
      to: string;
      wamid: string | null;
      nombre: string;
      fecha: string;
      hora: string;
    }
  | { ok: false; error: string };

export async function requestPaymentProofWhatsapp(input: {
  caseId: string;
  actor: string;
}): Promise<RequestPaymentWhatsappResult> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!row) return { ok: false, error: "case_not_found" };

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) return { ok: false, error: "kapso_not_configured" };

  if (row.paymentStatus === "paid") {
    return { ok: false, error: "already_paid" };
  }
  if (!row.scheduledAt) {
    return { ok: false, error: "missing_scheduled_at" };
  }
  if (!row.contactId) {
    return { ok: false, error: "missing_contact" };
  }

  const { name, phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) return { ok: false, error: "missing_phone" };

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) return { ok: false, error: "invalid_phone" };

  const nombre = firstName(name);
  const { fecha, hora } = formatMeetingParts(row.scheduledAt);

  const sent = await sendTemplate({
    creds,
    to,
    template: PAYMENT_REQUEST_TEMPLATE,
    parameters: [
      { parameter_name: "nombre", text: nombre },
      { parameter_name: "fecha", text: fecha },
      { parameter_name: "hora", text: hora },
    ],
  });

  if (!sent.ok) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_request_failed",
      payload: {
        to,
        template: PAYMENT_REQUEST_TEMPLATE,
        status: sent.status,
        error: sent.error,
      },
      actor: input.actor,
    });
    if (sent.status === 404 || /template/i.test(sent.error)) {
      return { ok: false, error: "template_not_ready" };
    }
    return { ok: false, error: "kapso_send_failed" };
  }

  await db.insert(caseEvents).values({
    caseId: row.id,
    type: "whatsapp_payment_request_sent",
    payload: {
      to,
      template: PAYMENT_REQUEST_TEMPLATE,
      language: TEMPLATE_LANGUAGE,
      nombre,
      fecha,
      hora,
      wamid: sent.wamid,
    },
    actor: input.actor,
  });

  return { ok: true, to, wamid: sent.wamid, nombre, fecha, hora };
}

export type NoPagoCancelledWhatsappResult =
  | { ok: true; to: string; wamid: string | null }
  | { ok: false; error: string };

/**
 * Aviso al lead al marcar No pagó · sesión cancelada por falta de confirmación.
 * No bloquea markLost si Kapso falla.
 */
export async function notifyNoPagoCancelledWhatsapp(input: {
  caseId: string;
  actor: string;
}): Promise<NoPagoCancelledWhatsappResult> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!row) return { ok: false, error: "case_not_found" };

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) return { ok: false, error: "kapso_not_configured" };

  if (!row.contactId) {
    return { ok: false, error: "missing_contact" };
  }

  const { phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) return { ok: false, error: "missing_phone" };

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) return { ok: false, error: "invalid_phone" };

  const sent = await sendTemplate({
    creds,
    to,
    template: NO_PAGO_CANCELLED_TEMPLATE,
  });

  if (!sent.ok) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_no_pago_cancelled_failed",
      payload: {
        to,
        template: NO_PAGO_CANCELLED_TEMPLATE,
        status: sent.status,
        error: sent.error,
      },
      actor: input.actor,
    });
    if (sent.status === 404 || /template/i.test(sent.error)) {
      return { ok: false, error: "template_not_ready" };
    }
    return { ok: false, error: "kapso_send_failed" };
  }

  await db.insert(caseEvents).values({
    caseId: row.id,
    type: "whatsapp_no_pago_cancelled_sent",
    payload: {
      to,
      template: NO_PAGO_CANCELLED_TEMPLATE,
      language: TEMPLATE_LANGUAGE,
      wamid: sent.wamid,
    },
    actor: input.actor,
  });

  return { ok: true, to, wamid: sent.wamid };
}

/**
 * Tras markPaid (MP o transferencia). No bloquea el pago si Kapso falla.
 * Requiere teléfono + scheduledAt + meetUrl.
 */
export async function notifyPaymentConfirmedWhatsapp(
  row: CaseRow
): Promise<void> {
  const db = await getDb();
  const actor = "integracion";

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_skipped",
      payload: { reason: "kapso_not_configured" },
      actor,
    });
    return;
  }

  if (!row.scheduledAt) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_skipped",
      payload: { reason: "missing_scheduled_at" },
      actor,
    });
    return;
  }

  const meet = row.meetUrl?.trim() || null;
  if (!meet) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_skipped",
      payload: { reason: "missing_meet_url" },
      actor,
    });
    return;
  }

  if (!row.contactId) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_skipped",
      payload: { reason: "missing_contact" },
      actor,
    });
    return;
  }

  const { name, phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_skipped",
      payload: { reason: "missing_phone" },
      actor,
    });
    return;
  }

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_skipped",
      payload: { reason: "invalid_phone", phone: rawPhone },
      actor,
    });
    return;
  }

  const nombre = firstName(name);
  const { fecha, hora } = formatMeetingParts(row.scheduledAt);

  try {
    const sent = await sendTemplate({
      creds,
      to,
      template: PAYMENT_CONFIRMED_TEMPLATE,
      parameters: [
        { parameter_name: "nombre", text: nombre },
        { parameter_name: "fecha", text: fecha },
        { parameter_name: "hora", text: hora },
        { parameter_name: "meet", text: meet },
      ],
    });

    if (!sent.ok) {
      await db.insert(caseEvents).values({
        caseId: row.id,
        type: "whatsapp_payment_confirmed_failed",
        payload: {
          to,
          template: PAYMENT_CONFIRMED_TEMPLATE,
          status: sent.status,
          error: sent.error,
        },
        actor,
      });
      return;
    }

    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_sent",
      payload: {
        to,
        template: PAYMENT_CONFIRMED_TEMPLATE,
        language: TEMPLATE_LANGUAGE,
        nombre,
        fecha,
        hora,
        meet,
        wamid: sent.wamid,
      },
      actor,
    });
  } catch (e) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_payment_confirmed_failed",
      payload: {
        to,
        template: PAYMENT_CONFIRMED_TEMPLATE,
        error: e instanceof Error ? e.message : "kapso_send_failed",
      },
      actor,
    });
  }
}

/**
 * Tras markPropuestaEnviada. No bloquea el cambio de etapa si Kapso falla.
 * Requiere teléfono del contacto.
 */
export async function notifyPropuestaEnviadaWhatsapp(
  row: CaseRow
): Promise<void> {
  const db = await getDb();
  const actor = "integracion";

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_propuesta_enviada_skipped",
      payload: { reason: "kapso_not_configured" },
      actor,
    });
    return;
  }

  if (!row.contactId) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_propuesta_enviada_skipped",
      payload: { reason: "missing_contact" },
      actor,
    });
    return;
  }

  const { name, phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_propuesta_enviada_skipped",
      payload: { reason: "missing_phone" },
      actor,
    });
    return;
  }

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_propuesta_enviada_skipped",
      payload: { reason: "invalid_phone", phone: rawPhone },
      actor,
    });
    return;
  }

  const nombre = firstName(name);

  try {
    const sent = await sendTemplate({
      creds,
      to,
      template: PROPUESTA_ENVIADA_TEMPLATE,
      parameters: [{ parameter_name: "nombre", text: nombre }],
    });

    if (!sent.ok) {
      await db.insert(caseEvents).values({
        caseId: row.id,
        type: "whatsapp_propuesta_enviada_failed",
        payload: {
          to,
          template: PROPUESTA_ENVIADA_TEMPLATE,
          status: sent.status,
          error: sent.error,
        },
        actor,
      });
      return;
    }

    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_propuesta_enviada_sent",
      payload: {
        to,
        template: PROPUESTA_ENVIADA_TEMPLATE,
        language: TEMPLATE_LANGUAGE,
        nombre,
        wamid: sent.wamid,
      },
      actor,
    });
  } catch (e) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_propuesta_enviada_failed",
      payload: {
        to,
        template: PROPUESTA_ENVIADA_TEMPLATE,
        error: e instanceof Error ? e.message : "kapso_send_failed",
      },
      actor,
    });
  }
}

export type MeetingRemindWhatsappResult =
  | { ok: true; to: string; wamid: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

/**
 * Recordatorio T-1h. Llamado desde Inngest tras validar vigencia.
 * Requiere pago + teléfono + scheduledAt + meetUrl.
 */
export async function notifyMeetingReminderWhatsapp(
  row: CaseRow
): Promise<MeetingRemindWhatsappResult> {
  const db = await getDb();
  const actor = "integracion";

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "kapso_not_configured" },
      actor,
    });
    return { ok: false, skipped: true, reason: "kapso_not_configured" };
  }

  if (row.paymentStatus !== "paid") {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "not_paid" },
      actor,
    });
    return { ok: false, skipped: true, reason: "not_paid" };
  }

  if (
    CLOSED_STATUSES.includes(
      row.status as (typeof CLOSED_STATUSES)[number]
    )
  ) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "case_closed", status: row.status },
      actor,
    });
    return { ok: false, skipped: true, reason: "case_closed" };
  }

  if (!row.scheduledAt) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "missing_scheduled_at" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_scheduled_at" };
  }

  const meet = row.meetUrl?.trim() || null;
  if (!meet) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "missing_meet_url" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_meet_url" };
  }

  if (!row.contactId) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "missing_contact" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_contact" };
  }

  const { name, phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "missing_phone" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_skipped",
      payload: { reason: "invalid_phone", phone: rawPhone },
      actor,
    });
    return { ok: false, skipped: true, reason: "invalid_phone" };
  }

  const nombre = firstName(name);
  const { fecha, hora } = formatMeetingParts(row.scheduledAt);

  try {
    const sent = await sendTemplate({
      creds,
      to,
      template: MEETING_REMIND_TEMPLATE,
      parameters: [
        { parameter_name: "nombre", text: nombre },
        { parameter_name: "fecha", text: fecha },
        { parameter_name: "hora", text: hora },
        { parameter_name: "meet", text: meet },
      ],
    });

    if (!sent.ok) {
      await db.insert(caseEvents).values({
        caseId: row.id,
        type: "whatsapp_meeting_remind_failed",
        payload: {
          to,
          template: MEETING_REMIND_TEMPLATE,
          status: sent.status,
          error: sent.error,
        },
        actor,
      });
      return { ok: false, skipped: false, error: sent.error };
    }

    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_sent",
      payload: {
        to,
        template: MEETING_REMIND_TEMPLATE,
        language: TEMPLATE_LANGUAGE,
        nombre,
        fecha,
        hora,
        meet,
        wamid: sent.wamid,
      },
      actor,
    });

    return { ok: true, to, wamid: sent.wamid };
  } catch (e) {
    const error = e instanceof Error ? e.message : "kapso_send_failed";
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_meeting_remind_failed",
      payload: {
        to,
        template: MEETING_REMIND_TEMPLATE,
        error,
      },
      actor,
    });
    return { ok: false, skipped: false, error };
  }
}

export type RescheduleWhatsappResult =
  | { ok: true; to: string; wamid: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

/**
 * Aviso de reagenda (solo pagados). Preferir Meet enriquecido; si no hay, el del case.
 */
export async function notifyRescheduleWhatsapp(
  row: CaseRow
): Promise<RescheduleWhatsappResult> {
  const db = await getDb();
  const actor = "integracion";

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "kapso_not_configured" },
      actor,
    });
    return { ok: false, skipped: true, reason: "kapso_not_configured" };
  }

  if (row.paymentStatus !== "paid") {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "not_paid" },
      actor,
    });
    return { ok: false, skipped: true, reason: "not_paid" };
  }

  if (
    CLOSED_STATUSES.includes(row.status as (typeof CLOSED_STATUSES)[number])
  ) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "case_closed", status: row.status },
      actor,
    });
    return { ok: false, skipped: true, reason: "case_closed" };
  }

  if (!row.scheduledAt) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "missing_scheduled_at" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_scheduled_at" };
  }

  const meet = row.meetUrl?.trim() || null;
  if (!meet) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "missing_meet_url" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_meet_url" };
  }

  if (!row.contactId) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "missing_contact" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_contact" };
  }

  const { phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "missing_phone" },
      actor,
    });
    return { ok: false, skipped: true, reason: "missing_phone" };
  }

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_skipped",
      payload: { reason: "invalid_phone", phone: rawPhone },
      actor,
    });
    return { ok: false, skipped: true, reason: "invalid_phone" };
  }

  const { fecha, hora } = formatMeetingParts(row.scheduledAt);

  try {
    const sent = await sendTemplate({
      creds,
      to,
      template: RESCHEDULE_TEMPLATE,
      parameters: [
        { parameter_name: "fecha", text: fecha },
        { parameter_name: "hora", text: hora },
        { parameter_name: "meet", text: meet },
      ],
    });

    if (!sent.ok) {
      await db.insert(caseEvents).values({
        caseId: row.id,
        type: "whatsapp_reschedule_failed",
        payload: {
          to,
          template: RESCHEDULE_TEMPLATE,
          status: sent.status,
          error: sent.error,
        },
        actor,
      });
      return { ok: false, skipped: false, error: sent.error };
    }

    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_sent",
      payload: {
        to,
        template: RESCHEDULE_TEMPLATE,
        language: TEMPLATE_LANGUAGE,
        fecha,
        hora,
        meet,
        wamid: sent.wamid,
      },
      actor,
    });

    return { ok: true, to, wamid: sent.wamid };
  } catch (e) {
    const error = e instanceof Error ? e.message : "kapso_send_failed";
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_reschedule_failed",
      payload: {
        to,
        template: RESCHEDULE_TEMPLATE,
        error,
      },
      actor,
    });
    return { ok: false, skipped: false, error };
  }
}

export type BlockWhatsappUserResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

/**
 * Bloquea el WhatsApp del contacto en el número de negocio (Meta block_users vía Kapso).
 * El usuario deja de poder escribir a ese phone_number_id.
 */
export async function blockWhatsappUser(input: {
  caseId: string;
  actor: string;
}): Promise<BlockWhatsappUserResult> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!row) return { ok: false, error: "case_not_found" };

  const creds = await getKapsoCredentialsForWorkspace(row.workspaceId);
  if (!creds) return { ok: false, error: "kapso_not_configured" };

  if (!row.contactId) {
    return { ok: false, error: "missing_contact" };
  }

  const { phone: rawPhone } = await resolveContactPhone(row.contactId);
  if (!rawPhone) return { ok: false, error: "missing_phone" };

  const to = toWhatsAppRecipient(rawPhone);
  if (!to) return { ok: false, error: "invalid_phone" };

  try {
    const res = await fetch(
      `${KAPSO_BASE}/${creds.phoneNumberId}/block_users`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": creds.apiKey,
        },
        body: JSON.stringify({
          block_users: [{ user: to }],
        }),
      }
    );
    const text = await res.text().catch(() => "");
    type KapsoBlockBody = {
      success?: boolean;
      error?: { message?: string };
    };
    let parsed: KapsoBlockBody | null = null;
    try {
      parsed = text ? (JSON.parse(text) as KapsoBlockBody) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const error =
        parsed?.error?.message?.trim() ||
        text.slice(0, 200) ||
        `HTTP ${res.status}`;
      await db.insert(caseEvents).values({
        caseId: row.id,
        type: "whatsapp_user_blocked_failed",
        payload: {
          to,
          status: res.status,
          error,
        },
        actor: input.actor,
      });
      return { ok: false, error: "kapso_block_failed" };
    }

    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_user_blocked",
      payload: {
        to,
        phoneNumberId: creds.phoneNumberId,
      },
      actor: input.actor,
    });

    return { ok: true, to };
  } catch (e) {
    const error = e instanceof Error ? e.message : "kapso_block_failed";
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "whatsapp_user_blocked_failed",
      payload: { to, error },
      actor: input.actor,
    });
    return { ok: false, error: "kapso_block_failed" };
  }
}

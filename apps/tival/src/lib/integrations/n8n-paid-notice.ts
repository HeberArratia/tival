/**
 * Aviso Slack (vía n8n) cuando un diagnóstico queda pagado.
 * Tival arma el texto; n8n solo lo publica en #novedades.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, companies, contacts, type CaseRow } from "@/db/schema";
import { appBaseUrl } from "@/lib/integrations/runtime-env";
import { memberById } from "@/lib/members-catalog";

const TIMEZONE = "America/Santiago";

function paidSlackWebhookUrl(): string | null {
  const raw = process.env.N8N_PAID_SLACK_WEBHOOK_URL?.trim();
  return raw || null;
}

function formatScheduled(at: Date | null): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: TIMEZONE,
  }).format(at);
}

function paymentLabel(method: CaseRow["paymentMethod"]): string {
  if (method === "transferencia") return "Transferencia";
  if (method === "mercadopago") return "Mercado Pago";
  return "Pago confirmado";
}

function buildText(input: {
  inviteeName: string;
  inviteeEmail: string | null;
  companyName: string | null;
  scheduledLabel: string | null;
  paymentMethodLabel: string;
  consultantName: string | null;
  caseUrl: string;
}): string {
  const who = input.companyName
    ? `*${input.inviteeName}* · ${input.companyName}`
    : `*${input.inviteeName}*`;
  const lines = [
    ":white_check_mark: *Se ha confirmado un diagnóstico*",
    who,
    input.inviteeEmail,
    input.scheduledLabel ? `Reunión: ${input.scheduledLabel}` : null,
    `Pago: ${input.paymentMethodLabel}`,
    `Consultor: ${input.consultantName || "sin asignar"}`,
    input.caseUrl,
  ];
  return lines.filter(Boolean).join("\n");
}

/** No tira el pago si n8n o Slack fallan. No-op si falta la env. */
export async function notifyDiagnosticoPagado(row: CaseRow): Promise<void> {
  const url = paidSlackWebhookUrl();
  const db = await getDb();

  let inviteeName = "Cliente";
  let inviteeEmail: string | null = null;
  if (row.contactId) {
    const [contact] = await db
      .select({ name: contacts.name, email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, row.contactId))
      .limit(1);
    if (contact?.name?.trim()) inviteeName = contact.name.trim();
    if (contact?.email?.trim()) inviteeEmail = contact.email.trim();
  }

  let companyName: string | null = null;
  if (row.companyId) {
    const [company] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, row.companyId))
      .limit(1);
    if (company?.name?.trim()) companyName = company.name.trim();
  }

  const consultant = memberById(row.assignedConsultantId);
  const text = buildText({
    inviteeName,
    inviteeEmail,
    companyName,
    scheduledLabel: formatScheduled(row.scheduledAt),
    paymentMethodLabel: paymentLabel(row.paymentMethod),
    consultantName: consultant?.name ?? null,
    caseUrl: `${appBaseUrl()}/oportunidades/${row.id}`,
  });

  if (!url) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "paid_slack_skipped",
      payload: { reason: "webhook_not_configured" },
      actor: "integracion",
    });
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      await db.insert(caseEvents).values({
        caseId: row.id,
        type: "paid_slack_failed",
        payload: { error: `n8n_webhook_http_${res.status}:${body}` },
        actor: "integracion",
      });
      return;
    }
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "paid_slack_sent",
      payload: { inviteeName },
      actor: "integracion",
    });
  } catch (e) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "paid_slack_failed",
      payload: {
        error: e instanceof Error ? e.message : "n8n_webhook_failed",
      },
      actor: "integracion",
    });
  }
}

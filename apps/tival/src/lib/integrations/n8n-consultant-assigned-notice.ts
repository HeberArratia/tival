/**
 * Aviso Slack (vía n8n) cuando se asigna un consultor.
 * Incluye <@U…> para que Slack notifique al consultor.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, companies, contacts, type CaseRow } from "@/db/schema";
import { appBaseUrl } from "@/lib/integrations/runtime-env";
import { memberById } from "@/lib/members-catalog";

/** Email del member (seed) → Slack member ID. */
const CONSULTANT_SLACK_USER_IDS: Record<string, string> = {
  "nico@jarascript.cl": "U08BNTXFVAP",
  "marcelo@alfondo.cl": "U09FD1E2WDQ",
  "cristian@alfondo.cl": "U09MS2MAFDL",
  "aylin@alfondo.cl": "U08BNQG2RGF",
  "walter@alfondo.cl": "U0B8K8E3JHL",
};

const TIMEZONE = "America/Santiago";

function consultantSlackWebhookUrl(): string | null {
  const raw = process.env.N8N_CONSULTANT_SLACK_WEBHOOK_URL?.trim();
  return raw || null;
}

function slackUserIdForEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return CONSULTANT_SLACK_USER_IDS[email.trim().toLowerCase()] ?? null;
}

function formatScheduled(at: Date | null): string | null {
  if (!at) return null;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: TIMEZONE,
  }).format(at);
}

function buildText(input: {
  inviteeName: string;
  inviteeEmail: string | null;
  companyName: string | null;
  scheduledLabel: string | null;
  consultantName: string;
  consultantMention: string;
  caseUrl: string;
}): string {
  const who = input.companyName
    ? `*${input.inviteeName}* · ${input.companyName}`
    : `*${input.inviteeName}*`;
  const lines = [
    ":bust_in_silhouette: *Consultor asignado*",
    who,
    input.inviteeEmail,
    input.scheduledLabel ? `Reunión: ${input.scheduledLabel}` : null,
    `Consultor: ${input.consultantMention} (${input.consultantName})`,
    input.caseUrl,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Best-effort: no bloquea la asignación. No-op si falta la env. */
export async function notifyConsultantAssigned(input: {
  row: CaseRow;
  consultantId: string;
}): Promise<void> {
  const { row } = input;
  const db = await getDb();
  const consultant = memberById(input.consultantId);
  if (!consultant) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "consultant_slack_skipped",
      payload: { reason: "consultant_not_found", consultantId: input.consultantId },
      actor: "integracion",
    });
    return;
  }

  const slackId = slackUserIdForEmail(consultant.email);
  const consultantMention = slackId
    ? `<@${slackId}>`
    : consultant.name;

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

  const text = buildText({
    inviteeName,
    inviteeEmail,
    companyName,
    scheduledLabel: formatScheduled(row.scheduledAt),
    consultantName: consultant.name,
    consultantMention,
    caseUrl: `${appBaseUrl()}/oportunidades/${row.id}`,
  });

  const url = consultantSlackWebhookUrl();
  if (!url) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "consultant_slack_skipped",
      payload: {
        reason: "webhook_not_configured",
        consultantId: input.consultantId,
        slackMention: Boolean(slackId),
      },
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
        type: "consultant_slack_failed",
        payload: {
          error: `n8n_webhook_http_${res.status}:${body}`,
          consultantId: input.consultantId,
        },
        actor: "integracion",
      });
      return;
    }
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "consultant_slack_sent",
      payload: {
        consultantId: input.consultantId,
        consultantName: consultant.name,
        slackUserId: slackId,
        inviteeName,
      },
      actor: "integracion",
    });
  } catch (e) {
    await db.insert(caseEvents).values({
      caseId: row.id,
      type: "consultant_slack_failed",
      payload: {
        error: e instanceof Error ? e.message : "n8n_webhook_failed",
        consultantId: input.consultantId,
      },
      actor: "integracion",
    });
  }
}

/** Fire-and-forget tras assignConsultant. */
export function scheduleNotifyConsultantAssigned(input: {
  row: CaseRow;
  consultantId: string;
}) {
  void notifyConsultantAssigned(input).catch((err) => {
    console.error(
      "[consultant-slack]",
      input.row.id,
      err instanceof Error ? err.message : err
    );
  });
}

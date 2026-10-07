/**
 * Dispara el workflow n8n de propuesta (webhook) cuando post-meet mueve Notas.
 * La redacción Gemini / Gmail / Slack vive en n8n; Tival solo envía contexto del case.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, cases, contacts } from "@/db/schema";
import { appBaseUrl } from "@/lib/integrations/runtime-env";
import { memberById } from "@/lib/members-catalog";

export type N8nProposalPayload = {
  caseId: string;
  inviteeName: string;
  inviteeEmail: string | null;
  driveFolderId: string;
  notesFileId: string;
  consultantName: string | null;
  consultantEmail: string | null;
  caseUrl: string;
};

export type TriggerN8nProposalResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: "webhook_not_configured" }
  | { ok: false; error: string };

function proposalWebhookUrl(): string | null {
  const raw = process.env.N8N_PROPOSAL_WEBHOOK_URL?.trim();
  return raw || null;
}

function proposalWebhookSecret(): string | null {
  const raw = process.env.N8N_PROPOSAL_WEBHOOK_SECRET?.trim();
  return raw || null;
}

/** Arma el payload desde el case + fileId de notas recién movido. */
export async function buildN8nProposalPayload(input: {
  caseId: string;
  notesFileId: string;
}): Promise<N8nProposalPayload | { error: string }> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: cases.id,
      driveFolderId: cases.driveFolderId,
      assignedConsultantId: cases.assignedConsultantId,
      contactId: cases.contactId,
    })
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!row) return { error: "case_not_found" };
  if (!row.driveFolderId) return { error: "missing_drive_folder" };

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

  const consultant = memberById(row.assignedConsultantId);
  const caseUrl = `${appBaseUrl()}/oportunidades/${row.id}`;

  return {
    caseId: row.id,
    inviteeName,
    inviteeEmail,
    driveFolderId: row.driveFolderId,
    notesFileId: input.notesFileId,
    consultantName: consultant?.name ?? null,
    consultantEmail: consultant?.email ?? null,
    caseUrl,
  };
}

/** fileId de Notas ya movidas a la carpeta del case. */
export function notesFileIdFromQualification(
  qualification: Record<string, unknown> | null | undefined
): string | null {
  const raw = qualification?.post_meet;
  if (!raw || typeof raw !== "object") return null;
  const moved = (raw as { moved?: unknown }).moved;
  if (!Array.isArray(moved)) return null;
  const notes = moved.find(
    (m) =>
      m &&
      typeof m === "object" &&
      (m as { kind?: string }).kind === "notes" &&
      typeof (m as { fileId?: string }).fileId === "string"
  ) as { fileId: string } | undefined;
  return notes?.fileId ?? null;
}

/** Reintento manual (botón en la opp). Requiere notas movidas + consultor con email. */
export async function retryN8nProposal(
  caseId: string
): Promise<TriggerN8nProposalResult | { ok: false; error: string }> {
  const db = await getDb();
  const [row] = await db
    .select({ qualification: cases.qualification })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row) return { ok: false, error: "case_not_found" };

  const notesFileId = notesFileIdFromQualification(
    (row.qualification ?? {}) as Record<string, unknown>
  );
  if (!notesFileId) return { ok: false, error: "notes_not_ready" };

  const built = await buildN8nProposalPayload({ caseId, notesFileId });
  if ("error" in built) return { ok: false, error: built.error };
  if (!built.consultantEmail) {
    return { ok: false, error: "missing_consultant" };
  }
  return triggerN8nProposalDraft(built);
}

/**
 * POST al webhook n8n. No-op si falta `N8N_PROPOSAL_WEBHOOK_URL`.
 * Errores se registran en case_events; no tiran la recolección post-meet.
 */
export async function triggerN8nProposalDraft(
  payload: N8nProposalPayload
): Promise<TriggerN8nProposalResult> {
  const url = proposalWebhookUrl();
  if (!url) {
    return { ok: true, skipped: true, reason: "webhook_not_configured" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = proposalWebhookSecret();
  if (secret) headers["X-Tival-Secret"] = secret;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      return {
        ok: false,
        error: `n8n_webhook_http_${res.status}:${body}`,
      };
    }

    const db = await getDb();
    await db.insert(caseEvents).values({
      caseId: payload.caseId,
      type: "proposal_n8n_triggered",
      payload: {
        notesFileId: payload.notesFileId,
        consultantEmail: payload.consultantEmail,
        inviteeName: payload.inviteeName,
      },
      actor: "integracion",
    });

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "n8n_webhook_failed",
    };
  }
}

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  caseEvents,
  cases,
  contacts,
  playbookStages,
  playbooks,
  workspaces,
  type CaseRow,
  type CaseStatus,
  type CompanyRow,
  type ContactRow,
} from "@/db/schema";
import {
  FAKE_CASES,
  FAKE_PLAYBOOK,
  FAKE_PLAYBOOKS,
  FAKE_STAGES,
  FAKE_WORKSPACE,
  fakeEventsFor,
  isFakeDataEnabled,
  playbookMetaById,
} from "@/lib/fake-data";
import { isChileRegion, type ChileRegion } from "@/lib/chile-regions";
import { isClosingScore, type ClosingScore } from "@/lib/closing-scores";
import {
  getCompanyById,
  isContactLinkedToCompany,
  linkContactCompany,
  loadIdentityMaps,
  normalizeEmail,
  resolveCompany,
  resolveContact,
  unlinkContactCompany,
  updateCompanyFields,
} from "@/lib/identity";
import {
  buildAwaitingRescheduleState,
  clearAwaitingReschedule,
  isAwaitingRescheduleActive,
  withAwaitingReschedule,
} from "@/lib/awaiting-reschedule";
import { isLostReason, type LostReason } from "@/lib/lost-reasons";
import {
  ensureMemberIsConsultor,
  isMemberId,
  memberById,
} from "@/lib/members";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const TIMEZONE = "America/Santiago";

export type CaseWithIdentity = CaseRow & {
  contact: ContactRow | null;
  company: CompanyRow | null;
};

export function caseTitle(c: Pick<CaseWithIdentity, "contact" | "company">) {
  return c.company?.name || c.contact?.name || "Sin nombre";
}

export function caseContactLabel(
  c: Pick<CaseWithIdentity, "contact" | "company">
) {
  return c.contact?.name || c.company?.name || "Sin nombre";
}

export type ScheduleCaseInput = {
  calendlyEventUuid: string;
  calendlyEventUri?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  companyName?: string | null;
  companyRut?: string | null;
  scheduledAt?: Date | null;
  meetUrl?: string | null;
  calendlyRoute?: string | null;
  qualification?: Record<string, unknown> | null;
  landingSource?: string | null;
  qualificationLogId?: string | null;
  workspaceSlug?: string;
  workspaceId?: string;
};

async function resolveIdentityForIngest(
  workspaceId: string,
  input: Pick<
    ScheduleCaseInput,
    | "contactName"
    | "contactEmail"
    | "contactPhone"
    | "companyName"
    | "companyRut"
    | "qualification"
  >
) {
  const q = (input.qualification ?? {}) as Record<string, unknown>;
  /** RUT facturación de la opp → también seed de empresa primaria si existe. */
  const rutFromQ =
    (typeof q.rut_facturacion === "string" ? q.rut_facturacion : null) ??
    input.companyRut;

  const contact = await resolveContact({
    workspaceId,
    email: input.contactEmail,
    name: input.contactName,
    phone: input.contactPhone,
    phoneSource: "calendly",
  });

  const company = await resolveCompany({
    workspaceId,
    rut: rutFromQ,
    name: input.companyName,
  });

  if (company) {
    await linkContactCompany(contact.id, company.id);
  }

  return { contactId: contact.id, companyId: company?.id ?? null };
}

export async function enrichCases(rows: CaseRow[]): Promise<CaseWithIdentity[]> {
  const maps = await loadIdentityMaps({
    contactIds: rows.map((r) => r.contactId).filter(Boolean) as string[],
    companyIds: rows.map((r) => r.companyId).filter(Boolean) as string[],
  });
  return rows.map((r) => ({
    ...r,
    contact: r.contactId ? maps.contactsById.get(r.contactId) ?? null : null,
    company: r.companyId ? maps.companiesById.get(r.companyId) ?? null : null,
  }));
}

export async function enrichCase(row: CaseRow): Promise<CaseWithIdentity> {
  const [enriched] = await enrichCases([row]);
  return enriched;
}

async function getActivePlaybook(workspaceSlug = defaultWorkspaceSlug()) {
  if (isFakeDataEnabled()) {
    return {
      workspace: FAKE_WORKSPACE,
      playbook: FAKE_PLAYBOOK,
      stages: FAKE_STAGES,
    };
  }

  const db = await getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceSlug}`);

  const [playbook] = await db
    .select()
    .from(playbooks)
    .where(
      and(eq(playbooks.workspaceId, workspace.id), eq(playbooks.isActive, true))
    )
    .limit(1);
  if (!playbook) throw new Error(`Active playbook not found for ${workspaceSlug}`);

  const stages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id))
    .orderBy(playbookStages.sortOrder);

  return { workspace, playbook, stages };
}

async function resolvePlaybookContext(input: {
  workspaceSlug?: string;
  workspaceId?: string;
}) {
  // Webhooks / integraciones siempre resuelven contra DB real.
  if (input.workspaceId) {
    const db = await getDb();
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);
    if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);

    const [playbook] = await db
      .select()
      .from(playbooks)
      .where(
        and(
          eq(playbooks.workspaceId, workspace.id),
          eq(playbooks.isActive, true)
        )
      )
      .limit(1);
    if (!playbook) {
      throw new Error(`Active playbook not found for ${workspace.slug}`);
    }
    const stages = await db
      .select()
      .from(playbookStages)
      .where(eq(playbookStages.playbookId, playbook.id))
      .orderBy(playbookStages.sortOrder);
    return { workspace, playbook, stages };
  }
  return getActivePlaybook(input.workspaceSlug ?? defaultWorkspaceSlug());
}

function stageByKey(
  stages: Awaited<ReturnType<typeof getActivePlaybook>>["stages"],
  key: string
) {
  const stage = stages.find((s) => s.key === key);
  if (!stage) throw new Error(`Stage not found: ${key}`);
  return stage;
}

async function appendEvent(
  caseId: string,
  type: string,
  payload: Record<string, unknown> = {},
  actor = "sistema"
) {
  const db = await getDb();
  await db.insert(caseEvents).values({ caseId, type, payload, actor });
}

export async function scheduleCase(input: ScheduleCaseInput): Promise<CaseRow> {
  const db = await getDb();
  const { workspace, playbook, stages } = await resolvePlaybookContext({
    workspaceSlug: input.workspaceSlug,
    workspaceId: input.workspaceId,
  });
  const leadStage = stageByKey(stages, "lead");

  const existing = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.workspaceId, workspace.id),
        eq(cases.calendlyEventUuid, input.calendlyEventUuid)
      )
    )
    .limit(1);

  const identity = await resolveIdentityForIngest(workspace.id, input);

  if (existing[0]) {
    const [updated] = await db
      .update(cases)
      .set({
        contactId: identity.contactId,
        companyId: identity.companyId ?? existing[0].companyId,
        calendlyEventUri: input.calendlyEventUri ?? existing[0].calendlyEventUri,
        scheduledAt: input.scheduledAt ?? existing[0].scheduledAt,
        meetUrl: input.meetUrl ?? existing[0].meetUrl,
        calendlyRoute: input.calendlyRoute ?? existing[0].calendlyRoute,
        qualification: input.qualification ?? existing[0].qualification,
        landingSource: input.landingSource ?? existing[0].landingSource,
        qualificationLogId:
          input.qualificationLogId ?? existing[0].qualificationLogId,
        updatedAt: new Date(),
      })
      .where(eq(cases.id, existing[0].id))
      .returning();

    await appendEvent(updated.id, "calendly_scheduled", {
      calendlyEventUuid: input.calendlyEventUuid,
      upsert: true,
    });
    return updated;
  }

  const [created] = await db
    .insert(cases)
    .values({
      workspaceId: workspace.id,
      playbookId: playbook.id,
      currentStageId: leadStage.id,
      status: "open",
      contactId: identity.contactId,
      companyId: identity.companyId,
      calendlyEventUuid: input.calendlyEventUuid,
      calendlyEventUri: input.calendlyEventUri,
      calendlyRoute: input.calendlyRoute,
      scheduledAt: input.scheduledAt,
      meetUrl: input.meetUrl,
      qualification: input.qualification ?? undefined,
      landingSource: input.landingSource,
      qualificationLogId: input.qualificationLogId,
      paymentStatus: "none",
    })
    .returning();

  await appendEvent(created.id, "calendly_scheduled", {
    calendlyEventUuid: input.calendlyEventUuid,
  });

  return created;
}

export async function rescheduleCase(input: {
  previousCalendlyEventUuid: string;
  newCalendlyEventUuid: string;
  calendlyEventUri?: string | null;
  scheduledAt?: Date | null;
  meetUrl?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  /** URLs Calendly del invitee nuevo (no pisa el resto de qualification). */
  rescheduleUrl?: string | null;
  cancelUrl?: string | null;
  workspaceId?: string;
  workspaceSlug?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const { workspace } = await resolvePlaybookContext({
    workspaceId: input.workspaceId,
    workspaceSlug: input.workspaceSlug,
  });

  const [current] = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.workspaceId, workspace.id),
        eq(cases.calendlyEventUuid, input.previousCalendlyEventUuid)
      )
    )
    .limit(1);

  if (!current) {
    return scheduleCase({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      calendlyEventUuid: input.newCalendlyEventUuid,
      calendlyEventUri: input.calendlyEventUri,
      scheduledAt: input.scheduledAt,
      meetUrl: input.meetUrl,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
    });
  }

  let contactId = current.contactId;
  if (input.contactEmail || input.contactName) {
    const contact = await resolveContact({
      workspaceId: workspace.id,
      email: input.contactEmail,
      name: input.contactName,
      phoneSource: "calendly",
    });
    contactId = contact.id;
  }

  const q = { ...(current.qualification ?? {}) } as Record<string, unknown>;
  if (input.rescheduleUrl) q.reschedule_url = input.rescheduleUrl;
  if (input.cancelUrl) q.cancel_url = input.cancelUrl;
  delete q.awaiting_reschedule;

  const [updated] = await db
    .update(cases)
    .set({
      status: "open",
      calendlyEventUuid: input.newCalendlyEventUuid,
      calendlyEventUri: input.calendlyEventUri ?? current.calendlyEventUri,
      scheduledAt: input.scheduledAt ?? current.scheduledAt,
      meetUrl: input.meetUrl ?? current.meetUrl,
      /** Se refrescan en enrichment Meet post-reschedule. */
      meetCode: null,
      googleCalendarEventId: null,
      contactId,
      qualification: q,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(updated.id, "calendly_rescheduled", {
    previousCalendlyEventUuid: input.previousCalendlyEventUuid,
    newCalendlyEventUuid: input.newCalendlyEventUuid,
  });

  return updated;
}

/**
 * Post no-show: merge de un invitee.created nuevo al case existente.
 * Solo agenda (UUID/fecha/Meet/URLs). No pisa RUT ni qualification de negocio.
 */
export async function mergeScheduleIntoCase(input: {
  caseId: string;
  calendlyEventUuid: string;
  calendlyEventUri?: string | null;
  scheduledAt?: Date | null;
  meetUrl?: string | null;
  rescheduleUrl?: string | null;
  cancelUrl?: string | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const q = clearAwaitingReschedule(current.qualification);
  if (input.rescheduleUrl) q.reschedule_url = input.rescheduleUrl;
  if (input.cancelUrl) q.cancel_url = input.cancelUrl;

  const previousUuid = current.calendlyEventUuid;

  const [updated] = await db
    .update(cases)
    .set({
      status: "open",
      calendlyEventUuid: input.calendlyEventUuid,
      calendlyEventUri: input.calendlyEventUri ?? current.calendlyEventUri,
      scheduledAt: input.scheduledAt ?? current.scheduledAt,
      meetUrl: input.meetUrl ?? current.meetUrl,
      meetCode: null,
      googleCalendarEventId: null,
      qualification: q,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "calendly_rescheduled",
    {
      previousCalendlyEventUuid: previousUuid,
      newCalendlyEventUuid: input.calendlyEventUuid,
      merge: "awaiting_reschedule",
    },
    input.actor ?? "calendly"
  );

  return updated;
}

/** Busca case vivo esperando reagenda (utm caseId o email + flag). */
export async function findCaseAwaitingReschedule(input: {
  workspaceId: string;
  caseId?: string | null;
  email?: string | null;
}): Promise<CaseRow | null> {
  const db = await getDb();

  if (input.caseId) {
    const [byId] = await db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.id, input.caseId),
          eq(cases.workspaceId, input.workspaceId)
        )
      )
      .limit(1);
    if (byId && isAwaitingRescheduleActive(byId.qualification)) {
      return byId;
    }
  }

  const email = normalizeEmail(input.email);
  if (!email) return null;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.email, email))
    )
    .limit(1);
  if (!contact) return null;

  const rows = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.workspaceId, input.workspaceId),
        eq(cases.contactId, contact.id)
      )
    )
    .orderBy(desc(cases.updatedAt));

  const candidates = rows.filter((r) =>
    isAwaitingRescheduleActive(r.qualification)
  );
  if (candidates.length === 1) return candidates[0]!;
  return null;
}

export async function cancelCase(input: {
  caseId?: string;
  calendlyEventUuid?: string;
  workspaceId?: string;
  reason: string;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = input.caseId
    ? await db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1)
    : await db
        .select()
        .from(cases)
        .where(
          input.workspaceId
            ? and(
                eq(cases.workspaceId, input.workspaceId),
                eq(cases.calendlyEventUuid, input.calendlyEventUuid!)
              )
            : eq(cases.calendlyEventUuid, input.calendlyEventUuid!)
        )
        .limit(1);

  if (!current) throw new Error("Case not found");
  if (current.status === "cancelled") return current;

  const actor = input.actor ?? "sistema";
  const fromOps = actor !== "calendly" && actor !== "sistema";

  // Ya en Perdido (p.ej. no_pago canceló Meet vía Calendly → webhook).
  // No pisar etapa terminal ni lost_reason con status cancelled.
  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const perdidoStage = stages.find((s) => s.key === "perdido");
  const ganadoStage = stages.find((s) => s.key === "ganado");
  if (
    (perdidoStage && current.currentStageId === perdidoStage.id) ||
    (ganadoStage && current.currentStageId === ganadoStage.id)
  ) {
    await appendEvent(
      current.id,
      fromOps ? "ops_cancelled" : "calendly_canceled",
      {
        reason: input.reason,
        ignored: true,
        because: "already_terminal_stage",
        stageId: current.currentStageId,
        lostReason: current.lostReason,
      },
      actor
    );
    return current;
  }

  const [updated] = await db
    .update(cases)
    .set({
      status: "cancelled",
      cancelReason: input.reason,
      qualification: clearAwaitingReschedule(current.qualification),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    fromOps ? "ops_cancelled" : "calendly_canceled",
    { reason: input.reason },
    actor
  );

  return updated;
}

export async function markPaymentPending(input: {
  caseId?: string;
  calendlyEventUuid?: string;
  method: "mercadopago" | "transferencia";
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = input.caseId
    ? await db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1)
    : await db
        .select()
        .from(cases)
        .where(eq(cases.calendlyEventUuid, input.calendlyEventUuid!))
        .limit(1);

  if (!current) throw new Error("Case not found");
  if (current.paymentStatus === "paid") return current;

  // Checkout pendiente: sigue en lead hasta que el pago confirme → pagado
  const [updated] = await db
    .update(cases)
    .set({
      paymentMethod: input.method,
      paymentStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(updated.id, "checkout_started", { method: input.method });
  return updated;
}

export async function markPaid(input: {
  caseId?: string;
  calendlyEventUuid?: string;
  method: "mercadopago" | "transferencia";
  mpPaymentId?: string | null;
  confirmedBy: string;
}): Promise<{ case: CaseRow; alreadyPaid: boolean }> {
  const db = await getDb();
  const [current] = input.caseId
    ? await db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1)
    : await db
        .select()
        .from(cases)
        .where(eq(cases.calendlyEventUuid, input.calendlyEventUuid!))
        .limit(1);

  if (!current) throw new Error("Case not found");

  if (current.paymentStatus === "paid") {
    return { case: current, alreadyPaid: true };
  }

  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const pagadoStage = stages.find((s) => s.key === "pagado");

  const [updated] = await db
    .update(cases)
    .set({
      paymentMethod: input.method,
      paymentStatus: "paid",
      mpPaymentId: input.mpPaymentId ?? current.mpPaymentId,
      paidAt: new Date(),
      paymentConfirmedBy: input.confirmedBy,
      currentStageId: pagadoStage?.id ?? current.currentStageId,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    input.method === "transferencia"
      ? "transfer_confirmed"
      : "payment_approved",
    {
      method: input.method,
      mpPaymentId: input.mpPaymentId,
      confirmedBy: input.confirmedBy,
    },
    input.confirmedBy
  );

  // Efecto drive-folder (pagado): no bloquea el pago si Drive falla.
  const { ensureDriveFolderForCase } = await import(
    "@/lib/integrations/google-drive/ensure-folder"
  );
  const drive = await ensureDriveFolderForCase(updated);
  if (drive.ok && drive.created) {
    await appendEvent(
      drive.case.id,
      "drive_folder_created",
      {
        driveFolderId: drive.case.driveFolderId,
        driveFolderKey: drive.case.driveFolderKey,
      },
      "integracion"
    );
  } else if (!drive.ok && !drive.skipped) {
    await appendEvent(
      updated.id,
      "drive_folder_failed",
      { error: drive.error },
      "integracion"
    );
  }

  const paidCase = drive.ok ? drive.case : updated;
  try {
    const { notifyDiagnosticoPagado } = await import(
      "@/lib/integrations/n8n-paid-notice"
    );
    await notifyDiagnosticoPagado(paidCase);
  } catch (e) {
    console.error("[paid-slack]", e);
  }

  return { case: paidCase, alreadyPaid: false };
}

export async function markNoShow(caseId: string, actor = "ops") {
  const db = await getDb();
  const [updated] = await db
    .update(cases)
    .set({ status: "no_show", updatedAt: new Date() })
    .where(eq(cases.id, caseId))
    .returning();
  if (!updated) throw new Error("Case not found");
  await appendEvent(updated.id, "no_show_marked", {}, actor);
  return updated;
}

/**
 * No llegó · reagendar: status no_show + flag awaiting_reschedule (TTL).
 * La etapa (lead/pagado) no cambia.
 */
export async function markNoShowAwaitingReschedule(
  caseId: string,
  actor = "ops"
): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const awaiting = buildAwaitingRescheduleState();
  const qualification = withAwaitingReschedule(current.qualification, awaiting);

  const [updated] = await db
    .update(cases)
    .set({
      status: "no_show",
      qualification,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, caseId))
    .returning();

  await appendEvent(
    updated.id,
    "no_show_awaiting_reschedule",
    { until: awaiting.until, startedAt: awaiting.startedAt },
    actor
  );
  return updated;
}

/** Terminal: etapa Perdido + lost_reason. Status open (cierre = etapa). */
export async function markLost(input: {
  caseId: string;
  reason?: LostReason | string;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const perdidoStage = stages.find((s) => s.key === "perdido");
  if (!perdidoStage) throw new Error("Stage perdido not found");

  if (current.currentStageId === perdidoStage.id) return current;

  const reason: LostReason = isLostReason(input.reason)
    ? input.reason
    : "no_pago";
  const actor = input.actor ?? "ops";

  const [updated] = await db
    .update(cases)
    .set({
      status: "open",
      currentStageId: perdidoStage.id,
      lostReason: reason,
      qualification: clearAwaitingReschedule(current.qualification),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "marked_lost",
    { reason, fromStageId: current.currentStageId },
    actor
  );

  // No pagó (típicamente Lead entrante): cancelar reunión Calendar/Meet.
  // Await (no setTimeout): en serverless el fire-and-forget se corta al responder.
  if (reason === "no_pago") {
    try {
      const { cancelCaseMeetingAndLog } = await import(
        "@/lib/integrations/cancel-case-meeting"
      );
      await cancelCaseMeetingAndLog({
        caseId: updated.id,
        actor,
      });
    } catch (err) {
      console.error(
        "[markLost.cancelMeeting]",
        updated.id,
        err instanceof Error ? err.message : err
      );
    }
  }

  return updated;
}

/** Diagnóstico pagado → Diagnóstico realizado. Score/región/producto opcionales. */
export async function markDiagnosticoRealizado(input: {
  caseId: string;
  actor?: string;
  closingScore?: ClosingScore | null;
  region?: ChileRegion | null;
  productKeys?: string[] | null;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  if (["cancelled", "no_show", "rescheduled_away"].includes(current.status)) {
    throw new Error("Case is closed");
  }

  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const pagadoStage = stages.find((s) => s.key === "pagado");
  const realizadoStage = stages.find((s) => s.key === "realizado");
  if (!realizadoStage) throw new Error("Stage realizado not found");

  if (current.currentStageId === realizadoStage.id) return current;

  if (pagadoStage && current.currentStageId !== pagadoStage.id) {
    throw new Error("Case must be in pagado stage");
  }

  const actor = input.actor ?? "ops";
  const score =
    input.closingScore && isClosingScore(input.closingScore)
      ? input.closingScore
      : null;
  const region =
    input.region && isChileRegion(input.region) ? input.region : null;
  const productKeys = Array.isArray(input.productKeys)
    ? [
        ...new Set(
          input.productKeys
            .filter((k): k is string => typeof k === "string" && !!k.trim())
            .map((k) => k.trim())
        ),
      ]
    : null;

  const qPatch: Record<string, unknown> = {};
  if (score) qPatch.closing_score = score;
  if (region) qPatch.region = region;
  if (productKeys && productKeys.length > 0) {
    qPatch.productos = productKeys;
  }

  let nextQualification: Record<string, unknown> | undefined;
  if (Object.keys(qPatch).length > 0) {
    nextQualification = {
      ...((current.qualification ?? {}) as Record<string, unknown>),
      ...qPatch,
    };
    delete nextQualification.producto;
  }

  const [updated] = await db
    .update(cases)
    .set({
      currentStageId: realizadoStage.id,
      ...(nextQualification ? { qualification: nextQualification } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "diagnostico_realizado",
    {
      fromStageId: current.currentStageId,
      ...(score ? { closingScore: score } : {}),
      ...(region ? { region } : {}),
      ...(productKeys && productKeys.length ? { productKeys } : {}),
    },
    actor
  );
  return updated;
}

/** Diagnóstico realizado → Propuesta enviada. */
export async function markPropuestaEnviada(input: {
  caseId: string;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  if (["cancelled", "no_show", "rescheduled_away"].includes(current.status)) {
    throw new Error("Case is closed");
  }

  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const realizadoStage = stages.find((s) => s.key === "realizado");
  const propuestaStage = stages.find((s) => s.key === "propuesta_enviada");
  if (!propuestaStage) throw new Error("Stage propuesta_enviada not found");

  if (current.currentStageId === propuestaStage.id) return current;

  if (realizadoStage && current.currentStageId !== realizadoStage.id) {
    throw new Error("Case must be in realizado stage");
  }

  const actor = input.actor ?? "ops";
  const [updated] = await db
    .update(cases)
    .set({
      currentStageId: propuestaStage.id,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "propuesta_enviada",
    { fromStageId: current.currentStageId },
    actor
  );
  return updated;
}

/** Actualiza closing score sin cambiar etapa (opcional, en cualquier momento). */
export async function setClosingScore(input: {
  caseId: string;
  closingScore: ClosingScore | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const score =
    input.closingScore && isClosingScore(input.closingScore)
      ? input.closingScore
      : null;

  const q = {
    ...((current.qualification ?? {}) as Record<string, unknown>),
  };
  if (score) q.closing_score = score;
  else delete q.closing_score;

  const [updated] = await db
    .update(cases)
    .set({
      qualification: q,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "closing_score_set",
    { closingScore: score },
    input.actor ?? "ops"
  );
  return updated;
}

/** Actualiza región de la oportunidad (qualification), no de la empresa. */
export async function setRegion(input: {
  caseId: string;
  region: ChileRegion | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const region =
    input.region && isChileRegion(input.region) ? input.region : null;

  const q = {
    ...((current.qualification ?? {}) as Record<string, unknown>),
  };
  if (region) q.region = region;
  else delete q.region;

  const [updated] = await db
    .update(cases)
    .set({
      qualification: q,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "region_set",
    { region },
    input.actor ?? "ops"
  );
  return updated;
}

function withRutFacturacion(
  qualification: Record<string, unknown> | null | undefined,
  rut: string | null
) {
  const q = { ...((qualification ?? {}) as Record<string, unknown>) };
  if (rut) q.rut_facturacion = rut;
  else delete q.rut_facturacion;
  return q;
}

/** Empresa primaria de la opp. null = sin empresas. Sync rut_facturacion. */
export async function setPrimaryCompany(input: {
  caseId: string;
  companyId: string | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");
  if (!current.contactId) throw new Error("Case has no contact");

  let rut: string | null = null;
  if (input.companyId) {
    const linked = await isContactLinkedToCompany(
      current.contactId,
      input.companyId
    );
    if (!linked) throw new Error("Company not linked to contact");
    const company = await getCompanyById(input.companyId);
    if (!company) throw new Error("Company not found");
    rut = company.rut;
  }

  const [updated] = await db
    .update(cases)
    .set({
      companyId: input.companyId,
      qualification: withRutFacturacion(current.qualification, rut),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "company_primary_set",
    { companyId: input.companyId, rut },
    input.actor ?? "ops"
  );
  return updated;
}

/** Crea/resuelve empresa por RUT, liga al contacto y la deja primaria. */
export async function addCompanyToCase(input: {
  caseId: string;
  rut: string;
  name?: string | null;
  actor?: string;
}): Promise<{ case: CaseRow; company: CompanyRow }> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");
  if (!current.contactId) throw new Error("Case has no contact");

  const company = await resolveCompany({
    workspaceId: current.workspaceId,
    rut: input.rut,
    name: input.name,
  });
  if (!company) throw new Error("RUT required");

  await linkContactCompany(current.contactId, company.id);

  const [updated] = await db
    .update(cases)
    .set({
      companyId: company.id,
      qualification: withRutFacturacion(
        current.qualification,
        company.rut
      ),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "company_added",
    { companyId: company.id, rut: company.rut, name: company.name },
    input.actor ?? "ops"
  );
  return { case: updated, company };
}

/** Edita campos Bigin de una empresa ligada al contacto de la opp. */
export async function updateCaseCompany(input: {
  caseId: string;
  companyId: string;
  patch: Partial<{
    name: string | null;
    rut: string | null;
    societyType: string | null;
    antiquity: string | null;
    sales12m: string | null;
    giro: string | null;
  }>;
  actor?: string;
}): Promise<{ case: CaseRow; company: CompanyRow }> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");
  if (!current.contactId) throw new Error("Case has no contact");

  const linked = await isContactLinkedToCompany(
    current.contactId,
    input.companyId
  );
  if (!linked && current.companyId !== input.companyId) {
    throw new Error("Company not linked to contact");
  }

  const company = await updateCompanyFields(input.companyId, input.patch);

  let updated = current;
  if (current.companyId === company.id) {
    const [row] = await db
      .update(cases)
      .set({
        qualification: withRutFacturacion(
          current.qualification,
          company.rut
        ),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, current.id))
      .returning();
    updated = row;
  }

  await appendEvent(
    current.id,
    "company_updated",
    { companyId: company.id, patch: input.patch },
    input.actor ?? "ops"
  );
  return { case: updated, company };
}

/** Desliga empresa del contacto; si era primaria, limpia company_id. */
export async function unlinkCompanyFromCase(input: {
  caseId: string;
  companyId: string;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");
  if (!current.contactId) throw new Error("Case has no contact");

  await unlinkContactCompany(current.contactId, input.companyId);

  const wasPrimary = current.companyId === input.companyId;
  const [updated] = await db
    .update(cases)
    .set({
      companyId: wasPrimary ? null : current.companyId,
      qualification: wasPrimary
        ? withRutFacturacion(current.qualification, null)
        : current.qualification,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "company_unlinked",
    { companyId: input.companyId, clearedPrimary: wasPrimary },
    input.actor ?? "ops"
  );
  return updated;
}

/** Actualiza productos (keys del catálogo) sin cambiar etapa. */
export async function setProducts(input: {
  caseId: string;
  productKeys: string[];
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const productKeys = [
    ...new Set(
      (input.productKeys ?? [])
        .filter((k): k is string => typeof k === "string" && !!k.trim())
        .map((k) => k.trim())
    ),
  ];

  const q = {
    ...((current.qualification ?? {}) as Record<string, unknown>),
  };
  delete q.producto;
  if (productKeys.length > 0) q.productos = productKeys;
  else delete q.productos;

  const [updated] = await db
    .update(cases)
    .set({
      qualification: q,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "products_set",
    { productKeys },
    input.actor ?? "ops"
  );
  return updated;
}

/**
 * Asigna consultor solo en Diagnóstico pagado.
 * Bloqueado desde Diagnóstico realizado en adelante.
 */
export async function assignConsultant(input: {
  caseId: string;
  consultantId: string;
  actor?: string;
}): Promise<CaseRow> {
  if (!isMemberId(input.consultantId)) {
    throw new Error("Consultant not found");
  }
  const member = await ensureMemberIsConsultor(input.consultantId);

  if (isFakeDataEnabled()) {
    const row = FAKE_CASES.find((c) => c.id === input.caseId);
    if (!row) throw new Error("Case not found");
    const stage = FAKE_STAGES.find((s) => s.id === row.currentStageId);
    if (stage && stage.key !== "pagado") {
      throw new Error("Cannot assign consultant after diagnóstico realizado");
    }
    row.assignedConsultantId = input.consultantId;
    row.updatedAt = new Date();
    return row;
  }

  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const stage = stages.find((s) => s.id === current.currentStageId);
  if (stage && stage.key !== "pagado") {
    throw new Error("Cannot assign consultant after diagnóstico realizado");
  }

  const actor = input.actor ?? "ops";

  const [updated] = await db
    .update(cases)
    .set({
      assignedConsultantId: input.consultantId,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "consultant_assigned",
    {
      consultantId: input.consultantId,
      consultantName: member?.name ?? null,
      previousConsultantId: current.assignedConsultantId,
    },
    actor
  );

  // Calendar invite + Meet COHOST (best-effort; fuera del request HTTP).
  const grantCaseId = updated.id;
  const grantConsultantId = input.consultantId;
  const grantPrevious = current.assignedConsultantId;
  const grantActor = actor;
  setTimeout(() => {
    void import("@/lib/integrations/grant-consultant-meet-access")
      .then(({ scheduleGrantConsultantMeetAccess }) =>
        scheduleGrantConsultantMeetAccess({
          caseId: grantCaseId,
          consultantId: grantConsultantId,
          previousConsultantId: grantPrevious,
          actor: grantActor,
        })
      )
      .catch((err) => {
        console.error(
          "[assignConsultant.grant]",
          grantCaseId,
          err instanceof Error ? err.message : err
        );
      });
  }, 0);

  // Slack vía n8n (mención <@U…>); no bloquea la asignación.
  void import("@/lib/integrations/n8n-consultant-assigned-notice")
    .then(({ scheduleNotifyConsultantAssigned }) =>
      scheduleNotifyConsultantAssigned({
        row: updated,
        consultantId: input.consultantId,
      })
    )
    .catch((err) => {
      console.error(
        "[assignConsultant.slack]",
        updated.id,
        err instanceof Error ? err.message : err
      );
    });

  return updated;
}

/** Terminal: etapa Ganado. Status sigue open (cierre = etapa). */
export async function markWon(input: {
  caseId: string;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const { stages } = await resolvePlaybookContext({
    workspaceId: current.workspaceId,
  });
  const ganadoStage = stages.find((s) => s.key === "ganado");
  if (!ganadoStage) throw new Error("Stage ganado not found");

  if (current.currentStageId === ganadoStage.id) return current;

  const actor = input.actor ?? "ops";

  const [updated] = await db
    .update(cases)
    .set({
      currentStageId: ganadoStage.id,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "marked_won",
    { fromStageId: current.currentStageId },
    actor
  );
  return updated;
}

export async function listCases(filters?: {
  status?: CaseStatus | CaseStatus[];
}): Promise<CaseWithIdentity[]> {
  let rows: CaseRow[];
  if (isFakeDataEnabled()) {
    rows = [...FAKE_CASES].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
    if (filters?.status) {
      const statuses = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      rows = rows.filter((c) => statuses.includes(c.status));
    }
  } else {
    const db = await getDb();
    if (!filters?.status) {
      rows = await db.select().from(cases).orderBy(desc(cases.updatedAt));
    } else {
      const statuses = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      rows = await db
        .select()
        .from(cases)
        .where(inArray(cases.status, statuses))
        .orderBy(desc(cases.updatedAt));
    }
  }
  return enrichCases(rows);
}

export async function getCaseWithEvents(caseId: string) {
  if (isFakeDataEnabled()) {
    const row = FAKE_CASES.find((c) => c.id === caseId);
    if (!row) return null;
    return {
      case: await enrichCase(row),
      events: fakeEventsFor(caseId),
    };
  }

  const db = await getDb();
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) return null;
  const events = await db
    .select()
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(desc(caseEvents.createdAt));
  return { case: await enrichCase(row), events };
}

export async function getPlaybookBundle(workspaceSlug = defaultWorkspaceSlug()) {
  return getActivePlaybook(workspaceSlug);
}

/** Stages del playbook del caso (fake multi-proceso). */
export async function getStagesForCase(caseRow: CaseRow) {
  if (isFakeDataEnabled()) {
    return playbookMetaById(caseRow.playbookId).stages;
  }
  const bundle = await getActivePlaybook();
  return bundle.stages;
}

export async function listFakePlaybooks() {
  if (!isFakeDataEnabled()) return [];
  return FAKE_PLAYBOOKS;
}

export { playbookMetaById, playbookLabel } from "@/lib/fake-data";

export async function findCaseByCalendlyUuid(uuid: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(cases)
    .where(eq(cases.calendlyEventUuid, uuid))
    .limit(1);
  return row ?? null;
}

/** Persiste Meet real (o falla) tras enrichment Calendly → Calendar. */
export async function applyMeetEnrichment(
  input:
    | {
        caseId: string;
        meetUrl: string;
        meetCode: string;
        googleCalendarEventId: string;
        failed?: false;
      }
    | {
        caseId: string;
        failed: true;
        error: string;
        googleCalendarEventId?: string | null;
      }
): Promise<CaseRow | null> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) return null;

  if (input.failed) {
    await appendEvent(
      current.id,
      "meet_enrich_failed",
      {
        error: input.error,
        googleCalendarEventId: input.googleCalendarEventId ?? null,
      },
      "integracion"
    );
    return current;
  }

  const qualification = {
    ...(current.qualification ?? {}),
    meet_url: input.meetUrl,
  };

  const [updated] = await db
    .update(cases)
    .set({
      meetUrl: input.meetUrl,
      meetCode: input.meetCode,
      googleCalendarEventId: input.googleCalendarEventId,
      qualification,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "meet_enriched",
    {
      meetUrl: input.meetUrl,
      meetCode: input.meetCode,
      googleCalendarEventId: input.googleCalendarEventId,
    },
    "integracion"
  );

  // Post-meet collect (Inngest): requiere meetCode; carpeta puede llegar al pagar.
  void import("@/inngest/functions/post-meet-collect").then(({ schedulePostMeetCollect }) =>
    schedulePostMeetCollect(updated.id)
  );

  // Si ya había consultor asignado antes del enrichment, otorgar COHOST ahora.
  void import("@/lib/integrations/grant-consultant-meet-access").then(
    ({ scheduleGrantIfConsultantAssigned }) =>
      scheduleGrantIfConsultantAssigned(updated)
  );

  return updated;
}

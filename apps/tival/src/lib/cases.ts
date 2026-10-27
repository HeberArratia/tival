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
  initiativeForCase,
  isFakeDataEnabled,
  playbookMetaById,
} from "@/lib/fake-data";
import { isChileRegion, type ChileRegion } from "@/lib/chile-regions";
import {
  isClosingScore,
  LEGACY_CLOSING_NO_FIT,
  migrateLegacyClosingNoFit,
  type ClosingScore,
} from "@/lib/closing-scores";
import { isDealFit, type DealFit } from "@/lib/deal-fits";
import {
  diagnosticoCreditForSlug,
  importeClpFromQualification,
  materializeOpportunityPrices,
  toProductOption,
  type OpportunityProductLine,
} from "@/lib/products";
import { listProducts } from "@/lib/products-db";
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
import { normalizeLandingSource } from "@/lib/workspace/calendly-map";
import { normalizeSegmentCode } from "@/lib/segments";
import {
  defaultWorkspaceSlug,
  getWorkspacePack,
} from "@/lib/workspace/registry";

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

function activePlaybookSlug(workspaceSlug: string) {
  try {
    return getWorkspacePack(workspaceSlug).defaultPlaybookSlug;
  } catch {
    return "consultoria";
  }
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
      and(
        eq(playbooks.workspaceId, workspace.id),
        eq(playbooks.slug, activePlaybookSlug(workspace.slug)),
        eq(playbooks.isActive, true)
      )
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
          eq(playbooks.slug, activePlaybookSlug(workspace.slug)),
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
  /** Slot nuevo → el post-meet anterior (timeout/waiting) ya no aplica. */
  delete q.post_meet;

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

  // WhatsApp reagenda + reminder T-1h: post enrich-meet (reason=reschedule).
  // Post-meet se reencola en applyMeetEnrichment (event id por scheduledAt).
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
  /** Slot nuevo → el post-meet anterior (timeout/waiting) ya no aplica. */
  delete q.post_meet;

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

  // WhatsApp reagenda + reminder T-1h: post enrich-meet (reason=reschedule).
  // Post-meet se reencola en applyMeetEnrichment (event id por scheduledAt).
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

  // Duplicado ops (superseded): cancelar reunión Calendar/Meet de esta opp.
  // No corre en webhook Calendly (evitar loop). Sin WhatsApp de no_pago.
  if (fromOps && input.reason === "superseded") {
    try {
      const { cancelCaseMeetingAndLog } = await import(
        "@/lib/integrations/cancel-case-meeting"
      );
      await cancelCaseMeetingAndLog({
        caseId: updated.id,
        actor,
        reason: "Duplicado · quedó vigente otra oportunidad en Tival",
      });
    } catch (err) {
      console.error(
        "[cancelCase.cancelMeeting]",
        updated.id,
        err instanceof Error ? err.message : err
      );
    }
  }

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
  /** Default true (webhooks / integraciones). Ops UI puede pasar false. */
  notifyWhatsapp?: boolean;
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

  const shouldNotifyWhatsapp = input.notifyWhatsapp !== false;
  if (shouldNotifyWhatsapp) {
    try {
      const { notifyPaymentConfirmedWhatsapp } = await import(
        "@/lib/integrations/kapso-whatsapp"
      );
      await notifyPaymentConfirmedWhatsapp(paidCase);
    } catch (e) {
      console.error("[paid-whatsapp]", e);
    }
  }

  void import("@/inngest/functions/meeting-remind").then(
    ({ scheduleMeetingReminder }) => scheduleMeetingReminder(paidCase)
  );

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

async function pricedLinesForCase(
  current: CaseRow,
  lines: { key: string; priceClp: number | null }[]
): Promise<OpportunityProductLine[]> {
  const catalog = await listProducts({ activeOnly: false }).catch(() => []);
  const creditClp = diagnosticoCreditForSlug(initiativeForCase(current)?.slug);
  const importeClp = importeClpFromQualification(
    (current.qualification ?? null) as Record<string, unknown> | null
  );
  return materializeOpportunityPrices(lines, catalog.map(toProductOption), {
    creditClp,
    importeClp,
  });
}

/** Diagnóstico pagado → Diagnóstico realizado. Score/fit/región/producto opcionales. */
export async function markDiagnosticoRealizado(input: {
  caseId: string;
  actor?: string;
  closingScore?: ClosingScore | null;
  dealFit?: DealFit | null;
  region?: ChileRegion | null;
  /** Líneas con precio de esta oportunidad. Si falta el monto, se cotiza. */
  products?: { key: string; priceClp: number | null }[] | null;
  /** Segmento confirmado por el consultor (opcional). */
  segmento?: string | null;
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
  const dealFit =
    input.dealFit && isDealFit(input.dealFit) ? input.dealFit : null;
  const region =
    input.region && isChileRegion(input.region) ? input.region : null;
  const productLines = Array.isArray(input.products)
    ? await pricedLinesForCase(current, input.products)
    : null;
  const segmento = normalizeSegmentCode(input.segmento);

  const baseQ = migrateLegacyClosingNoFit({
    ...((current.qualification ?? {}) as Record<string, unknown>),
  });
  const qPatch: Record<string, unknown> = {};
  if (score) qPatch.closing_score = score;
  if (dealFit) qPatch.deal_fit = dealFit;
  if (region) qPatch.region = region;
  if (productLines && productLines.length > 0) {
    qPatch.productos = productLines;
  }
  if (segmento) qPatch.segmento_confirmado = segmento;

  const hadLegacy =
    (current.qualification as Record<string, unknown> | null)?.closing_score ===
    LEGACY_CLOSING_NO_FIT;
  let nextQualification: Record<string, unknown> | undefined;
  if (Object.keys(qPatch).length > 0 || hadLegacy) {
    nextQualification = { ...baseQ, ...qPatch };
    delete nextQualification.producto;
  }

  const [updated] = await db
    .update(cases)
    .set({
      currentStageId: realizadoStage.id,
      ...(segmento ? { segmento } : {}),
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
      ...(dealFit ? { dealFit } : {}),
      ...(region ? { region } : {}),
      ...(productLines && productLines.length ? { products: productLines } : {}),
      ...(segmento
        ? {
            segmento,
            segmentoSugerido:
              current.segmentoSugerido ??
              (typeof current.qualification?.segmento_sugerido === "string"
                ? current.qualification.segmento_sugerido
                : null),
          }
        : {}),
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

  try {
    const { notifyPropuestaEnviadaWhatsapp } = await import(
      "@/lib/integrations/kapso-whatsapp"
    );
    await notifyPropuestaEnviadaWhatsapp(updated);
  } catch (e) {
    console.error("[propuesta-whatsapp]", e);
  }

  return updated;
}

/** Actualiza temperatura comercial sin cambiar etapa (opcional, en cualquier momento). */
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

  const q = migrateLegacyClosingNoFit({
    ...((current.qualification ?? {}) as Record<string, unknown>),
  });
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

/** Actualiza calificación del deal sin cambiar etapa (opcional, en cualquier momento). */
export async function setDealFit(input: {
  caseId: string;
  dealFit: DealFit | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const fit =
    input.dealFit && isDealFit(input.dealFit) ? input.dealFit : null;

  const q = migrateLegacyClosingNoFit({
    ...((current.qualification ?? {}) as Record<string, unknown>),
  });
  if (fit) q.deal_fit = fit;
  else delete q.deal_fit;

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
    "deal_fit_set",
    { dealFit: fit },
    input.actor ?? "ops"
  );
  return updated;
}

/** Segmento definitivo del consultor (columna `segmento`). */
export async function setSegmento(input: {
  caseId: string;
  segmento: string | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const segmento = normalizeSegmentCode(input.segmento);
  const q = {
    ...((current.qualification ?? {}) as Record<string, unknown>),
  };
  if (segmento) q.segmento_confirmado = segmento;
  else delete q.segmento_confirmado;

  const [updated] = await db
    .update(cases)
    .set({
      segmento,
      qualification: q,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "segmento_set",
    {
      segmento,
      segmentoSugerido:
        current.segmentoSugerido ??
        (typeof current.qualification?.segmento_sugerido === "string"
          ? current.qualification.segmento_sugerido
          : null),
    },
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

/** Actualiza productos de la oportunidad (key + precio de ese deal) sin cambiar etapa. */
export async function setProducts(input: {
  caseId: string;
  lines: { key: string; priceClp: number | null }[];
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Case not found");

  const lines = await pricedLinesForCase(current, input.lines ?? []);

  const q = {
    ...((current.qualification ?? {}) as Record<string, unknown>),
  };
  delete q.producto;
  if (lines.length > 0) q.productos = lines;
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
    { products: lines },
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

  // Calendar invite (Inngest; inline si send disabled). COHOST Meet = best-effort.
  try {
    const { scheduleGrantConsultantMeetAccessJob } = await import(
      "@/inngest/functions/grant-consultant-meet-access"
    );
    await scheduleGrantConsultantMeetAccessJob({
      caseId: updated.id,
      consultantId: input.consultantId,
      previousConsultantId: current.assignedConsultantId,
      actor,
    });
  } catch (err) {
    console.error(
      "[assignConsultant.grant]",
      updated.id,
      err instanceof Error ? err.message : err
    );
  }

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

/** Pedido de pago por WhatsApp (efecto Moira) en Lead entrante. */
export type PaymentRequestStatus = "sent" | "failed" | "none";

const PAYMENT_REQUEST_EVENT_TYPES = [
  "whatsapp_payment_request_sent",
  "whatsapp_payment_request_failed",
] as const;

/**
 * Si el efecto de pedir pago por WhatsApp ya corrió.
 * `sent` gana si hubo al menos un envío ok, aunque después haya fallado un reintento.
 */
export async function paymentRequestStatusByCaseIds(
  caseIds: string[]
): Promise<Map<string, PaymentRequestStatus>> {
  const map = new Map<string, PaymentRequestStatus>();
  if (caseIds.length === 0) return map;

  if (isFakeDataEnabled()) {
    for (const id of caseIds) {
      const events = fakeEventsFor(id);
      const sent = events.some((e) => e.type === "whatsapp_payment_request_sent");
      const failed = events.some(
        (e) => e.type === "whatsapp_payment_request_failed"
      );
      map.set(id, sent ? "sent" : failed ? "failed" : "none");
    }
    return map;
  }

  const db = await getDb();
  const rows = await db
    .select({
      caseId: caseEvents.caseId,
      type: caseEvents.type,
    })
    .from(caseEvents)
    .where(
      and(
        inArray(caseEvents.caseId, caseIds),
        inArray(caseEvents.type, [...PAYMENT_REQUEST_EVENT_TYPES])
      )
    );

  const sent = new Set<string>();
  const failed = new Set<string>();
  for (const row of rows) {
    if (row.type === "whatsapp_payment_request_sent") sent.add(row.caseId);
    else if (row.type === "whatsapp_payment_request_failed") failed.add(row.caseId);
  }
  for (const id of caseIds) {
    map.set(id, sent.has(id) ? "sent" : failed.has(id) ? "failed" : "none");
  }
  return map;
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
    if (row) {
      return {
        case: await enrichCase(row),
        events: fakeEventsFor(caseId),
      };
    }
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

/** Todos los playbooks del workspace, con sus etapas. */
export async function listWorkspacePlaybooks(
  workspaceSlug = defaultWorkspaceSlug()
) {
  const db = await getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!workspace) return [];
  const rows = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.workspaceId, workspace.id))
    .orderBy(playbooks.name);
  const out = [];
  for (const playbook of rows) {
    const stages = await db
      .select()
      .from(playbookStages)
      .where(eq(playbookStages.playbookId, playbook.id))
      .orderBy(playbookStages.sortOrder);
    out.push({ playbook, stages });
  }
  return out;
}

/** Stages del playbook del caso. */
export async function getStagesForCase(caseRow: CaseRow) {
  if (isFakeDataEnabled()) {
    const meta = FAKE_PLAYBOOKS.find((p) => p.id === caseRow.playbookId);
    if (meta) return meta.stages;
  }
  const db = await getDb();
  return db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, caseRow.playbookId))
    .orderBy(playbookStages.sortOrder);
}

/** Oportunidades de un playbook concreto (siempre DB, aunque la UI demo esté activa). */
export async function listCasesForPlaybook(playbookId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(cases)
    .where(eq(cases.playbookId, playbookId))
    .orderBy(desc(cases.updatedAt));
  return enrichCases(rows);
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

/**
 * Persiste enrichment del wizard Alfondo (segmento + answers).
 * Best-effort: el case ya existe; fallos no deshacen el intake.
 */
export async function applyDiagnosticoEnrichment(
  input:
    | {
        caseId: string;
        diagnosticoLogId: string;
        segmento: string;
        segmentoLabel?: string | null;
        fitInnovacion?: string | null;
        fitInnovacionLabel?: string | null;
        wizardKind?: string | null;
        schemaVersion?: string | null;
        landingSource?: string | null;
        calendlyRoute?: string | null;
        answers?: Record<string, unknown> | null;
        wizardCreatedAt?: string | null;
        failed?: false;
      }
    | {
        caseId: string;
        failed: true;
        error: string;
        diagnosticoLogId?: string | null;
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
      "diagnostico_enrich_failed",
      {
        error: input.error,
        diagnosticoLogId: input.diagnosticoLogId ?? current.qualificationLogId,
      },
      "integracion"
    );
    return current;
  }

  const enrichedAt = new Date().toISOString();
  const qualification = {
    ...(current.qualification ?? {}),
    segmento_sugerido: input.segmento,
    segmento_label: input.segmentoLabel ?? null,
    fit_innovacion: input.fitInnovacion ?? null,
    fit_innovacion_label: input.fitInnovacionLabel ?? null,
    wizardKind: input.wizardKind ?? null,
    schemaVersion: input.schemaVersion ?? null,
    diagnostico_answers: input.answers ?? null,
    diagnostico_enriched_at: enrichedAt,
    wizard_created_at: input.wizardCreatedAt ?? null,
  };

  const allowedLandings =
    getWorkspacePack().calendlyMapping.allowedLandings ?? null;
  const fromApi = normalizeLandingSource(
    input.landingSource,
    allowedLandings
  );
  const currentLanding = normalizeLandingSource(
    current.landingSource,
    allowedLandings
  );
  // Preferir API; si API no trae landing, no conservar ruido (ej. "alfondo").
  const nextLanding = fromApi ?? currentLanding;

  const [updated] = await db
    .update(cases)
    .set({
      // Wizard → solo sugerido. No pisa segmento confirmado por consultor.
      segmentoSugerido: input.segmento,
      qualificationLogId:
        input.diagnosticoLogId || current.qualificationLogId,
      landingSource: nextLanding,
      calendlyRoute:
        input.calendlyRoute?.trim() || current.calendlyRoute,
      qualification,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await appendEvent(
    updated.id,
    "diagnostico_enriched",
    {
      diagnosticoLogId: input.diagnosticoLogId,
      segmentoSugerido: input.segmento,
      segmentoLabel: input.segmentoLabel ?? null,
      landingSource: input.landingSource ?? null,
      wizardKind: input.wizardKind ?? null,
    },
    "integracion"
  );

  return updated;
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

  // Si ya había consultor asignado antes del enrichment, invitar a Calendar.
  void import("@/lib/integrations/grant-consultant-meet-access").then(
    ({ scheduleGrantIfConsultantAssigned }) =>
      scheduleGrantIfConsultantAssigned(updated)
  );

  return updated;
}

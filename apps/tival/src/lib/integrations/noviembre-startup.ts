/**
 * Intake Noviembre StartUp: POST de Alfondo → oportunidad en Venta directa.
 * Sin WhatsApp, n8n ni otros efectos. La etapa inicial es Lead entrante.
 */
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  caseEvents,
  cases,
  playbookStages,
  playbooks,
  workspaces,
  type CaseRow,
  type PlaybookStage,
} from "@/db/schema";
import { resolveContact } from "@/lib/identity";
import { isLostReason, type LostReason } from "@/lib/lost-reasons";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";
import {
  ALFONDO_VENTA_DIRECTA_STAGES,
  VENTA_DIRECTA_MOVES,
  VENTA_DIRECTA_SLUG,
} from "@/workspaces/alfondo/playbook-venta-directa";

export const NOVIEMBRE_STARTUP_SOURCE = "noviembre-startup";
export const NOVIEMBRE_STARTUP_SCHEMA = "noviembre-startup-v1";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FUND_IDS = ["semilla-inicia", "semilla-expande", "startup-chile"] as const;
const PROGRAM_IDS = ["build", "ignite", "growth", "unknown"] as const;
const SERVICE_IDS = ["formulation", "review"] as const;
const REVIEW_IDS = [
  "not-started",
  "some-answers",
  "mostly-developed",
  "almost-finished",
] as const;

const DECLARATIONS_BY_FUND: Record<(typeof FUND_IDS)[number], string[]> = {
  "semilla-inicia": ["innovative", "inicia-without-sales"],
  "semilla-expande": ["innovative", "expande-age-and-sales", "expande-traction"],
  "startup-chile": ["innovative", "startup-scalable", "startup-venture"],
};

export type NoviembreStartupFundId = (typeof FUND_IDS)[number];

export type NoviembreStartupSolicitud = {
  schema_version: typeof NOVIEMBRE_STARTUP_SCHEMA;
  source: typeof NOVIEMBRE_STARTUP_SOURCE;
  submission_id: string;
  submitted_at: string;
  contact: {
    full_name: string;
    email: string;
    phone: string;
    company: string;
    website: string | null;
  };
  fund: {
    id: NoviembreStartupFundId;
    label: string;
    program: { id: (typeof PROGRAM_IDS)[number]; label: string } | null;
  };
  service: { id: (typeof SERVICE_IDS)[number]; label: string };
  review_progress: { id: (typeof REVIEW_IDS)[number]; label: string } | null;
  project_description: string;
  declarations: { id: string; text: string }[];
  budget_intent: "willing-to-invest";
  contact_consent: { accepted: true; text: string };
};

export type IngestNoviembreStartupResult = {
  opportunityId: string;
  created: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} es obligatorio.`);
  }
  return value.trim();
}

function sameIds(got: string[], expected: string[]) {
  if (got.length !== expected.length) return false;
  const set = new Set(got);
  return expected.every((id) => set.has(id));
}

export function parseNoviembreStartup(body: unknown): NoviembreStartupSolicitud {
  if (!isRecord(body)) throw new Error("El body tiene que ser un objeto JSON.");

  if (body.schema_version !== NOVIEMBRE_STARTUP_SCHEMA) {
    throw new Error(
      `schema_version tiene que ser "${NOVIEMBRE_STARTUP_SCHEMA}".`
    );
  }
  if (body.source !== NOVIEMBRE_STARTUP_SOURCE) {
    throw new Error(`source tiene que ser "${NOVIEMBRE_STARTUP_SOURCE}".`);
  }

  const submissionId = requiredString(body.submission_id, "submission_id");
  if (!UUID_RE.test(submissionId)) {
    throw new Error("submission_id tiene que ser un UUID.");
  }

  const submittedAt = requiredString(body.submitted_at, "submitted_at");
  if (Number.isNaN(Date.parse(submittedAt))) {
    throw new Error("submitted_at tiene que ser una fecha ISO 8601.");
  }

  if (!isRecord(body.contact)) throw new Error("contact es obligatorio.");
  const email = requiredString(body.contact.email, "contact.email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("contact.email no es un email válido.");
  }
  const phone = requiredString(body.contact.phone, "contact.phone");
  if (!/^\+\d+$/.test(phone)) {
    throw new Error('contact.phone tiene que ser "+" seguido solo de dígitos.');
  }
  const website =
    body.contact.website == null
      ? null
      : requiredString(body.contact.website, "contact.website");

  const fundId = requiredString(body.fund && isRecord(body.fund) ? body.fund.id : null, "fund.id");
  if (!FUND_IDS.includes(fundId as NoviembreStartupFundId)) {
    throw new Error(
      'fund.id tiene que ser "semilla-inicia", "semilla-expande" o "startup-chile".'
    );
  }
  const fund = body.fund as Record<string, unknown>;
  const fundLabel = requiredString(fund.label, "fund.label");

  let program: NoviembreStartupSolicitud["fund"]["program"] = null;
  if (fundId === "startup-chile") {
    if (!isRecord(fund.program)) {
      throw new Error("fund.program es obligatorio cuando el fondo es Start-Up Chile.");
    }
    const programId = requiredString(fund.program.id, "fund.program.id");
    if (!PROGRAM_IDS.includes(programId as (typeof PROGRAM_IDS)[number])) {
      throw new Error(
        'fund.program.id tiene que ser "build", "ignite", "growth" o "unknown".'
      );
    }
    program = {
      id: programId as (typeof PROGRAM_IDS)[number],
      label: requiredString(fund.program.label, "fund.program.label"),
    };
  } else if (fund.program != null) {
    throw new Error("fund.program tiene que ser null fuera de Start-Up Chile.");
  }

  if (!isRecord(body.service)) throw new Error("service es obligatorio.");
  const serviceId = requiredString(body.service.id, "service.id");
  if (!SERVICE_IDS.includes(serviceId as (typeof SERVICE_IDS)[number])) {
    throw new Error('service.id tiene que ser "formulation" o "review".');
  }
  const serviceLabel = requiredString(body.service.label, "service.label");

  let review: NoviembreStartupSolicitud["review_progress"] = null;
  if (serviceId === "review") {
    if (!isRecord(body.review_progress)) {
      throw new Error("review_progress es obligatorio cuando el servicio es revisión.");
    }
    const reviewId = requiredString(body.review_progress.id, "review_progress.id");
    if (!REVIEW_IDS.includes(reviewId as (typeof REVIEW_IDS)[number])) {
      throw new Error(
        'review_progress.id tiene que ser "not-started", "some-answers", "mostly-developed" o "almost-finished".'
      );
    }
    review = {
      id: reviewId as (typeof REVIEW_IDS)[number],
      label: requiredString(body.review_progress.label, "review_progress.label"),
    };
  } else if (body.review_progress != null) {
    throw new Error("review_progress tiene que ser null si el servicio no es revisión.");
  }

  const projectDescription = requiredString(
    body.project_description,
    "project_description"
  );
  if (projectDescription.length > 800) {
    throw new Error("project_description admite hasta 800 caracteres.");
  }

  if (!Array.isArray(body.declarations) || body.declarations.length === 0) {
    throw new Error("declarations es obligatorio.");
  }
  const declarations = body.declarations.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`declarations[${index}] tiene que ser un objeto.`);
    }
    return {
      id: requiredString(item.id, `declarations[${index}].id`),
      text: requiredString(item.text, `declarations[${index}].text`),
    };
  });
  const expected = DECLARATIONS_BY_FUND[fundId as NoviembreStartupFundId];
  if (!sameIds(declarations.map((d) => d.id), expected)) {
    throw new Error(
      `declarations de ${fundId} tienen que ser: ${expected.join(", ")}.`
    );
  }

  if (body.budget_intent !== "willing-to-invest") {
    throw new Error('budget_intent tiene que ser "willing-to-invest".');
  }
  if (!isRecord(body.contact_consent) || body.contact_consent.accepted !== true) {
    throw new Error("contact_consent.accepted tiene que ser true.");
  }
  const consentText = requiredString(
    body.contact_consent.text,
    "contact_consent.text"
  );

  return {
    schema_version: NOVIEMBRE_STARTUP_SCHEMA,
    source: NOVIEMBRE_STARTUP_SOURCE,
    submission_id: submissionId,
    submitted_at: submittedAt,
    contact: {
      full_name: requiredString(body.contact.full_name, "contact.full_name"),
      email,
      phone,
      company: requiredString(body.contact.company, "contact.company"),
      website,
    },
    fund: {
      id: fundId as NoviembreStartupFundId,
      label: fundLabel,
      program,
    },
    service: {
      id: serviceId as (typeof SERVICE_IDS)[number],
      label: serviceLabel,
    },
    review_progress: review,
    project_description: projectDescription,
    declarations,
    budget_intent: "willing-to-invest",
    contact_consent: { accepted: true, text: consentText },
  };
}

export function readNoviembreStartup(
  qualification: Record<string, unknown> | null | undefined
): NoviembreStartupSolicitud | null {
  const raw = qualification?.noviembre_startup;
  if (!isRecord(raw)) return null;
  if (raw.source !== NOVIEMBRE_STARTUP_SOURCE) return null;
  if (typeof raw.submission_id !== "string") return null;
  return raw as NoviembreStartupSolicitud;
}

export function websiteHref(raw: string | null | undefined) {
  const value = raw?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/** Misma clave con la que Tival llama a Alfondo (ALFONDO_API_KEY = TIVAL_API_KEY allá). */
export function alfondoInboundApiKey() {
  return (
    process.env.ALFONDO_API_KEY?.trim() ||
    process.env.TIVAL_API_KEY?.trim() ||
    null
  );
}

export function readInboundApiKey(request: {
  headers: { get(name: string): string | null };
}) {
  const header = request.headers.get("x-tival-api-key")?.trim();
  if (header) return header;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

type PlaybookReady = {
  workspaceId: string;
  playbookId: string;
  stages: PlaybookStage[];
};

export async function ensureVentaDirectaPlaybook(): Promise<PlaybookReady> {
  const db = await getDb();
  const slug = defaultWorkspaceSlug();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!workspace) {
    throw new Error(`Workspace no encontrado: ${slug}. Corré el seed.`);
  }

  let [playbook] = await db
    .select()
    .from(playbooks)
    .where(
      and(eq(playbooks.workspaceId, workspace.id), eq(playbooks.slug, VENTA_DIRECTA_SLUG))
    )
    .limit(1);

  if (!playbook) {
    [playbook] = await db
      .insert(playbooks)
      .values({
        workspaceId: workspace.id,
        name: "Venta directa",
        slug: VENTA_DIRECTA_SLUG,
        isActive: true,
      })
      .returning();
  }

  const existing = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id));

  for (const def of ALFONDO_VENTA_DIRECTA_STAGES) {
    const hit = existing.find((stage) => stage.key === def.key);
    if (hit) {
      await db
        .update(playbookStages)
        .set({
          name: def.name,
          description: def.description,
          sortOrder: def.sortOrder,
          requiresPayment: def.requiresPayment,
          requiresHuman: def.requiresHuman,
          actor: def.actor,
        })
        .where(eq(playbookStages.id, hit.id));
    } else {
      await db.insert(playbookStages).values({
        playbookId: playbook.id,
        ...def,
      });
    }
  }

  const stages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, playbook.id))
    .orderBy(playbookStages.sortOrder);

  return { workspaceId: workspace.id, playbookId: playbook.id, stages };
}

function isUniqueViolation(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "23505") return true;
  const message = err instanceof Error ? err.message : "";
  return message.includes("cases_workspace_source_submission");
}

export async function ingestNoviembreStartup(
  body: unknown
): Promise<IngestNoviembreStartupResult> {
  const solicitud = parseNoviembreStartup(body);
  const ready = await ensureVentaDirectaPlaybook();
  const db = await getDb();

  const [existing] = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.workspaceId, ready.workspaceId),
        eq(cases.sourceSubmissionId, solicitud.submission_id)
      )
    )
    .limit(1);

  if (existing) {
    console.info("[noviembre-startup]", {
      submission_id: solicitud.submission_id,
      opportunity_id: existing.id,
      created: false,
    });
    return { opportunityId: existing.id, created: false };
  }

  const lead = ready.stages.find((stage) => stage.key === "lead");
  if (!lead) throw new Error("Etapa Lead entrante no encontrada.");

  const contact = await resolveContact({
    workspaceId: ready.workspaceId,
    email: solicitud.contact.email,
    name: solicitud.contact.full_name,
    phone: solicitud.contact.phone,
    phoneSource: NOVIEMBRE_STARTUP_SOURCE,
  });

  const qualification = {
    source: NOVIEMBRE_STARTUP_SOURCE,
    noviembre_startup: solicitud,
    payload: body,
  };

  try {
    const [created] = await db
      .insert(cases)
      .values({
        workspaceId: ready.workspaceId,
        playbookId: ready.playbookId,
        currentStageId: lead.id,
        status: "open",
        contactId: contact.id,
        sourceSubmissionId: solicitud.submission_id,
        landingSource: NOVIEMBRE_STARTUP_SOURCE,
        qualification,
        paymentStatus: "none",
      })
      .returning();

    await db.insert(caseEvents).values({
      caseId: created.id,
      type: "noviembre_startup_received",
      actor: "integracion",
      payload: {
        submission_id: solicitud.submission_id,
        fund_id: solicitud.fund.id,
        service_id: solicitud.service.id,
      },
    });

    console.info("[noviembre-startup]", {
      submission_id: solicitud.submission_id,
      opportunity_id: created.id,
      created: true,
    });
    return { opportunityId: created.id, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [again] = await db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.workspaceId, ready.workspaceId),
          eq(cases.sourceSubmissionId, solicitud.submission_id)
        )
      )
      .limit(1);
    if (!again) throw err;
    console.info("[noviembre-startup]", {
      submission_id: solicitud.submission_id,
      opportunity_id: again.id,
      created: false,
    });
    return { opportunityId: again.id, created: false };
  }
}

export async function moveVentaDirectaStage(input: {
  caseId: string;
  stageKey: string;
  reason?: string | null;
  actor?: string;
}): Promise<CaseRow> {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!current) throw new Error("Oportunidad no encontrada.");

  const [playbook] = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.id, current.playbookId))
    .limit(1);
  if (playbook?.slug !== VENTA_DIRECTA_SLUG) {
    throw new Error("Esta oportunidad no es de Venta directa.");
  }

  const stages = await db
    .select()
    .from(playbookStages)
    .where(eq(playbookStages.playbookId, current.playbookId));
  const currentStage = stages.find((stage) => stage.id === current.currentStageId);
  const target = stages.find((stage) => stage.key === input.stageKey);
  if (!currentStage || !target) throw new Error("Etapa no encontrada.");
  if (currentStage.id === target.id) return current;

  const allowed = VENTA_DIRECTA_MOVES[currentStage.key] ?? [];
  if (!allowed.includes(target.key)) {
    throw new Error("Ese paso de etapa no está permitido.");
  }

  let lostReason: LostReason | null = null;
  if (target.key === "perdido") {
    const raw = input.reason?.trim() || "no_compra";
    lostReason = isLostReason(raw) ? raw : "no_compra";
  }

  const actor = input.actor ?? "ops";
  const [updated] = await db
    .update(cases)
    .set({
      currentStageId: target.id,
      lostReason,
      updatedAt: new Date(),
    })
    .where(eq(cases.id, current.id))
    .returning();

  await db.insert(caseEvents).values({
    caseId: updated.id,
    type: "venta_directa_stage",
    actor,
    payload: {
      from: currentStage.key,
      to: target.key,
      ...(lostReason ? { reason: lostReason } : {}),
    },
  });

  return updated;
}

import Link from "next/link";
import type { PlaybookStage } from "@/db/schema";
import {
  caseTitle,
  getPlaybookBundle,
  listCases,
  listFakePlaybooks,
  paymentRequestStatusByCaseIds,
  type CaseWithIdentity,
  type PaymentRequestStatus,
} from "@/lib/cases";
import {
  AppShell,
  ClosingScorePill,
  DealFitPill,
  LostReasonPill,
  PaymentRequestPill,
  SegmentPill,
  StatusPill,
  Topbar,
  closingScoreFromQualification,
  dealFitFromQualification,
} from "@/components/AppShell";
import { RememberCanvasHref } from "@/components/CanvasLink";
import {
  AssignConsultantButton,
  ConfirmMpButton,
  ConfirmTransferButton,
  MarkLostButton,
  MarkPropuestaEnviadaButton,
  MarkRealizadoButton,
  MarkWonButton,
} from "@/components/CaseActions";
import { MemberAvatar } from "@/components/MemberAvatar";
import { OpportunityFilterBar } from "@/components/OpportunityFilterBar";
import { ProcessBoard } from "@/components/ProcessBoard";
import { getSessionUser } from "@/lib/auth/session";
import {
  FAKE_INITIATIVES,
  INI_DIAGNOSTICO,
  initiativeById,
  initiativeForCase,
  isFakeDataEnabled,
  opportunityHref,
  PB_CONSULTORIA,
  caseSegmentInfo,
  segmentForCase,
} from "@/lib/fake-data";
import {
  handoffActionsForCase,
  memberById,
  type HandoffActionId,
} from "@/lib/members-catalog";
import { membersWithRole } from "@/lib/members";
import {
  DIAGNOSTICO_CREDIT_CLP,
  formatClp,
  quoteProductLines,
  sumQuotedPrices,
  toProductOption,
  type ProductOption,
} from "@/lib/products";
import { listProducts } from "@/lib/products-db";
import {
  caseMatchesFilters,
  diagnosticoHref,
  parseOpportunityFilters,
  type OpportunityFilterState,
} from "@/lib/opportunity-filters";
import { segmentsByIds } from "@/lib/segments";
import { isTerminalStageKey } from "@/lib/terminal-stages";

export const dynamic = "force-dynamic";

type ViewId = "tablero" | "listado" | "handoff";

function closingScoreFromCase(c: CaseWithIdentity): string | null {
  return closingScoreFromQualification(c.qualification);
}

function dealFitFromCase(c: CaseWithIdentity): string | null {
  return dealFitFromQualification(c.qualification);
}

function regionFromCase(c: CaseWithIdentity): string | null {
  const raw = (c.qualification as Record<string, unknown> | null)?.region;
  return typeof raw === "string" ? raw : null;
}

function quotedLinesForCase(c: CaseWithIdentity, options: ProductOption[]) {
  return quoteProductLines(
    c.qualification as Record<string, unknown> | null,
    options,
    { creditClp: DIAGNOSTICO_CREDIT_CLP }
  );
}

function stageForCase(
  stages: PlaybookStage[],
  c: CaseWithIdentity
): PlaybookStage | null {
  if (c.currentStageId) {
    const byId = stages.find((s) => s.id === c.currentStageId);
    if (byId) return byId;
  }
  return stages.find((s) => s.key === "lead") ?? stages[0] ?? null;
}

function HandoffCaseRow({
  c,
  stage,
  role,
  actions,
  productOptions,
  consultants,
  paymentRequest,
}: {
  c: CaseWithIdentity;
  stage: PlaybookStage | null;
  role: "ops" | "consultor";
  actions: HandoffActionId[];
  productOptions: ProductOption[];
  consultants: { id: string; name: string }[];
  paymentRequest?: PaymentRequestStatus;
}) {
  const segInfo = caseSegmentInfo(c);
  const consultant = memberById(c.assignedConsultantId);
  const lines = quotedLinesForCase(c, productOptions);
  const productsHint = lines.length
    ? ` · ${lines.length} prod · ${formatClp(sumQuotedPrices(lines))}`
    : "";

  return (
    <div className="row">
      <Link
        href={opportunityHref(c)}
        style={{
          flex: 1,
          minWidth: 0,
          color: "inherit",
          textDecoration: "none",
        }}
      >
        <div className="row-title">
          {caseTitle(c)}
          <SegmentPill
            segment={segInfo?.segment}
            status={segInfo?.status}
          />
          <ClosingScorePill score={closingScoreFromCase(c)} />
          <DealFitPill fit={dealFitFromCase(c)} />
          {["cancelled", "no_show"].includes(c.status) ? (
            <StatusPill status={c.status} />
          ) : null}
          {c.lostReason ? <LostReasonPill reason={c.lostReason} /> : null}
          {c.paymentStatus === "pending" ? (
            <span className="pill pill-warn">espera pago</span>
          ) : null}
          {stage?.key === "lead" ? (
            <PaymentRequestPill status={paymentRequest ?? "none"} />
          ) : null}
          {stage ? <span className="pill">{stage.name}</span> : null}
          {consultant ? (
            <span
              className="pill pill-role-consultor"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
              }}
            >
              <MemberAvatar
                memberId={consultant.id}
                name={consultant.name}
                size="sm"
              />
              {consultant.name}
            </span>
          ) : role === "ops" && actions.includes("assign_consultant") ? (
            <span className="pill pill-warn">sin consultor</span>
          ) : null}
        </div>
        <p className="row-sub">
          {c.contact?.name}
          {c.contact?.email ? ` · ${c.contact.email}` : ""}
          {productsHint}
        </p>
        <p className="row-meta">
          {role === "ops" ? "Acciones Ops" : "Acciones consultor"}
          {consultant && role === "consultor" ? ` · ${consultant.name}` : ""}
        </p>
      </Link>
      <div className="row-actions">
        {actions.includes("confirm_transfer") ? (
          <ConfirmTransferButton
            caseId={c.id}
            status={c.status}
            paymentStatus={c.paymentStatus}
            stageKey={stage?.key}
            hasPhone={Boolean(c.contact?.primaryPhone)}
            className="btn btn-primary"
            stopPropagation
          />
        ) : null}
        {actions.includes("confirm_mp") ? (
          <ConfirmMpButton
            caseId={c.id}
            status={c.status}
            paymentStatus={c.paymentStatus}
            stageKey={stage?.key}
            hasPhone={Boolean(c.contact?.primaryPhone)}
            className="btn"
            stopPropagation
          />
        ) : null}
        {actions.includes("mark_lost_unpaid") ? (
          <MarkLostButton
            caseId={c.id}
            status={c.status}
            paymentStatus={c.paymentStatus}
            stageKey={stage?.key}
            hasPhone={Boolean(c.contact?.primaryPhone)}
            className="btn"
            stopPropagation
            reason="no_pago"
          />
        ) : null}
        {actions.includes("assign_consultant") ? (
          <AssignConsultantButton
            caseId={c.id}
            status={c.status}
            paymentStatus={c.paymentStatus}
            stageKey={stage?.key}
            currentConsultantId={c.assignedConsultantId}
            consultants={consultants}
            className="btn btn-primary"
            stopPropagation
          />
        ) : null}
        {actions.includes("mark_realizado") ? (
          <MarkRealizadoButton
            caseId={c.id}
            status={c.status}
            stageKey={stage?.key}
            stopPropagation
            currentClosingScore={closingScoreFromCase(c)}
            currentDealFit={dealFitFromCase(c)}
            currentRegion={regionFromCase(c)}
            currentLines={quotedLinesForCase(c, productOptions)}
            creditClp={DIAGNOSTICO_CREDIT_CLP}
            productOptions={productOptions}
            suggestedSegmento={
              c.segmentoSugerido ??
              (typeof c.qualification?.segmento_sugerido === "string"
                ? c.qualification.segmento_sugerido
                : typeof c.qualification?.segmento === "string"
                  ? c.qualification.segmento
                  : c.segmento)
            }
            currentSegmento={
              typeof c.qualification?.segmento_confirmado === "string"
                ? c.qualification.segmento_confirmado
                : null
            }
          />
        ) : null}
        {actions.includes("mark_propuesta") ? (
          <MarkPropuestaEnviadaButton
            caseId={c.id}
            status={c.status}
            stageKey={stage?.key}
            stopPropagation
          />
        ) : null}
        {actions.includes("mark_won") ? (
          <MarkWonButton
            caseId={c.id}
            status={c.status}
            stageKey={stage?.key}
            stopPropagation
          />
        ) : null}
        {actions.includes("mark_lost_no_compra") ? (
          <MarkLostButton
            caseId={c.id}
            status={c.status}
            paymentStatus={c.paymentStatus}
            stageKey={stage?.key}
            className="btn"
            stopPropagation
            reason="no_compra"
          />
        ) : null}
      </div>
    </div>
  );
}

/** Iniciativa Diagnóstico · vistas tipo ClickUp: tablero / listado / handoff. */
export default async function DiagnosticoInnovacionCanvasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const viewParam = params.view;
  const viewValue = Array.isArray(viewParam) ? viewParam[0] : viewParam;
  const view: ViewId =
    viewValue === "listado" || viewValue === "handoff" ? viewValue : "tablero";

  const initiative =
    initiativeById(INI_DIAGNOSTICO) ??
    FAKE_INITIATIVES.find((i) => i.slug === "diagnostico")!;

  const session = await getSessionUser().catch(() => null);
  const isOps = !!session?.roles.includes("ops");
  /** Consultor sin rol ops: solo ve lo suyo, sin cola Ops. */
  const isConsultorView = !!session?.roles.includes("consultor") && !isOps;

  const fakeOn = isFakeDataEnabled();
  const fakePlaybooks = fakeOn ? await listFakePlaybooks() : [];
  const bundle = await getPlaybookBundle().catch(() => null);
  const all = await listCases().catch(() => []);
  const targets = segmentsByIds(initiative.targetSegmentIds);

  const meta =
    fakePlaybooks.find((p) => p.id === PB_CONSULTORIA) ??
    (bundle
      ? {
          id: bundle.playbook.id,
          name: bundle.playbook.name,
          stages: bundle.stages,
          slug: bundle.playbook.slug,
        }
      : null);

  /**
   * Canceladas / supersedidas fuera del canvas.
   * no_show (esperando reagenda) sí se muestra en su etapa para no perderlas de vista.
   */
  const HIDDEN_STATUSES = ["cancelled", "rescheduled_away"];

  const opportunities = all.filter((c) => {
    if (HIDDEN_STATUSES.includes(c.status)) return false;
    const ini = initiativeForCase(c);
    if (ini?.id === initiative.id) return true;
    if (bundle && c.playbookId === bundle.playbook.id) return true;
    return false;
  });

  const parsedFilters = parseOpportunityFilters(params);
  const filters: OpportunityFilterState = targets.some(
    (segment) => segment.id === parsedFilters.segment
  )
    ? parsedFilters
    : { ...parsedFilters, segment: null };
  const pool = opportunities.filter((c) =>
    caseMatchesFilters(
      c,
      { ...filters, segment: null },
      segmentForCase(c)?.id ?? null
    )
  );
  const filtered = filters.segment
    ? pool.filter((c) => segmentForCase(c)?.id === filters.segment)
    : pool;

  const productOptions = (
    await listProducts({ activeOnly: false }).catch(() => [])
  ).map(toProductOption);

  const stages = meta?.stages ?? [];
  const leadCaseIds = filtered
    .filter((c) => stageForCase(stages, c)?.key === "lead")
    .map((c) => c.id);
  const paymentRequestByCase = await paymentRequestStatusByCaseIds(
    leadCaseIds
  ).catch(() => new Map<string, PaymentRequestStatus>());
  const consultants = (await membersWithRole("consultor")).map((m) => ({
    id: m.id,
    name: m.name,
  }));
  const consultantOptions = [...consultants];
  const knownConsultants = new Set(consultantOptions.map((consultant) => consultant.id));
  for (const opportunity of opportunities) {
    const id = opportunity.assignedConsultantId;
    if (!id || knownConsultants.has(id)) continue;
    knownConsultants.add(id);
    consultantOptions.push({
      id,
      name: memberById(id)?.name ?? "Sin nombre",
    });
  }
  consultantOptions.sort((a, b) => a.name.localeCompare(b.name, "es"));
  const productChoices = [...productOptions].sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );

  const needsHuman = filtered.filter((c) => {
    const st = stageForCase(stages, c);
    if (!st || isTerminalStageKey(st.key)) return false;
    if (["cancelled", "no_show", "rescheduled_away"].includes(c.status))
      return false;
    return (
      c.paymentStatus === "pending" ||
      (st.key === "pagado" && c.status === "open") ||
      (st.key === "realizado" && c.status === "open") ||
      (st.key === "propuesta_enviada" && c.status === "open") ||
      (c.paymentStatus !== "paid" && c.status === "open" && st.key === "lead")
    );
  });

  /** Handoff consultor: solo asignados a él · sin cola Ops. */
  const handoffPool = isConsultorView
    ? needsHuman.filter((c) => c.assignedConsultantId === session!.id)
    : needsHuman;

  const handoffOps = isConsultorView
    ? []
    : handoffPool.filter((c) => {
        const st = stageForCase(stages, c);
        return (
          handoffActionsForCase({
            status: c.status,
            paymentStatus: c.paymentStatus,
            stageKey: st?.key,
            assignedConsultantId: c.assignedConsultantId,
          }).ops.length > 0
        );
      });
  const handoffConsultor = handoffPool.filter((c) => {
    const st = stageForCase(stages, c);
    return (
      handoffActionsForCase({
        status: c.status,
        paymentStatus: c.paymentStatus,
        stageKey: st?.key,
        assignedConsultantId: c.assignedConsultantId,
      }).consultor.length > 0
    );
  });
  const warnCount = isConsultorView
    ? 0
    : handoffPool.filter((c) => {
        const st = stageForCase(stages, c);
        return handoffActionsForCase({
          status: c.status,
          paymentStatus: c.paymentStatus,
          stageKey: st?.key,
          assignedConsultantId: c.assignedConsultantId,
        }).needsConsultantWarning;
      }).length;

  const handoffPendingCount = isConsultorView
    ? handoffConsultor.length
    : needsHuman.length;

  const listRows = filtered;
  const subtitle =
    view === "handoff"
      ? isConsultorView
        ? "Tus oportunidades · diagnóstico y cierre"
        : "Ops y consultor · mismas acciones, ownership sugerido"
      : view === "listado"
        ? "Todas las oportunidades de esta iniciativa"
        : undefined;

  return (
    <AppShell active="diagnostico">
      <RememberCanvasHref href={diagnosticoHref(view, filters)} />
      <Topbar
        title="Diagnóstico"
        subtitle={subtitle}
        actions={
          <div className="topbar-actions">
            <Link className="btn" href={`/iniciativas/${initiative.slug}`}>
              Config
            </Link>
          </div>
        }
      />
      <div className="content content-wide">
        {!meta ? (
          <div className="panel">
            <h3>Sin playbook</h3>
            <p className="lede">Corre el seed o USE_FAKE_DATA=1</p>
          </div>
        ) : (
          <>
            <div className="view-tabs" role="tablist" aria-label="Vistas">
              <Link
                href={diagnosticoHref("tablero", filters)}
                className={`view-tab ${view === "tablero" ? "is-active" : ""}`}
                role="tab"
                aria-selected={view === "tablero"}
              >
                Tablero
              </Link>
              <Link
                href={diagnosticoHref("listado", filters)}
                className={`view-tab ${view === "listado" ? "is-active" : ""}`}
                role="tab"
                aria-selected={view === "listado"}
              >
                Listado
                <span className="view-tab-count">{filtered.length}</span>
              </Link>
              <Link
                href={diagnosticoHref("handoff", filters)}
                className={`view-tab ${view === "handoff" ? "is-active" : ""}`}
                role="tab"
                aria-selected={view === "handoff"}
              >
                Handoff
                {handoffPendingCount > 0 ? (
                  <span className="view-tab-count view-tab-count-warn">
                    {handoffPendingCount}
                  </span>
                ) : null}
              </Link>
            </div>

            <OpportunityFilterBar
              view={view}
              filters={filters}
              totalCount={pool.length}
              segments={targets.map((segment) => ({
                id: segment.id,
                code: segment.code,
                name: segment.name,
                count: pool.filter(
                  (opportunity) => segmentForCase(opportunity)?.id === segment.id
                ).length,
              }))}
              consultants={consultantOptions}
              products={productChoices}
            />

            {view === "tablero" ? (
              <ProcessBoard
                title="Por etapa"
                stages={stages}
                opportunities={filtered}
                quiet
                productOptions={productOptions}
                paymentRequestByCase={paymentRequestByCase}
              />
            ) : view === "handoff" ? (
              handoffPendingCount === 0 ? (
                <p className="empty">
                  {isConsultorView
                    ? "No tenés oportunidades asignadas pendientes."
                    : "Nada pendiente de intervención."}
                </p>
              ) : (
                <>
                  {warnCount > 0 ? (
                    <p className="lede" style={{ marginBottom: "1rem" }}>
                      <span className="pill pill-warn">
                        {warnCount} sin consultor
                      </span>{" "}
                      Warning — no bloquea marcar realizado ni avanzar.
                    </p>
                  ) : null}

                  {!isConsultorView ? (
                    <section className="handoff-section">
                      <div className="handoff-section-head">
                        <span className="pill pill-role-ops">Ops</span>
                        <h3>Cola operativa</h3>
                        <p className="lede">
                          Pago, asignación y excepciones · {handoffOps.length}
                        </p>
                      </div>
                      <div className="row-list">
                        {handoffOps.length === 0 ? (
                          <p className="empty">Sin acciones Ops pendientes.</p>
                        ) : (
                          handoffOps.map((c) => {
                            const stage = stageForCase(stages, c);
                            const { ops } = handoffActionsForCase({
                              status: c.status,
                              paymentStatus: c.paymentStatus,
                              stageKey: stage?.key,
                              assignedConsultantId: c.assignedConsultantId,
                            });
                            return (
                              <HandoffCaseRow
                                key={`ops-${c.id}`}
                                c={c}
                                stage={stage}
                                role="ops"
                                actions={ops}
                                productOptions={productOptions}
                                consultants={consultants}
                                paymentRequest={paymentRequestByCase.get(c.id)}
                              />
                            );
                          })
                        )}
                      </div>
                    </section>
                  ) : null}

                  <section className="handoff-section">
                    <div className="handoff-section-head">
                      <span className="pill pill-role-consultor">
                        {isConsultorView ? "Mis casos" : "Consultor"}
                      </span>
                      <h3>Cola de diagnóstico</h3>
                      <p className="lede">
                        Realizado, propuesta y cierre · {handoffConsultor.length}
                      </p>
                    </div>
                    <div className="row-list">
                      {handoffConsultor.length === 0 ? (
                        <p className="empty">
                          {isConsultorView
                            ? "Nada pendiente en tus oportunidades."
                            : "Sin acciones de consultor pendientes."}
                        </p>
                      ) : (
                        handoffConsultor.map((c) => {
                          const stage = stageForCase(stages, c);
                          const { consultor } = handoffActionsForCase({
                            status: c.status,
                            paymentStatus: c.paymentStatus,
                            stageKey: stage?.key,
                            assignedConsultantId: c.assignedConsultantId,
                          });
                          return (
                            <HandoffCaseRow
                              key={`consultor-${c.id}`}
                              c={c}
                              stage={stage}
                              role="consultor"
                              actions={consultor}
                              productOptions={productOptions}
                              consultants={consultants}
                              paymentRequest={paymentRequestByCase.get(c.id)}
                            />
                          );
                        })
                      )}
                    </div>
                  </section>
                </>
              )
            ) : (
              <div className="row-list">
                {listRows.length === 0 ? (
                  <p className="empty">Sin oportunidades con este filtro.</p>
                ) : (
                  listRows.map((c) => {
                    const segInfo = caseSegmentInfo(c);
                    const stage = stageForCase(stages, c);
                    const consultant = memberById(c.assignedConsultantId);
                    return (
                      <div key={c.id} className="row">
                        <Link
                          href={opportunityHref(c)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: "inherit",
                            textDecoration: "none",
                          }}
                        >
                          <div className="row-title">
                            {caseTitle(c)}
                            <SegmentPill
                              segment={segInfo?.segment}
                              status={segInfo?.status}
                            />
                            <ClosingScorePill score={closingScoreFromCase(c)} />
                            <DealFitPill fit={dealFitFromCase(c)} />
                            {["cancelled", "no_show"].includes(c.status) ? (
                              <StatusPill status={c.status} />
                            ) : null}
                            {c.lostReason ? (
                              <LostReasonPill reason={c.lostReason} />
                            ) : null}
                            {c.paymentStatus === "pending" ? (
                              <span className="pill pill-warn">espera pago</span>
                            ) : null}
                            {stage ? (
                              <span className="pill">{stage.name}</span>
                            ) : null}
                            {consultant ? (
                              <span
                                className="pill pill-role-consultor"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.35rem",
                                }}
                              >
                                <MemberAvatar
                                  memberId={consultant.id}
                                  name={consultant.name}
                                  size="sm"
                                />
                                {consultant.name}
                              </span>
                            ) : null}
                          </div>
                          <p className="row-sub">
                            {c.contact?.name}
                            {c.contact?.email ? ` · ${c.contact.email}` : ""}
                            {(() => {
                              const lines = quotedLinesForCase(c, productOptions);
                              if (!lines.length) return null;
                              return ` · ${lines.length} prod · ${formatClp(sumQuotedPrices(lines))}`;
                            })()}
                          </p>
                          <p className="row-meta">
                            {c.scheduledAt
                              ? new Date(c.scheduledAt).toLocaleString(
                                  "es-CL",
                                  { timeZone: "America/Santiago" }
                                )
                              : c.id.slice(0, 10) + "…"}
                          </p>
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AppShell,
  InitiativePill,
  LostReasonPill,
  SegmentPill,
  StatusPill,
  Topbar,
} from "@/components/AppShell";
import {
  AssignConsultantButton,
  CaseActions,
  ConfirmTransferButton,
  CopyCalendlyLinkButton,
  MarkLostButton,
  MarkPropuestaEnviadaButton,
  MarkRealizadoButton,
  MarkWonButton,
} from "@/components/CaseActions";
import {
  isAwaitingRescheduleActive,
  readAwaitingReschedule,
} from "@/lib/awaiting-reschedule";
import {
  buildTivalReagendaUrl,
  canShareReagendaLink,
} from "@/lib/reagenda-link";
import { MemberAvatar } from "@/components/MemberAvatar";
import {
  EventTimeline,
  NextActionPanel,
  StageRail,
} from "@/components/ProcessUI";
import { ClosingScoreEditor } from "@/components/ClosingScoreEditor";
import {
  OpportunityExtras,
  OpportunityFieldValues,
} from "@/components/OpportunityFields";
import { OpportunityIdentityEditor } from "@/components/OpportunityIdentityEditor";
import { OpportunityTabs } from "@/components/OpportunityTabs";
import { ProductEditor } from "@/components/ProductEditor";
import { RegionEditor } from "@/components/RegionEditor";
import { caseTitle, getCaseWithEvents, getStagesForCase } from "@/lib/cases";
import {
  extrasForCase,
  initiativeForCase,
  opportunityHref,
  PB_CONSULTORIA,
  resolveOpportunityFields,
  segmentForCase,
} from "@/lib/fake-data";
import {
  listCompaniesForContact,
  listPhonesForContact,
} from "@/lib/identity";
import { memberById } from "@/lib/members-catalog";
import { membersWithRole } from "@/lib/members";
import { nextActionForCase } from "@/lib/process-effects";
import { getPostMeetState } from "@/lib/integrations/post-meet-collect";
import { lostReasonLabel } from "@/lib/lost-reasons";
import {
  formatClp,
  productKeysFromQualification,
  sumProductPrices,
  toProductOption,
} from "@/lib/products";
import { listProducts } from "@/lib/products-db";
import { isChileRegion } from "@/lib/chile-regions";

export const dynamic = "force-dynamic";

/** Oportunidad anidada — vista ops (sin glosario de arquitectura). */
export default async function IniciativaOportunidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug, id } = await params;
  const { tab: tabParam } = await searchParams;
  const data = await getCaseWithEvents(id).catch(() => null);
  if (!data) notFound();

  const { case: c, events } = data;
  const ini = initiativeForCase(c);
  const canonical = opportunityHref(c);
  if (ini?.slug && ini.slug !== slug) {
    redirect(canonical);
  }

  const stages = await getStagesForCase(c);
  const currentStage = stages.find((s) => s.id === c.currentStageId);
  const seg = segmentForCase(c);
  const fieldRows = resolveOpportunityFields(c);
  const extras = extrasForCase(c);
  const qualification = (c.qualification ?? {}) as Record<string, unknown>;
  const currentClosingScore =
    typeof qualification.closing_score === "string"
      ? qualification.closing_score
      : null;
  const currentRegion =
    typeof qualification.region === "string" &&
    isChileRegion(qualification.region)
      ? qualification.region
      : null;
  const phones = c.contactId
    ? await listPhonesForContact(c.contactId)
    : [];
  const contactCompanies = c.contactId
    ? await listCompaniesForContact(c.contactId)
    : [];
  const currentProductKeys = productKeysFromQualification(qualification);
  const postMeet = getPostMeetState(c);
  const canGenerateProposal = Boolean(
    c.assignedConsultantId &&
      postMeet.moved?.some((m) => m.kind === "notes")
  );
  const catalogProducts = await listProducts({ activeOnly: false }).catch(
    () => []
  );
  const productOptions = catalogProducts
    .filter((p) => p.active || currentProductKeys.includes(p.key))
    .map(toProductOption);
  const productsTotal = sumProductPrices(currentProductKeys, productOptions);
  const isConsultoria =
    c.playbookId === PB_CONSULTORIA ||
    ini?.playbookId === PB_CONSULTORIA ||
    currentStage?.key === "lead" ||
    currentStage?.key === "pagado" ||
    currentStage?.key === "realizado" ||
    currentStage?.key === "propuesta_enviada" ||
    currentStage?.key === "seguimiento" ||
    currentStage?.key === "ganado" ||
    currentStage?.key === "perdido";
  const consultants = (await membersWithRole("consultor")).map((m) => ({
    id: m.id,
    name: m.name,
  }));
  const assignedConsultant = memberById(c.assignedConsultantId);
  const awaiting = readAwaitingReschedule(qualification);
  const awaitingActive = isAwaitingRescheduleActive(qualification);
  const calendlyBase =
    typeof ini?.config?.calendlyUrl === "string"
      ? ini.config.calendlyUrl
      : null;
  const rescheduleUrl =
    typeof qualification.reschedule_url === "string"
      ? qualification.reschedule_url
      : null;
  const reagendaShareLink = canShareReagendaLink({
    status: c.status,
    scheduledAt: c.scheduledAt,
    qualification,
    hasRescheduleUrl: Boolean(rescheduleUrl),
    hasCalendlyBase: Boolean(calendlyBase),
  })
    ? buildTivalReagendaUrl(c.id)
    : null;
  const next = nextActionForCase({
    status: c.status,
    paymentStatus: c.paymentStatus,
    stageKey: currentStage?.key,
    stageRequiresHuman: currentStage?.requiresHuman,
    isConsultoria,
    assignedConsultantId: c.assignedConsultantId,
    assignedConsultantName: assignedConsultant?.name ?? null,
    awaitingReschedule: awaitingActive,
    awaitingRescheduleUntil: awaiting?.until ?? null,
  });
  const shellActive =
    ini?.slug === "diagnostico" ? "diagnostico" : "iniciativas";
  const contactHref = c.contactId
    ? `/contactos/${c.contactId}`
    : "/contactos";
  const iniHref =
    ini?.slug === "diagnostico"
      ? "/procesos/diagnostico"
      : ini
        ? `/iniciativas/${ini.slug}`
        : "/iniciativas";
  const initialTab =
    tabParam === "productos" || tabParam === "timeline"
      ? tabParam
      : "general";

  return (
    <AppShell active={shellActive}>
      <Topbar
        title={caseTitle(c)}
        subtitle={[
          c.contact?.name,
          c.contact?.email,
          currentProductKeys.length
            ? `${currentProductKeys.length} producto${
                currentProductKeys.length === 1 ? "" : "s"
              } · ${formatClp(productsTotal)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          isConsultoria ? (
            <CaseActions
              caseId={c.id}
              status={c.status}
              paymentStatus={c.paymentStatus}
              stageKey={currentStage?.key}
              hasScheduledAt={Boolean(c.scheduledAt)}
              calendlyLink={reagendaShareLink}
              canGenerateProposal={canGenerateProposal}
            />
          ) : (
            <span className="pill pill-warn">acciones etapa 2</span>
          )
        }
      />
      <div className="content">
        <p className="row-meta" style={{ marginBottom: "0.75rem" }}>
          <Link href={iniHref} style={{ textDecoration: "underline" }}>
            ← {ini?.name ?? slug}
          </Link>
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <InitiativePill initiative={ini} />{" "}
          <SegmentPill segment={seg} />{" "}
          {["cancelled", "no_show", "rescheduled_away"].includes(c.status) ? (
            <StatusPill status={c.status} />
          ) : null}{" "}
          {awaitingActive ? (
            <span className="pill pill-warn" title={awaiting?.until ?? undefined}>
              esperando reagenda
            </span>
          ) : null}{" "}
          {c.paymentStatus !== "paid" && c.status === "open" ? (
            <span className="pill pill-warn">sin pago</span>
          ) : null}{" "}
          {c.paymentStatus === "paid" &&
          currentStage?.key !== "perdido" &&
          currentStage?.key !== "ganado" ? (
            <span className="pill pill-ok">pagado</span>
          ) : null}{" "}
          {currentStage ? (
            <span className="pill">{currentStage.name}</span>
          ) : null}{" "}
          {assignedConsultant ? (
            <span
              className="pill pill-role-consultor"
              style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
            >
              <MemberAvatar
                memberId={assignedConsultant.id}
                name={assignedConsultant.name}
                size="sm"
              />
              {assignedConsultant.name}
            </span>
          ) : c.paymentStatus === "paid" &&
            currentStage?.key !== "perdido" &&
            currentStage?.key !== "ganado" ? (
            <span className="pill pill-warn">sin consultor</span>
          ) : null}{" "}
          {c.lostReason ? <LostReasonPill reason={c.lostReason} /> : null}
        </div>

        {currentStage?.key === "perdido" ? (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="panel-kicker">Cierre</p>
            <h3>Perdido</h3>
            <p className="lede" style={{ marginTop: "0.35rem" }}>
              Motivo:{" "}
              <strong>{lostReasonLabel(c.lostReason) ?? "Sin motivo"}</strong>
            </p>
          </div>
        ) : null}

        {c.status === "cancelled" ? (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="panel-kicker">Cierre</p>
            <h3>Cancelada</h3>
            <p className="lede" style={{ marginTop: "0.35rem" }}>
              Motivo:{" "}
              <strong>
                {c.cancelReason === "superseded"
                  ? "Duplicada · superseded (otra opp vigente)"
                  : c.cancelReason ?? "Sin motivo"}
              </strong>
            </p>
          </div>
        ) : null}

        {awaitingActive ? (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="panel-kicker">Reagenda</p>
            <h3>Esperando reagenda</h3>
            <p className="lede" style={{ marginTop: "0.35rem" }}>
              No asistió al slot anterior. Compartí el link prefildado; al
              agendar se actualiza esta misma oportunidad
              {awaiting?.until
                ? ` · chance hasta ${new Date(awaiting.until).toLocaleDateString(
                    "es-CL",
                    { day: "numeric", month: "short", year: "numeric" }
                  )}`
                : ""}
              .
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                marginTop: "0.75rem",
              }}
            >
              <CopyCalendlyLinkButton
                url={reagendaShareLink}
                label="Copiar link reagenda"
                className="btn btn-primary"
              />
            </div>
          </div>
        ) : null}

        {next && !awaitingActive ? (
          <NextActionPanel
            hint={next}
            actions={
              isConsultoria &&
              currentStage?.key !== "perdido" &&
              currentStage?.key !== "ganado" &&
              c.status !== "no_show" ? (
                <>
                  {c.paymentStatus !== "paid" ? (
                    <ConfirmTransferButton
                      caseId={c.id}
                      status={c.status}
                      paymentStatus={c.paymentStatus}
                      stageKey={currentStage?.key}
                      className="btn btn-primary"
                    />
                  ) : null}
                  <AssignConsultantButton
                    caseId={c.id}
                    status={c.status}
                    paymentStatus={c.paymentStatus}
                    stageKey={currentStage?.key}
                    currentConsultantId={c.assignedConsultantId}
                    consultants={consultants}
                    className="btn btn-primary"
                  />
                  {currentStage?.key === "pagado" ? (
                    <MarkRealizadoButton
                      caseId={c.id}
                      status={c.status}
                      stageKey={currentStage.key}
                      currentClosingScore={currentClosingScore}
                      currentRegion={currentRegion}
                      currentProductKeys={currentProductKeys}
                      productOptions={productOptions}
                    />
                  ) : null}
                  {currentStage?.key === "realizado" ? (
                    <MarkPropuestaEnviadaButton
                      caseId={c.id}
                      status={c.status}
                      stageKey={currentStage.key}
                    />
                  ) : null}
                  {currentStage?.key === "propuesta_enviada" ? (
                    <>
                      <MarkWonButton
                        caseId={c.id}
                        status={c.status}
                        stageKey={currentStage.key}
                      />
                      <MarkLostButton
                        caseId={c.id}
                        status={c.status}
                        paymentStatus={c.paymentStatus}
                        stageKey={currentStage.key}
                        className="btn btn-ghost"
                        reason="no_compra"
                      />
                    </>
                  ) : null}
                </>
              ) : null
            }
          />
        ) : null}

        <div className="grid-2" style={{ marginTop: "1rem" }}>
          <div>
            <OpportunityTabs
              initialTab={initialTab}
              productsCount={currentProductKeys.length}
              productsTotalLabel={
                currentProductKeys.length ? formatClp(productsTotal) : null
              }
              general={
                <>
                  <div className="panel" style={{ marginBottom: "1rem" }}>
                    <p className="panel-kicker">Identidad</p>
                    <div style={{ marginTop: "0.5rem" }}>
                      <OpportunityIdentityEditor
                        caseId={c.id}
                        contact={c.contact}
                        contactHref={contactHref}
                        phoneLabel={
                          c.contact?.primaryPhone ??
                          phones[0]?.phone ??
                          null
                        }
                        companies={contactCompanies}
                        primaryCompanyId={c.companyId}
                      />
                    </div>
                  </div>

                  <div className="panel" style={{ marginBottom: "1rem" }}>
                    <p className="panel-kicker">Ficha</p>
                    <h3>Datos de esta oportunidad</h3>
                    <OpportunityFieldValues
                      rows={
                        isConsultoria
                          ? fieldRows.filter(
                              (r) =>
                                r.def.key !== "closing_score" &&
                                r.def.key !== "region"
                            )
                          : fieldRows
                      }
                    />
                    {isConsultoria ? (
                      <div style={{ marginTop: "0.85rem" }}>
                        <RegionEditor
                          caseId={c.id}
                          currentRegion={currentRegion}
                        />
                      </div>
                    ) : null}
                  </div>

                  {isConsultoria ? (
                    <div className="panel">
                      <p className="panel-kicker">Closing score</p>
                      <h3>Temperatura comercial</h3>
                      <p className="lede" style={{ marginTop: "0.35rem" }}>
                        Opcional. Podés actualizarlo en cualquier momento.
                      </p>
                      <div style={{ marginTop: "0.75rem" }}>
                        <ClosingScoreEditor
                          caseId={c.id}
                          currentClosingScore={currentClosingScore}
                        />
                      </div>
                    </div>
                  ) : null}

                  {Object.keys(extras).length > 0 ? (
                    <details className="panel" style={{ marginTop: "1rem" }}>
                      <summary
                        className="panel-kicker"
                        style={{ cursor: "pointer" }}
                      >
                        Origen / tracking
                      </summary>
                      <div style={{ marginTop: "0.65rem" }}>
                        <OpportunityExtras extras={extras} />
                        <p
                          className="lede mono"
                          style={{ marginTop: "0.5rem" }}
                        >
                          id {c.id}
                        </p>
                        <p className="lede mono">path {canonical}</p>
                      </div>
                    </details>
                  ) : (
                    <section className="panel" style={{ marginTop: "1rem" }}>
                      <p className="panel-kicker">Referencias</p>
                      <p className="lede mono">id {c.id}</p>
                    </section>
                  )}
                </>
              }
              products={
                <div className="panel">
                  <p className="panel-kicker">Catálogo</p>
                  <h3>Productos de esta oportunidad</h3>
                  <p className="lede" style={{ marginTop: "0.35rem" }}>
                    Buscá y agregá. Podés sumar más de uno.
                  </p>
                  <div style={{ marginTop: "0.85rem" }}>
                    <ProductEditor
                      caseId={c.id}
                      currentProductKeys={currentProductKeys}
                      options={productOptions}
                    />
                  </div>
                </div>
              }
              timeline={
                <div className="panel">
                  <p className="panel-kicker">Historia</p>
                  <h3>Timeline</h3>
                  <div style={{ marginTop: "0.85rem" }}>
                    <EventTimeline events={events} />
                  </div>
                </div>
              }
            />
          </div>

          <div>
            <section className="panel">
              <p className="panel-kicker">Proceso</p>
              <h3>Etapa actual</h3>
              <div style={{ marginTop: "0.9rem" }}>
                <StageRail
                  stages={stages}
                  currentStageId={c.currentStageId}
                  showEffects={false}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

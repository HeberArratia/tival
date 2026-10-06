import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell, PlaybookPill, Topbar } from "@/components/AppShell";
import { OpportunityFieldsSchema } from "@/components/OpportunityFields";
import { PlaybookRolesPanel, StageRail } from "@/components/ProcessUI";
import { getPlaybookBundle, listFakePlaybooks } from "@/lib/cases";
import {
  initiativesForPlaybook,
  isFakeDataEnabled,
  playbookBySlug,
} from "@/lib/fake-data";
import { FLOW_LINE, GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-dynamic";

/** Show: un playbook — iniciativas + etapas (triggers / efectos). */
export default async function PlaybookShowPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const fakeOn = isFakeDataEnabled();
  const fakePlaybooks = fakeOn ? await listFakePlaybooks() : [];
  const bundle = await getPlaybookBundle().catch(() => null);

  let pb =
    fakePlaybooks.find((p) => p.slug === slug) ?? playbookBySlug(slug) ?? null;

  if (!pb && bundle && bundle.playbook.slug === slug) {
    pb = {
      id: bundle.playbook.id,
      slug: bundle.playbook.slug,
      name: bundle.playbook.name,
      blurb: "Playbook activo del workspace.",
      compatibleTypes: ["agenda"],
      opportunityFields: [],
      stages: bundle.stages,
    };
  }

  if (!pb) notFound();
  if (pb.comingSoon) redirect("/playbooks");

  const inis = initiativesForPlaybook(pb.id);
  const canvasHref =
    pb.slug === "consultoria"
      ? "/procesos/diagnostico"
      : null;

  return (
    <AppShell active="playbooks">
      <Topbar
        title={pb.name}
        subtitle={`Playbook · ${FLOW_LINE}`}
        actions={
          <div className="topbar-actions">
            {canvasHref ? (
              <Link className="btn btn-primary" href={canvasHref}>
                Canvas · Diagnóstico
              </Link>
            ) : null}
            <Link className="btn" href="/playbooks">
              ← Playbooks
            </Link>
          </div>
        }
      />
      <div className="content">
        <div style={{ marginBottom: "1rem" }}>
          <PlaybookPill playbookId={pb.id} />{" "}
          {pb.comingSoon ? (
            <span className="pill">coming soon</span>
          ) : pb.slug === "consultoria" ? (
            <span className="pill pill-ok">activo V1</span>
          ) : (
            <span className="pill pill-warn">preview</span>
          )}
        </div>

        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">Plantilla</p>
          <h3>{pb.name}</h3>
          <p className="lede">{pb.blurb}</p>
          <p className="lede">
            Compatible con tipos:{" "}
            <span className="mono">{pb.compatibleTypes.join(", ")}</span>
          </p>
        </div>

        <section className="section">
          <div className="section-head">
            <h2>Campos de la oportunidad</h2>
            <span>{GLOSSARY.campo.short}</span>
          </div>
          <div className="panel">
            <p className="lede" style={{ marginBottom: "0.75rem" }}>
              Contrato del proceso. La iniciativa pone defaults; el flujo llena
              valores; lo que no entra al esquema va a extras.
            </p>
            <OpportunityFieldsSchema fields={pb.opportunityFields ?? []} />
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Iniciativas</h2>
            <span>Ofertas que usan este playbook</span>
          </div>
          {inis.length === 0 ? (
            <p className="empty">Sin iniciativas asociadas (aún).</p>
          ) : (
            <ul className="initiative-list">
              {inis.map((ini) => (
                <li key={ini.id}>
                  <strong>{ini.name}</strong>
                  <span>{ini.blurb}</span>
                  {ini.comingSoon ? <em className="pill">pronto</em> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {pb.slug === "consultoria" ? (
          <section className="section">
            <div className="section-head">
              <h2>Roles</h2>
              <span>{GLOSSARY.rol.short}</span>
            </div>
            <div className="panel">
              <PlaybookRolesPanel />
            </div>
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">
            <h2>Etapas</h2>
            <span>Triggers + efectos · rol en cada acción humana</span>
          </div>
          <div className="panel">
            <StageRail
              stages={pb.stages}
              currentStageId={null}
              showEffects
              previewMode={!pb.comingSoon}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

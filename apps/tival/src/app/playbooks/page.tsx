import Link from "next/link";
import { AppShell, PlaybookPill, Topbar } from "@/components/AppShell";
import { getPlaybookBundle, listFakePlaybooks } from "@/lib/cases";
import {
  initiativesForPlaybook,
  isFakeDataEnabled,
} from "@/lib/fake-data";
import { FLOW_LINE } from "@/lib/glossary";
import { getWorkspacePack } from "@/lib/workspace/registry";

export const dynamic = "force-dynamic";

/** Index: lista de playbooks del workspace. */
export default async function PlaybooksIndexPage() {
  const pack = getWorkspacePack();
  const fakeOn = isFakeDataEnabled();
  const fakePlaybooks = fakeOn ? await listFakePlaybooks() : [];
  const bundle = await getPlaybookBundle().catch(() => null);

  const rows =
    fakePlaybooks.length > 0
      ? fakePlaybooks
      : bundle
        ? [
            {
              id: bundle.playbook.id,
              slug: bundle.playbook.slug,
              name: bundle.playbook.name,
              blurb: "Playbook activo del workspace.",
              compatibleTypes: ["agenda"],
              opportunityFields: [],
              stages: bundle.stages,
              comingSoon: false as boolean | undefined,
            },
          ]
        : [];

  return (
    <AppShell active="playbooks">
      <Topbar
        title="Playbooks"
        subtitle={`${FLOW_LINE} · Elegí un playbook para ver iniciativas, etapas, triggers y efectos.`}
      />
      <div className="content">
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">Workspace · {pack.name}</p>
          <h3>Plantillas del sistema comercial</h3>
          <p className="lede">
            Un playbook define etapas, triggers y efectos. Las iniciativas lo
            usan; las oportunidades viven en una iniciativa.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="panel">
            <h3>Sin playbooks</h3>
            <p className="lede">Corre npm run db:seed o USE_FAKE_DATA=1</p>
          </div>
        ) : (
          <div className="row-list">
            {rows.map((pb) => {
              const inis = initiativesForPlaybook(pb.id);
              const inner = (
                <>
                  <div>
                    <div className="row-title">
                      {pb.name}
                      <PlaybookPill playbookId={pb.id} />
                      {pb.comingSoon ? (
                        <span className="pill">coming soon</span>
                      ) : pb.slug === "consultoria" ? (
                        <span className="pill pill-ok">activo V1</span>
                      ) : (
                        <span className="pill pill-warn">preview</span>
                      )}
                    </div>
                    <p className="row-sub">{pb.blurb}</p>
                    <p className="row-meta">
                      {pb.stages.length} etapas · tipos{" "}
                      {pb.compatibleTypes.join(", ")} · {inis.length}{" "}
                      iniciativas
                    </p>
                  </div>
                  <span className="pill">
                    {pb.comingSoon ? "pronto" : "abrir"}
                  </span>
                </>
              );
              if (pb.comingSoon) {
                return (
                  <div
                    key={pb.id}
                    className="row playbook-index-row is-disabled"
                    aria-disabled="true"
                  >
                    {inner}
                  </div>
                );
              }
              return (
                <Link
                  key={pb.id}
                  className="row playbook-index-row"
                  href={`/playbooks/${pb.slug}`}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

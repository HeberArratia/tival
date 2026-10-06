import Link from "next/link";
import { AppShell, SegmentPill, Topbar } from "@/components/AppShell";
import { FAKE_INITIATIVES } from "@/lib/fake-data";
import { GLOSSARY } from "@/lib/glossary";
import {
  workspaceSegments,
  segmentModeLabel,
} from "@/lib/segments";
import { getWorkspacePack } from "@/lib/workspace/registry";

export const dynamic = "force-dynamic";

/** Catálogo de segmentos del workspace — concepto UI. */
export default function SegmentosPage() {
  const pack = getWorkspacePack();
  const segments = workspaceSegments(pack.slug);

  return (
    <AppShell active="segmentos">
      <Topbar
        title="Segmentos"
        subtitle={`${GLOSSARY.segmento.short} Criterios del workspace ${pack.name}.`}
      />
      <div className="content">
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">Workspace · {pack.name}</p>
          <h3>A quién busca la empresa</h3>
          <p className="lede">
            El catálogo vive en el workspace pack (
            <span className="mono">workspaces/{pack.slug}</span>
            ). Cada iniciativa declara a qué segmentos apunta. El segmento
            resuelto queda en la oportunidad — no es una etapa del playbook.
          </p>
        </div>

        <div className="row-list" style={{ marginBottom: "1.5rem" }}>
          {segments.map((seg) => {
            const inis = FAKE_INITIATIVES.filter((i) =>
              i.targetSegmentIds?.includes(seg.id)
            );
            return (
              <div key={seg.id} className="panel" style={{ marginBottom: "0.75rem" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <SegmentPill segment={seg} />
                  <h3 style={{ margin: 0 }}>{seg.name}</h3>
                </div>
                <p className="lede">{seg.blurb}</p>
                <div style={{ marginTop: "0.75rem" }}>
                  <p className="panel-kicker">Criterios (orientativos)</p>
                  <ul className="initiative-list">
                    {seg.criteria.map((c) => (
                      <li key={c.key}>
                        <strong>{c.label}</strong> · {c.hint}
                      </li>
                    ))}
                  </ul>
                </div>
                {inis.length > 0 ? (
                  <p className="row-meta" style={{ marginTop: "0.75rem" }}>
                    Iniciativas ·{" "}
                    {inis.map((i, idx) => (
                      <span key={i.id}>
                        {idx > 0 ? " · " : ""}
                        {i.comingSoon ? (
                          <span>
                            {i.name}{" "}
                            <span className="pill">pronto</span>
                          </span>
                        ) : (
                          <Link
                            href={`/iniciativas/${i.slug}`}
                            style={{ textDecoration: "underline" }}
                          >
                            {i.name}
                          </Link>
                        )}
                        <span className="mono">
                          {" "}
                          ({segmentModeLabel(i.segmentMode).split(" · ")[0]})
                        </span>
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

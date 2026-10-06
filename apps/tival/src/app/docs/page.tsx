import { AppShell, Topbar } from "@/components/AppShell";
import { FlowLegend, GlossaryLegend } from "@/components/ProcessUI";
import { FLOW_LINE, GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-dynamic";

/** Definiciones del modelo Tival. */
export default function DocsPage() {
  const entries = Object.values(GLOSSARY);

  return (
    <AppShell active="docs">
      <Topbar
        title="Docs"
        subtitle={`Definiciones del modelo · ${FLOW_LINE}`}
      />
      <div className="content">
        <GlossaryLegend />
        <FlowLegend />

        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">Glosario</p>
          <h3>Cómo se habla en Tival</h3>
          <p className="lede">
            Términos del modelo comercial. La UI y los playbooks usan estas
            palabras con el mismo significado.
          </p>
        </div>

        <div className="row-list">
          {entries.map((entry) => (
            <div key={entry.term} className="panel" style={{ marginBottom: "0.65rem" }}>
              <h3 style={{ margin: 0 }}>{entry.term}</h3>
              <p className="lede" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                {entry.short}
              </p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AppShell,
  InitiativePill,
  PlaybookPill,
  SegmentPill,
  StatusPill,
  Topbar,
} from "@/components/AppShell";
import { chileRegionLabel } from "@/lib/chile-regions";
import { getDirectoryCompany } from "@/lib/companies-dir";
import { initiativeForCase, opportunityHref, segmentForCase } from "@/lib/fake-data";
import { GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-dynamic";

export default async function EmpresaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await getDirectoryCompany(id);
  if (!entry) notFound();

  const { company, contacts, opportunities } = entry;

  return (
    <AppShell active="empresas">
      <Topbar
        title={company.name || "Sin razón social"}
        subtitle={company.rut ?? "sin RUT"}
        actions={
          <Link className="btn btn-ghost" href="/empresas">
            ← Empresas
          </Link>
        }
      />
      <div className="content">
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">{GLOSSARY.empresa.term}</p>
          <h3>Ficha</h3>
          <dl className="field-grid">
            <div>
              <dt>RUT</dt>
              <dd className="mono">{company.rut ?? "—"}</dd>
            </div>
            <div>
              <dt>Razón social</dt>
              <dd>{company.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Tipo sociedad</dt>
              <dd>{company.societyType ?? "—"}</dd>
            </div>
            <div>
              <dt>Antigüedad</dt>
              <dd>{company.antiquity ?? "—"}</dd>
            </div>
            <div>
              <dt>Ventas 12 meses</dt>
              <dd>{company.sales12m ?? "—"}</dd>
            </div>
            <div>
              <dt>Región</dt>
              <dd>{chileRegionLabel(company.region) ?? "—"}</dd>
            </div>
            <div>
              <dt>Giro</dt>
              <dd>{company.giro ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">{GLOSSARY.contacto.term}</p>
          <h3>Contactos</h3>
          {contacts.length === 0 ? (
            <p className="lede">Sin contactos ligados.</p>
          ) : (
            <div className="row-list" style={{ marginTop: "0.75rem" }}>
              {contacts.map((ct) => (
                <Link key={ct.id} className="row" href={`/contactos/${ct.id}`}>
                  <div>
                    <div className="row-title">{ct.name || "Sin nombre"}</div>
                    <p className="row-sub">{ct.email ?? "sin email"}</p>
                  </div>
                  <span className="pill">ver</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">{GLOSSARY.oportunidad.term}</p>
          <h3>Oportunidades</h3>
          <p className="lede">
            Deals donde esta empresa es la primaria (facturación / postulación).
          </p>
          {opportunities.length === 0 ? (
            <p className="lede" style={{ marginTop: "0.75rem" }}>
              Sin oportunidades.
            </p>
          ) : (
            <div className="row-list" style={{ marginTop: "0.75rem" }}>
              {opportunities.map((c) => {
                const ini = initiativeForCase(c);
                const seg = segmentForCase(c);
                return (
                  <div key={c.id} className="row" style={{ cursor: "default" }}>
                    <div>
                      <div className="row-title">
                        {c.contact?.name || "Oportunidad"}
                        <PlaybookPill playbookId={c.playbookId} />
                        <InitiativePill initiative={ini} />
                        <SegmentPill segment={seg} />
                        <StatusPill status={c.status} />
                      </div>
                      <p className="row-meta">{ini?.name ?? "iniciativa"}</p>
                    </div>
                    <Link className="btn" href={opportunityHref(c)}>
                      oportunidad
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

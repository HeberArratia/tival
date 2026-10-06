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
import { getDirectoryContact } from "@/lib/contacts";
import { initiativeForCase, opportunityHref, segmentForCase } from "@/lib/fake-data";
import { GLOSSARY } from "@/lib/glossary";

export const dynamic = "force-dynamic";

export default async function ContactoDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const entry = await getDirectoryContact(key);
  if (!entry) notFound();

  const { contact, phones, companies, opportunities } = entry;
  const otherPhones = phones.filter((p) => p.phone !== contact.primaryPhone);

  return (
    <AppShell active="contactos">
      <Topbar
        title={contact.name || "Sin nombre"}
        subtitle={contact.email ?? "sin email"}
        actions={
          <Link className="btn btn-ghost" href="/contactos">
            ← Contactos
          </Link>
        }
      />
      <div className="content">
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">{GLOSSARY.contacto.term}</p>
          <h3>Identidad</h3>
          <p className="lede" style={{ marginBottom: "0.75rem" }}>
            Datos de la persona. Las oportunidades y empresas viven aparte.
          </p>
          <dl className="field-grid">
            <div>
              <dt>Email</dt>
              <dd className="mono">{contact.email ?? "—"}</dd>
            </div>
            <div>
              <dt>Teléfono principal</dt>
              <dd className="mono">{contact.primaryPhone ?? "—"}</dd>
            </div>
            {otherPhones.length > 0 ? (
              <div>
                <dt>También</dt>
                <dd className="mono">
                  {otherPhones.map((p) => p.phone).join(" · ")}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">{GLOSSARY.empresa.term}</p>
          <h3>Empresas</h3>
          {companies.length === 0 ? (
            <p className="lede">Sin empresas ligadas.</p>
          ) : (
            <div className="row-list" style={{ marginTop: "0.75rem" }}>
              {companies.map((co) => (
                <Link
                  key={co.id}
                  className="row"
                  href={`/empresas/${co.id}`}
                >
                  <div>
                    <div className="row-title">{co.name || "Sin razón social"}</div>
                    <p className="row-sub">
                      {co.rut ?? "sin RUT"}
                      {co.region ? ` · ${co.region}` : ""}
                    </p>
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
            Cada fila es una oportunidad en una iniciativa.
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
                const iniHref =
                  ini?.slug === "diagnostico"
                    ? "/procesos/diagnostico"
                    : ini
                      ? `/iniciativas/${ini.slug}`
                      : "/iniciativas";
                return (
                  <div key={c.id} className="row" style={{ cursor: "default" }}>
                    <div>
                      <div className="row-title">
                        {c.company?.name || c.contact?.name || "Oportunidad"}
                        <PlaybookPill playbookId={c.playbookId} />
                        <InitiativePill initiative={ini} />
                        <SegmentPill segment={seg} />
                        <StatusPill status={c.status} />
                      </div>
                      <p className="row-meta">
                        {GLOSSARY.oportunidad.term} en{" "}
                        {ini?.name ?? "iniciativa"}
                        {seg ? ` · ${seg.code}` : ""} · id {c.id.slice(0, 10)}…
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                      <Link className="btn btn-ghost" href={iniHref}>
                        iniciativa
                      </Link>
                      <Link className="btn" href={opportunityHref(c)}>
                        oportunidad
                      </Link>
                    </div>
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

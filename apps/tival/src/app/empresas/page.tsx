import Link from "next/link";
import { AppShell, InitiativePill, Topbar } from "@/components/AppShell";
import { chileRegionLabel } from "@/lib/chile-regions";
import { listDirectoryCompanies } from "@/lib/companies-dir";
import { initiativeForCase } from "@/lib/fake-data";

export const dynamic = "force-dynamic";

export default async function EmpresasPage() {
  let companies: Awaited<ReturnType<typeof listDirectoryCompanies>> = [];
  let dbError: string | null = null;
  try {
    companies = await listDirectoryCompanies();
  } catch (e) {
    dbError = e instanceof Error ? e.message : "db_error";
  }

  return (
    <AppShell active="empresas">
      <Topbar
        title="Empresas"
        subtitle="Sociedades · RUT de facturación / postulación."
      />
      <div className="content">
        {dbError ? (
          <div className="panel">
            <h3>Base de datos no disponible</h3>
            <p className="lede mono">{dbError}</p>
          </div>
        ) : companies.length === 0 ? (
          <div className="panel">
            <h3>Sin empresas</h3>
            <p className="lede">
              Se crean al capturar RUT o razón social en una oportunidad.
            </p>
          </div>
        ) : (
          <div className="row-list">
            {companies.map((entry) => {
              const inis = [
                ...new Map(
                  entry.opportunities
                    .map((o) => initiativeForCase(o))
                    .filter(Boolean)
                    .map((i) => [i!.id, i!] as const)
                ).values(),
              ];
              return (
                <Link
                  key={entry.company.id}
                  className="row"
                  href={`/empresas/${entry.company.id}`}
                >
                  <div>
                    <div className="row-title">
                      {entry.company.name || "Sin razón social"}
                    </div>
                    <p className="row-sub">
                      {entry.company.rut ?? "sin RUT"}
                      {entry.company.region
                        ? ` · ${chileRegionLabel(entry.company.region) ?? entry.company.region}`
                        : ""}
                      {entry.company.giro ? ` · ${entry.company.giro}` : ""}
                    </p>
                    <p className="row-meta">
                      {entry.contacts.length} contacto
                      {entry.contacts.length === 1 ? "" : "s"}
                      {" · "}
                      {entry.opportunities.length} oportunidad
                      {entry.opportunities.length === 1 ? "" : "es"}
                    </p>
                    {inis.length > 0 ? (
                      <div
                        style={{
                          marginTop: "0.35rem",
                          display: "flex",
                          gap: "0.35rem",
                          flexWrap: "wrap",
                        }}
                      >
                        {inis.map((i) => (
                          <InitiativePill key={i.id} initiative={i} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="pill">ver</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

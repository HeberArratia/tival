import Link from "next/link";
import {
  AppShell,
  InitiativePill,
  Topbar,
} from "@/components/AppShell";
import { listDirectoryContacts } from "@/lib/contacts";
import { initiativeForCase } from "@/lib/fake-data";

export const dynamic = "force-dynamic";

/** Directorio — personas (identidad). */
export default async function ContactosPage() {
  let contacts: Awaited<ReturnType<typeof listDirectoryContacts>> = [];
  let dbError: string | null = null;
  try {
    contacts = await listDirectoryContacts();
  } catch (e) {
    dbError = e instanceof Error ? e.message : "db_error";
  }

  return (
    <AppShell active="contactos">
      <Topbar
        title="Contactos"
        subtitle="Quién es · en qué iniciativas aparece."
      />
      <div className="content">
        {dbError ? (
          <div className="panel">
            <h3>Base de datos no disponible</h3>
            <p className="lede">
              Arranca Postgres o deja{" "}
              <span className="mono">USE_FAKE_DATA=1</span>.
            </p>
            <p className="lede mono">{dbError}</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="panel">
            <h3>Sin contactos</h3>
            <p className="lede">
              Aparecen cuando una iniciativa crea oportunidades.
            </p>
          </div>
        ) : (
          <div className="row-list">
            {contacts.map((ct) => {
              const inis = [
                ...new Map(
                  ct.opportunities
                    .map((o) => initiativeForCase(o))
                    .filter(Boolean)
                    .map((i) => [i!.id, i!] as const)
                ).values(),
              ];
              const phone =
                ct.contact.primaryPhone ?? ct.phones[0]?.phone ?? null;
              return (
                <Link
                  key={ct.contact.id}
                  className="row"
                  href={`/contactos/${ct.contact.id}`}
                >
                  <div>
                    <div className="row-title">
                      {ct.contact.name || "Sin nombre"}
                    </div>
                    <p className="row-sub">
                      {ct.contact.email ?? "sin email"}
                      {phone ? ` · ${phone}` : ""}
                    </p>
                    <p className="row-meta">
                      {ct.companies.length} empresa
                      {ct.companies.length === 1 ? "" : "s"}
                      {" · "}
                      {ct.opportunities.length} oportunidad
                      {ct.opportunities.length === 1 ? "" : "es"}
                      {inis.length > 0
                        ? ` · ${inis.map((i) => i.name).join(", ")}`
                        : ""}
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

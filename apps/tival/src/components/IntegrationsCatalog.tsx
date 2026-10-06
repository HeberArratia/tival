import Link from "next/link";
import type { ConnectionPublic } from "@/lib/integrations/connection-types";
import type { ProviderMeta } from "@/lib/integrations/providers";

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "connected"
      ? "pill pill-ok"
      : status === "error"
        ? "pill pill-warn"
        : "pill";
  const label =
    status === "connected"
      ? "conectado"
      : status === "error"
        ? "error"
        : "sin conectar";
  return <span className={cls}>{label}</span>;
}

/** Listado: cards con estado. La config vive en el show. */
export function IntegrationsCatalog({
  items,
}: {
  items: {
    provider: ProviderMeta;
    connection: ConnectionPublic | null;
  }[];
}) {
  return (
    <div className="integrations-grid">
      {items.map(({ provider, connection }) => {
        const status = connection?.status ?? "disconnected";
        return (
          <Link
            key={provider.id}
            href={`/integraciones/${provider.slug}`}
            className="integration-card panel"
          >
            <div className="integration-card-head">
              <div>
                <p className="panel-kicker">{provider.slug}</p>
                <h3>{provider.name}</h3>
              </div>
              <StatusBadge status={status} />
            </div>
            <p className="lede">{provider.blurb}</p>
            <span className="integration-card-cta">Configurar →</span>
          </Link>
        );
      })}
    </div>
  );
}

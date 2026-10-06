import { AppShell, Topbar } from "@/components/AppShell";
import { IntegrationsCatalog } from "@/components/IntegrationsCatalog";
import { listConnectionsForWorkspace } from "@/lib/integrations/connections";
import {
  defaultWorkspaceSlug,
  getWorkspacePack,
} from "@/lib/workspace/registry";

export const dynamic = "force-dynamic";

/** Listado de integraciones del workspace. */
export default async function IntegracionesPage() {
  const workspaceSlug = defaultWorkspaceSlug();
  const pack = getWorkspacePack(workspaceSlug);
  let items: Awaited<ReturnType<typeof listConnectionsForWorkspace>> = [];
  let loadError: string | null = null;

  try {
    items = await listConnectionsForWorkspace(workspaceSlug);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "No se pudo cargar";
  }

  const connected = items.filter(
    (i) => i.connection?.status === "connected"
  ).length;

  return (
    <AppShell active="integraciones">
      <Topbar
        title="Integraciones"
        subtitle={`${pack.name} · ${connected} conectada${connected === 1 ? "" : "s"}`}
      />
      <div className="content content-wide">
        {loadError ? (
          <div className="panel">
            <p className="field-error">{loadError}</p>
            <p className="lede">
              ¿Falta seed? Corré{" "}
              <span className="mono">npm run db:seed</span> en{" "}
              <span className="mono">apps/tival</span>.
            </p>
          </div>
        ) : (
          <IntegrationsCatalog items={items} />
        )}
      </div>
    </AppShell>
  );
}

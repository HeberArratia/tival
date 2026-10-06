import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell, Topbar } from "@/components/AppShell";
import { IntegrationDetail } from "@/components/IntegrationDetail";
import {
  ensureConnection,
  listConnectionsForWorkspace,
} from "@/lib/integrations/connections";
import {
  providerMeta,
  resolveProviderId,
} from "@/lib/integrations/providers";
import {
  defaultWorkspaceSlug,
  getWorkspacePack,
} from "@/lib/workspace/registry";

export const dynamic = "force-dynamic";

/** Show: configuración de una integración. */
export default async function IntegracionShowPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider: providerParam } = await params;
  const providerId = resolveProviderId(providerParam);
  if (!providerId) notFound();

  const provider = providerMeta(providerId);
  const workspaceSlug = defaultWorkspaceSlug();
  const pack = getWorkspacePack(workspaceSlug);

  let connection = null as Awaited<
    ReturnType<typeof listConnectionsForWorkspace>
  >[number]["connection"];
  let loadError: string | null = null;

  try {
    if (provider.connectable) {
      connection = await ensureConnection({
        workspaceSlug,
        provider: provider.id,
      });
    } else {
      const items = await listConnectionsForWorkspace(workspaceSlug);
      connection =
        items.find((i) => i.provider.id === provider.id)?.connection ?? null;
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : "No se pudo cargar";
  }

  const status = connection?.status ?? "disconnected";
  const statusLabel =
    status === "connected"
      ? "conectado"
      : status === "error"
        ? "error"
        : "sin conectar";

  return (
    <AppShell active="integraciones">
      <Topbar
        title={provider.name}
        subtitle={`${pack.name} · ${statusLabel}`}
      />
      <div className="content">
        {loadError ? (
          <div className="panel">
            <p className="field-error">{loadError}</p>
          </div>
        ) : (
          <Suspense fallback={<p className="lede">Cargando…</p>}>
            <IntegrationDetail
              workspaceSlug={workspaceSlug}
              provider={provider}
              connection={connection}
            />
          </Suspense>
        )}
      </div>
    </AppShell>
  );
}

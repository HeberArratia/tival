import { AppShell, Topbar } from "@/components/AppShell";
import { ProcessBoard } from "@/components/ProcessBoard";
import { listCasesForPlaybook } from "@/lib/cases";
import { ensureVentaDirectaPlaybook } from "@/lib/integrations/noviembre-startup";

export const dynamic = "force-dynamic";

const HIDDEN_STATUSES = ["cancelled", "rescheduled_away"];

/** Tablero operativo de la iniciativa noviembre-startup. */
export default async function NoviembreStartupPage() {
  let loadError: string | null = null;
  const ready = await ensureVentaDirectaPlaybook().catch((err: unknown) => {
    loadError = err instanceof Error ? err.message : "No se pudo cargar el playbook.";
    return null;
  });

  const opportunities = ready
    ? (await listCasesForPlaybook(ready.playbookId).catch(() => [])).filter(
        (row) => !HIDDEN_STATUSES.includes(row.status)
      )
    : [];

  return (
    <AppShell active="noviembre-startup">
      <Topbar
        title="noviembre-startup"
        subtitle="Venta directa · convocatoria"
      />
      <div className="content">
        {loadError ? (
          <div className="panel">
            <h3>Sin playbook</h3>
            <p className="lede">{loadError}</p>
          </div>
        ) : (
          <ProcessBoard
            stages={ready?.stages ?? []}
            opportunities={opportunities}
            title="noviembre-startup"
            quiet
            showPaymentRequest={false}
          />
        )}
      </div>
    </AppShell>
  );
}

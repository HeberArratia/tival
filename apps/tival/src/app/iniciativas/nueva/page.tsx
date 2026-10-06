import Link from "next/link";
import { AppShell, Topbar } from "@/components/AppShell";
import { CreateInitiativeForm } from "@/components/CreateInitiativeForm";

export const dynamic = "force-dynamic";

export default function NuevaIniciativaPage() {
  return (
    <AppShell active="iniciativas">
      <Topbar
        title="Nueva iniciativa"
        subtitle="Elegí tipo → playbook compatible (default) → config del canal."
        actions={
          <Link className="btn" href="/iniciativas">
            ← Iniciativas
          </Link>
        }
      />
      <div className="content">
        <div className="panel">
          <CreateInitiativeForm />
        </div>
      </div>
    </AppShell>
  );
}

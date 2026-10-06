import Link from "next/link";
import { AppShell, Topbar } from "@/components/AppShell";
import { InitiativesIndexClient } from "@/components/InitiativesIndexClient";

export const dynamic = "force-dynamic";

export default function IniciativasIndexPage() {
  return (
    <AppShell active="iniciativas">
      <Topbar
        title="Iniciativas"
        subtitle="Ofertas del workspace · cada una con su proceso."
        actions={
          <Link className="btn btn-primary" href="/iniciativas/nueva">
            Nueva iniciativa
          </Link>
        }
      />
      <div className="content">
        <InitiativesIndexClient />
      </div>
    </AppShell>
  );
}

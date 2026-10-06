import { AppShell, Topbar } from "@/components/AppShell";
import { ProductsAdmin } from "@/components/ProductsAdmin";
import { listProducts, seedProductsIfEmpty } from "@/lib/products-db";
import { getWorkspacePack } from "@/lib/workspace/registry";

export const dynamic = "force-dynamic";

/** Catálogo de productos del workspace — Configurar. */
export default async function ProductosPage() {
  const pack = getWorkspacePack();
  await seedProductsIfEmpty({ workspaceSlug: pack.slug }).catch(() => null);
  const items = await listProducts({ workspaceSlug: pack.slug }).catch(() => []);

  return (
    <AppShell active="productos">
      <Topbar
        title="Productos"
        subtitle={`${items.filter((p) => p.active).length} activos · ${items.length} en total`}
      />
      <div className="content">
        <ProductsAdmin initialProducts={items} />
      </div>
    </AppShell>
  );
}

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products, workspaces, type ProductRow } from "@/db/schema";
import { slugifyProductKey, type ProductSeed } from "@/lib/products";
import { ALFONDO_PRODUCTS_SEED } from "@/lib/products-seed-data";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export type ProductInput = {
  key?: string;
  name: string;
  priceListClp?: number | null;
  paymentLink?: string | null;
  active?: boolean;
};

async function resolveWorkspaceId(slug = defaultWorkspaceSlug()) {
  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new Error(`Workspace not found: ${slug}`);
  return ws;
}

export async function listProducts(opts?: {
  workspaceSlug?: string;
  activeOnly?: boolean;
}): Promise<ProductRow[]> {
  const db = await getDb();
  const ws = await resolveWorkspaceId(opts?.workspaceSlug);
  return db
    .select()
    .from(products)
    .where(
      opts?.activeOnly
        ? and(eq(products.workspaceId, ws.id), eq(products.active, true))
        : eq(products.workspaceId, ws.id)
    )
    .orderBy(asc(products.name));
}

export async function getProductById(id: string): Promise<ProductRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row ?? null;
}

export async function getProductByKey(input: {
  key: string;
  workspaceSlug?: string;
}): Promise<ProductRow | null> {
  const db = await getDb();
  const ws = await resolveWorkspaceId(input.workspaceSlug);
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, ws.id), eq(products.key, input.key)))
    .limit(1);
  return row ?? null;
}

function normalizeInput(input: ProductInput): Required<
  Pick<ProductInput, "name" | "active">
> & {
  key: string;
  priceListClp: number | null;
  paymentLink: string | null;
} {
  const name = input.name.trim();
  if (!name) throw new Error("name_required");
  const key = slugifyProductKey(input.key?.trim() || name);
  if (!key) throw new Error("key_required");

  let priceListClp = input.priceListClp ?? null;
  if (priceListClp != null) {
    priceListClp = Math.round(Number(priceListClp));
    if (Number.isNaN(priceListClp) || priceListClp < 0) {
      throw new Error("invalid_price");
    }
  }

  const paymentLink = input.paymentLink?.trim() || null;
  if (paymentLink && !/^https?:\/\//i.test(paymentLink)) {
    throw new Error("invalid_payment_link");
  }

  return {
    key,
    name,
    priceListClp,
    paymentLink,
    active: input.active ?? true,
  };
}

export async function createProduct(input: {
  workspaceSlug?: string;
  data: ProductInput;
}): Promise<ProductRow> {
  const db = await getDb();
  const ws = await resolveWorkspaceId(input.workspaceSlug);
  const data = normalizeInput(input.data);

  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, ws.id), eq(products.key, data.key)))
    .limit(1);
  if (existing) throw new Error("key_already_exists");

  const [row] = await db
    .insert(products)
    .values({
      workspaceId: ws.id,
      key: data.key,
      name: data.name,
      priceListClp: data.priceListClp,
      paymentLink: data.paymentLink,
      active: data.active,
    })
    .returning();
  return row;
}

export async function updateProduct(input: {
  id: string;
  data: ProductInput;
}): Promise<ProductRow> {
  const db = await getDb();
  const current = await getProductById(input.id);
  if (!current) throw new Error("not_found");

  const data = normalizeInput({
    ...input.data,
    key: input.data.key ?? current.key,
  });

  if (data.key !== current.key) {
    const [clash] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.workspaceId, current.workspaceId),
          eq(products.key, data.key)
        )
      )
      .limit(1);
    if (clash) throw new Error("key_already_exists");
  }

  const [row] = await db
    .update(products)
    .set({
      key: data.key,
      name: data.name,
      priceListClp: data.priceListClp,
      paymentLink: data.paymentLink,
      active: data.active,
      updatedAt: new Date(),
    })
    .where(eq(products.id, current.id))
    .returning();
  return row;
}

/** Inserta seed si el workspace aún no tiene productos. */
export async function seedProductsIfEmpty(opts?: {
  workspaceSlug?: string;
  catalog?: ProductSeed[];
}): Promise<{ inserted: number; skipped: boolean }> {
  const db = await getDb();
  const ws = await resolveWorkspaceId(opts?.workspaceSlug);
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.workspaceId, ws.id))
    .limit(1);
  if (existing.length > 0) return { inserted: 0, skipped: true };

  const catalog = opts?.catalog ?? ALFONDO_PRODUCTS_SEED;
  if (!catalog.length) return { inserted: 0, skipped: true };

  await db.insert(products).values(
    catalog.map((p) => ({
      workspaceId: ws.id,
      key: p.key,
      name: p.name,
      priceListClp: p.priceListClp ?? null,
      paymentLink: p.paymentLink ?? null,
      active: p.active ?? true,
    }))
  );
  return { inserted: catalog.length, skipped: false };
}

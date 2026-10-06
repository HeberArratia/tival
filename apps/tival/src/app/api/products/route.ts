import { NextRequest, NextResponse } from "next/server";
import {
  createProduct,
  listProducts,
  seedProductsIfEmpty,
} from "@/lib/products-db";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const slug =
      request.nextUrl.searchParams.get("workspace") ?? defaultWorkspaceSlug();
    const activeOnly =
      request.nextUrl.searchParams.get("activeOnly") === "1";
    const items = await listProducts({ workspaceSlug: slug, activeOnly });
    return NextResponse.json({ ok: true, workspace: slug, items });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body?.action === "seed") {
      const result = await seedProductsIfEmpty({
        workspaceSlug: body.workspaceSlug
          ? String(body.workspaceSlug)
          : undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const priceRaw = body.priceListClp;
    const priceListClp =
      priceRaw === "" || priceRaw == null ? null : Number(priceRaw);

    const row = await createProduct({
      workspaceSlug: body.workspaceSlug
        ? String(body.workspaceSlug)
        : undefined,
      data: {
        key: body.key ? String(body.key) : undefined,
        name: String(body.name ?? ""),
        priceListClp,
        paymentLink:
          body.paymentLink != null ? String(body.paymentLink) : null,
        active: body.active !== false,
      },
    });
    return NextResponse.json({ ok: true, product: row });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "error";
    const status =
      msg === "key_already_exists" ||
      msg === "name_required" ||
      msg === "invalid_price" ||
      msg === "invalid_payment_link" ||
      msg === "key_required"
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

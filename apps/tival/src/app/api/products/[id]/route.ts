import { NextRequest, NextResponse } from "next/server";
import { getProductById, updateProduct } from "@/lib/products-db";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const product = await getProductById(id);
    if (!product) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const priceRaw = body.priceListClp;
    const priceListClp =
      priceRaw === "" || priceRaw == null ? null : Number(priceRaw);

    const product = await updateProduct({
      id,
      data: {
        key: body.key ? String(body.key) : undefined,
        name: String(body.name ?? ""),
        priceListClp,
        paymentLink:
          body.paymentLink != null ? String(body.paymentLink) : null,
        active: body.active !== false,
      },
    });
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "error";
    const status =
      msg === "not_found"
        ? 404
        : msg === "key_already_exists" ||
            msg === "name_required" ||
            msg === "invalid_price" ||
            msg === "invalid_payment_link" ||
            msg === "key_required"
          ? 400
          : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

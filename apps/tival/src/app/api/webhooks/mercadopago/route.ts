import { NextRequest, NextResponse } from "next/server";
import { findCaseByCalendlyUuid, markPaid } from "@/lib/cases";
import { parsePaymentExternalReference } from "@/lib/payments/refs";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

/**
 * Mercado Pago webhook directo (opción B).
 * Opción A (recomendada): Alfondo POST /api/payments action=payment_approved.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const paymentId =
      body?.data?.id ??
      body?.id ??
      body?.payment_id ??
      request.nextUrl.searchParams.get("id");

    if (!paymentId) {
      return NextResponse.json({ ok: true, skipped: "no_payment_id" });
    }

    const workspaceSlug = defaultWorkspaceSlug();
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!token) {
      const calendlyUuid = parsePaymentExternalReference(
        body?.external_reference ?? body?.calendlyEventUuid,
        workspaceSlug
      );
      if (!calendlyUuid && !body?.caseId) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "MERCADOPAGO_ACCESS_TOKEN missing and no simulation payload",
          },
          { status: 400 }
        );
      }
      const result = await markPaid({
        caseId: body?.caseId,
        calendlyEventUuid: calendlyUuid ?? undefined,
        method: "mercadopago",
        mpPaymentId: String(paymentId),
        confirmedBy: "mp_webhook_sim",
      });
      return NextResponse.json({
        ok: true,
        simulated: true,
        caseId: result.case.id,
        alreadyPaid: result.alreadyPaid,
      });
    }

    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!paymentResponse.ok) {
      return NextResponse.json(
        { ok: false, error: "mp_fetch_failed" },
        { status: 502 }
      );
    }

    const payment = await paymentResponse.json();
    if (payment.status !== "approved") {
      return NextResponse.json({
        ok: true,
        skipped: "not_approved",
        status: payment.status,
      });
    }

    const calendlyUuid = parsePaymentExternalReference(
      payment.external_reference,
      workspaceSlug
    );
    if (!calendlyUuid) {
      return NextResponse.json(
        { ok: false, error: "missing_external_reference" },
        { status: 400 }
      );
    }

    const existing = await findCaseByCalendlyUuid(calendlyUuid);
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "case_not_found" },
        { status: 404 }
      );
    }

    const result = await markPaid({
      calendlyEventUuid: calendlyUuid,
      method: "mercadopago",
      mpPaymentId: String(payment.id),
      confirmedBy: "mp_webhook",
    });

    return NextResponse.json({
      ok: true,
      caseId: result.case.id,
      alreadyPaid: result.alreadyPaid,
    });
  } catch (error) {
    console.error("[mercadopago.webhook]", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "error" },
      { status: 500 }
    );
  }
}

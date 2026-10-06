import { NextRequest, NextResponse } from "next/server";
import { markPaid, markPaymentPending } from "@/lib/cases";
import { parsePaymentExternalReference } from "@/lib/payments/refs";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

function authorize(request: NextRequest) {
  const key = process.env.TIVAL_INTERNAL_KEY;
  if (!key) return true;
  const header = request.headers.get("x-tival-key");
  return header === key;
}

/**
 * Entrada de pago desde Alfondo / ops / simulador.
 *
 * Actions:
 * - payment_approved — MP (o POST Alfondo tras webhook MP)
 * - confirm_transfer — ops declara transfer recibida
 * - checkout_started — opcional (pending); no condiciona el botón
 */
export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = String(body?.action ?? "");
    const workspaceSlug = String(
      body.workspaceSlug ?? defaultWorkspaceSlug()
    );

    const calendlyFromRef = parsePaymentExternalReference(
      body.external_reference ?? body.externalReference,
      workspaceSlug
    );
    const calendlyEventUuid =
      (body.calendlyEventUuid
        ? String(body.calendlyEventUuid)
        : null) ?? calendlyFromRef;
    const caseId = body.caseId ? String(body.caseId) : undefined;

    if (action === "checkout_started") {
      if (!caseId && !calendlyEventUuid) {
        return NextResponse.json(
          { ok: false, error: "caseId_or_calendly_required" },
          { status: 400 }
        );
      }
      const row = await markPaymentPending({
        caseId,
        calendlyEventUuid: calendlyEventUuid ?? undefined,
        method:
          body.method === "transferencia" ? "transferencia" : "mercadopago",
      });
      return NextResponse.json({
        ok: true,
        action,
        caseId: row.id,
        paymentStatus: row.paymentStatus,
      });
    }

    if (action === "payment_approved" || action === "confirm_transfer") {
      if (!caseId && !calendlyEventUuid) {
        return NextResponse.json(
          {
            ok: false,
            error: "caseId_or_reference_required",
            hint: "Enviá caseId, calendlyEventUuid o external_reference diag_{uuid}",
          },
          { status: 400 }
        );
      }

      const method =
        action === "confirm_transfer"
          ? "transferencia"
          : body.method === "transferencia"
            ? "transferencia"
            : "mercadopago";

      const result = await markPaid({
        caseId,
        calendlyEventUuid: calendlyEventUuid ?? undefined,
        method,
        mpPaymentId: body.mpPaymentId ? String(body.mpPaymentId) : null,
        confirmedBy:
          body.confirmedBy ??
          (action === "confirm_transfer" ? "ops_manual" : "alfondo_mp"),
      });

      return NextResponse.json({
        ok: true,
        action,
        caseId: result.case.id,
        alreadyPaid: result.alreadyPaid,
        paymentStatus: result.case.paymentStatus,
        stageId: result.case.currentStageId,
      });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    console.error("[payments]", error);
    const message = error instanceof Error ? error.message : "error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

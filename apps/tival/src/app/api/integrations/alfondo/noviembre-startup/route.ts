import { NextRequest, NextResponse } from "next/server";
import {
  alfondoInboundApiKey,
  ingestNoviembreStartup,
  readInboundApiKey,
} from "@/lib/integrations/noviembre-startup";

export const runtime = "nodejs";

/**
 * POST de Alfondo cuando una solicitud de noviembre-startup pasa las validaciones.
 * Auth: el mismo secreto que Tival usa para GET /api/diagnostico/log (ALFONDO_API_KEY).
 */
export async function POST(request: NextRequest) {
  const expected = alfondoInboundApiKey();
  if (!expected) {
    console.error("[noviembre-startup] ALFONDO_API_KEY no configurada");
    return NextResponse.json(
      { ok: false, error: "Tival no tiene ALFONDO_API_KEY configurada." },
      { status: 500 }
    );
  }

  const presented = readInboundApiKey(request);
  if (!presented || presented !== expected) {
    return NextResponse.json(
      { ok: false, error: "No autorizado." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "El body tiene que ser JSON." },
      { status: 400 }
    );
  }

  try {
    const result = await ingestNoviembreStartup(body);
    return NextResponse.json(
      { ok: true, opportunity_id: result.opportunityId },
      { status: result.created ? 201 : 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno.";
    const invalid =
      message.includes("tiene que") ||
      message.includes("obligatorio") ||
      message.includes("no es") ||
      message.includes("admite hasta") ||
      message.includes("declaraciones");
    if (invalid) {
      const submissionId =
        body && typeof body === "object" && "submission_id" in body
          ? String((body as { submission_id?: unknown }).submission_id ?? "")
          : "";
      console.info("[noviembre-startup]", {
        submission_id: submissionId,
        error: message,
      });
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    console.error("[noviembre-startup]", err);
    return NextResponse.json(
      { ok: false, error: "Error interno." },
      { status: 500 }
    );
  }
}

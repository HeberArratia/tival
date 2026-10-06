import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Endpoint legacy sin token de conexión.
 * Las organizaciones deben usar /api/webhooks/calendly/{webhookToken}
 * (se copia desde Configurar → Integraciones).
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "webhook_token_required",
      hint: "Usá la URL de la conexión Calendly del workspace: /api/webhooks/calendly/{token}",
    },
    { status: 410 }
  );
}

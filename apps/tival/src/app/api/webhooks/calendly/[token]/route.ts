import { NextRequest, NextResponse } from "next/server";
import { handleCalendlyWebhook } from "@/lib/integrations/calendly-webhook";

export const runtime = "nodejs";

/**
 * Webhook Calendly scoped a una conexión de workspace.
 * URL: /api/webhooks/calendly/{webhookToken}
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("calendly-webhook-signature") ??
    request.headers.get("Calendly-Webhook-Signature");

  const result = await handleCalendlyWebhook({
    webhookToken: token,
    rawBody,
    signatureHeader,
    allowUnsignedDev: true,
  });

  return NextResponse.json(result.body, { status: result.status });
}

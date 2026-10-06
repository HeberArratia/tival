import { NextRequest, NextResponse } from "next/server";
import { registerCalendlyWebhook } from "@/lib/integrations/calendly-register-webhook";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

/** Registra o recrea el webhook en Calendly (URL = NEXT_PUBLIC_APP_URL). */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const workspaceSlug = String(
      (body as { workspaceSlug?: string }).workspaceSlug ??
        defaultWorkspaceSlug()
    );

    const result = await registerCalendlyWebhook({
      connectionId: id,
      workspaceSlug,
    });

    if (!result.ok) {
      const status =
        result.error.includes("missing") ||
        result.error.includes("not_found") ||
        result.error.includes("public_base_url")
          ? 400
          : 502;
      return NextResponse.json(
        { ok: false, error: result.error },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      connection: result.connection,
      webhookUrl: result.webhookUrl,
      action: result.action,
      deletedCount: result.deletedCount,
      env: result.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

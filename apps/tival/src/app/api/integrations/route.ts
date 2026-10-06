import { NextRequest, NextResponse } from "next/server";
import type { IntegrationProvider } from "@/db/schema";
import {
  CONNECTABLE_PROVIDERS,
  ensureConnection,
  listConnectionsForWorkspace,
} from "@/lib/integrations/connections";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const slug =
      request.nextUrl.searchParams.get("workspace") ?? defaultWorkspaceSlug();
    const items = await listConnectionsForWorkspace(slug);
    return NextResponse.json({ ok: true, workspace: slug, items });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "error",
      },
      { status: 500 }
    );
  }
}

/** Crea (o devuelve) la fila de conexión para un proveedor. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceSlug = String(
      body.workspaceSlug ?? defaultWorkspaceSlug()
    );
    const provider = String(body.provider ?? "") as IntegrationProvider;
    if (!provider) {
      return NextResponse.json(
        { ok: false, error: "provider_required" },
        { status: 400 }
      );
    }
    if (!CONNECTABLE_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { ok: false, error: "provider_not_connectable_yet" },
        { status: 400 }
      );
    }
    const connection = await ensureConnection({
      workspaceSlug,
      provider,
      label: body.label ? String(body.label) : undefined,
    });
    return NextResponse.json({ ok: true, connection });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "error",
      },
      { status: 500 }
    );
  }
}

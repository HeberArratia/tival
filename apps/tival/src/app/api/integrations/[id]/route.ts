import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import {
  updateCalendlyConnection,
  updateDriveConnection,
} from "@/lib/integrations/connections";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const workspaceSlug = String(
      body.workspaceSlug ?? defaultWorkspaceSlug()
    );

    const db = await getDb();
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "Connection not found" },
        { status: 404 }
      );
    }

    if (row.provider === "google_drive") {
      const connection = await updateDriveConnection({
        connectionId: id,
        workspaceSlug,
        config: body.config,
        markConnected: body.markConnected,
      });
      return NextResponse.json({ ok: true, connection });
    }

    const connection = await updateCalendlyConnection({
      connectionId: id,
      workspaceSlug,
      signingKey:
        body.signingKey === undefined ? undefined : body.signingKey || null,
      apiToken:
        body.apiToken === undefined ? undefined : body.apiToken || null,
      config: body.config,
      markConnected: body.markConnected,
    });

    return NextResponse.json({ ok: true, connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

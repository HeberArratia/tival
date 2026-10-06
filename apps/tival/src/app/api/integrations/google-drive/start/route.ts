import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureConnection,
} from "@/lib/integrations/connections";
import {
  buildDriveAuthUrl,
  signOAuthState,
} from "@/lib/integrations/google-drive/oauth";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const runtime = "nodejs";

/** Inicia OAuth Google (Drive + Calendar) para el workspace. */
export async function GET(request: NextRequest) {
  try {
    const workspaceSlug =
      request.nextUrl.searchParams.get("workspace") ?? defaultWorkspaceSlug();

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_google_oauth_env",
          hint: "Definí GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.local",
        },
        { status: 500 }
      );
    }

    const connection = await ensureConnection({
      workspaceSlug,
      provider: "google_drive",
      label: "Google",
    });

    const state = signOAuthState({
      workspaceSlug,
      connectionId: connection.id,
      nonce: randomBytes(8).toString("hex"),
      exp: Date.now() + 15 * 60 * 1000,
    });

    const url = buildDriveAuthUrl(state);
    return NextResponse.redirect(url);
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

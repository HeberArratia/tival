import { NextRequest, NextResponse } from "next/server";
import { updateDriveConnection } from "@/lib/integrations/connections";
import {
  exchangeCodeForTokens,
  verifyOAuthState,
} from "@/lib/integrations/google-drive/oauth";

export const runtime = "nodejs";

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

/** Callback OAuth Google → guarda refresh_token cifrado. */
export async function GET(request: NextRequest) {
  const base = appBaseUrl();
  const driveShowUrl = `${base}/integraciones/google`;

  try {
    const err = request.nextUrl.searchParams.get("error");
    if (err) {
      return NextResponse.redirect(
        `${driveShowUrl}?drive=error&reason=${encodeURIComponent(err)}`
      );
    }

    const code = request.nextUrl.searchParams.get("code");
    const stateRaw = request.nextUrl.searchParams.get("state");
    if (!code || !stateRaw) {
      return NextResponse.redirect(
        `${driveShowUrl}?drive=error&reason=missing_code`
      );
    }

    const state = verifyOAuthState(stateRaw);
    const tokens = await exchangeCodeForTokens(code);

    await updateDriveConnection({
      connectionId: state.connectionId,
      workspaceSlug: state.workspaceSlug,
      tokens,
      markConnected: true,
    });

    return NextResponse.redirect(`${driveShowUrl}?drive=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    return NextResponse.redirect(
      `${driveShowUrl}?drive=error&reason=${encodeURIComponent(message)}`
    );
  }
}

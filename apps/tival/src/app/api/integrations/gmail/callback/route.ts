import { NextRequest, NextResponse } from "next/server";
import { updateGmailConnection } from "@/lib/integrations/connections";
import { gmailSyncMailboxEmail } from "@/lib/integrations/gmail/config";
import {
  exchangeGmailCodeForTokens,
  verifyOAuthState,
} from "@/lib/integrations/gmail/oauth";

export const runtime = "nodejs";

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

/** Callback OAuth Gmail → guarda refresh_token cifrado. */
export async function GET(request: NextRequest) {
  const base = appBaseUrl();
  const showUrl = `${base}/integraciones/gmail`;

  try {
    const err = request.nextUrl.searchParams.get("error");
    if (err) {
      return NextResponse.redirect(
        `${showUrl}?gmail=error&reason=${encodeURIComponent(err)}`
      );
    }

    const code = request.nextUrl.searchParams.get("code");
    const stateRaw = request.nextUrl.searchParams.get("state");
    if (!code || !stateRaw) {
      return NextResponse.redirect(
        `${showUrl}?gmail=error&reason=missing_code`
      );
    }

    const state = verifyOAuthState(stateRaw);
    const tokens = await exchangeGmailCodeForTokens(code);

    const expected = gmailSyncMailboxEmail();
    if (
      tokens.accountEmail &&
      tokens.accountEmail.toLowerCase() !== expected
    ) {
      return NextResponse.redirect(
        `${showUrl}?gmail=error&reason=${encodeURIComponent(
          `Conectaste ${tokens.accountEmail}; se espera ${expected}`
        )}`
      );
    }

    await updateGmailConnection({
      connectionId: state.connectionId,
      workspaceSlug: state.workspaceSlug,
      tokens,
      markConnected: true,
    });

    return NextResponse.redirect(`${showUrl}?gmail=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    return NextResponse.redirect(
      `${showUrl}?gmail=error&reason=${encodeURIComponent(message)}`
    );
  }
}

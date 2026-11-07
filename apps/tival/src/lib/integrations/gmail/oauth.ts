/**
 * OAuth Gmail readonly para el buzón compartido (hablemos@).
 * Reusa GOOGLE_CLIENT_ID / SECRET del mismo proyecto GCP que Drive.
 */

import {
  refreshAccessToken,
  signOAuthState,
  verifyOAuthState,
  type DriveOAuthTokens,
  type OAuthStatePayload,
} from "@/lib/integrations/google-drive/oauth";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GMAIL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export type GmailOAuthTokens = DriveOAuthTokens;
export type { OAuthStatePayload };
export { signOAuthState, verifyOAuthState, refreshAccessToken };

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env.local"
    );
  }
  return { clientId, clientSecret };
}

export function gmailOAuthRedirectUri() {
  return `${appBaseUrl()}/api/integrations/gmail/callback`;
}

export function buildGmailAuthUrl(state: string): string {
  const { clientId } = oauthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailOAuthRedirectUri(),
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  const loginHint = process.env.GMAIL_SYNC_MAILBOX?.trim();
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export async function exchangeGmailCodeForTokens(
  code: string
): Promise<GmailOAuthTokens> {
  const { clientId, clientSecret } = oauthClient();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: gmailOAuthRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || `token_exchange_failed_${res.status}`);
  }
  if (!data.refresh_token) {
    throw new Error(
      "Google no devolvió refresh_token. Revocá el acceso a Tival en https://myaccount.google.com/permissions y volvé a conectar con prompt=consent."
    );
  }

  let accountEmail: string | undefined;
  try {
    const ui = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (ui.ok) {
      const profile = (await ui.json()) as { email?: string };
      accountEmail = profile.email?.toLowerCase();
    }
  } catch {
    /* opcional */
  }

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
    accountEmail,
  };
}

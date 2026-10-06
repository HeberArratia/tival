import { createHmac, timingSafeEqual } from "crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * Google del workspace:
 * - Drive: carpetas / mover artefactos
 * - Calendar readonly: hangoutLink / meeting code
 * - Meet readonly: conferenceRecords, notes, recordings, transcripts
 *
 * Tras cambiar scopes hay que reconectar en /integraciones (prompt=consent).
 * En GCP también debe estar enabled Calendar API + Google Meet API.
 */
export const DRIVE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export type DriveOAuthTokens = {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  accountEmail?: string;
};

export type OAuthStatePayload = {
  workspaceSlug: string;
  connectionId: string;
  nonce: string;
  exp: number;
};

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

function stateSecret() {
  return (
    process.env.INTEGRATIONS_ENCRYPTION_KEY ||
    process.env.TIVAL_INTERNAL_KEY ||
    "dev-only-insecure-integrations-key"
  );
}

export function driveOAuthRedirectUri() {
  return `${appBaseUrl()}/api/integrations/google-drive/callback`;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(raw: string): OAuthStatePayload {
  const [body, sig] = raw.split(".");
  if (!body || !sig) throw new Error("invalid_oauth_state");
  const expected = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("invalid_oauth_state_signature");
  }
  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8")
  ) as OAuthStatePayload;
  if (!payload.workspaceSlug || !payload.connectionId || !payload.exp) {
    throw new Error("invalid_oauth_state_payload");
  }
  if (Date.now() > payload.exp) throw new Error("oauth_state_expired");
  return payload;
}

export function buildDriveAuthUrl(state: string): string {
  const { clientId } = oauthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveOAuthRedirectUri(),
    response_type: "code",
    scope: DRIVE_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

async function fetchTokens(
  body: URLSearchParams
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || `token_exchange_failed_${res.status}`);
  }
  return data;
}

export async function exchangeCodeForTokens(
  code: string
): Promise<DriveOAuthTokens> {
  const { clientId, clientSecret } = oauthClient();
  const data = await fetchTokens(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: driveOAuthRedirectUri(),
      grant_type: "authorization_code",
    })
  );

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
      accountEmail = profile.email;
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

export async function refreshAccessToken(
  refreshToken: string
): Promise<DriveOAuthTokens> {
  const { clientId, clientSecret } = oauthClient();
  const data = await fetchTokens(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    })
  );

  return {
    refreshToken,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

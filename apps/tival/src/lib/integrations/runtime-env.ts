/**
 * Helpers de entorno seguros para client + server.
 * No importar DB ni módulos Node desde acá.
 */

export function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

/** True si la app apunta a localhost (en dev hace falta túnel / host override). */
export function isLocalAppBaseUrl(raw?: string | null) {
  const value = (raw ?? appBaseUrl()).trim();
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" || host === "127.0.0.1" || host === "[::1]"
    );
  } catch {
    return true;
  }
}

/**
 * Entorno de esta instancia (`NEXT_PUBLIC_TIVAL_ENV`).
 * Una sola variable: Next la expone a client y server (no es secreto).
 * Ej: local | production | staging.
 */
export function tivalRuntimeEnv() {
  const fromEnv = (process.env.NEXT_PUBLIC_TIVAL_ENV || "")
    .trim()
    .toLowerCase();
  if (fromEnv) return fromEnv.replace(/[^a-z0-9_-]/g, "") || "local";
  return isLocalAppBaseUrl() ? "local" : "production";
}

/** Host público (ngrok / prod). Solo https excepto localhost. */
export function normalizePublicBaseUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return { ok: false, error: "public_base_url_empty" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "public_base_url_invalid" };
  }
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    return { ok: false, error: "public_base_url_https_required" };
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    return { ok: false, error: "public_base_url_no_path" };
  }
  return { ok: true, url: `${parsed.protocol}//${parsed.host}` };
}

export function calendlyWebhookUrl(
  webhookToken: string,
  publicBaseUrl?: string | null
) {
  const base = (publicBaseUrl || appBaseUrl()).replace(/\/$/, "");
  return `${base}/api/webhooks/calendly/${webhookToken}`;
}

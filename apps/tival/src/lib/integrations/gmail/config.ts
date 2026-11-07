import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

const DEFAULT_EXCLUDE_DOMAINS = [
  "calendly.com",
  "email.calendly.com",
  "notifications.google.com",
  "calendar-notification.google.com",
  "google.com",
  "noreply.github.com",
  "bounce.google.com",
];

/** Buzón esperado (login_hint + validación post-OAuth). */
export function gmailSyncMailboxEmail(): string {
  return (
    process.env.GMAIL_SYNC_MAILBOX?.trim().toLowerCase() ||
    "hablemos@alfondo.cl"
  );
}

export function gmailSyncWorkspaceSlug(): string {
  return (
    process.env.GMAIL_SYNC_WORKSPACE_SLUG?.trim().toLowerCase() ||
    defaultWorkspaceSlug()
  );
}

/** Días hacia atrás en el bootstrap (sin historyId). */
export function gmailSyncBootstrapDays(): number {
  const raw = Number(process.env.GMAIL_SYNC_BOOTSTRAP_DAYS || "30");
  if (!Number.isFinite(raw) || raw < 1) return 30;
  return Math.min(Math.floor(raw), 365);
}

export function gmailSyncExcludeDomains(): string[] {
  const raw = process.env.GMAIL_SYNC_EXCLUDE_DOMAINS?.trim();
  if (!raw) return DEFAULT_EXCLUDE_DOMAINS;
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** OAuth client compartido con Drive. */
export function isGmailOAuthEnvReady(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

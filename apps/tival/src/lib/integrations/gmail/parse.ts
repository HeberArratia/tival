/** Parseo liviano de headers/MIME de Gmail (sin deps). */

export type ParsedAddress = { email: string; name: string | null };

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

/** `Name <a@b.com>` / `a@b.com` / lista separada por comas. */
export function parseAddressList(header: string | null | undefined): ParsedAddress[] {
  if (!header?.trim()) return [];
  const parts = header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const out: ParsedAddress[] = [];
  for (const part of parts) {
    const s = part.trim();
    if (!s) continue;
    const angle = s.match(/^(.*?)\s*<([^>]+)>$/);
    if (angle) {
      const email = normalizeEmail(angle[2]);
      if (!email) continue;
      const name = angle[1].replace(/^["']|["']$/g, "").trim() || null;
      out.push({ email, name });
      continue;
    }
    const email = normalizeEmail(s.replace(/^<|>$/g, ""));
    if (email) out.push({ email, name: null });
  }
  return out;
}

export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

export function isExcludedSender(
  fromEmail: string | null | undefined,
  excludeDomains: string[]
): boolean {
  if (!fromEmail) return false;
  const domain = domainOfEmail(fromEmail);
  if (!domain) return false;
  const local = fromEmail.split("@")[0] || "";
  if (local.startsWith("noreply") || local.startsWith("no-reply")) return true;
  if (local === "mailer-daemon" || local === "postmaster") return true;
  return excludeDomains.some(
    (d) => domain === d || domain.endsWith(`.${d}`)
  );
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

type MimePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: MimePart[];
};

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function collectBodies(
  part: MimePart | undefined,
  acc: { plain: string[]; html: string[] }
) {
  if (!part) return;
  const mime = (part.mimeType || "").toLowerCase();
  if (part.body?.data) {
    const text = decodeBase64Url(part.body.data);
    if (mime === "text/plain") acc.plain.push(text);
    else if (mime === "text/html") acc.html.push(text);
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) collectBodies(child, acc);
  }
}

/** Preferí text/plain; si no hay, strip de HTML. */
export function extractBodyText(payload: MimePart | undefined): string | null {
  const acc = { plain: [] as string[], html: [] as string[] };
  collectBodies(payload, acc);
  if (acc.plain.length) return acc.plain.join("\n\n").trim() || null;
  if (acc.html.length) {
    return htmlToPlainText(acc.html.join("\n")) || null;
  }
  return null;
}

export function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
): string | null {
  if (!headers?.length) return null;
  const lower = name.toLowerCase();
  const found = headers.find((h) => (h.name || "").toLowerCase() === lower);
  return found?.value?.trim() || null;
}

/**
 * Limpia texto plano de Gmail para UI: cita colapsable, links cortos, menos ruido.
 */

export type BodyPart = { type: "text"; value: string } | { type: "link"; href: string; label: string };

const QUOTE_HEADER_RE =
  /^(El .+ escribió:\s*|On .+ wrote:\s*|From:\s*.+|-{2,}\s*Original Message\s*-{2,}|_{2,}\s*)$/i;

const ANGLE_LINK_RE =
  /(?:^|[\s(])(?:([^<\n]{1,80}?)\s+)?<(https?:\/\/[^>\s]+)>/g;

const BARE_URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Quita `*digits*` estilo WhatsApp/markdown suelto. */
export function stripNoiseMarkup(text: string): string {
  return text
    .replace(/\*(\d{6,})\*/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Separa el mensaje nuevo de la cadena citada (`>` / "El … escribió:").
 */
export function splitQuotedReply(raw: string): {
  main: string;
  quoted: string | null;
} {
  const text = stripNoiseMarkup(raw);
  if (!text) return { main: "", quoted: null };

  const lines = text.split(/\r?\n/);
  let cut = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (QUOTE_HEADER_RE.test(line)) {
      cut = i;
      break;
    }
    // Bloque de citas con > (al menos 2 líneas seguidas o una larga)
    if (line.startsWith(">")) {
      const next = lines[i + 1]?.trim() ?? "";
      if (next.startsWith(">") || line.length > 40 || i > 2) {
        cut = i;
        break;
      }
    }
  }

  if (cut < 0) return { main: text, quoted: null };

  const main = lines.slice(0, cut).join("\n").trim();
  const quoted = lines
    .slice(cut)
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();

  return {
    main: main || text,
    quoted: quoted || null,
  };
}

function shortUrlLabel(href: string): string {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname;
    const full = `${host}${path}`;
    if (full.length <= 48) return full;
    return `${full.slice(0, 45)}…`;
  } catch {
    return href.length > 48 ? `${href.slice(0, 45)}…` : href;
  }
}

/** Parte el texto en texto + links clickeables (labels cortos). */
export function linkifyBody(text: string): BodyPart[] {
  if (!text) return [];

  // Primero: `etiqueta <url>` / `<url>`
  type Hit = { start: number; end: number; href: string; label: string };
  const hits: Hit[] = [];

  for (const m of text.matchAll(ANGLE_LINK_RE)) {
    const full = m[0];
    const idx = m.index ?? 0;
    // match puede incluir espacio inicial
    const lead = full.match(/^[\s(]/)?.[0] ?? "";
    const start = idx + lead.length;
    const labelRaw = (m[1] || "").trim();
    const href = m[2];
    hits.push({
      start,
      end: idx + full.length,
      href,
      label: labelRaw || shortUrlLabel(href),
    });
  }

  // Bare URLs que no caen dentro de un hit angle
  for (const m of text.matchAll(BARE_URL_RE)) {
    const href = m[1];
    const start = m.index ?? 0;
    const end = start + href.length;
    const overlaps = hits.some((h) => start < h.end && end > h.start);
    if (overlaps) continue;
    // Evitar trailing puntuación
    let clean = href;
    let trimEnd = end;
    while (/[),.;!?]$/.test(clean)) {
      clean = clean.slice(0, -1);
      trimEnd -= 1;
    }
    hits.push({
      start,
      end: trimEnd,
      href: clean,
      label: shortUrlLabel(clean),
    });
  }

  hits.sort((a, b) => a.start - b.start);

  const parts: BodyPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    if (h.start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, h.start) });
    }
    parts.push({ type: "link", href: h.href, label: h.label });
    cursor = h.end;
  }
  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }
  return parts.length ? parts : [{ type: "text", value: text }];
}

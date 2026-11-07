"use client";

import { useMemo, useState } from "react";
import type { GmailMailbox } from "@/db/schema";
import {
  linkifyBody,
  splitQuotedReply,
  type BodyPart,
} from "@/lib/integrations/gmail/format-body";
import type { CaseEmailThreadView } from "@/lib/integrations/gmail/sync";

/** Caracteres del mensaje principal antes de pedir expandir. */
const BODY_PREVIEW_CHARS = 480;

function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeFrom(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function SyncStatus({ sync }: { sync: GmailMailbox | null }) {
  if (!sync) {
    return (
      <p className="email-sync-status email-sync-status-muted">
        Sync de correo aún no configurado o sin corridas.
      </p>
    );
  }

  if (sync.lastError) {
    return (
      <p className="email-sync-status email-sync-status-error">
        Último sync falló {relativeFrom(sync.lastAttemptAt) ?? ""}
        {sync.lastAttemptAt ? ` (${formatWhen(sync.lastAttemptAt)})` : ""}
        : {sync.lastError}
      </p>
    );
  }

  if (sync.lastSuccessAt) {
    return (
      <p className="email-sync-status">
        Correos actualizados{" "}
        {relativeFrom(sync.lastSuccessAt) ?? formatWhen(sync.lastSuccessAt)}
        <span className="email-sync-mailbox"> · {sync.email}</span>
      </p>
    );
  }

  return (
    <p className="email-sync-status email-sync-status-muted">
      Pendiente de primer sync exitoso
      {sync.lastAttemptAt
        ? ` · último intento ${formatWhen(sync.lastAttemptAt)}`
        : ""}
      .
    </p>
  );
}

function renderParts(parts: BodyPart[]) {
  return parts.map((p, i) => {
    if (p.type === "text") {
      return <span key={i}>{p.value}</span>;
    }
    return (
      <a
        key={i}
        className="email-body-link"
        href={p.href}
        target="_blank"
        rel="noopener noreferrer"
        title={p.href}
      >
        {p.label}
      </a>
    );
  });
}

function EmailBody({ text }: { text: string }) {
  const { main, quoted } = useMemo(() => splitQuotedReply(text), [text]);
  const [expandedMain, setExpandedMain] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  const mainLong = main.length > BODY_PREVIEW_CHARS;
  const mainShown =
    !mainLong || expandedMain
      ? main
      : `${main.slice(0, BODY_PREVIEW_CHARS).trimEnd()}…`;
  const mainParts = useMemo(() => linkifyBody(mainShown), [mainShown]);
  const quoteParts = useMemo(
    () => (quoted && showQuote ? linkifyBody(quoted) : []),
    [quoted, showQuote]
  );

  return (
    <div className="email-message-body-wrap">
      <div className="email-message-body">{renderParts(mainParts)}</div>
      {mainLong ? (
        <button
          type="button"
          className="email-body-toggle"
          onClick={() => setExpandedMain((v) => !v)}
        >
          {expandedMain ? "Ver menos" : "Expandir"}
        </button>
      ) : null}

      {quoted ? (
        <div className="email-quote-block">
          <button
            type="button"
            className="email-body-toggle"
            onClick={() => setShowQuote((v) => !v)}
          >
            {showQuote ? "Ocultar cita" : "Ver mensaje citado"}
          </button>
          {showQuote ? (
            <div className="email-message-body email-message-quoted">
              {renderParts(quoteParts)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Timeline de hilos Gmail ligados al case (texto plano, más reciente arriba). */
export function CaseEmailThreads({
  threads,
  sync,
}: {
  threads: CaseEmailThreadView[];
  sync: GmailMailbox | null;
}) {
  return (
    <div className="case-emails">
      <SyncStatus sync={sync} />

      {threads.length === 0 ? (
        <p className="empty">
          Sin hilos de correo ligados a esta oportunidad. Se asocian por el
          email del contacto cuando `hablemos@` está en copia.
        </p>
      ) : (
        <div className="email-thread-list">
          {threads.map((thread) => (
            <article key={thread.threadId} className="email-thread">
              <header className="email-thread-head">
                <h4>{thread.subject || "(sin asunto)"}</h4>
                <time>{formatWhen(thread.lastMessageAt)}</time>
              </header>
              <div className="email-message-list">
                {thread.messages.map((m) => (
                  <div key={m.id} className="email-message">
                    <div className="email-message-meta">
                      <strong>
                        {m.fromName || m.fromEmail || "Desconocido"}
                        {m.fromName && m.fromEmail ? (
                          <span className="email-message-addr">
                            {" "}
                            &lt;{m.fromEmail}&gt;
                          </span>
                        ) : null}
                      </strong>
                      <time>{formatWhen(m.sentAt)}</time>
                    </div>
                    {(m.toEmails.length > 0 || m.ccEmails.length > 0) && (
                      <p className="email-message-headers">
                        {m.toEmails.length
                          ? `Para: ${m.toEmails.join(", ")}`
                          : null}
                        {m.ccEmails.length
                          ? `${m.toEmails.length ? " · " : ""}CC: ${m.ccEmails.join(", ")}`
                          : null}
                      </p>
                    )}
                    <EmailBody
                      text={
                        m.bodyText?.trim() || m.subject || "(sin cuerpo)"
                      }
                    />
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

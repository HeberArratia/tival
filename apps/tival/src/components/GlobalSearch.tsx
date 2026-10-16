"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { SearchResult, SearchResultType } from "@/lib/search";

const TYPE_LABEL: Record<SearchResultType, string> = {
  contact: "Contacto",
  company: "Empresa",
  opportunity: "Oportunidad",
};

function isModK(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
}

function groupResults(results: SearchResult[]) {
  const order: SearchResultType[] = ["contact", "company", "opportunity"];
  return order
    .map((type) => ({
      type,
      items: results.filter((r) => r.type === type),
    }))
    .filter((g) => g.items.length > 0);
}

function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const parts = shortcut.includes("+")
    ? shortcut.split("+")
    : shortcut.length === 2
      ? [shortcut[0], shortcut[1]]
      : [shortcut];
  return (
    <span className="global-search-keys">
      {parts.map((part) => (
        <kbd key={part}>{part}</kbd>
      ))}
    </span>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState("⌘K");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isModK(e)) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    setShortcut(mac ? "⌘K" : "Ctrl+K");
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    setError(null);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          ok: boolean;
          results?: SearchResult[];
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setError(data.error || "No se pudo buscar");
          setResults([]);
          return;
        }
        setResults(data.results ?? []);
        setActiveIndex(0);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("No se pudo buscar");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  function close() {
    setOpen(false);
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => (i + 1) % results.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIndex];
      if (hit) go(hit.href);
    }
  }

  const groups = groupResults(results);
  const flatIndex = (item: SearchResult) =>
    results.findIndex((r) => r.type === item.type && r.id === item.id);
  const qLen = query.trim().length;
  const showEmptyHelp = !loading && !error && qLen === 0;
  const showNoHits = !loading && !error && qLen >= 2 && results.length === 0;

  const dialog =
    open && mounted
      ? createPortal(
          <div
            className="modal-backdrop global-search-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              className="modal-panel global-search-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={inputId}
            >
              <div className="global-search-field">
                <span className="global-search-glyph" aria-hidden="true">
                  ⌕
                </span>
                <input
                  ref={inputRef}
                  id={inputId}
                  className="global-search-input"
                  type="search"
                  placeholder="Nombre, mail, teléfono o RUT…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-controls={listId}
                  aria-autocomplete="list"
                />
                <kbd className="global-search-esc">esc</kbd>
              </div>

              <div id={listId} className="global-search-body" role="listbox">
                {showEmptyHelp ? (
                  <div className="global-search-empty">
                    <p className="global-search-empty-title">
                      Buscá en el directorio
                    </p>
                    <p className="global-search-empty-copy">
                      Contactos, empresas y oportunidades. Abrí esto en
                      cualquier pantalla con{" "}
                      <ShortcutKeys shortcut={shortcut} />.
                    </p>
                    <ul className="global-search-chips" aria-hidden="true">
                      <li>nombre</li>
                      <li>mail</li>
                      <li>teléfono</li>
                      <li>RUT</li>
                    </ul>
                  </div>
                ) : null}

                {qLen > 0 && qLen < 2 ? (
                  <p className="global-search-hint">
                    Escribí al menos 2 caracteres.
                  </p>
                ) : null}
                {loading ? (
                  <p className="global-search-hint">Buscando…</p>
                ) : null}
                {error ? <p className="field-error">{error}</p> : null}
                {showNoHits ? (
                  <div className="global-search-empty">
                    <p className="global-search-empty-title">
                      Sin coincidencias
                    </p>
                    <p className="global-search-empty-copy">
                      Probá otro nombre, mail, teléfono o RUT.
                    </p>
                  </div>
                ) : null}

                {groups.map((group) => (
                  <div key={group.type} className="global-search-group">
                    <div className="global-search-group-label">
                      {TYPE_LABEL[group.type]}
                    </div>
                    <ul>
                      {group.items.map((item) => {
                        const idx = flatIndex(item);
                        const active = idx === activeIndex;
                        return (
                          <li key={`${item.type}-${item.id}`}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={active}
                              className={
                                active
                                  ? "global-search-result is-active"
                                  : "global-search-result"
                              }
                              onMouseEnter={() => setActiveIndex(idx)}
                              onClick={() => go(item.href)}
                            >
                              <span
                                className={`global-search-mark global-search-mark-${item.type}`}
                                aria-hidden="true"
                              />
                              <span className="global-search-result-text">
                                <strong>{item.title}</strong>
                                <span>{item.subtitle}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="global-search-foot">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> mover
                </span>
                <span>
                  <kbd>↵</kbd> abrir
                </span>
                <span>
                  <kbd>esc</kbd> cerrar
                </span>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="global-search">
      <button
        type="button"
        className="global-search-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="global-search-trigger-main">
          <span className="global-search-glyph" aria-hidden="true">
            ⌕
          </span>
          <span>Buscar…</span>
        </span>
        <ShortcutKeys shortcut={shortcut} />
      </button>
      <p className="global-search-memory">
        Atajo: <ShortcutKeys shortcut={shortcut} /> en cualquier pantalla
      </p>
      {dialog}
    </div>
  );
}

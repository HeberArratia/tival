"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  defaultOpportunityPrice,
  formatClp,
  type OpportunityProductLine,
  type ProductOption,
} from "@/lib/products";

function parseAmount(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Lista seleccionada + buscador para ir agregando. El precio es de esta oportunidad. */
export function ProductSelect({
  value,
  onChange,
  options,
  creditClp = 0,
  disabled,
}: {
  value: OpportunityProductLine[];
  onChange: (next: OpportunityProductLine[]) => void;
  options: ProductOption[];
  /** Crédito de diagnóstico. 0 fuera de esa iniciativa. */
  creditClp?: number;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const priceRef = useRef<HTMLInputElement>(null);

  const byKey = useMemo(
    () => new Map(options.map((o) => [o.key, o])),
    [options]
  );

  const selectedKeys = useMemo(() => new Set(value.map((l) => l.key)), [value]);

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !selectedKeys.has(o.key))
      .filter((o) => {
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [options, selectedKeys, query]);

  useEffect(() => {
    if (!editingKey) return;
    priceRef.current?.focus();
    priceRef.current?.select();
  }, [editingKey]);

  const showResults = open || query.trim().length > 0;
  const remaining = options.filter((o) => !selectedKeys.has(o.key)).length;

  function priceFor(option: ProductOption): number | null {
    return defaultOpportunityPrice(option.priceListClp, creditClp);
  }

  function add(option: ProductOption) {
    if (disabled || selectedKeys.has(option.key)) return;
    onChange([
      ...value,
      { key: option.key, priceClp: priceFor(option) },
    ]);
    setQuery("");
  }

  function remove(key: string) {
    if (disabled) return;
    onChange(value.filter((l) => l.key !== key));
  }

  function startEdit(line: OpportunityProductLine) {
    if (disabled) return;
    setEditingKey(line.key);
    setDraft(line.priceClp == null ? "" : String(line.priceClp));
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraft("");
  }

  function confirmEdit(line: OpportunityProductLine) {
    const next = parseAmount(draft);
    setEditingKey(null);
    setDraft("");
    const resolved =
      next == null
        ? (byKey.get(line.key) ? priceFor(byKey.get(line.key)!) : line.priceClp)
        : next;
    if (resolved === line.priceClp) return;
    onChange(
      value.map((l) => (l.key === line.key ? { ...l, priceClp: resolved } : l))
    );
  }

  return (
    <div className="product-picker">
      {value.length > 0 ? (
        <ul className="product-picker-selected">
          {value.map((line) => {
            const option = byKey.get(line.key);
            const name = option?.name ?? line.key;
            const standard = option ? priceFor(option) : null;
            const adjusted =
              line.priceClp != null &&
              standard != null &&
              line.priceClp !== standard;
            const editing = editingKey === line.key;
            return (
              <li key={line.key}>
                <div>
                  <strong>{name}</strong>
                  {editing ? (
                    <div className="product-picker-price-row">
                      <input
                        ref={priceRef}
                        className="field-input product-picker-price"
                        inputMode="numeric"
                        value={draft}
                        disabled={disabled}
                        aria-label={`Precio de ${name}`}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmEdit(line);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="product-picker-icon is-ok"
                        disabled={disabled}
                        aria-label={`Confirmar precio de ${name}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => confirmEdit(line)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="product-picker-icon"
                        disabled={disabled}
                        aria-label="Cancelar edición"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={cancelEdit}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="product-picker-price-row">
                      <span className="product-picker-amount">
                        {formatClp(line.priceClp)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost product-picker-edit"
                        disabled={disabled}
                        onClick={() => startEdit(line)}
                      >
                        Editar
                      </button>
                    </div>
                  )}
                  {adjusted && standard != null && !editing ? (
                    <span className="product-picker-note">
                      Ajustado · valor{" "}
                      {creditClp > 0 ? "con diagnóstico" : "de lista"}{" "}
                      {formatClp(standard)}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => remove(line.key)}
                  aria-label={`Quitar ${name}`}
                >
                  Quitar
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lede" style={{ margin: "0 0 0.65rem" }}>
          Ningún producto todavía.
        </p>
      )}

      {remaining > 0 ? (
        <>
          <label className="field-label" htmlFor={inputId}>
            Buscar y agregar
          </label>
          <input
            id={inputId}
            className="field-input"
            style={{ maxWidth: "100%" }}
            type="search"
            placeholder="Nombre del producto…"
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 150);
            }}
            autoComplete="off"
          />

          {showResults ? (
            <ul className="product-picker-results" role="listbox">
              {available.length === 0 ? (
                <li className="product-picker-empty">Sin coincidencias</li>
              ) : (
                available.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      className="product-picker-result"
                      disabled={disabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => add(p)}
                    >
                      <span>
                        <strong>{p.name}</strong>
                        <span>{formatClp(priceFor(p))}</span>
                      </span>
                      <span className="product-picker-add">Agregar</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : (
            <p className="row-meta" style={{ marginTop: "0.4rem" }}>
              Tocá el buscador o escribí para agregar.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

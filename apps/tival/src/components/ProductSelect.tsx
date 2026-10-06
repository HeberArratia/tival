"use client";

import { useId, useMemo, useState } from "react";
import { formatClp, type ProductOption } from "@/lib/products";

/** Lista seleccionada + buscador para ir agregando. */
export function ProductSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: ProductOption[];
  disabled?: boolean;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const byKey = useMemo(
    () => new Map(options.map((o) => [o.key, o])),
    [options]
  );

  const selected = useMemo(() => {
    return value.map((key) => {
      const hit = byKey.get(key);
      return (
        hit ?? {
          key,
          name: key,
          priceListClp: null as number | null,
        }
      );
    });
  }, [value, byKey]);

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !value.includes(o.key))
      .filter((o) => {
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [options, value, query]);

  const showResults = open || query.trim().length > 0;
  const remaining = options.filter((o) => !value.includes(o.key)).length;

  function add(key: string) {
    if (disabled || value.includes(key)) return;
    onChange([...value, key]);
    setQuery("");
  }

  function remove(key: string) {
    if (disabled) return;
    onChange(value.filter((k) => k !== key));
  }

  return (
    <div className="product-picker">
      {selected.length > 0 ? (
        <ul className="product-picker-selected">
          {selected.map((p) => (
            <li key={p.key}>
              <div>
                <strong>{p.name}</strong>
                <span>{formatClp(p.priceListClp)}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={disabled}
                onClick={() => remove(p.key)}
                aria-label={`Quitar ${p.name}`}
              >
                Quitar
              </button>
            </li>
          ))}
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
              // Dejá clickear "Agregar" antes de cerrar.
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
                      onClick={() => add(p.key)}
                    >
                      <span>
                        <strong>{p.name}</strong>
                        <span>{formatClp(p.priceListClp)}</span>
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

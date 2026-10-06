"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductRow } from "@/db/schema";
import { formatClp, slugifyProductKey } from "@/lib/products";

type FormState = {
  key: string;
  name: string;
  priceListClp: string;
  paymentLink: string;
  active: boolean;
};

const emptyForm = (): FormState => ({
  key: "",
  name: "",
  priceListClp: "",
  paymentLink: "",
  active: true,
});

function fromRow(p: ProductRow): FormState {
  return {
    key: p.key,
    name: p.name,
    priceListClp: p.priceListClp != null ? String(p.priceListClp) : "",
    paymentLink: p.paymentLink ?? "",
    active: p.active,
  };
}

export function ProductsAdmin({
  initialProducts,
}: {
  initialProducts: ProductRow[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(true);

  const items = useMemo(
    () =>
      initialProducts.filter((p) => (showInactive ? true : p.active)),
    [initialProducts, showInactive]
  );

  function openCreate() {
    setCreating(true);
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
  }

  function openEdit(p: ProductRow) {
    setCreating(false);
    setEditingId(p.id);
    setForm(fromRow(p));
    setError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        key: form.key || undefined,
        name: form.name,
        priceListClp: form.priceListClp === "" ? null : Number(form.priceListClp),
        paymentLink: form.paymentLink,
        active: form.active,
      };

      const res = await fetch(
        creating ? "/api/products" : `/api/products/${editingId}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Error al guardar");
        return;
      }
      closeForm();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function runSeed() {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Error al cargar seed");
        return;
      }
      router.refresh();
    } finally {
      setSeeding(false);
    }
  }

  const previewKey = form.key || slugifyProductKey(form.name);
  const formOpen = creating || !!editingId;

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Nuevo producto
        </button>
        {initialProducts.length === 0 ? (
          <button
            type="button"
            className="btn"
            disabled={seeding}
            onClick={() => runSeed()}
          >
            {seeding ? "…" : "Cargar catálogo inicial"}
          </button>
        ) : null}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.8rem",
            color: "var(--t-muted)",
            marginLeft: "auto",
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar inactivos
        </label>
      </div>

      {formOpen ? (
        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">{creating ? "Nuevo" : "Editar"}</p>
          <h3 style={{ marginBottom: "0.75rem" }}>
            {creating ? "Crear producto" : form.name || "Producto"}
          </h3>

          <div className="product-form-grid">
            <label className="field-label">
              Nombre
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field-label">
              Precio (CLP)
              <input
                className="field-input"
                inputMode="numeric"
                value={form.priceListClp}
                onChange={(e) =>
                  setForm({ ...form, priceListClp: e.target.value })
                }
              />
            </label>
            <label className="field-label">
              Key
              <input
                className="field-input mono"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder={previewKey}
              />
            </label>
            <label className="field-label">
              Link de pago
              <input
                className="field-input"
                value={form.paymentLink}
                onChange={(e) =>
                  setForm({ ...form, paymentLink: e.target.value })
                }
                placeholder="https://…"
              />
            </label>
          </div>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              marginTop: "0.75rem",
              fontSize: "0.82rem",
            }}
          >
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Activo
          </label>

          {error ? (
            <p
              className="lede"
              style={{ color: "var(--t-coral)", marginTop: "0.5rem" }}
            >
              {error}
            </p>
          ) : null}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={closeForm}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => save()}
            >
              {saving ? "…" : "Guardar"}
            </button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="panel">
          <h3>Sin productos</h3>
          <p className="lede">Creá el primero o cargá el catálogo inicial.</p>
        </div>
      ) : (
        <div className="panel">
          <ul className="initiative-list">
            {items.map((p) => (
              <li
                key={p.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  {!p.active ? (
                    <span
                      className="pill pill-warn"
                      style={{ marginLeft: "0.35rem" }}
                    >
                      inactivo
                    </span>
                  ) : null}
                  <p className="row-meta" style={{ marginTop: "0.15rem" }}>
                    {formatClp(p.priceListClp)}
                    {" · "}
                    <span className="mono">{p.key}</span>
                    {p.paymentLink ? (
                      <>
                        {" · "}
                        <a
                          href={p.paymentLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "underline" }}
                        >
                          pago
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => openEdit(p)}
                >
                  Editar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

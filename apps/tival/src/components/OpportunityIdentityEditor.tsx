"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CompanyRow, ContactRow } from "@/db/schema";
import { GLOSSARY } from "@/lib/glossary";

type SaveState = "idle" | "saving" | "saved" | "error";

type CompanyDraft = {
  rut: string;
  name: string;
  societyType: string;
  antiquity: string;
  sales12m: string;
  giro: string;
};

function draftFromCompany(co: CompanyRow): CompanyDraft {
  return {
    rut: co.rut ?? "",
    name: co.name ?? "",
    societyType: co.societyType ?? "",
    antiquity: co.antiquity ?? "",
    sales12m: co.sales12m ?? "",
    giro: co.giro ?? "",
  };
}

/** Identidad en reunión: primaria, agregar, editar Bigin, desligar. */
export function OpportunityIdentityEditor({
  caseId,
  contact,
  contactHref,
  phoneLabel,
  companies,
  primaryCompanyId,
}: {
  caseId: string;
  contact: ContactRow | null;
  contactHref: string;
  phoneLabel: string | null;
  companies: CompanyRow[];
  primaryCompanyId: string | null;
}) {
  const router = useRouter();
  const [primaryId, setPrimaryId] = useState<string | null>(primaryCompanyId);
  const [list, setList] = useState(companies);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [addRut, setAddRut] = useState("");
  const [addName, setAddName] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPrimaryId(primaryCompanyId);
    setList(companies);
  }, [primaryCompanyId, companies]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  function flash(state: SaveState, msg: string | null) {
    setSaveState(state);
    setStatusMsg(msg);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    if (state === "saved") {
      savedTimer.current = setTimeout(() => {
        setSaveState("idle");
        setStatusMsg(null);
      }, 2200);
    }
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/cases/${caseId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.error === "string" ? data.error : "request_failed"
      );
    }
    return data;
  }

  async function pickPrimary(next: string | null) {
    if (next === primaryId || saveState === "saving") return;
    const prev = primaryId;
    setPrimaryId(next);
    flash("saving", "Guardando…");
    try {
      await post({ action: "set_primary_company", companyId: next });
      flash("saved", next ? "Primaria actualizada" : "Sin empresa primaria");
      router.refresh();
    } catch (err) {
      console.error("[set_primary_company]", err);
      setPrimaryId(prev);
      flash("error", "No se pudo guardar. Probá de nuevo.");
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const rut = addRut.trim();
    if (!rut || saveState === "saving") return;
    flash("saving", "Guardando…");
    try {
      const data = await post({
        action: "add_company",
        rut,
        name: addName.trim() || null,
      });
      const company = data.company as CompanyRow;
      setList((prev) => {
        if (prev.some((c) => c.id === company.id)) {
          return prev.map((c) => (c.id === company.id ? company : c));
        }
        return [...prev, company];
      });
      setPrimaryId(company.id);
      setAdding(false);
      setAddRut("");
      setAddName("");
      flash("saved", "Empresa agregada");
      router.refresh();
    } catch (err) {
      console.error("[add_company]", err);
      flash("error", "No se pudo agregar. Revisá el RUT.");
    }
  }

  function openEdit(co: CompanyRow) {
    setEditingId(co.id);
    setDraft(draftFromCompany(co));
  }

  async function saveEdit() {
    if (!editingId || !draft || saveState === "saving") return;
    flash("saving", "Guardando…");
    try {
      const data = await post({
        action: "update_company",
        companyId: editingId,
        rut: draft.rut.trim() || null,
        name: draft.name.trim() || null,
        societyType: draft.societyType.trim() || null,
        antiquity: draft.antiquity.trim() || null,
        sales12m: draft.sales12m.trim() || null,
        giro: draft.giro.trim() || null,
      });
      const company = data.company as CompanyRow;
      setList((prev) =>
        prev.map((c) => (c.id === company.id ? company : c))
      );
      setEditingId(null);
      setDraft(null);
      flash("saved", "Empresa actualizada");
      router.refresh();
    } catch (err) {
      console.error("[update_company]", err);
      flash("error", "No se pudo guardar.");
    }
  }

  async function unlink(companyId: string) {
    if (saveState === "saving") return;
    flash("saving", "Guardando…");
    try {
      await post({ action: "unlink_company", companyId });
      setList((prev) => prev.filter((c) => c.id !== companyId));
      if (primaryId === companyId) setPrimaryId(null);
      if (editingId === companyId) {
        setEditingId(null);
        setDraft(null);
      }
      flash("saved", "Empresa quitada del contacto");
      router.refresh();
    } catch (err) {
      console.error("[unlink_company]", err);
      flash("error", "No se pudo quitar.");
    }
  }

  return (
    <div className="opp-identity-editor">
      <div style={{ marginBottom: "0.85rem" }}>
        <p className="field-label" style={{ marginBottom: "0.25rem" }}>
          {GLOSSARY.contacto.term}
        </p>
        {contact ? (
          <>
            <Link href={contactHref} style={{ textDecoration: "underline" }}>
              {contact.name || "Sin nombre"}
            </Link>
            <p className="lede mono" style={{ marginTop: "0.15rem" }}>
              {contact.email ?? "sin email"}
              {phoneLabel ? ` · ${phoneLabel}` : ""}
            </p>
          </>
        ) : (
          <p className="lede">Sin contacto</p>
        )}
      </div>

      <p className="field-label" style={{ marginBottom: "0.4rem" }}>
        {GLOSSARY.empresa.term} primaria
      </p>

      <div className="opp-company-list" role="radiogroup" aria-label="Empresa primaria">
        <label className="opp-company-row">
          <input
            type="radio"
            name="primary-company"
            checked={primaryId === null}
            disabled={saveState === "saving"}
            onChange={() => void pickPrimary(null)}
          />
          <span>ninguna</span>
        </label>

        {list.map((co) => {
          const isPrimary = primaryId === co.id;
          const isEditing = editingId === co.id;
          return (
            <div key={co.id} className="opp-company-block">
              <div className="opp-company-row">
                <label style={{ display: "flex", gap: "0.5rem", flex: 1, minWidth: 0 }}>
                  <input
                    type="radio"
                    name="primary-company"
                    checked={isPrimary}
                    disabled={saveState === "saving"}
                    onChange={() => void pickPrimary(co.id)}
                  />
                  <span style={{ minWidth: 0 }}>
                    <strong>{co.name || "Sin razón social"}</strong>
                    <span className="lede mono" style={{ display: "block" }}>
                      {co.rut ?? "sin RUT"}
                      {co.giro ? ` · ${co.giro}` : ""}
                    </span>
                  </span>
                </label>
                <div className="opp-company-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saveState === "saving"}
                    onClick={() =>
                      isEditing ? (setEditingId(null), setDraft(null)) : openEdit(co)
                    }
                  >
                    {isEditing ? "cerrar" : "editar"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saveState === "saving"}
                    onClick={() => void unlink(co.id)}
                    title="Quitar del contacto"
                  >
                    quitar
                  </button>
                </div>
              </div>

              {isEditing && draft ? (
                <div className="opp-company-edit">
                  <div className="field-grid">
                    <label className="field-label">
                      RUT
                      <input
                        className="field-input"
                        value={draft.rut}
                        onChange={(e) =>
                          setDraft({ ...draft, rut: e.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Razón social
                      <input
                        className="field-input"
                        value={draft.name}
                        onChange={(e) =>
                          setDraft({ ...draft, name: e.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Tipo sociedad
                      <input
                        className="field-input"
                        value={draft.societyType}
                        onChange={(e) =>
                          setDraft({ ...draft, societyType: e.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Antigüedad
                      <input
                        className="field-input"
                        value={draft.antiquity}
                        onChange={(e) =>
                          setDraft({ ...draft, antiquity: e.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Ventas 12 meses
                      <input
                        className="field-input"
                        value={draft.sales12m}
                        onChange={(e) =>
                          setDraft({ ...draft, sales12m: e.target.value })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Giro
                      <input
                        className="field-input"
                        value={draft.giro}
                        onChange={(e) =>
                          setDraft({ ...draft, giro: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: "0.65rem" }}
                    disabled={saveState === "saving"}
                    onClick={() => void saveEdit()}
                  >
                    Guardar
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {adding ? (
        <form
          onSubmit={(e) => void submitAdd(e)}
          className="opp-company-add"
          style={{ marginTop: "0.75rem" }}
        >
          <div className="field-grid">
            <label className="field-label">
              RUT
              <input
                className="field-input"
                value={addRut}
                onChange={(e) => setAddRut(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="field-label">
              Razón social
              <input
                className="field-input"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.55rem" }}>
            <button
              type="submit"
              className="btn"
              disabled={saveState === "saving" || !addRut.trim()}
            >
              Agregar y usar
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false);
                setAddRut("");
                setAddName("");
              }}
            >
              cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: "0.65rem" }}
          disabled={!contact || saveState === "saving"}
          onClick={() => setAdding(true)}
        >
          + Agregar empresa
        </button>
      )}

      {statusMsg ? (
        <p
          className={`closing-score-status is-${saveState}`}
          aria-live="polite"
          style={{ marginTop: "0.5rem" }}
        >
          {statusMsg}
        </p>
      ) : null}
    </div>
  );
}

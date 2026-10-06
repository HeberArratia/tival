"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  defaultPlaybookForType,
  playbooksCompatibleWithType,
  type FakeInitiative,
} from "@/lib/fake-data";
import {
  INITIATIVE_TYPES,
  initiativeTypeById,
  type InitiativeTypeId,
} from "@/lib/initiative-types";
import { saveUserInitiative, slugify } from "@/lib/initiatives-local";

export function CreateInitiativeForm() {
  const router = useRouter();
  const [typeId, setTypeId] = useState<InitiativeTypeId>("guia");
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [playbookId, setPlaybookId] = useState(
    () => defaultPlaybookForType("guia").id
  );
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const typeDef = initiativeTypeById(typeId)!;
  const compatible = useMemo(
    () => playbooksCompatibleWithType(typeId),
    [typeId]
  );

  function onTypeChange(next: InitiativeTypeId) {
    setTypeId(next);
    const def = defaultPlaybookForType(next);
    setPlaybookId(def.id);
    setConfig({});
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Poné un nombre.");
      return;
    }
    const pb = compatible.find((p) => p.id === playbookId);
    if (!pb) {
      setError("Playbook no compatible con este tipo.");
      return;
    }
    const slug = slugify(trimmed) || `ini-${Date.now()}`;
    const ini: FakeInitiative = {
      id: `ini-user-${Date.now()}`,
      name: trimmed,
      slug,
      blurb: blurb.trim() || `${typeDef.name} · ${pb.name}`,
      typeId,
      playbookId: pb.id,
      config,
      userCreated: true,
    };
    saveUserInitiative(ini);
    router.push(`/iniciativas/${slug}`);
    router.refresh();
  }

  return (
    <form className="create-ini-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Tipo de iniciativa</span>
        <select
          value={typeId}
          onChange={(e) => onTypeChange(e.target.value as InitiativeTypeId)}
        >
          {INITIATIVE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <small>
          Entry: {typeDef.entry} · default playbook: {typeDef.defaultPlaybookSlug}
        </small>
      </label>

      <label className="field">
        <span>Playbook</span>
        <select
          value={playbookId}
          onChange={(e) => setPlaybookId(e.target.value)}
        >
          {compatible.map((p) => (
            <option key={p.id} value={p.id} disabled={p.comingSoon}>
              {p.name}
              {p.slug === typeDef.defaultPlaybookSlug ? " (default)" : ""}
              {p.comingSoon ? " · pronto" : ""}
            </option>
          ))}
        </select>
        <small>Solo playbooks compatibles con este tipo.</small>
      </label>

      <label className="field">
        <span>Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Guía IVA 2026"
          required
        />
      </label>

      <label className="field">
        <span>Descripción</span>
        <input
          value={blurb}
          onChange={(e) => setBlurb(e.target.value)}
          placeholder="Opcional"
        />
      </label>

      <div className="create-ini-config">
        <p className="panel-kicker">Config del canal ({typeDef.entry})</p>
        {typeDef.configFields.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            <input
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) =>
                setConfig((c) => ({ ...c, [f.key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="topbar-actions" style={{ marginTop: "1rem" }}>
        <button type="submit" className="btn btn-primary">
          Crear iniciativa
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => router.push("/iniciativas")}
        >
          Cancelar
        </button>
      </div>
      <p className="lede" style={{ marginTop: "0.75rem" }}>
        Guardado local (browser) — concepto UI, sin schema aún.
      </p>
    </form>
  );
}

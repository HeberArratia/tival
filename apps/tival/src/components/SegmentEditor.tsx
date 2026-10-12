"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { workspaceSegments } from "@/lib/segments";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Segmento definitivo del consultor — guarda al elegir. */
export function SegmentEditor({
  caseId,
  currentSegmento,
  suggestedSegmento,
  suggestedLabel,
}: {
  caseId: string;
  currentSegmento?: string | null;
  suggestedSegmento?: string | null;
  suggestedLabel?: string | null;
}) {
  const router = useRouter();
  const options = workspaceSegments();
  const initial = currentSegmento?.trim() || null;
  const [value, setValue] = useState<string | null>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initial);
    setSaveState("idle");
  }, [initial]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function persist(next: string | null) {
    const prev = value;
    setValue(next);
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);

    try {
      const res = await fetch(`/api/cases/${caseId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_segmento",
          segmento: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[set_segmento]", data);
        setValue(prev);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[set_segmento]", err);
      setValue(prev);
      setSaveState("error");
    }
  }

  const selected = options.find(
    (s) => s.code === value || s.id === value?.toLowerCase()
  );
  const statusText =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? value
          ? `Validado · ${selected?.code ?? value}`
          : "Guardado · sin segmento"
        : saveState === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : null;

  return (
    <div className="region-editor">
      <label className="field-label" htmlFor="opp-segmento">
        Segmento
      </label>
      <select
        id="opp-segmento"
        className="field-input"
        value={value ?? ""}
        disabled={saveState === "saving"}
        onChange={(e) => {
          const next = e.target.value ? e.target.value : null;
          if (next === value || saveState === "saving") return;
          void persist(next);
        }}
      >
        <option value="">Sin confirmar</option>
        {options.map((s) => (
          <option key={s.id} value={s.code}>
            {s.code} — {s.name}
          </option>
        ))}
      </select>
      {suggestedSegmento ? (
        <p className="row-meta" style={{ marginTop: "0.35rem" }}>
          Sugerido por el wizard: <strong>{suggestedSegmento}</strong>
          {suggestedLabel ? ` — ${suggestedLabel}` : ""}
        </p>
      ) : null}
      {statusText ? (
        <p
          className={`closing-score-status is-${saveState}`}
          aria-live="polite"
        >
          {statusText}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RegionSelect } from "@/components/RegionSelect";
import {
  chileRegionLabel,
  isChileRegion,
  type ChileRegion,
} from "@/lib/chile-regions";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Edita región en cualquier momento — guarda al elegir. */
export function RegionEditor({
  caseId,
  currentRegion,
}: {
  caseId: string;
  currentRegion?: string | null;
}) {
  const router = useRouter();
  const initial = isChileRegion(currentRegion) ? currentRegion : null;
  const [region, setRegion] = useState<ChileRegion | null>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRegion(initial);
    setSaveState("idle");
  }, [initial]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function persist(next: ChileRegion | null) {
    const prev = region;
    setRegion(next);
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);

    try {
      const res = await fetch(`/api/cases/${caseId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_region",
          region: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[set_region]", data);
        setRegion(prev);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[set_region]", err);
      setRegion(prev);
      setSaveState("error");
    }
  }

  const statusText =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? region
          ? `Guardado · ${chileRegionLabel(region)}`
          : "Guardado · sin región"
        : saveState === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : null;

  return (
    <div className="region-editor">
      <label className="field-label" htmlFor="opp-region">
        Región
      </label>
      <RegionSelect
        id="opp-region"
        value={region}
        onChange={(next) => {
          if (next === region || saveState === "saving") return;
          void persist(next);
        }}
        disabled={saveState === "saving"}
      />
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

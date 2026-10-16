"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DealFitPicker } from "@/components/DealFitPicker";
import {
  dealFitLabel,
  isDealFit,
  type DealFit,
} from "@/lib/deal-fits";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Edita calificación del deal en cualquier momento — guarda al elegir. */
export function DealFitEditor({
  caseId,
  currentDealFit,
}: {
  caseId: string;
  currentDealFit?: string | null;
}) {
  const router = useRouter();
  const initial = isDealFit(currentDealFit) ? currentDealFit : null;
  const [fit, setFit] = useState<DealFit | null>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFit(initial);
    setSaveState("idle");
  }, [initial]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function persist(next: DealFit | null) {
    const prev = fit;
    setFit(next);
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);

    try {
      const res = await fetch(`/api/cases/${caseId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_deal_fit",
          dealFit: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[set_deal_fit]", data);
        setFit(prev);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[set_deal_fit]", err);
      setFit(prev);
      setSaveState("error");
    }
  }

  const statusText =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? fit
          ? `Guardado · ${dealFitLabel(fit)}`
          : "Guardado · sin calificación"
        : saveState === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : fit
            ? `Actual: ${dealFitLabel(fit)}`
            : "Sin calificación todavía";

  return (
    <div className="closing-score-editor">
      <DealFitPicker
        value={fit}
        onChange={(next) => {
          if (next === fit || saveState === "saving") return;
          void persist(next);
        }}
        disabled={saveState === "saving"}
        allowClear
      />
      <p
        className={`closing-score-status is-${saveState}`}
        aria-live="polite"
      >
        {statusText}
      </p>
    </div>
  );
}

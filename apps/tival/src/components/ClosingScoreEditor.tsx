"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ClosingScorePicker } from "@/components/ClosingScorePicker";
import {
  closingScoreLabel,
  isClosingScore,
  type ClosingScore,
} from "@/lib/closing-scores";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Edita closing score en cualquier momento — guarda al elegir. */
export function ClosingScoreEditor({
  caseId,
  currentClosingScore,
}: {
  caseId: string;
  currentClosingScore?: string | null;
}) {
  const router = useRouter();
  const initial = isClosingScore(currentClosingScore)
    ? currentClosingScore
    : null;
  const [score, setScore] = useState<ClosingScore | null>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setScore(initial);
    setSaveState("idle");
  }, [initial]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function persist(next: ClosingScore | null) {
    const prev = score;
    setScore(next);
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);

    try {
      const res = await fetch(`/api/cases/${caseId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_closing_score",
          closingScore: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[set_closing_score]", data);
        setScore(prev);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[set_closing_score]", err);
      setScore(prev);
      setSaveState("error");
    }
  }

  const statusText =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? score
          ? `Guardado · ${closingScoreLabel(score)}`
          : "Guardado · sin score"
        : saveState === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : score
            ? `Actual: ${closingScoreLabel(score)}`
            : "Sin score todavía";

  return (
    <div className="closing-score-editor">
      <ClosingScorePicker
        value={score}
        onChange={(next) => {
          if (next === score || saveState === "saving") return;
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

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ProductSelect } from "@/components/ProductSelect";
import {
  formatClp,
  sumQuotedPrices,
  type OpportunityProductLine,
  type ProductOption,
} from "@/lib/products";

type SaveState = "idle" | "saving" | "saved" | "error";

function sameLines(a: OpportunityProductLine[], b: OpportunityProductLine[]) {
  if (a.length !== b.length) return false;
  return a.every(
    (line, i) => line.key === b[i]?.key && line.priceClp === b[i]?.priceClp
  );
}

/** Edita productos de la oportunidad — buscar, agregar, quitar, ajustar precio. */
export function ProductEditor({
  caseId,
  lines: linesProp,
  options,
  creditClp = 0,
}: {
  caseId: string;
  lines?: OpportunityProductLine[];
  options: ProductOption[];
  creditClp?: number;
}) {
  const router = useRouter();
  const initial = linesProp ?? [];
  const [lines, setLines] = useState<OpportunityProductLine[]>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialKey = initial
    .map((l) => `${l.key}:${l.priceClp ?? ""}`)
    .join("|");

  useEffect(() => {
    setLines(initial);
    setSaveState("idle");
  }, [initialKey]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function persist(next: OpportunityProductLine[]) {
    const prev = lines;
    setLines(next);
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);

    try {
      const res = await fetch(`/api/cases/${caseId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_products",
          products: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[set_products]", data);
        setLines(prev);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[set_products]", err);
      setLines(prev);
      setSaveState("error");
    }
  }

  const total = sumQuotedPrices(lines);
  const statusText =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? lines.length
          ? `Guardado · ${formatClp(total)}`
          : "Guardado · sin productos"
        : saveState === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : null;

  return (
    <div className="region-editor">
      <ProductSelect
        value={lines}
        options={options}
        creditClp={creditClp}
        onChange={(next) => {
          if (sameLines(next, lines) || saveState === "saving") return;
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

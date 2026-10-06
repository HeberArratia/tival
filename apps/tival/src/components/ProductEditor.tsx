"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ProductSelect } from "@/components/ProductSelect";
import {
  formatClp,
  sumProductPrices,
  type ProductOption,
} from "@/lib/products";

type SaveState = "idle" | "saving" | "saved" | "error";

function sameKeys(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((k, i) => k === sb[i]);
}

/** Edita productos (multi) — buscar, agregar, quitar. */
export function ProductEditor({
  caseId,
  currentProductKeys,
  options,
}: {
  caseId: string;
  currentProductKeys?: string[];
  options: ProductOption[];
}) {
  const router = useRouter();
  const initial = currentProductKeys ?? [];
  const [keys, setKeys] = useState<string[]>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialKey = initial.join("|");

  useEffect(() => {
    setKeys(initial);
    setSaveState("idle");
  }, [initialKey]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function persist(next: string[]) {
    const prev = keys;
    setKeys(next);
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);

    try {
      const res = await fetch(`/api/cases/${caseId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_products",
          productKeys: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[set_products]", data);
        setKeys(prev);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      router.refresh();
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[set_products]", err);
      setKeys(prev);
      setSaveState("error");
    }
  }

  const total = sumProductPrices(keys, options);
  const statusText =
    saveState === "saving"
      ? "Guardando…"
      : saveState === "saved"
        ? keys.length
          ? `Guardado · ${formatClp(total)}`
          : "Guardado · sin productos"
        : saveState === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : null;

  return (
    <div className="region-editor">
      <ProductSelect
        value={keys}
        options={options}
        onChange={(next) => {
          if (sameKeys(next, keys) || saveState === "saving") return;
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

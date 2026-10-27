"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VENTA_DIRECTA_MOVES } from "@/workspaces/alfondo/playbook-venta-directa";

const LABELS: Record<string, string> = {
  contactado: "Contactado",
  propuesta_enviada: "Propuesta enviada",
  ganado: "Ganado",
  perdido: "Perdido",
};

async function postMove(caseId: string, stageKey: string) {
  const res = await fetch(`/api/cases/${caseId}/actions`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "move_venta_directa",
      stageKey,
      ...(stageKey === "perdido" ? { reason: "no_compra" } : {}),
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "No se pudo cambiar la etapa.");
  }
}

export function VentaDirectaActions({
  caseId,
  stageKey,
  status,
}: {
  caseId: string;
  stageKey?: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (["cancelled", "no_show", "rescheduled_away"].includes(status)) return null;
  const moves = stageKey ? (VENTA_DIRECTA_MOVES[stageKey] ?? []) : [];
  if (!moves.length) return null;

  async function run(next: string) {
    setLoading(next);
    setError(null);
    try {
      await postMove(caseId, next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la etapa.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {moves.map((key) => (
        <button
          key={key}
          type="button"
          className={key === "perdido" ? "btn btn-ghost" : "btn btn-primary"}
          disabled={loading !== null}
          onClick={() => void run(key)}
        >
          {loading === key ? "…" : LABELS[key] ?? key}
        </button>
      ))}
      {error ? <span className="pill pill-warn">{error}</span> : null}
    </div>
  );
}

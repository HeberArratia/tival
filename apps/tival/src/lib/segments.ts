/**
 * Segmentos — tipos genéricos.
 * El catálogo concreto vive en cada workspace pack (`workspaces/<slug>`).
 */

import { getWorkspacePack } from "@/lib/workspace/registry";

export type SegmentId = string;

export type SegmentCriterion = {
  key: string;
  label: string;
  hint: string;
};

export type WorkspaceSegment = {
  id: SegmentId;
  code: string;
  name: string;
  blurb: string;
  criteria: SegmentCriterion[];
};

/** Modo de segmentación en una iniciativa. */
export type SegmentMode = "classify" | "fixed";

/** Origen del segmento mostrado en la opp. */
export type CaseSegmentStatus = "sugerido" | "validado";

export type ResolvedCaseSegment = {
  segment: WorkspaceSegment;
  /** Código crudo (S1, S2…). */
  code: string;
  status: CaseSegmentStatus;
};

/** Catálogo del workspace activo (default de instancia). */
export function workspaceSegments(workspaceSlug?: string): WorkspaceSegment[] {
  return getWorkspacePack(workspaceSlug).segments;
}

/** @deprecated Usar workspaceSegments(slug) — reexport del pack default. */
export const WORKSPACE_SEGMENTS = workspaceSegments();

export function segmentById(
  id: SegmentId | null | undefined,
  workspaceSlug?: string
) {
  if (!id) return null;
  const needle = id.trim().toLowerCase();
  return (
    workspaceSegments(workspaceSlug).find(
      (s) => s.id === needle || s.id === id || s.code.toLowerCase() === needle
    ) ?? null
  );
}

/** Resuelve por código Alfondo (S1, S2, S2S3, S3) o id pack (s1…). */
export function segmentByCode(
  code: string | null | undefined,
  workspaceSlug?: string
) {
  if (!code) return null;
  return segmentById(code, workspaceSlug);
}

function readSuggestedCode(caseRow: {
  segmentoSugerido?: string | null;
  qualification?: Record<string, unknown> | null;
}): string | null {
  const fromCol = caseRow.segmentoSugerido?.trim() || null;
  if (fromCol) return fromCol;
  const q = caseRow.qualification ?? {};
  if (typeof q.segmento_sugerido === "string" && q.segmento_sugerido.trim()) {
    return q.segmento_sugerido.trim();
  }
  return null;
}

function looksLikeWizardLegacy(caseRow: {
  segmentoSugerido?: string | null;
  qualification?: Record<string, unknown> | null;
}) {
  if (caseRow.segmentoSugerido?.trim()) return true;
  const q = caseRow.qualification ?? {};
  return Boolean(
    q.diagnostico_enriched_at ||
      q.segmento_sugerido ||
      q.segmento_label ||
      q.diagnostico_answers ||
      // Enrich viejo guardaba el código en qualification.segmento
      (typeof q.segmento === "string" && q.segmento.trim())
  );
}

/**
 * Segmento de una oportunidad: confirmado (consultor) gana sobre sugerido (wizard).
 */
export function resolveCaseSegmentInfo(
  caseRow: {
    id?: string;
    segmento?: string | null;
    segmentoSugerido?: string | null;
    qualification?: Record<string, unknown> | null;
  },
  workspaceSlug?: string
): ResolvedCaseSegment | null {
  const suggested = readSuggestedCode(caseRow);
  const confirmedCol = caseRow.segmento?.trim() || null;
  const confirmedQ =
    typeof caseRow.qualification?.segmento_confirmado === "string"
      ? caseRow.qualification.segmento_confirmado.trim()
      : null;
  const confirmed = confirmedCol || confirmedQ || null;

  // Ambos: consultor ya validó.
  if (confirmed && suggested) {
    const segment = segmentByCode(confirmed, workspaceSlug);
    if (!segment) return null;
    return { segment, code: confirmed, status: "validado" };
  }

  // Solo columna segmento: legacy enrich → sugerido; si no hay rastro wizard → validado.
  if (confirmed && !suggested) {
    const status: CaseSegmentStatus = looksLikeWizardLegacy(caseRow)
      ? "sugerido"
      : "validado";
    // Si legacy wizard escribió en `segmento`, el código es el sugerido.
    const code = confirmed;
    const segment = segmentByCode(code, workspaceSlug);
    if (!segment) return null;
    return { segment, code, status };
  }

  if (suggested) {
    const segment = segmentByCode(suggested, workspaceSlug);
    if (!segment) return null;
    return { segment, code: suggested, status: "sugerido" };
  }

  return null;
}

/** @deprecated Preferí resolveCaseSegmentInfo — solo el WorkspaceSegment. */
export function resolveCaseSegment(
  caseRow: {
    id?: string;
    segmento?: string | null;
    segmentoSugerido?: string | null;
    qualification?: Record<string, unknown> | null;
  },
  workspaceSlug?: string
) {
  return resolveCaseSegmentInfo(caseRow, workspaceSlug)?.segment ?? null;
}

export function segmentsByIds(
  ids: SegmentId[] | undefined,
  workspaceSlug?: string
) {
  if (!ids?.length) return [];
  const all = workspaceSegments(workspaceSlug);
  return ids
    .map((id) => all.find((s) => s.id === id))
    .filter(Boolean) as WorkspaceSegment[];
}

export function segmentModeLabel(mode: SegmentMode | undefined) {
  if (mode === "fixed") return "Fijo · todas las opp de esta iniciativa";
  if (mode === "classify") return "Clasifica · form / flujo resuelve S1–S3";
  return "—";
}

/** Normaliza código de segmento del pack (S1 / s1 → code canónico). */
export function normalizeSegmentCode(
  raw: string | null | undefined,
  workspaceSlug?: string
): string | null {
  const seg = segmentByCode(raw, workspaceSlug);
  return seg?.code ?? null;
}

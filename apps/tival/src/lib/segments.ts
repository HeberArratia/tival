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
  return workspaceSegments(workspaceSlug).find((s) => s.id === id) ?? null;
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

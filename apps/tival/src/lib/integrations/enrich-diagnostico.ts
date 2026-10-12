/**
 * Enrichment diagnóstico: Alfondo GET log → segmento + answers en el case.
 * Corre fuera del webhook HTTP (Inngest / inline). Fallos no bloquean el lead.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cases } from "@/db/schema";
import { applyDiagnosticoEnrichment } from "@/lib/cases";
import {
  fetchDiagnosticoLog,
  isDiagnosticoLogId,
} from "@/lib/integrations/alfondo-diagnostico";

export type EnrichDiagnosticoResult =
  | {
      ok: true;
      skipped?: false;
      segmento: string;
      diagnosticoLogId: string;
    }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string; retryable?: boolean };

function hasAnswersSnapshot(q: Record<string, unknown> | null | undefined) {
  const answers = q?.diagnostico_answers;
  if (!answers || typeof answers !== "object") return false;
  const selections = (answers as { selections?: unknown }).selections;
  return Boolean(selections && typeof selections === "object");
}

/**
 * Enriquece un case con el log de Alfondo.
 * Idempotente: si ya hay answers para el mismo log id, no re-fetch.
 */
export async function enrichDiagnosticoForCase(
  caseId: string,
  opts?: { force?: boolean; logId?: string | null }
): Promise<EnrichDiagnosticoResult> {
  const db = await getDb();
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) return { ok: false, error: "case_not_found" };

  const logId =
    (opts?.logId && isDiagnosticoLogId(opts.logId) ? opts.logId.trim() : null) ??
    (row.qualificationLogId && isDiagnosticoLogId(row.qualificationLogId)
      ? row.qualificationLogId.trim()
      : null);

  if (!logId) {
    return { ok: true, skipped: true, reason: "missing_qualification_log_id" };
  }

  const q = (row.qualification ?? {}) as Record<string, unknown>;
  if (
    !opts?.force &&
    row.qualificationLogId === logId &&
    hasAnswersSnapshot(q) &&
    typeof q.diagnostico_enriched_at === "string"
  ) {
    return { ok: true, skipped: true, reason: "already_enriched" };
  }

  const fetched = await fetchDiagnosticoLog(logId);
  if (!fetched.ok) {
    await applyDiagnosticoEnrichment({
      caseId,
      failed: true,
      error: fetched.error,
      diagnosticoLogId: logId,
    });
    return {
      ok: false,
      error: fetched.error,
      retryable: fetched.retryable ?? false,
    };
  }

  const data = fetched.data;
  const segmento = String(data.segmento || data.segmento_alfondo || "").trim();
  if (!segmento) {
    await applyDiagnosticoEnrichment({
      caseId,
      failed: true,
      error: "missing_segmento",
      diagnosticoLogId: logId,
    });
    return { ok: false, error: "missing_segmento", retryable: false };
  }

  await applyDiagnosticoEnrichment({
    caseId,
    diagnosticoLogId: data.id || logId,
    segmento,
    segmentoLabel:
      typeof data.segmento_label === "string" ? data.segmento_label : null,
    fitInnovacion:
      data.fit_innovacion != null ? String(data.fit_innovacion) : null,
    fitInnovacionLabel:
      typeof data.fit_innovacion_label === "string"
        ? data.fit_innovacion_label
        : null,
    wizardKind: data.wizardKind != null ? String(data.wizardKind) : null,
    schemaVersion:
      data.schemaVersion != null ? String(data.schemaVersion) : null,
    landingSource:
      typeof data.landing_source === "string" && data.landing_source.trim()
        ? data.landing_source.trim()
        : null,
    calendlyRoute:
      typeof data.route === "string" && data.route.trim()
        ? data.route.trim()
        : null,
    answers:
      data.answers && typeof data.answers === "object"
        ? (data.answers as Record<string, unknown>)
        : null,
    wizardCreatedAt:
      typeof data.created_at === "string" ? data.created_at : null,
  });

  return {
    ok: true,
    segmento,
    diagnosticoLogId: data.id || logId,
  };
}

/** Fire-and-forget local (sin Inngest). */
export function scheduleDiagnosticoEnrichmentInline(caseId: string) {
  void enrichDiagnosticoForCase(caseId).catch((err) => {
    console.error(
      "[enrich-diagnostico]",
      caseId,
      err instanceof Error ? err.message : err
    );
  });
}

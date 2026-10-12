import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import { enrichDiagnosticoForCase } from "@/lib/integrations/enrich-diagnostico";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

export type DiagnosticoEnrichEventData = {
  caseId: string;
  /** UUID diagnostico_logs (= utm_content). */
  qualificationLogId?: string | null;
};

const RETRYABLE = new Set([
  "alfondo_unavailable",
  "endpoint_not_deployed",
  "network_error",
  "fetch failed",
]);

/**
 * Trae segmento + answers desde Alfondo fuera del webhook Calendly.
 * Fallos no afectan la creación del case.
 */
export const enrichDiagnosticoArtifacts = inngest.createFunction(
  {
    id: "enrich-diagnostico",
    name: "Enrich diagnostico from Alfondo",
    retries: 3,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/diagnostico.enrich" }],
  },
  async ({ event, step }) => {
    const data = event.data as DiagnosticoEnrichEventData;
    const caseId = data.caseId;
    if (!caseId) throw new Error("missing_case_id");

    const result = await step.run("enrich-diagnostico", async () =>
      enrichDiagnosticoForCase(caseId, {
        logId: data.qualificationLogId,
      })
    );

    if (!result.ok) {
      const retryable =
        result.retryable === true ||
        RETRYABLE.has(result.error) ||
        /network|timeout|ECONN|503|502/i.test(result.error);
      if (retryable) throw new Error(result.error);
      return { ok: false as const, error: result.error };
    }

    if (result.skipped) {
      return { ok: true as const, skipped: true, reason: result.reason };
    }

    return {
      ok: true as const,
      segmento: result.segmento,
      diagnosticoLogId: result.diagnosticoLogId,
    };
  }
);

/**
 * Encola enrichment Alfondo. Sin log id → no-op.
 * Local / sin Inngest: inline fire-and-forget.
 */
export async function scheduleDiagnosticoEnrichmentJob(
  caseId: string,
  opts?: { qualificationLogId?: string | null }
): Promise<void> {
  const logId = opts?.qualificationLogId?.trim() || null;
  if (!logId) return;

  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — enrich diagnostico inline %s",
      tivalRuntimeEnv(),
      caseId
    );
    const { scheduleDiagnosticoEnrichmentInline } = await import(
      "@/lib/integrations/enrich-diagnostico"
    );
    scheduleDiagnosticoEnrichmentInline(caseId);
    return;
  }

  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn(
      "[inngest] INNGEST_EVENT_KEY missing — enrich diagnostico inline"
    );
    const { scheduleDiagnosticoEnrichmentInline } = await import(
      "@/lib/integrations/enrich-diagnostico"
    );
    scheduleDiagnosticoEnrichmentInline(caseId);
    return;
  }

  try {
    await inngest.send({
      id: `diagnostico-enrich-${caseId}-${logId}`,
      name: "case/diagnostico.enrich",
      data: {
        caseId,
        qualificationLogId: logId,
      } satisfies DiagnosticoEnrichEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] scheduleDiagnosticoEnrichmentJob",
      caseId,
      e instanceof Error ? e.message : e
    );
    const { scheduleDiagnosticoEnrichmentInline } = await import(
      "@/lib/integrations/enrich-diagnostico"
    );
    scheduleDiagnosticoEnrichmentInline(caseId);
  }
}

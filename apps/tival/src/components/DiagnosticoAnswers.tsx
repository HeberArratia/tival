import type { AlfondoDiagnosticoAnswers } from "@/lib/integrations/alfondo-diagnostico";

const KNOWN_LANDINGS = new Set([
  "diagnostico",
  "diagnostico-landing",
  "diagnostico-innovacion",
]);

function readAnswers(
  qualification: Record<string, unknown> | null | undefined
): AlfondoDiagnosticoAnswers | null {
  const raw = qualification?.diagnostico_answers;
  if (!raw || typeof raw !== "object") return null;
  return raw as AlfondoDiagnosticoAnswers;
}

/** Código Alfondo → texto para ops. */
function wizardKindLabel(kind: string) {
  const k = kind.trim().toLowerCase();
  if (k === "s12") return "Cuestionario S1/S2";
  if (k === "innovacion") return "Cuestionario innovación";
  return kind;
}

function displayLanding(raw: string | null | undefined) {
  if (!raw?.trim()) return null;
  const v = raw.trim().toLowerCase();
  return KNOWN_LANDINGS.has(v) ? raw.trim() : null;
}

export function DiagnosticoEnrichmentPanel({
  qualification,
  landingSource,
  segmento,
}: {
  qualification: Record<string, unknown> | null | undefined;
  landingSource?: string | null;
  segmento?: string | null;
}) {
  const answers = readAnswers(qualification);
  const segmentoLabel =
    typeof qualification?.segmento_label === "string"
      ? qualification.segmento_label
      : null;
  const fit =
    qualification?.fit_innovacion != null
      ? String(qualification.fit_innovacion)
      : null;
  const fitLabel =
    typeof qualification?.fit_innovacion_label === "string"
      ? qualification.fit_innovacion_label
      : null;
  const wizardKind =
    typeof qualification?.wizardKind === "string"
      ? qualification.wizardKind
      : null;
  const enrichedAt =
    typeof qualification?.diagnostico_enriched_at === "string"
      ? qualification.diagnostico_enriched_at
      : null;
  const landing = displayLanding(landingSource);

  const selections = answers?.selections
    ? Object.entries(answers.selections)
    : [];

  const hasMeta =
    Boolean(segmento || segmentoLabel || landing || fit || wizardKind) ||
    selections.length > 0;

  if (!hasMeta) return null;

  return (
    <div className="panel" style={{ marginTop: "1rem" }}>
      <p className="panel-kicker">Diagnóstico Alfondo</p>
      <h3>Cuestionario y segmento</h3>

      <ul className="initiative-list" style={{ marginTop: "0.75rem" }}>
        {segmento || segmentoLabel ? (
          <li>
            <strong>Segmento</strong> ·{" "}
            {segmentoLabel ?? segmento}
            {segmento && segmentoLabel ? (
              <span className="pill" style={{ marginLeft: "0.35rem" }}>
                {segmento}
              </span>
            ) : null}
          </li>
        ) : null}
        {landing ? (
          <li>
            <strong>Landing</strong> ·{" "}
            <span className="mono">{landing}</span>
          </li>
        ) : null}
        {fit ? (
          <li>
            <strong>Fit innovación</strong> · {fitLabel ?? fit}
          </li>
        ) : null}
        {wizardKind ? (
          <li>
            <strong>Cuestionario</strong> · {wizardKindLabel(wizardKind)}
          </li>
        ) : null}
      </ul>

      {selections.length > 0 ? (
        <>
          <p className="panel-kicker" style={{ marginTop: "1rem" }}>
            Respuestas del diagnóstico
          </p>
          <ul className="initiative-list" style={{ marginTop: "0.5rem" }}>
            {selections.map(([key, sel]) => {
              const title =
                sel?.question?.title?.trim() ||
                key.replace(/_/g, " ");
              const label = sel?.label?.trim() || "—";
              const hint = sel?.hint?.trim();
              return (
                <li key={key}>
                  <strong>{title}</strong>
                  <p style={{ marginTop: "0.2rem" }}>{label}</p>
                  {hint ? (
                    <p className="row-meta" style={{ marginTop: "0.15rem" }}>
                      {hint}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : enrichedAt ? (
        <p className="lede" style={{ marginTop: "0.65rem" }}>
          Enriquecido sin snapshot de respuestas.
        </p>
      ) : null}
    </div>
  );
}

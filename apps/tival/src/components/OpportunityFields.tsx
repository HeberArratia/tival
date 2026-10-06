import type { OpportunityFieldDef } from "@/lib/opportunity-fields";
import { formatFieldValue } from "@/lib/opportunity-fields";
import type { ResolvedOpportunityField } from "@/lib/fake-data";
import { chileRegionLabel } from "@/lib/chile-regions";
import { closingScoreLabel } from "@/lib/closing-scores";

function displayFieldValue(def: OpportunityFieldDef, value: string | null) {
  if (def.key === "closing_score") {
    return closingScoreLabel(value) ?? "—";
  }
  if (def.key === "region") {
    return chileRegionLabel(value) ?? "—";
  }
  return formatFieldValue(def.type, value);
}

/** Esquema del playbook (contrato). */
export function OpportunityFieldsSchema({
  fields,
}: {
  fields: OpportunityFieldDef[];
}) {
  if (!fields.length) {
    return <p className="lede">Sin campos declarados.</p>;
  }
  return (
    <ul className="initiative-list">
      {fields.map((f) => (
        <li key={f.key}>
          <strong>{f.label}</strong>{" "}
          <span className="mono">{f.key}</span>
          <span className="pill" style={{ marginLeft: "0.35rem" }}>
            {f.type}
          </span>
          {f.required ? (
            <span className="pill pill-warn" style={{ marginLeft: "0.25rem" }}>
              req
            </span>
          ) : null}
          <p className="row-meta" style={{ marginTop: "0.2rem" }}>
            {f.filledBy ?? "—"}
            {f.filledAtStage ? ` · etapa ${f.filledAtStage}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Defaults de la iniciativa sobre el esquema. */
export function InitiativeFieldDefaults({
  fields,
  defaults,
}: {
  fields: OpportunityFieldDef[];
  defaults: Record<string, string> | undefined;
}) {
  if (!fields.length) {
    return <p className="lede">Este playbook no declara campos.</p>;
  }
  const d = defaults ?? {};
  return (
    <ul className="initiative-list">
      {fields.map((f) => {
        const v = d[f.key];
        return (
          <li key={f.key}>
            <strong>{f.label}</strong> ·{" "}
            {v ? (
              <span>{formatFieldValue(f.type, v)}</span>
            ) : (
              <span className="row-meta">sin default (lo llena el flujo)</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Valores resueltos en la oportunidad. */
export function OpportunityFieldValues({
  rows,
}: {
  rows: ResolvedOpportunityField[];
}) {
  if (!rows.length) {
    return <p className="lede">Sin esquema de campos en el playbook.</p>;
  }
  return (
    <ul className="initiative-list">
      {rows.map(({ def, value }) => (
        <li key={def.key}>
          <strong>{def.label}</strong> ·{" "}
          {def.type === "url" && value ? (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "underline" }}
            >
              {def.key === "drive_folder_url" ? "Abrir en Drive" : value}
            </a>
          ) : (
            displayFieldValue(def, value)
          )}
        </li>
      ))}
    </ul>
  );
}

export function OpportunityExtras({
  extras,
}: {
  extras: Record<string, string>;
}) {
  const entries = Object.entries(extras);
  if (!entries.length) {
    return <p className="lede">Sin extras.</p>;
  }
  return (
    <ul className="initiative-list">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="mono">{k}</span> · {v}
        </li>
      ))}
    </ul>
  );
}

import type { ReactNode } from "react";
import type { CaseEvent, PlaybookStage } from "@/db/schema";
import {
  describeEvent,
  recipeForStageKey,
  roleDutiesForConsultoria,
  type NextActionHint,
  type StageEffect,
  type StageTrigger,
} from "@/lib/process-effects";
import { FLOW_LINE, GLOSSARY } from "@/lib/glossary";
import { ROLE_LABEL } from "@/lib/members-catalog";
import type { WorkspaceRole } from "@/lib/workspace/types";

export function GlossaryLegend() {
  return (
    <div className="model-legend" aria-label="Glosario Tival">
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.playbook.term}</span>
        <span>{GLOSSARY.playbook.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.iniciativa.term}</span>
        <span>{GLOSSARY.iniciativa.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.segmento.term}</span>
        <span>{GLOSSARY.segmento.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.producto.term}</span>
        <span>{GLOSSARY.producto.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.contacto.term}</span>
        <span>{GLOSSARY.contacto.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.campo.term}</span>
        <span>{GLOSSARY.campo.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.oportunidad.term}</span>
        <span>{GLOSSARY.oportunidad.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.integracion.term}</span>
        <span>{GLOSSARY.integracion.short}</span>
      </div>
    </div>
  );
}

/** Trigger → Efecto → Evento */
export function FlowLegend() {
  return (
    <div className="model-legend model-legend-flow" aria-label="Flujo de ejecución">
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.trigger.term}</span>
        <span>{GLOSSARY.trigger.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.efecto.term}</span>
        <span>{GLOSSARY.efecto.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.evento.term}</span>
        <span>{GLOSSARY.evento.short}</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">{GLOSSARY.integracion.term}</span>
        <span>{GLOSSARY.integracion.short}</span>
      </div>
    </div>
  );
}

export function ModelLegend() {
  return (
    <div className="model-legend" aria-label="Cómo leer la oportunidad">
      <div className="model-legend-item">
        <span className="model-legend-key">Mapa</span>
        <span>etapas del playbook · dónde está la oportunidad</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">Flujo</span>
        <span>triggers (entrada) + efectos (salida) de cada etapa</span>
      </div>
      <div className="model-legend-item">
        <span className="model-legend-key">Diario</span>
        <span>eventos · historia con resultado</span>
      </div>
    </div>
  );
}

function RecipeChip({
  kind,
  label,
  via,
  status,
  ownedBy,
}: {
  kind: "trigger" | "efecto";
  label: string;
  via: string;
  status: "live" | "planned";
  ownedBy?: WorkspaceRole;
}) {
  const roleHint = ownedBy ? ` · ${ROLE_LABEL[ownedBy]}` : "";
  return (
    <span
      className={`effect-chip ${kind === "trigger" ? "is-trigger" : ""} ${status === "live" ? "is-live" : "is-planned"} ${ownedBy ? `owned-${ownedBy}` : ""}`}
      title={`${kind} · ${via}${roleHint} · ${status === "live" ? "vivo" : "planificado"}`}
    >
      <em>{kind === "trigger" ? "trigger" : status === "live" ? "efecto" : "efecto·plan"}</em>
      {ownedBy ? (
        <span className={`chip-role chip-role-${ownedBy}`}>
          {ROLE_LABEL[ownedBy]}
        </span>
      ) : null}
      {label}
      <small>{via}</small>
    </span>
  );
}

export function EffectChips({ effects }: { effects: StageEffect[] }) {
  if (effects.length === 0) return null;
  return (
    <div className="effect-chips">
      {effects.map((e) => (
        <RecipeChip
          key={e.id}
          kind="efecto"
          label={e.label}
          via={e.via}
          status={e.status}
        />
      ))}
    </div>
  );
}

export function StageRecipeChips({
  triggers,
  effects,
}: {
  triggers: StageTrigger[];
  effects: StageEffect[];
}) {
  if (triggers.length === 0 && effects.length === 0) return null;
  return (
    <div className="effect-chips">
      {triggers.map((t) => (
        <RecipeChip
          key={t.id}
          kind="trigger"
          label={t.label}
          via={t.via}
          status={t.status}
          ownedBy={t.ownedBy}
        />
      ))}
      {effects.map((e) => (
        <RecipeChip
          key={e.id}
          kind="efecto"
          label={e.label}
          via={e.via}
          status={e.status}
        />
      ))}
    </div>
  );
}

/** Mapa Ops / Consultor del playbook consultoría (ownership sugerido). */
export function PlaybookRolesPanel() {
  const duties = roleDutiesForConsultoria();
  return (
    <div className="playbook-roles">
      <p className="lede" style={{ marginBottom: "0.85rem" }}>
        Quién debería hacer cada acción humana. No es permiso: cualquiera puede
        ejecutar; el rol organiza el handoff.
      </p>
      <div className="playbook-roles-grid">
        {(["ops", "consultor"] as const).map((role) => (
          <div key={role} className={`playbook-role-card role-${role}`}>
            <div className="playbook-role-head">
              <span className={`pill pill-role-${role}`}>{ROLE_LABEL[role]}</span>
              <strong>
                {role === "ops" ? "Cola operativa" : "Cola de diagnóstico"}
              </strong>
            </div>
            <ul className="playbook-role-list">
              {duties[role].map((d) => (
                <li key={`${role}-${d.stageKey}-${d.label}`}>
                  <span className="playbook-role-stage">{d.stageLabel}</span>
                  <span>{d.label}</span>
                  {d.status === "planned" ? (
                    <em className="pill">plan</em>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StageRail({
  stages,
  currentStageId,
  showEffects = true,
  previewMode = false,
}: {
  stages: PlaybookStage[];
  currentStageId?: string | null;
  showEffects?: boolean;
  previewMode?: boolean;
}) {
  const currentOrder =
    stages.find((s) => s.id === currentStageId)?.sortOrder ??
    (previewMode ? 2 : 0);

  return (
    <div className="rail">
      {stages.map((s) => {
        const isNow = currentStageId
          ? s.id === currentStageId
          : previewMode && s.sortOrder === 3;
        const isDone = currentStageId
          ? s.sortOrder < currentOrder
          : previewMode && s.sortOrder < 3;
        const recipe = showEffects ? recipeForStageKey(s.key) : null;
        return (
          <div
            key={s.id}
            className={`stage ${isDone ? "is-done" : ""} ${isNow ? "is-now" : ""} ${!isDone && !isNow ? "is-next" : ""}`}
          >
            <span className="node" />
            <div>
              <strong>
                {s.name}
                {s.requiresHuman ? (
                  <span className="stage-flag">humano</span>
                ) : null}
                {s.requiresPayment ? (
                  <span className="stage-flag stage-flag-pay">pago</span>
                ) : null}
              </strong>
              <span className="stage-desc">
                {s.description}
                {s.actor ? ` · actor ${s.actor}` : ""}
              </span>
              {recipe ? (
                <>
                  {(() => {
                    const roles = [
                      ...new Set(
                        recipe.triggers
                          .map((t) => t.ownedBy)
                          .filter((r): r is WorkspaceRole => !!r)
                      ),
                    ];
                    if (roles.length === 0) return null;
                    return (
                      <div className="stage-roles">
                        {roles.map((r) => (
                          <span
                            key={r}
                            className={`pill pill-role-${r}`}
                          >
                            {ROLE_LABEL[r]}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  <StageRecipeChips
                    triggers={recipe.triggers}
                    effects={recipe.effects}
                  />
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EventTimeline({ events }: { events: CaseEvent[] }) {
  if (events.length === 0) {
    return <p className="empty">Sin eventos todavía.</p>;
  }

  return (
    <div className="timeline">
      <p className="timeline-hint">{FLOW_LINE}</p>
      {events.map((e) => {
        const meta = describeEvent(e.type);
        const result =
          meta.result ??
          (e.payload && typeof e.payload === "object" && "error" in e.payload
            ? "fail"
            : "ok");
        return (
          <div className="event" key={e.id} data-kind={meta.kind}>
            <time>
              {new Date(e.createdAt).toLocaleString("es-CL", {
                timeZone: "America/Santiago",
              })}
            </time>
            <div>
              <strong>
                {meta.title}
                <span className={`event-kind event-kind-${meta.kind}`}>
                  {meta.kind}
                </span>
                <span className={`event-result event-result-${result}`}>
                  {result}
                </span>
              </strong>
              <p>
                {e.actor}
                {e.payload && Object.keys(e.payload).length
                  ? ` · ${JSON.stringify(e.payload)}`
                  : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NextActionPanel({
  hint,
  actions,
}: {
  hint: NextActionHint;
  actions?: ReactNode;
}) {
  return (
    <section className={`panel next-action next-action-${hint.tone}`}>
      <div className="next-action-label">Próxima acción</div>
      <h3>{hint.title}</h3>
      <p className="lede">{hint.body}</p>
      {actions ? <div className="next-action-actions">{actions}</div> : null}
    </section>
  );
}

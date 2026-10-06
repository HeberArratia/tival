import Link from "next/link";
import type { PlaybookStage } from "@/db/schema";
import {
  ClosingScorePill,
  InitiativePill,
  SegmentPill,
  StatusPill,
  LostReasonPill,
  closingScoreFromQualification,
} from "@/components/AppShell";
import { MemberAvatar } from "@/components/MemberAvatar";
import { StageRecipeChips } from "@/components/ProcessUI";
import {
  caseTitle,
  type CaseWithIdentity,
} from "@/lib/cases";
import {
  initiativeForCase,
  opportunityHref,
  segmentForCase,
} from "@/lib/fake-data";
import { memberById } from "@/lib/members-catalog";
import { recipeForStageKey } from "@/lib/process-effects";
import {
  formatClp,
  productKeysFromQualification,
  productNamesForKeys,
  sumProductPrices,
  type ProductOption,
} from "@/lib/products";
function columnForCase(stages: PlaybookStage[], c: CaseWithIdentity): string {
  if (c.currentStageId && stages.some((s) => s.id === c.currentStageId)) {
    return c.currentStageId;
  }
  return stages.find((s) => s.key === "lead")?.id ?? stages[0]?.id ?? "";
}

function stageKeyForCase(
  stages: PlaybookStage[],
  c: CaseWithIdentity
): string | undefined {
  return stages.find((s) => s.id === c.currentStageId)?.key;
}

export function ProcessBoard({
  stages,
  opportunities,
  title = "Consultoría",
  showInitiative = false,
  /** Canvas ops: sin chips de recipe por columna */
  quiet = false,
  productOptions = [],
}: {
  stages: PlaybookStage[];
  opportunities: CaseWithIdentity[];
  title?: string;
  showInitiative?: boolean;
  quiet?: boolean;
  productOptions?: ProductOption[];
}) {
  const byStage = new Map<string, CaseWithIdentity[]>();
  for (const s of stages) byStage.set(s.id, []);

  const orphan: CaseWithIdentity[] = [];
  for (const c of opportunities) {
    const col = columnForCase(stages, c);
    if (byStage.has(col)) byStage.get(col)!.push(c);
    else orphan.push(c);
  }

  return (
    <section className="board-wrap">
      <div className="section-head">
        <h2>{quiet ? title : `Canvas · ${title}`}</h2>
        <span>
          {opportunities.length} en el tablero
          {!quiet ? " · columnas = etapas" : ""}
        </span>
      </div>
      <div className="board" role="list">
        {stages.map((s) => {
          const cards = byStage.get(s.id) ?? [];
          const locked = s.key === "seguimiento";
          const tone =
            s.key === "ganado" ? "won" : s.key === "perdido" ? "lost" : null;
          const recipe = locked ? null : recipeForStageKey(s.key);
          const columnTotal = locked
            ? 0
            : cards.reduce((acc, c) => {
                const keys = productKeysFromQualification(
                  c.qualification as Record<string, unknown> | null
                );
                return acc + sumProductPrices(keys, productOptions);
              }, 0);
          const colClass = [
            "board-col",
            locked ? "is-locked" : "",
            tone === "won" ? "is-won" : "",
            tone === "lost" ? "is-lost" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              className={colClass}
              key={s.id}
              role="listitem"
              aria-disabled={locked || undefined}
            >
              <header className="board-col-head">
                <div>
                  <strong>
                    {tone === "won" ? (
                      <span className="board-col-thumb" aria-hidden>
                        👍
                      </span>
                    ) : null}
                    {tone === "lost" ? (
                      <span className="board-col-thumb" aria-hidden>
                        👎
                      </span>
                    ) : null}
                    {s.name}
                    {locked ? (
                      <span className="board-col-soon">pronto</span>
                    ) : null}
                  </strong>
                  <span>
                    {locked
                      ? "cadencias · más adelante"
                      : tone === "won"
                        ? [
                            "cierre positivo",
                            columnTotal > 0 ? formatClp(columnTotal) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : tone === "lost"
                          ? [
                              "cierre negativo",
                              columnTotal > 0 ? formatClp(columnTotal) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : [
                              s.requiresPayment ? "pago" : null,
                              s.requiresHuman ? "humano" : null,
                              s.actor,
                              columnTotal > 0 ? formatClp(columnTotal) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                  </span>
                </div>
                <em>{locked ? "—" : cards.length}</em>
              </header>
              {!quiet && recipe ? (
                <StageRecipeChips
                  triggers={recipe.triggers.slice(0, 1)}
                  effects={recipe.effects.slice(0, 1)}
                />
              ) : null}
              <div className="board-col-body">
                {locked ? (
                  <p className="board-empty board-locked-msg">Pronto</p>
                ) : cards.length === 0 ? (
                  <p className="board-empty">Vacío</p>
                ) : (
                  cards.map((c) => {
                    const ini = showInitiative ? initiativeForCase(c) : null;
                    const seg = segmentForCase(c);
                    const stageKey = stageKeyForCase(stages, c);
                    // Solo “sin pago”: el resto de cierres se ven normales.
                    const muted =
                      stageKey === "perdido" && c.lostReason === "no_pago";
                    const keys = productKeysFromQualification(
                      c.qualification as Record<string, unknown> | null
                    );
                    const oppTotal = sumProductPrices(keys, productOptions);
                    const names = productNamesForKeys(keys, productOptions);
                    const consultant = memberById(c.assignedConsultantId);
                    const showConsultantSlot =
                      c.paymentStatus === "paid" &&
                      stageKey !== "ganado" &&
                      stageKey !== "perdido" &&
                      stageKey !== "lead";
                    return (
                      <Link
                        key={c.id}
                        href={opportunityHref(c)}
                        className={`board-card ${muted ? "is-muted" : ""}`}
                      >
                        <div className="board-card-top">
                          <div className="board-card-main">
                            <div className="board-card-title">
                              {caseTitle(c)}
                            </div>
                            <div className="board-card-meta">
                              {c.contact?.name}
                            </div>
                          </div>
                          {showConsultantSlot ? (
                            <MemberAvatar
                              memberId={c.assignedConsultantId}
                              name={consultant?.name}
                              size="sm"
                              empty={!consultant}
                              title={
                                consultant
                                  ? `Consultor · ${consultant.name}`
                                  : "Sin consultor"
                              }
                            />
                          ) : null}
                        </div>
                        {c.scheduledAt ? (
                          <div className="board-card-when">
                            {new Date(c.scheduledAt).toLocaleString("es-CL", {
                              timeZone: "America/Santiago",
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        ) : null}
                        {keys.length > 0 ? (
                          <div className="board-card-products">
                            <strong>{formatClp(oppTotal)}</strong>
                            <span>
                              {names.length <= 2
                                ? names.join(" · ")
                                : `${names.slice(0, 2).join(" · ")} +${
                                    names.length - 2
                                  }`}
                            </span>
                          </div>
                        ) : null}
                        <div className="board-card-foot">
                          <SegmentPill segment={seg} />
                          <ClosingScorePill
                            score={closingScoreFromQualification(c.qualification)}
                          />
                          {ini ? <InitiativePill initiative={ini} /> : null}
                          {["cancelled", "no_show"].includes(c.status) ? (
                            <StatusPill status={c.status} />
                          ) : null}
                          {c.lostReason ? (
                            <LostReasonPill reason={c.lostReason} />
                          ) : null}
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
        {orphan.length > 0 ? (
          <div className="board-col board-col-orphan" role="listitem">
            <header className="board-col-head">
              <div>
                <strong>Sin etapa</strong>
                <span>revisar datos</span>
              </div>
              <em>{orphan.length}</em>
            </header>
            <div className="board-col-body">
              {orphan.map((c) => (
                <Link
                  key={c.id}
                  href={opportunityHref(c)}
                  className="board-card"
                >
                  <div className="board-card-title">
                    {caseTitle(c)}
                  </div>
                  <StatusPill status={c.status} />
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

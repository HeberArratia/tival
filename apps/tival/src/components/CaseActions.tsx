"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { ClosingScorePicker } from "@/components/ClosingScorePicker";
import { ProductSelect } from "@/components/ProductSelect";
import { RegionSelect } from "@/components/RegionSelect";
import {
  isChileRegion,
  type ChileRegion,
} from "@/lib/chile-regions";
import {
  isClosingScore,
  type ClosingScore,
} from "@/lib/closing-scores";
import { MemberAvatar } from "@/components/MemberAvatar";
import { canAssignConsultant } from "@/lib/members-catalog";
import { toProductOption, type ProductOption } from "@/lib/products";
import { isTerminalStageKey } from "@/lib/terminal-stages";

const EXCEPTION_STATUSES = ["cancelled", "no_show", "rescheduled_away"];

export type ConsultantOption = {
  id: string;
  name: string;
};

export function canConfirmTransfer(input: {
  status: string;
  paymentStatus: string;
  stageKey?: string;
}) {
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  if (isTerminalStageKey(input.stageKey)) return false;
  return input.paymentStatus !== "paid";
}

export function canMarkLost(input: {
  status: string;
  paymentStatus: string;
  stageKey?: string;
}) {
  if (input.status === "cancelled" || input.status === "rescheduled_away") {
    return false;
  }
  if (isTerminalStageKey(input.stageKey)) return false;
  // No-show (con o sin chance de reagenda) → Perdido / no asistió.
  if (input.status === "no_show") return true;
  // Pre-pago: sin transferencia.
  if (input.paymentStatus !== "paid") return true;
  // Post-propuesta: no compró.
  return input.stageKey === "propuesta_enviada";
}

/** No llegó (primera vez): solo Diagnóstico pagado con reunión, status open. */
export function canMarkNoShowActions(input: {
  status: string;
  stageKey?: string;
  hasScheduledAt?: boolean;
}) {
  if (isTerminalStageKey(input.stageKey)) return false;
  if (input.status === "cancelled" || input.status === "rescheduled_away") {
    return false;
  }
  if (input.status === "no_show") return false;
  if (!input.hasScheduledAt) return false;
  return input.stageKey === "pagado";
}

/** Reagendar / renovar chance (pagado, o desde no_show si expiró el TTL). */
export function canOfferReschedule(input: {
  status: string;
  stageKey?: string;
  hasScheduledAt?: boolean;
}) {
  if (isTerminalStageKey(input.stageKey)) return false;
  if (input.status === "cancelled" || input.status === "rescheduled_away") {
    return false;
  }
  if (input.status === "no_show") return true;
  if (!input.hasScheduledAt) return false;
  return input.stageKey === "pagado";
}

export function canMarkWon(input: {
  status: string;
  stageKey?: string;
}) {
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  return input.stageKey === "propuesta_enviada";
}

async function postAction(
  caseId: string,
  action: string,
  payload?: {
    reason?: string;
    closingScore?: string | null;
    region?: string | null;
    productKeys?: string[] | null;
    consultantId?: string | null;
  }
): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(`/api/cases/${caseId}/actions`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (res.ok) return { ok: true, status: res.status };

  const text = await res.text().catch(() => "");
  let error = `http_${res.status}`;
  try {
    const data = text ? (JSON.parse(text) as { error?: string }) : null;
    if (data?.error) error = data.error;
    else if (!text) error = "empty_body";
  } catch {
    error = text ? `non_json:${text.slice(0, 120)}` : "empty_body";
  }
  // String only — evita overlay de Next que colapsa objetos a "{}"
  console.warn(`[CaseAction:${action}] ${res.status} ${error}`);
  return { ok: false, status: res.status, error };
}

/** Ops asigna consultor (sugerido en Diagnóstico pagado; no bloquea). */
export function AssignConsultantButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  currentConsultantId,
  consultants,
  className = "btn",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  currentConsultantId?: string | null;
  consultants: ConsultantOption[];
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  if (
    !canAssignConsultant({ status, paymentStatus, stageKey }) ||
    consultants.length === 0
  ) {
    return null;
  }

  async function assign(consultantId: string, e?: MouseEvent) {
    if (stopPropagation && e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      const result = await postAction(caseId, "assign_consultant", {
        consultantId,
      });
      if (!result.ok) {
        if (result.status === 401 || result.error === "unauthorized") {
          window.alert(
            "Sesión expirada o no autorizada. Volvé a iniciar sesión e intentá de nuevo."
          );
        } else {
          window.alert(`No se pudo asignar el consultor (${result.error}).`);
        }
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const current = consultants.find((c) => c.id === currentConsultantId);
  const label = current
    ? `Consultor: ${current.name}`
    : "Asignar consultor";
  const btnClass = current
    ? className
    : className.includes("btn-primary")
      ? className
      : "btn btn-primary";

  return (
    <div className="assign-consultant" style={{ position: "relative" }}>
      <button
        type="button"
        className={btnClass}
        disabled={loading}
        onClick={(e) => {
          if (stopPropagation) {
            e.preventDefault();
            e.stopPropagation();
          }
          setOpen((v) => !v);
        }}
      >
        {loading ? (
          "…"
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            {current ? (
              <MemberAvatar
                memberId={current.id}
                name={current.name}
                size="sm"
              />
            ) : null}
            {label}
          </span>
        )}
      </button>
      {open ? (
        <div
          className="assign-consultant-menu"
          role="listbox"
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
          }}
        >
          {consultants.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === currentConsultantId}
              className="assign-consultant-option"
              disabled={loading || c.id === currentConsultantId}
              onClick={(e) => void assign(c.id, e)}
            >
              <MemberAvatar memberId={c.id} name={c.name} size="sm" />
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Ops confirma transferencia (misma acción que markPaid / transfer). */
export function ConfirmTransferButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  className = "btn btn-primary",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canConfirmTransfer({ status, paymentStatus, stageKey })) return null;

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      await postAction(caseId, "confirm_transfer");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title="Ops confirma transferencia recibida"
    >
      {loading ? "…" : "Confirmar transferencia"}
    </button>
  );
}

/** No pagó / no compró / no asistió (desde no_show) → Perdido. */
export function MarkLostButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  className = "btn",
  stopPropagation = false,
  reason,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
  reason?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canMarkLost({ status, paymentStatus, stageKey })) return null;

  const isNoShow = status === "no_show";
  const isPostProposal = stageKey === "propuesta_enviada";
  const resolvedReason =
    reason ??
    (isNoShow ? "no_asistio" : isPostProposal ? "no_compra" : "no_pago");
  const label = isNoShow
    ? "Perdido · no asistió"
    : isPostProposal
      ? "Perdido"
      : "No pagó";
  const action = isNoShow ? "no_show_lost" : "mark_lost";

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      if (action === "no_show_lost") {
        await postAction(caseId, "no_show_lost");
      } else {
        await postAction(caseId, "mark_lost", { reason: resolvedReason });
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title={
        isNoShow
          ? "Cierra sin chance de reagenda · Perdido / no asistió"
          : isPostProposal
            ? "No compró · pasa a Perdido"
            : "Marca como perdido (sin pago). Pasa a la etapa Perdido."
      }
    >
      {loading ? "…" : label}
    </button>
  );
}

/** No llegó · reagendar (activa awaiting_reschedule). */
export function MarkNoShowRescheduleButton({
  caseId,
  status,
  stageKey,
  hasScheduledAt,
  className = "btn",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  hasScheduledAt?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canOfferReschedule({ status, stageKey, hasScheduledAt })) return null;

  const renew = status === "no_show";

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      await postAction(caseId, "no_show_reschedule");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title={
        renew
          ? "Renueva la ventana de reagenda (mismo case)"
          : "No llegó · deja chance de reagenda (mismo case)"
      }
    >
      {loading ? "…" : renew ? "Renovar reagenda" : "No llegó · reagendar"}
    </button>
  );
}

/** No llegó · perdido directo (sin pasar por awaiting). */
export function MarkNoShowLostButton({
  caseId,
  status,
  stageKey,
  hasScheduledAt,
  className = "btn",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  hasScheduledAt?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canMarkNoShowActions({ status, stageKey, hasScheduledAt })) return null;

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      await postAction(caseId, "no_show_lost");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title="No llegó · cierra en Perdido / no asistió"
    >
      {loading ? "…" : "No llegó · perdido"}
    </button>
  );
}

/** Cancelar opp duplicada / reemplazada → status cancelled + reason superseded. */
export function canCancelSuperseded(input: {
  status: string;
  stageKey?: string;
}) {
  if (isTerminalStageKey(input.stageKey)) return false;
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  return true;
}

export function CancelSupersededButton({
  caseId,
  status,
  stageKey,
  className = "btn btn-ghost",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canCancelSuperseded({ status, stageKey })) return null;

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    const ok = window.confirm(
      "¿Cancelar esta oportunidad? Queda fuera del canvas (motivo: superseded). Usalo para duplicados cuando otra opp es la vigente."
    );
    if (!ok) return;
    setLoading(true);
    try {
      await postAction(caseId, "cancel", { reason: "superseded" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title="Cancelar duplicado · superseded (queda la otra opp)"
    >
      {loading ? "…" : "Cancelar · duplicado"}
    </button>
  );
}

/** Copia link Calendly (reschedule nativo o booking prefildado). */
export function CopyCalendlyLinkButton({
  url,
  label = "Copiar link reagenda",
  className = "btn",
}: {
  url: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copiá el link:", url!);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      title={url}
    >
      {copied ? "Copiado" : label}
    </button>
  );
}

/** Propuesta enviada → Ganado. */
export function MarkWonButton({
  caseId,
  status,
  stageKey,
  className = "btn btn-primary",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canMarkWon({ status, stageKey })) return null;

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      await postAction(caseId, "mark_won");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title="Trato cerrado · pasa a Ganado"
    >
      {loading ? "…" : "Ganado"}
    </button>
  );
}

export function canMarkRealizado(input: {
  status: string;
  stageKey?: string;
}) {
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  return input.stageKey === "pagado";
}

export function canMarkPropuestaEnviada(input: {
  status: string;
  stageKey?: string;
}) {
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  return input.stageKey === "realizado";
}

/** Diagnóstico realizado → Propuesta enviada. */
export function MarkPropuestaEnviadaButton({
  caseId,
  status,
  stageKey,
  className = "btn btn-primary",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canMarkPropuestaEnviada({ status, stageKey })) return null;

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      await postAction(caseId, "mark_propuesta_enviada");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={run}
      title="Propuesta enviada al cliente · pasa a Propuesta enviada"
    >
      {loading ? "…" : "Propuesta enviada"}
    </button>
  );
}

/** Regenera propuesta en n8n. Solo si hay notas movidas y consultor asignado. */
export function GenerateProposalButton({
  caseId,
  canGenerate,
  className = "btn",
}: {
  caseId: string;
  canGenerate: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canGenerate) return null;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const result = await postAction(caseId, "generate_proposal");
      if (!result.ok) setError("No se pudo disparar la propuesta");
      else router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={run}
        title="Genera el correo de propuesta y lo envía al consultor asignado"
      >
        {loading ? "…" : "Generar propuesta"}
      </button>
      {error ? <span className="row-meta">{error}</span> : null}
    </span>
  );
}

/** Diagnóstico pagado → Diagnóstico realizado (modal recuerda campos ops). */
export function MarkRealizadoButton({
  caseId,
  status,
  stageKey,
  className = "btn btn-primary",
  stopPropagation = false,
  currentClosingScore,
  currentRegion,
  currentProductKeys,
  productOptions: productOptionsProp,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
  currentClosingScore?: string | null;
  currentRegion?: string | null;
  currentProductKeys?: string[];
  productOptions?: ProductOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<ClosingScore | null>(
    isClosingScore(currentClosingScore) ? currentClosingScore : null
  );
  const [region, setRegion] = useState<ChileRegion | null>(
    isChileRegion(currentRegion) ? currentRegion : null
  );
  const [productKeys, setProductKeys] = useState<string[]>(
    currentProductKeys ?? []
  );
  const [productOptions, setProductOptions] = useState<ProductOption[]>(
    productOptionsProp ?? []
  );

  useEffect(() => {
    if (open) {
      setScore(isClosingScore(currentClosingScore) ? currentClosingScore : null);
      setRegion(isChileRegion(currentRegion) ? currentRegion : null);
      setProductKeys(currentProductKeys ?? []);
      if (productOptionsProp?.length) {
        setProductOptions(productOptionsProp);
      } else {
        void fetch("/api/products?activeOnly=1")
          .then((r) => r.json())
          .then((data) => {
            if (data?.ok && Array.isArray(data.items)) {
              setProductOptions(
                data.items.map(
                  (p: { key: string; name: string; priceListClp: number | null }) =>
                    toProductOption(p)
                )
              );
            }
          })
          .catch(() => null);
      }
    }
  }, [
    open,
    currentClosingScore,
    currentRegion,
    currentProductKeys,
    productOptionsProp,
  ]);

  if (!canMarkRealizado({ status, stageKey })) return null;

  function openModal(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setOpen(true);
  }

  async function confirm() {
    setLoading(true);
    try {
      await postAction(caseId, "mark_realizado", {
        closingScore: score,
        region,
        productKeys,
      });
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={openModal}
        title="La reunión ocurrió · pasa a Diagnóstico realizado"
      >
        {loading ? "…" : "Realizado"}
      </button>

      {open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
            if (!loading) setOpen(false);
          }}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="realizado-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="panel-kicker">Diagnóstico</p>
            <h3 id="realizado-modal-title">Marcar como realizado</h3>
            <p className="lede" style={{ marginTop: "0.35rem" }}>
              Recordatorio: completá score, productos y región si ya los tenés.
              Son opcionales — podés dejarlos vacíos y cargarlos después.
            </p>

            <div style={{ marginTop: "0.85rem" }}>
              <ClosingScorePicker
                value={score}
                onChange={setScore}
                disabled={loading}
                allowClear
              />
            </div>

            <div className="region-editor" style={{ marginTop: "0.85rem" }}>
              <label className="field-label">Productos</label>
              <ProductSelect
                value={productKeys}
                options={productOptions}
                onChange={setProductKeys}
                disabled={loading}
              />
            </div>

            <div className="region-editor" style={{ marginTop: "0.85rem" }}>
              <label className="field-label" htmlFor="realizado-region">
                Región
              </label>
              <RegionSelect
                id="realizado-region"
                value={region}
                onChange={setRegion}
                disabled={loading}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loading}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={() => confirm()}
              >
                {loading ? "…" : "Marcar realizado"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const MENU_ITEM = "case-actions-menu-item";

/**
 * Acciones secundarias en topbar (menú).
 * Happy path vive en el banner NextAction — no se repite acá.
 */
export function CaseActions({
  caseId,
  status,
  paymentStatus,
  stageKey,
  canGenerateProposal = false,
  hasScheduledAt = false,
  calendlyLink = null,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  canGenerateProposal?: boolean;
  hasScheduledAt?: boolean;
  calendlyLink?: string | null;
}) {
  const [open, setOpen] = useState(false);

  const showNoShow = canOfferReschedule({ status, stageKey, hasScheduledAt });
  const showNoShowLost = canMarkNoShowActions({
    status,
    stageKey,
    hasScheduledAt,
  });
  const showLost = canMarkLost({ status, paymentStatus, stageKey });
  const showCancel = canCancelSuperseded({ status, stageKey });
  const showLink = Boolean(calendlyLink);
  const hasAnything =
    showNoShow ||
    showNoShowLost ||
    showLost ||
    showCancel ||
    showLink ||
    canGenerateProposal;

  if (!hasAnything) return null;

  return (
    <div className="case-actions" style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost case-actions-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        Acciones{open ? " ▴" : " ▾"}
      </button>
      {open ? (
        <div
          className="case-actions-menu"
          role="menu"
          onClick={() => setOpen(false)}
        >
          <MarkNoShowRescheduleButton
            caseId={caseId}
            status={status}
            stageKey={stageKey}
            hasScheduledAt={hasScheduledAt}
            className={MENU_ITEM}
          />
          <MarkNoShowLostButton
            caseId={caseId}
            status={status}
            stageKey={stageKey}
            hasScheduledAt={hasScheduledAt}
            className={MENU_ITEM}
          />
          <MarkLostButton
            caseId={caseId}
            status={status}
            paymentStatus={paymentStatus}
            stageKey={stageKey}
            className={MENU_ITEM}
          />
          <CancelSupersededButton
            caseId={caseId}
            status={status}
            stageKey={stageKey}
            className={MENU_ITEM}
          />
          <CopyCalendlyLinkButton
            url={calendlyLink}
            label="Copiar link reagenda"
            className={MENU_ITEM}
          />
          <GenerateProposalButton
            caseId={caseId}
            canGenerate={canGenerateProposal}
            className={MENU_ITEM}
          />
        </div>
      ) : null}
    </div>
  );
}

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
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  if (isTerminalStageKey(input.stageKey)) return false;
  // Pre-pago: sin transferencia.
  if (input.paymentStatus !== "paid") return true;
  // Post-propuesta: no compró.
  return input.stageKey === "propuesta_enviada";
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
) {
  const res = await fetch(`/api/cases/${caseId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error(`[CaseAction:${action}]`, data);
  }
  return res.ok;
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
      await postAction(caseId, "assign_consultant", { consultantId });
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

/** No pagó (pre-pago) o no compró (post-propuesta) → Perdido. */
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

  const isPostProposal = stageKey === "propuesta_enviada";
  const resolvedReason = reason ?? (isPostProposal ? "no_compra" : "no_pago");
  const label = isPostProposal ? "Perdido" : "No pagó";

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    try {
      await postAction(caseId, "mark_lost", { reason: resolvedReason });
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
        isPostProposal
          ? "No compró · pasa a Perdido"
          : "Marca como perdido (sin pago). Pasa a la etapa Perdido."
      }
    >
      {loading ? "…" : label}
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

export function CaseActions({
  caseId,
  status,
  paymentStatus,
  stageKey,
  currentClosingScore,
  currentRegion,
  currentProductKeys,
  productOptions,
  currentConsultantId,
  consultants = [],
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  currentClosingScore?: string | null;
  currentRegion?: string | null;
  currentProductKeys?: string[];
  productOptions?: ProductOption[];
  currentConsultantId?: string | null;
  consultants?: ConsultantOption[];
}) {
  return (
    <>
      <ConfirmTransferButton
        caseId={caseId}
        status={status}
        paymentStatus={paymentStatus}
        stageKey={stageKey}
      />
      <AssignConsultantButton
        caseId={caseId}
        status={status}
        paymentStatus={paymentStatus}
        stageKey={stageKey}
        currentConsultantId={currentConsultantId}
        consultants={consultants}
      />
      <MarkLostButton
        caseId={caseId}
        status={status}
        paymentStatus={paymentStatus}
        stageKey={stageKey}
        className="btn btn-ghost"
      />
      <MarkRealizadoButton
        caseId={caseId}
        status={status}
        stageKey={stageKey}
        currentClosingScore={currentClosingScore}
        currentRegion={currentRegion}
        currentProductKeys={currentProductKeys}
        productOptions={productOptions}
      />
      <MarkPropuestaEnviadaButton
        caseId={caseId}
        status={status}
        stageKey={stageKey}
      />
      <MarkWonButton caseId={caseId} status={status} stageKey={stageKey} />
    </>
  );
}

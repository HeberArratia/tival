"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ClosingScorePicker } from "@/components/ClosingScorePicker";
import { DealFitPicker } from "@/components/DealFitPicker";
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
import { isDealFit, type DealFit } from "@/lib/deal-fits";
import { MemberAvatar } from "@/components/MemberAvatar";
import { canAssignConsultant } from "@/lib/members-catalog";
import { toProductOption, type ProductOption } from "@/lib/products";
import { workspaceSegments } from "@/lib/segments";
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

/** Pedir comprobante por WhatsApp (Moira) — lead / sin pago. */
export function canRequestPaymentWhatsapp(input: {
  status: string;
  paymentStatus: string;
  stageKey?: string;
  hasPhone?: boolean;
  hasScheduledAt?: boolean;
}) {
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  if (isTerminalStageKey(input.stageKey)) return false;
  if (input.paymentStatus === "paid") return false;
  if (!input.hasPhone) return false;
  if (!input.hasScheduledAt) return false;
  return input.stageKey === "lead" || !input.stageKey;
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
    notifyWhatsapp?: boolean;
    closingScore?: string | null;
    dealFit?: string | null;
    region?: string | null;
    productKeys?: string[] | null;
    consultantId?: string | null;
    segmento?: string | null;
  }
): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  whatsappError?: string;
}> {
  const res = await fetch(`/api/cases/${caseId}/actions`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await res.text().catch(() => "");
  type ActionBody = {
    error?: string;
    whatsapp?: { ok?: boolean; error?: string } | null;
  };
  let data: ActionBody | null = null;
  try {
    data = text ? (JSON.parse(text) as ActionBody) : null;
  } catch {
    data = null;
  }

  if (res.ok) {
    const whatsappError =
      data?.whatsapp && data.whatsapp.ok === false
        ? data.whatsapp.error
        : undefined;
    return { ok: true, status: res.status, whatsappError };
  }

  let error = `http_${res.status}`;
  if (data?.error) error = data.error;
  else if (!text) error = "empty_body";
  else if (!data) error = `non_json:${text.slice(0, 120)}`;
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

type ConfirmPaymentMethod = "transferencia" | "mercadopago";

/** Ops confirma pago (transferencia o MP manual) con modal + switch WhatsApp. */
function ConfirmPaymentButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  method,
  hasPhone = false,
  className = "btn btn-primary",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  method: ConfirmPaymentMethod;
  hasPhone?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!canConfirmTransfer({ status, paymentStatus, stageKey })) return null;

  const isMp = method === "mercadopago";
  const action = isMp ? "confirm_mp" : "confirm_transfer";
  const label = isMp ? "Confirmar MP" : "Confirmar transferencia";
  const title = isMp
    ? "Ops confirma pago por Mercado Pago (manual, hasta tener integración)"
    : "Ops confirma transferencia recibida";
  const modalTitleId = isMp
    ? "confirm-mp-modal-title"
    : "confirm-transfer-modal-title";
  const switchId = isMp
    ? "confirm-mp-notify-whatsapp"
    : "confirm-transfer-notify-whatsapp";

  function openConfirm(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setNotifyWhatsapp(false);
    setOpen(true);
  }

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await postAction(caseId, action, { notifyWhatsapp });
      if (!res.ok) {
        setError(res.error ?? "No se pudo confirmar el pago");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const modal =
    open && mounted
      ? createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              if (!loading) setOpen(false);
            }}
          >
            <div
              className="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={modalTitleId}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="panel-kicker">Lead entrante</p>
              <h3 id={modalTitleId}>¿Confirmar pago?</h3>
              <p className="lede" style={{ marginTop: "0.35rem" }}>
                {isMp
                  ? "Se marca como pagado por Mercado Pago y pasa a Diagnóstico pagado."
                  : "Se marca como pagado por transferencia y pasa a Diagnóstico pagado."}
              </p>

              <label
                className="modal-switch-row"
                htmlFor={switchId}
                title={
                  hasPhone
                    ? "Envía el template de pago confirmado por WhatsApp"
                    : "Sin teléfono en el contacto"
                }
              >
                <span>
                  Avisar vía WhatsApp
                  {!hasPhone ? (
                    <span className="row-meta" style={{ display: "block" }}>
                      Sin teléfono en el contacto
                    </span>
                  ) : null}
                </span>
                <input
                  id={switchId}
                  type="checkbox"
                  role="switch"
                  checked={notifyWhatsapp}
                  disabled={loading || !hasPhone}
                  onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                />
              </label>

              {error ? (
                <p
                  className="row-meta"
                  style={{
                    color: "var(--danger, #b33)",
                    marginTop: "0.65rem",
                  }}
                >
                  {error}
                </p>
              ) : null}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={loading}
                  onClick={() => setOpen(false)}
                >
                  No
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => void confirm()}
                >
                  {loading ? "…" : isMp ? "Sí, confirmar MP" : "Sí, confirmar transferencia"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={openConfirm}
        title={title}
      >
        {loading && !open ? "…" : label}
      </button>
      {modal}
    </>
  );
}

/** Ops confirma transferencia recibida. */
export function ConfirmTransferButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  hasPhone = false,
  className = "btn btn-primary",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  hasPhone?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  return (
    <ConfirmPaymentButton
      caseId={caseId}
      status={status}
      paymentStatus={paymentStatus}
      stageKey={stageKey}
      method="transferencia"
      hasPhone={hasPhone}
      className={className}
      stopPropagation={stopPropagation}
    />
  );
}

/** Ops confirma MP manual (hasta tener integración). */
export function ConfirmMpButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  hasPhone = false,
  className = "btn",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  hasPhone?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  return (
    <ConfirmPaymentButton
      caseId={caseId}
      status={status}
      paymentStatus={paymentStatus}
      stageKey={stageKey}
      method="mercadopago"
      hasPhone={hasPhone}
      className={className}
      stopPropagation={stopPropagation}
    />
  );
}

const WHATSAPP_ERROR_LABEL: Record<string, string> = {
  missing_phone: "Sin teléfono en el contacto",
  invalid_phone: "Teléfono inválido",
  missing_scheduled_at: "Sin fecha de reunión",
  missing_contact: "Sin contacto",
  already_paid: "Ya está pagado",
  template_not_ready: "Template WhatsApp aún no aprobado en Meta",
  kapso_not_configured:
    "Kapso no configurado (Integraciones → Kapso, o KAPSO_* en env)",
  kapso_api_key_missing: "Falta API key de Kapso",
  kapso_phone_number_id_missing: "Falta phone number ID de Kapso",
  kapso_send_failed: "Kapso no pudo enviar el mensaje",
  kapso_block_failed: "Kapso no pudo bloquear el número",
};

/** Bloquear WhatsApp del contacto en el número de negocio. */
export function canBlockWhatsapp(input: { hasPhone?: boolean }) {
  return Boolean(input.hasPhone);
}

export function BlockWhatsappButton({
  caseId,
  hasPhone = false,
  className = "btn",
  onConfirmOpenChange,
}: {
  caseId: string;
  hasPhone?: boolean;
  className?: string;
  /** Avisa al menú padre para no desmontar mientras el modal está abierto. */
  onConfirmOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!canBlockWhatsapp({ hasPhone })) return null;

  function setConfirmOpen(next: boolean) {
    setOpen(next);
    onConfirmOpenChange?.(next);
  }

  function openConfirm(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setConfirmOpen(true);
  }

  async function confirmBlock() {
    setLoading(true);
    setError(null);
    try {
      const res = await postAction(caseId, "block_whatsapp");
      if (!res.ok) {
        setError(
          WHATSAPP_ERROR_LABEL[res.error ?? ""] ??
            res.error ??
            "No se pudo bloquear"
        );
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const modal =
    open && mounted
      ? createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              if (!loading) setConfirmOpen(false);
            }}
          >
            <div
              className="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="block-whatsapp-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="panel-kicker">WhatsApp</p>
              <h3 id="block-whatsapp-modal-title">¿Bloquear este número?</h3>
              <p className="lede" style={{ marginTop: "0.35rem" }}>
                No podrá escribirte más a este número de negocio. Podés
                desbloquearlo después desde Kapso / Meta si hace falta.
              </p>

              {error ? (
                <p
                  className="row-meta"
                  style={{
                    color: "var(--danger, #b33)",
                    marginTop: "0.65rem",
                  }}
                >
                  {error}
                </p>
              ) : null}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={loading}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => void confirmBlock()}
                >
                  {loading ? "…" : "Sí, bloquear"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={openConfirm}
        title="Bloquea este contacto en WhatsApp Business (Kapso / Meta)"
      >
        {loading && !open ? "…" : "Bloquear WhatsApp"}
      </button>
      {modal}
    </>
  );
}

/** Pedir comprobante de pago por WhatsApp (template Moira). */
export function RequestPaymentWhatsappButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  hasPhone = false,
  hasScheduledAt = false,
  className = "btn",
  stopPropagation = false,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  hasPhone?: boolean;
  hasScheduledAt?: boolean;
  className?: string;
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    !canRequestPaymentWhatsapp({
      status,
      paymentStatus,
      stageKey,
      hasPhone,
      hasScheduledAt,
    })
  ) {
    return null;
  }

  async function run(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLoading(true);
    setError(null);
    try {
      const res = await postAction(caseId, "request_payment_whatsapp");
      if (!res.ok) {
        setError(
          WHATSAPP_ERROR_LABEL[res.error ?? ""] ??
            res.error ??
            "No se pudo enviar"
        );
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={run}
        title="Envía el mensaje de Moira pidiendo el comprobante de pago"
      >
        {loading ? "…" : "Pedir pago por WhatsApp"}
      </button>
      {error ? (
        <span className="row-meta" style={{ color: "var(--danger, #b33)" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** No pagó / no compró / no asistió (desde no_show) → Perdido. */
export function MarkLostButton({
  caseId,
  status,
  paymentStatus,
  stageKey,
  hasPhone = false,
  className = "btn",
  stopPropagation = false,
  reason,
  onConfirmOpenChange,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  hasPhone?: boolean;
  className?: string;
  stopPropagation?: boolean;
  reason?: string;
  /** Avisa al menú padre para no desmontar mientras el modal está abierto. */
  onConfirmOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!canMarkLost({ status, paymentStatus, stageKey })) return null;

  const isNoShow = status === "no_show";
  const isPostProposal = stageKey === "propuesta_enviada";
  const resolvedReason =
    reason ??
    (isNoShow ? "no_asistio" : isPostProposal ? "no_compra" : "no_pago");
  const isNoPago = resolvedReason === "no_pago";
  const label = isNoShow
    ? "Perdido · no asistió"
    : isPostProposal
      ? "Perdido"
      : "No pagó";
  const action = isNoShow ? "no_show_lost" : "mark_lost";

  function setConfirmOpen(next: boolean) {
    setOpen(next);
    onConfirmOpenChange?.(next);
  }

  function openConfirm(e: MouseEvent) {
    if (isNoPago) {
      // Cortar burbuja: Acciones cierra el menú y desmontaba este botón
      // antes de que el modal pudiera montarse.
      e.preventDefault();
      e.stopPropagation();
      setError(null);
      setNotifyWhatsapp(false);
      setConfirmOpen(true);
      return;
    }
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    void runDirect();
  }

  async function runDirect() {
    setLoading(true);
    setError(null);
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

  async function confirmNoPago() {
    setLoading(true);
    setError(null);
    try {
      const res = await postAction(caseId, "mark_lost", {
        reason: "no_pago",
        notifyWhatsapp,
      });
      if (!res.ok) {
        setError(
          WHATSAPP_ERROR_LABEL[res.error ?? ""] ??
            res.error ??
            "No se pudo marcar perdido"
        );
        return;
      }
      if (res.whatsappError) {
        setError(
          WHATSAPP_ERROR_LABEL[res.whatsappError] ??
            `Marcado perdido, pero WhatsApp falló: ${res.whatsappError}`
        );
      }
      setConfirmOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const modal =
    open && mounted
      ? createPortal(
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              if (!loading) setConfirmOpen(false);
            }}
          >
            <div
              className="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="no-pago-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="panel-kicker">Lead entrante</p>
              <h3 id="no-pago-modal-title">¿Seguro que quiere hacerlo?</h3>
              <p className="lede" style={{ marginTop: "0.35rem" }}>
                La oportunidad pasa a Perdido y se cancela la reunión en
                Calendar / Meet.
              </p>

              <label
                className="modal-switch-row"
                htmlFor="no-pago-notify-whatsapp"
                title={
                  hasPhone
                    ? "Envía el template de sesión cancelada por WhatsApp"
                    : "Sin teléfono en el contacto"
                }
              >
                <span>
                  Avisar vía WhatsApp
                  {!hasPhone ? (
                    <span className="row-meta" style={{ display: "block" }}>
                      Sin teléfono en el contacto
                    </span>
                  ) : null}
                </span>
                <input
                  id="no-pago-notify-whatsapp"
                  type="checkbox"
                  role="switch"
                  checked={notifyWhatsapp}
                  disabled={loading || !hasPhone}
                  onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                />
              </label>

              {error ? (
                <p
                  className="row-meta"
                  style={{
                    color: "var(--danger, #b33)",
                    marginTop: "0.65rem",
                  }}
                >
                  {error}
                </p>
              ) : null}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={loading}
                  onClick={() => setConfirmOpen(false)}
                >
                  No
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => void confirmNoPago()}
                >
                  {loading ? "…" : "Sí, marcar no pagó"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={loading}
        onClick={openConfirm}
        title={
          isNoShow
            ? "Cierra sin chance de reagenda · Perdido / no asistió"
            : isPostProposal
              ? "No compró · pasa a Perdido"
              : "Marca como perdido (sin pago). Pasa a la etapa Perdido."
        }
      >
        {loading && !open ? "…" : label}
      </button>
      {modal}
    </>
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
      "¿Cancelar esta oportunidad? Queda fuera del canvas (motivo: superseded) y se cancela la reunión en Calendly/Meet. Usalo para duplicados cuando otra opp es la vigente."
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
      title="Cancelar duplicado · superseded (queda la otra opp; cancela Calendly/Meet)"
    >
      {loading ? "…" : "Cancelar · duplicado"}
    </button>
  );
}

/** Copia link de reagenda (URL Tival `/r/{caseId}` → redirect a Calendly). */
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
  currentDealFit,
  currentRegion,
  currentProductKeys,
  productOptions: productOptionsProp,
  /** Segmento sugerido por el wizard (prefill). */
  suggestedSegmento = null,
  /** Segmento ya confirmado (si existe). */
  currentSegmento = null,
}: {
  caseId: string;
  status: string;
  stageKey?: string;
  className?: string;
  stopPropagation?: boolean;
  currentClosingScore?: string | null;
  currentDealFit?: string | null;
  currentRegion?: string | null;
  currentProductKeys?: string[];
  productOptions?: ProductOption[];
  suggestedSegmento?: string | null;
  currentSegmento?: string | null;
}) {
  const router = useRouter();
  const segmentOptions = workspaceSegments();
  const defaultSeg =
    currentSegmento?.trim() || suggestedSegmento?.trim() || null;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<ClosingScore | null>(
    isClosingScore(currentClosingScore) ? currentClosingScore : null
  );
  const [dealFit, setDealFit] = useState<DealFit | null>(
    isDealFit(currentDealFit) ? currentDealFit : null
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
  const [segmento, setSegmento] = useState<string | null>(defaultSeg);

  useEffect(() => {
    if (open) {
      setScore(isClosingScore(currentClosingScore) ? currentClosingScore : null);
      setDealFit(isDealFit(currentDealFit) ? currentDealFit : null);
      setRegion(isChileRegion(currentRegion) ? currentRegion : null);
      setProductKeys(currentProductKeys ?? []);
      setSegmento(
        currentSegmento?.trim() || suggestedSegmento?.trim() || null
      );
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
    currentDealFit,
    currentRegion,
    currentProductKeys,
    productOptionsProp,
    suggestedSegmento,
    currentSegmento,
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
        dealFit,
        region,
        productKeys,
        segmento,
      });
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const suggestedLabel = suggestedSegmento
    ? segmentOptions.find(
        (s) =>
          s.code.toLowerCase() === suggestedSegmento.toLowerCase() ||
          s.id === suggestedSegmento.toLowerCase()
      )?.name
    : null;

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
              Completá lo que ya tengas. Todo es opcional — podés cargarlo
              después. El segmento lo valida el consultor tras la reunión.
            </p>

            <div className="region-editor" style={{ marginTop: "0.85rem" }}>
              <label className="field-label" htmlFor="realizado-segmento">
                Segmento
              </label>
              <select
                id="realizado-segmento"
                className="field-input"
                value={segmento ?? ""}
                disabled={loading}
                onChange={(e) =>
                  setSegmento(e.target.value ? e.target.value : null)
                }
              >
                <option value="">Sin confirmar</option>
                {segmentOptions.map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
              {suggestedSegmento ? (
                <p className="row-meta" style={{ marginTop: "0.35rem" }}>
                  Sugerido por el wizard:{" "}
                  <strong>{suggestedSegmento}</strong>
                  {suggestedLabel ? ` — ${suggestedLabel}` : ""}
                </p>
              ) : null}
            </div>

            <div style={{ marginTop: "0.85rem" }}>
              <p className="field-label" style={{ marginBottom: "0.4rem" }}>
                Temperatura comercial
              </p>
              <ClosingScorePicker
                value={score}
                onChange={setScore}
                disabled={loading}
                allowClear
              />
            </div>

            <div style={{ marginTop: "0.85rem" }}>
              <p className="field-label" style={{ marginBottom: "0.4rem" }}>
                Calificación del deal
              </p>
              <DealFitPicker
                value={dealFit}
                onChange={setDealFit}
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
  hasPhone = false,
  calendlyLink = null,
}: {
  caseId: string;
  status: string;
  paymentStatus: string;
  stageKey?: string;
  canGenerateProposal?: boolean;
  hasScheduledAt?: boolean;
  hasPhone?: boolean;
  calendlyLink?: string | null;
}) {
  const [open, setOpen] = useState(false);
  /** Mantener MarkLost montado mientras su modal esté abierto (el menú se cierra). */
  const [lostConfirmOpen, setLostConfirmOpen] = useState(false);
  /** Idem para Bloquear WhatsApp. */
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);

  const showNoShow = canOfferReschedule({ status, stageKey, hasScheduledAt });
  const showNoShowLost = canMarkNoShowActions({
    status,
    stageKey,
    hasScheduledAt,
  });
  const showLost = canMarkLost({ status, paymentStatus, stageKey });
  const showCancel = canCancelSuperseded({ status, stageKey });
  const showLink = Boolean(calendlyLink);
  const showBlock = canBlockWhatsapp({ hasPhone });
  const hasAnything =
    showNoShow ||
    showNoShowLost ||
    showLost ||
    showCancel ||
    showLink ||
    canGenerateProposal ||
    showBlock;

  if (!hasAnything) return null;

  const showMenu = open || lostConfirmOpen || blockConfirmOpen;

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
      {showMenu ? (
        <div
          className="case-actions-menu"
          role="menu"
          hidden={!open}
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
            hasPhone={hasPhone}
            className={MENU_ITEM}
            onConfirmOpenChange={(next) => {
              setLostConfirmOpen(next);
              if (next) setOpen(false);
            }}
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
          <BlockWhatsappButton
            caseId={caseId}
            hasPhone={hasPhone}
            className={MENU_ITEM}
            onConfirmOpenChange={(next) => {
              setBlockConfirmOpen(next);
              if (next) setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

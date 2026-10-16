import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { SidebarUser } from "@/components/SidebarUser";
import {
  CLOSING_SCORES,
  LEGACY_CLOSING_NO_FIT,
  isClosingScore,
} from "@/lib/closing-scores";
import { DEAL_FITS, isDealFit } from "@/lib/deal-fits";
import {
  playbookLabel,
  playbookMetaById,
  type FakeInitiative,
} from "@/lib/fake-data";
import { lostReasonLabel } from "@/lib/lost-reasons";
import type { WorkspaceSegment } from "@/lib/segments";
import { segmentModeLabel } from "@/lib/segments";
import { getWorkspacePack } from "@/lib/workspace/registry";

export type ShellActive =
  | "contactos"
  | "empresas"
  | "playbooks"
  | "iniciativas"
  | "segmentos"
  | "productos"
  | "integraciones"
  | "diagnostico"
  | "docs";

export function AppShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: ShellActive;
}) {
  const pack = getWorkspacePack();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/procesos/diagnostico" className="brand">
          <BrandMark />
          <div>
            <strong>tival</strong>
            <small>operar el proceso</small>
          </div>
        </Link>

        <div className="tenant">
          <label>Workspace</label>
          <strong>{pack.name}</strong>
        </div>

        <nav className="nav">
          <div className="nav-label">Iniciativas</div>
          <Link
            href="/procesos/diagnostico"
            className={active === "diagnostico" ? "is-active" : undefined}
            title="Iniciativa Diagnóstico"
          >
            <span className="dot" />
            Diagnóstico
          </Link>

          <div className="nav-label" style={{ marginTop: "1.1rem" }}>
            Directorio
          </div>
          <Link
            href="/contactos"
            className={active === "contactos" ? "is-active" : undefined}
          >
            <span className="dot" />
            Contactos
          </Link>
          <Link
            href="/empresas"
            className={active === "empresas" ? "is-active" : undefined}
          >
            <span className="dot" />
            Empresas
          </Link>

          <details className="nav-config" open>
            <summary className="nav-label nav-config-summary">
              Configurar
            </summary>
            <Link
              href="/iniciativas"
              className={active === "iniciativas" ? "is-active" : undefined}
            >
              <span className="dot" />
              Iniciativas
            </Link>
            <Link
              href="/segmentos"
              className={active === "segmentos" ? "is-active" : undefined}
            >
              <span className="dot" />
              Segmentos
            </Link>
            <Link
              href="/productos"
              className={active === "productos" ? "is-active" : undefined}
            >
              <span className="dot" />
              Productos
            </Link>
            <Link
              href="/integraciones"
              className={active === "integraciones" ? "is-active" : undefined}
            >
              <span className="dot" />
              Integraciones
            </Link>
            <Link
              href="/playbooks"
              className={active === "playbooks" ? "is-active" : undefined}
            >
              <span className="dot" />
              Playbooks
            </Link>
          </details>

          <div className="nav-bottom">
            <Link
              href="/docs"
              className={active === "docs" ? "is-active" : undefined}
            >
              <span className="dot" />
              Docs
            </Link>
          </div>
        </nav>

        <div className="sidebar-foot">
          <SidebarUser />
          <p>Una ficha por oportunidad · sin duplicar</p>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export function Topbar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="topbar-actions">{actions}</div> : null}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "pill-run",
    cancelled: "pill",
    no_show: "pill-wait",
    rescheduled_away: "pill-warn",
  };
  const labels: Record<string, string> = {
    open: "open",
    cancelled: "cancelado",
    no_show: "esperando reagenda",
    rescheduled_away: "reagendada",
  };
  return (
    <span className={`pill ${map[status] ?? "pill"}`}>
      {labels[status] ?? status}
    </span>
  );
}

/** Pedido de pago por WhatsApp — solo Lead entrante. */
export function PaymentRequestPill({
  status,
}: {
  status: "sent" | "failed" | "none";
}) {
  if (status === "sent") {
    return (
      <span className="pill pill-ok" title="Ya se pidió el pago por WhatsApp">
        solicitado
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="pill pill-wait"
        title="El WhatsApp de pedido de pago no se envió"
      >
        falló
      </span>
    );
  }
  return (
    <span
      className="pill pill-warn"
      title="Todavía no se pidió el pago por WhatsApp"
    >
      no solicitado
    </span>
  );
}

export function LostReasonPill({
  reason,
}: {
  reason: string | null | undefined;
}) {
  const label = lostReasonLabel(reason);
  if (!label) return null;
  return (
    <span className="pill pill-warn" title="Motivo de perdido">
      {label}
    </span>
  );
}

/** Solo renderiza si hay temperatura comercial definida. */
export function ClosingScorePill({
  score,
}: {
  score: string | null | undefined;
}) {
  if (!isClosingScore(score)) return null;
  const s = CLOSING_SCORES[score];
  return (
    <span
      className={`pill pill-closing pill-closing-${score}`}
      title={s.description}
    >
      {s.emoji} {s.label}
    </span>
  );
}

export function closingScoreFromQualification(
  qualification: Record<string, unknown> | null | undefined
): string | null {
  const raw = qualification?.closing_score;
  return typeof raw === "string" && isClosingScore(raw) ? raw : null;
}

/** Solo renderiza si hay calificación del deal definida. */
export function DealFitPill({
  fit,
}: {
  fit: string | null | undefined;
}) {
  if (!isDealFit(fit)) return null;
  const s = DEAL_FITS[fit];
  return (
    <span
      className={`pill pill-fit pill-fit-${fit}`}
      title={s.description}
    >
      {s.emoji} {s.label}
    </span>
  );
}

export function dealFitFromQualification(
  qualification: Record<string, unknown> | null | undefined
): string | null {
  const raw = qualification?.deal_fit;
  if (typeof raw === "string" && isDealFit(raw)) return raw;
  // Legacy: no_fit vivía en closing_score
  if (qualification?.closing_score === LEGACY_CLOSING_NO_FIT) {
    return LEGACY_CLOSING_NO_FIT;
  }
  return null;
}

export function PlaybookPill({
  playbookId,
}: {
  playbookId: string | null | undefined;
}) {
  const label = playbookLabel(playbookId);
  const meta = playbookMetaById(playbookId);
  const slugClass =
    meta.slug.includes("captacion") || meta.slug === "captacion"
      ? "pill-playbook-cap"
      : meta.slug === "wizard-autodiagnostico"
        ? "pill-playbook-funder"
        : "pill-playbook";
  return (
    <span className={`pill ${slugClass}`} title="Playbook">
      <i className="pill-process-mark" aria-hidden />
      {label}
    </span>
  );
}

export function InitiativePill({
  initiative,
}: {
  initiative: FakeInitiative | null | undefined;
}) {
  if (!initiative) return null;
  return (
    <span className="pill pill-initiative" title="Iniciativa">
      {initiative.name}
    </span>
  );
}

export function SegmentPill({
  segment,
  label,
  status,
}: {
  segment: WorkspaceSegment | null | undefined;
  /** Label Alfondo (segmento_label); si no, usa name del pack. */
  label?: string | null;
  /** En oportunidades: sugerido (rojo) vs validado (verde). */
  status?: "sugerido" | "validado" | null;
}) {
  if (!segment) return null;
  const cls =
    status === "validado"
      ? "pill pill-segment-validado"
      : status === "sugerido"
        ? "pill pill-segment-sugerido"
        : "pill pill-segment";
  const titleParts = [
    label || segment.name,
    status === "sugerido" ? "Sugerido por el wizard" : null,
    status === "validado" ? "Validado por el consultor" : null,
  ].filter(Boolean);
  return (
    <span className={cls} title={titleParts.join(" · ")}>
      {segment.code}
      {status === "sugerido" ? (
        <span style={{ fontWeight: 500, opacity: 0.85 }}> · sugerido</span>
      ) : null}
    </span>
  );
}

export function InitiativeSegmentSummary({
  initiative,
}: {
  initiative: FakeInitiative | null | undefined;
}) {
  if (!initiative?.targetSegmentIds?.length) return null;
  const mode = segmentModeLabel(initiative.segmentMode);
  return (
    <span className="pill pill-segment-mode" title={mode}>
      {initiative.segmentMode === "classify" ? "clasifica" : "fijo"} ·{" "}
      {initiative.targetSegmentIds
        .map((id) => id.toUpperCase())
        .join(" · ")}
    </span>
  );
}

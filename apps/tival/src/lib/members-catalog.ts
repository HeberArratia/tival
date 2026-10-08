/**
 * Catálogo sync de miembros — seguro para Client Components.
 * Sin imports de DB / postgres.
 */
import {
  SEED_USER_HEBER_ID,
  seedUserById,
} from "@/lib/auth/seed-users";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/workspace/types";

export type { WorkspaceMember, WorkspaceRole };

/** @deprecated usar getSessionUser */
export const CURRENT_MEMBER_ID = SEED_USER_HEBER_ID;

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  ops: "Ops",
  consultor: "Consultor",
};

/** Lookup sync (avatar / UI) — mismos IDs que el seed/DB. */
export function memberById(
  id: string | null | undefined,
  _workspaceSlug?: string | null
): WorkspaceMember | null {
  const u = seedUserById(id);
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles,
  };
}

export function isMemberId(
  id: string,
  _workspaceSlug?: string | null
): boolean {
  return !!seedUserById(id);
}

/** Iniciales para avatar (máx. 2). */
export function memberInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

/** Acciones de handoff consultoría — ownership sugerido (no permiso). */
export type HandoffActionId =
  | "confirm_transfer"
  | "assign_consultant"
  | "mark_lost_unpaid"
  | "mark_realizado"
  | "mark_propuesta"
  | "mark_won"
  | "mark_lost_no_compra";

export type ActionOwner = WorkspaceRole;

export const HANDOFF_ACTION_OWNER: Record<HandoffActionId, ActionOwner> = {
  confirm_transfer: "ops",
  assign_consultant: "ops",
  mark_lost_unpaid: "ops",
  mark_realizado: "consultor",
  mark_propuesta: "consultor",
  mark_won: "consultor",
  mark_lost_no_compra: "consultor",
};

export const HANDOFF_ACTION_LABEL: Record<HandoffActionId, string> = {
  confirm_transfer: "Confirmar transferencia",
  assign_consultant: "Asignar consultor",
  mark_lost_unpaid: "Marcar perdido (no pagó)",
  mark_realizado: "Marcar diagnóstico realizado",
  mark_propuesta: "Propuesta enviada",
  mark_won: "Marcar ganado",
  mark_lost_no_compra: "Marcar perdido (no compró)",
};

const EXCEPTION_STATUSES = ["cancelled", "no_show", "rescheduled_away"];

export function handoffActionsForCase(input: {
  status: string;
  paymentStatus: string;
  stageKey?: string | null;
  assignedConsultantId?: string | null;
}): {
  ops: HandoffActionId[];
  consultor: HandoffActionId[];
  needsConsultantWarning: boolean;
} {
  const ops: HandoffActionId[] = [];
  const consultor: HandoffActionId[] = [];

  if (EXCEPTION_STATUSES.includes(input.status)) {
    return { ops, consultor, needsConsultantWarning: false };
  }

  const stage = input.stageKey ?? null;
  const paid = input.paymentStatus === "paid";
  const open = input.status === "open";

  if (!paid && open && (stage === "lead" || stage === "pagado" || !stage)) {
    ops.push("confirm_transfer");
    ops.push("mark_lost_unpaid");
  }

  if (paid && open && stage === "pagado") {
    if (!input.assignedConsultantId) {
      ops.push("assign_consultant");
    }
    consultor.push("mark_realizado");
  }

  if (paid && open && stage === "realizado") {
    consultor.push("mark_propuesta");
  }

  if (paid && open && stage === "propuesta_enviada") {
    consultor.push("mark_won");
    consultor.push("mark_lost_no_compra");
  }

  /** Warning solo en Diagnóstico pagado (última etapa donde se puede asignar). */
  const needsConsultantWarning =
    paid &&
    open &&
    stage === "pagado" &&
    !input.assignedConsultantId;

  return { ops, consultor, needsConsultantWarning };
}

/** Asignar/cambiar consultor solo en Diagnóstico pagado (no desde realizado). */
export function canAssignConsultant(input: {
  status: string;
  paymentStatus: string;
  stageKey?: string | null;
}): boolean {
  if (EXCEPTION_STATUSES.includes(input.status)) return false;
  if (input.paymentStatus !== "paid") return false;
  return input.stageKey === "pagado";
}

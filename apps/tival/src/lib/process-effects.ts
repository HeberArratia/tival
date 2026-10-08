/**
 * Flujo UI del playbook por etapa: triggers (entrada) + efectos (salida).
 * Evento = rastro histórico en la oportunidad (timeline), con resultado.
 * No es el runtime de adapters — expresa el modelo mental.
 */

import type { WorkspaceRole } from "@/lib/workspace/types";

export type StageTrigger = {
  id: string;
  label: string;
  /** Origen de la señal */
  via: string;
  status: "live" | "planned";
  /**
   * Quién debería disparar este trigger humano (ops / consultor).
   * Distinto del actor de etapa (sistema | integracion | humano | agente).
   */
  ownedBy?: WorkspaceRole;
};

export type StageEffect = {
  id: string;
  label: string;
  /** Adapter / canal de ejecución */
  via: string;
  status: "live" | "planned";
};

type StageRecipe = {
  triggers: StageTrigger[];
  effects: StageEffect[];
};

/** Triggers + efectos por stage.key — Consultoría (hechos). */
const RECIPE_BY_STAGE_KEY: Record<string, StageRecipe> = {
  lead: {
    triggers: [
      {
        id: "form-preagenda",
        label: "Form pre-agenda enviado",
        via: "Landing",
        status: "live",
      },
      {
        id: "calendly-created",
        label: "Calendly invitee.created",
        via: "Webhook",
        status: "live",
      },
    ],
    effects: [
      {
        id: "upsert-opp",
        label: "Crear / upsert oportunidad",
        via: "Dominio",
        status: "live",
      },
      {
        id: "resolve-segment",
        label: "Resolver segmento (S1–S3)",
        via: "Dominio",
        status: "planned",
      },
      {
        id: "route-calendly",
        label: "Enrutar Calendly A/B/C",
        via: "Dominio",
        status: "planned",
      },
    ],
  },
  pagado: {
    triggers: [
      {
        id: "mp-webhook",
        label: "MP payment.approved (POST Alfondo)",
        via: "Webhook",
        status: "live",
      },
      {
        id: "ops-transfer",
        label: "Confirma transferencia",
        via: "UI",
        status: "live",
        ownedBy: "ops",
      },
      {
        id: "ops-assign",
        label: "Asigna consultor",
        via: "UI",
        status: "live",
        ownedBy: "ops",
      },
    ],
    effects: [
      {
        id: "mark-paid",
        label: "Marcar pagado · entrar a esta etapa",
        via: "Dominio",
        status: "live",
      },
      {
        id: "drive-folder",
        label: "Crear carpeta Drive",
        via: "Drive",
        status: "live",
      },
      {
        id: "slack-paid",
        label: "Avisar diagnóstico confirmado",
        via: "n8n · Slack",
        status: "live",
      },
      {
        id: "meta-capi",
        label: "Informar Purchase a Meta",
        via: "CAPI",
        status: "planned",
      },
    ],
  },
  realizado: {
    triggers: [
      {
        id: "consultor-realizado",
        label: "Marca diagnóstico realizado",
        via: "UI",
        status: "live",
        ownedBy: "consultor",
      },
      {
        id: "meet-done",
        label: "Reunión de diagnóstico cerrada",
        via: "Humano · Meet",
        status: "planned",
        ownedBy: "consultor",
      },
    ],
    effects: [
      {
        id: "advance-realizado",
        label: "Entrar a Diagnóstico realizado",
        via: "Dominio",
        status: "live",
      },
      {
        id: "post-meet",
        label: "Notas + grabación a carpeta",
        via: "Meet · Drive · Inngest",
        status: "live",
      },
    ],
  },
  propuesta_enviada: {
    triggers: [
      {
        id: "consultor-propuesta",
        label: "Marca propuesta enviada",
        via: "UI",
        status: "live",
        ownedBy: "consultor",
      },
      {
        id: "send-proposal",
        label: "Propuesta enviada al cliente",
        via: "Humano · Agente",
        status: "planned",
        ownedBy: "consultor",
      },
    ],
    effects: [
      {
        id: "advance-propuesta",
        label: "Entrar a Propuesta enviada",
        via: "Dominio",
        status: "live",
      },
      {
        id: "draft",
        label: "Generar borrador propuesta",
        via: "n8n · Gemini",
        status: "live",
      },
      {
        id: "mail",
        label: "Correo de propuesta al consultor",
        via: "n8n · Gmail",
        status: "live",
      },
    ],
  },
  seguimiento: {
    triggers: [
      {
        id: "in-seguimiento",
        label: "Entró a seguimiento",
        via: "Dominio",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "cadence",
        label: "Cadencia 48h / 7d",
        via: "Agente",
        status: "planned",
      },
    ],
  },
  ganado: {
    triggers: [
      {
        id: "mark-won",
        label: "Marca ganado",
        via: "UI",
        status: "planned",
        ownedBy: "consultor",
      },
    ],
    effects: [
      {
        id: "close-won",
        label: "Cerrar como ganado",
        via: "Dominio",
        status: "planned",
      },
    ],
  },
  perdido: {
    triggers: [
      {
        id: "ops-unpaid",
        label: "No pagó",
        via: "UI",
        status: "live",
        ownedBy: "ops",
      },
      {
        id: "consultor-no-compra",
        label: "No compró",
        via: "UI",
        status: "live",
        ownedBy: "consultor",
      },
    ],
    effects: [
      {
        id: "close-lost",
        label: "Mover a Perdido",
        via: "Dominio",
        status: "live",
      },
      {
        id: "cancel-meeting",
        label: "Cancelar reunión Calendar/Meet (si no_pago)",
        via: "Integración",
        status: "live",
      },
    ],
  },
  inbound: {
    triggers: [
      {
        id: "web-magnet",
        label: "Submit guía / form",
        via: "Web",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "upsert-cap",
        label: "Crear oportunidad",
        via: "Dominio",
        status: "planned",
      },
    ],
  },
  registrado: {
    triggers: [
      {
        id: "webinar-reg",
        label: "Registro webinar",
        via: "Web",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "upsert-web",
        label: "Crear oportunidad webinar",
        via: "Dominio",
        status: "planned",
      },
    ],
  },
  asistencia: {
    triggers: [
      {
        id: "attendance-sync",
        label: "Sync asistencia (Zoom / Meet)",
        via: "Integración",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "mark-attended",
        label: "Marcar asistió / no asistió",
        via: "Dominio",
        status: "planned",
      },
    ],
  },
  nurture: {
    triggers: [
      {
        id: "inbound-done",
        label: "Lead inbound capturado",
        via: "Dominio",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "seq",
        label: "Enroll nurture",
        via: "Sequenzy · WA",
        status: "planned",
      },
    ],
  },
  calificado: {
    triggers: [
      {
        id: "score-hot",
        label: "Lead calienta / score",
        via: "Agente · Humano",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "promote",
        label: "Promover a iniciativa Consultoría",
        via: "Humano",
        status: "planned",
      },
    ],
  },
  match: {
    triggers: [
      {
        id: "imp-in",
        label: "Lead wizard",
        via: "Web",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "fund-match",
        label: "Resultado autodiagnóstico",
        via: "Agente",
        status: "planned",
      },
    ],
  },
  cierre: {
    triggers: [
      {
        id: "match-ok",
        label: "Match confirmado",
        via: "Humano",
        status: "planned",
      },
    ],
    effects: [
      {
        id: "program-pay",
        label: "Pago / inscripción programa",
        via: "Pagos",
        status: "planned",
      },
    ],
  },
};

export function recipeForStageKey(key: string): StageRecipe {
  return RECIPE_BY_STAGE_KEY[key] ?? { triggers: [], effects: [] };
}

export function effectsForStageKey(key: string): StageEffect[] {
  return recipeForStageKey(key).effects;
}

export function triggersForStageKey(key: string): StageTrigger[] {
  return recipeForStageKey(key).triggers;
}

/** Etapas del playbook consultoría (para mapa de roles). */
const CONSULTORIA_STAGE_ORDER = [
  "lead",
  "pagado",
  "realizado",
  "propuesta_enviada",
  "seguimiento",
  "ganado",
  "perdido",
] as const;

export type RoleDuty = {
  stageKey: string;
  stageLabel: string;
  label: string;
  status: "live" | "planned";
};

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead entrante",
  pagado: "Diagnóstico pagado",
  realizado: "Diagnóstico realizado",
  propuesta_enviada: "Propuesta enviada",
  seguimiento: "Seguimiento",
  ganado: "Ganado",
  perdido: "Perdido",
};

/** Acciones humanas por rol, derivadas de las recipes del playbook. */
export function roleDutiesForConsultoria(): Record<WorkspaceRole, RoleDuty[]> {
  const out: Record<WorkspaceRole, RoleDuty[]> = {
    ops: [],
    consultor: [],
  };
  for (const key of CONSULTORIA_STAGE_ORDER) {
    const recipe = RECIPE_BY_STAGE_KEY[key];
    if (!recipe) continue;
    for (const t of recipe.triggers) {
      if (!t.ownedBy) continue;
      out[t.ownedBy].push({
        stageKey: key,
        stageLabel: STAGE_LABELS[key] ?? key,
        label: t.label,
        status: t.status,
      });
    }
  }
  return out;
}

/** kind en timeline: origen del hecho histórico */
export type EventKind = "trigger" | "efecto" | "humano";

const EVENT_LABELS: Record<
  string,
  { title: string; kind: EventKind; result?: "ok" | "fail" | "info" }
> = {
  calendly_scheduled: {
    title: "Trigger Calendly · agendado",
    kind: "trigger",
    result: "ok",
  },
  calendly_rescheduled: {
    title: "Trigger Calendly · reagendado",
    kind: "trigger",
    result: "ok",
  },
  calendly_canceled: {
    title: "Trigger Calendly · cancelado",
    kind: "trigger",
    result: "ok",
  },
  ops_cancelled: {
    title: "Humano · oportunidad cancelada",
    kind: "humano",
    result: "ok",
  },
  checkout_started: {
    title: "Efecto · checkout iniciado",
    kind: "efecto",
    result: "ok",
  },
  payment_approved: {
    title: "Trigger MP · pago aprobado",
    kind: "trigger",
    result: "ok",
  },
  transfer_confirmed: {
    title: "Trigger ops · transfer confirmada",
    kind: "humano",
    result: "ok",
  },
  drive_folder_created: {
    title: "Efecto · carpeta Drive creada",
    kind: "efecto",
    result: "ok",
  },
  drive_folder_failed: {
    title: "Efecto · carpeta Drive falló",
    kind: "efecto",
    result: "fail",
  },
  meet_enriched: {
    title: "Efecto · Meet real resuelto",
    kind: "efecto",
    result: "ok",
  },
  meet_enrich_failed: {
    title: "Efecto · Meet enrichment falló",
    kind: "efecto",
    result: "fail",
  },
  no_show_marked: {
    title: "Humano · no-show",
    kind: "humano",
    result: "ok",
  },
  no_show_awaiting_reschedule: {
    title: "Humano · no llegó · esperando reagenda",
    kind: "humano",
    result: "ok",
  },
  marked_lost: {
    title: "Humano · perdido",
    kind: "humano",
    result: "ok",
  },
  meeting_canceled: {
    title: "Efecto · reunión Calendar/Meet cancelada",
    kind: "efecto",
    result: "ok",
  },
  meeting_cancel_skipped: {
    title: "Efecto · cancelación reunión omitida",
    kind: "efecto",
    result: "info",
  },
  meeting_cancel_failed: {
    title: "Efecto · cancelación reunión falló",
    kind: "efecto",
    result: "fail",
  },
  marked_won: {
    title: "Humano · ganado",
    kind: "humano",
    result: "ok",
  },
  diagnostico_realizado: {
    title: "Humano · diagnóstico realizado",
    kind: "humano",
    result: "ok",
  },
  propuesta_enviada: {
    title: "Humano · propuesta enviada",
    kind: "humano",
    result: "ok",
  },
  guide_downloaded: {
    title: "Trigger web · guía descargada",
    kind: "trigger",
    result: "ok",
  },
  webinar_registered: {
    title: "Trigger web · webinar",
    kind: "trigger",
    result: "ok",
  },
  contact_form_submitted: {
    title: "Trigger web · contacto",
    kind: "trigger",
    result: "ok",
  },
  nurture_enrolled: {
    title: "Efecto · enroll nurture",
    kind: "efecto",
    result: "ok",
  },
  lead_qualified: {
    title: "Humano · lead calificado",
    kind: "humano",
    result: "ok",
  },
};

export function describeEvent(type: string) {
  return (
    EVENT_LABELS[type] ?? {
      title: type.replace(/_/g, " "),
      kind: "efecto" as EventKind,
      result: "info" as const,
    }
  );
}

export type NextActionHint = {
  title: string;
  body: string;
  tone: "ops" | "consultor" | "wait" | "preview" | "warn";
};

export function nextActionForCase(input: {
  status: string;
  paymentStatus: string;
  stageKey?: string;
  stageRequiresHuman?: boolean;
  isConsultoria: boolean;
  assignedConsultantId?: string | null;
  assignedConsultantName?: string | null;
  awaitingReschedule?: boolean;
  awaitingRescheduleUntil?: string | null;
}): NextActionHint | null {
  if (!input.isConsultoria) {
    if (input.stageKey === "calificado") {
      return {
        title: "Promover a Consultoría",
        body: "Etapa 2: esta oportunidad calificada podrá pasar a una iniciativa de Consultoría sin duplicar el lead.",
        tone: "preview",
      };
    }
    return {
      title: "Captación (preview)",
      body: "Sin handoffs ops en V1. El timeline guarda eventos (historia); la promoción llega después.",
      tone: "preview",
    };
  }

  if (input.stageKey === "perdido") {
    return {
      title: "Perdido",
      body: "Etapa terminal. El motivo (sin pago, no asistió, …) queda en la ficha.",
      tone: "wait",
    };
  }

  if (input.stageKey === "ganado") {
    return {
      title: "Ganado",
      body: "Etapa terminal. Trato cerrado.",
      tone: "wait",
    };
  }

  if (input.awaitingReschedule || input.status === "no_show") {
    const until = input.awaitingRescheduleUntil
      ? new Date(input.awaitingRescheduleUntil)
      : null;
    const untilLabel =
      until && !Number.isNaN(until.getTime())
        ? until.toLocaleDateString("es-CL", {
            day: "numeric",
            month: "short",
          })
        : null;
    return {
      title: input.awaitingReschedule
        ? "Esperando que reagende"
        : "No-show",
      body: input.awaitingReschedule
        ? `Compartí el link de reagenda. Cuando agende, se actualiza esta misma opp.${
            untilLabel ? ` Chance hasta ${untilLabel}.` : ""
          } Si no → Perdido / no asistió.`
        : "Marcá reagendar (chance) o perdido (no asistió).",
      tone: "warn",
    };
  }

  if (input.paymentStatus !== "paid") {
    return {
      title: "Confirmar pago o marcar perdido",
      body: "Ops: transfer recibida → confirmar. Si no va a pagar → Perdido. MP llega solo vía Alfondo.",
      tone: "ops",
    };
  }

  const who = input.assignedConsultantName
    ? ` · ${input.assignedConsultantName}`
    : "";

  if (input.stageKey === "pagado" && !input.assignedConsultantId) {
    return {
      title: "Asignar consultor (recomendado)",
      body: "Ops: elegí quién lleva el diagnóstico. No bloquea marcar realizado.",
      tone: "warn",
    };
  }

  if (input.stageKey === "pagado") {
    return {
      title: `Marcar diagnóstico realizado${who}`,
      body: "Consultor: tras la reunión, pasá a Diagnóstico realizado. Post-meet (notas → Drive) es efecto planificado.",
      tone: "consultor",
    };
  }

  if (input.stageKey === "realizado") {
    return {
      title: `Propuesta enviada${who}`,
      body: "Consultor: cuando la propuesta esté afuera, marcá Propuesta enviada para avanzar de etapa.",
      tone: "consultor",
    };
  }

  if (input.stageKey === "propuesta_enviada") {
    return {
      title: `Cerrar oportunidad${who}`,
      body: "Consultor: Ganado si compró · Perdido si no. Seguimiento queda para después.",
      tone: "consultor",
    };
  }

  if (input.stageRequiresHuman) {
    return {
      title: "Handoff humano",
      body: "Esta etapa pide intervención. Seguimiento y cadencias quedan como efectos → eventos en el diario.",
      tone: "ops",
    };
  }

  return null;
}

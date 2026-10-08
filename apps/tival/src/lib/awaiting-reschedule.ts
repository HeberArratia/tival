/**
 * Chance de reagenda post no-show.
 * Vive en qualification.awaiting_reschedule (no columna dedicada).
 */

export const AWAITING_RESCHEDULE_TTL_DAYS = 14;

export type AwaitingRescheduleState = {
  until: string;
  startedAt: string;
};

export function readAwaitingReschedule(
  qualification: Record<string, unknown> | null | undefined
): AwaitingRescheduleState | null {
  const raw = qualification?.awaiting_reschedule;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const until = typeof o.until === "string" ? o.until : null;
  const startedAt = typeof o.startedAt === "string" ? o.startedAt : null;
  if (!until || !startedAt) return null;
  return { until, startedAt };
}

export function isAwaitingRescheduleActive(
  qualification: Record<string, unknown> | null | undefined,
  now = new Date()
): boolean {
  const state = readAwaitingReschedule(qualification);
  if (!state) return false;
  const until = Date.parse(state.until);
  if (Number.isNaN(until)) return false;
  return until > now.getTime();
}

export function buildAwaitingRescheduleState(
  now = new Date(),
  ttlDays = AWAITING_RESCHEDULE_TTL_DAYS
): AwaitingRescheduleState {
  const until = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  return {
    startedAt: now.toISOString(),
    until: until.toISOString(),
  };
}

/** Quita el flag; deja el resto de qualification intacto. */
export function clearAwaitingReschedule(
  qualification: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const next = { ...(qualification ?? {}) };
  delete next.awaiting_reschedule;
  return next;
}

export function withAwaitingReschedule(
  qualification: Record<string, unknown> | null | undefined,
  state: AwaitingRescheduleState
): Record<string, unknown> {
  return {
    ...(qualification ?? {}),
    awaiting_reschedule: state,
  };
}

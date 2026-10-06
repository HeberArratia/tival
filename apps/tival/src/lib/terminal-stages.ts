/** Etapas terminales del playbook Consultoría — fuente de verdad de cierre. */
export const TERMINAL_STAGE_KEYS = ["perdido", "ganado"] as const;

export type TerminalStageKey = (typeof TERMINAL_STAGE_KEYS)[number];

export function isTerminalStageKey(
  key: string | null | undefined
): key is TerminalStageKey {
  return key === "perdido" || key === "ganado";
}

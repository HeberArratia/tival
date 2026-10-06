import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

/**
 * ¿Esta instancia puede encolar eventos Inngest?
 *
 * Default: solo `NEXT_PUBLIC_TIVAL_ENV=production`.
 * Así local/staging no duplican jobs contra una DB compartida.
 *
 * Override explícito:
 * - `INNGEST_ENABLED=1` → permitir (p. ej. probar con `npm run inngest:dev`)
 * - `INNGEST_ENABLED=0` → forzar off
 */
export function isInngestSendEnabled(): boolean {
  const flag = (process.env.INNGEST_ENABLED || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  return tivalRuntimeEnv() === "production";
}

import { Inngest } from "inngest";

/**
 * App id estable (Inngest Cloud).
 * Encolar eventos: solo si `isInngestSendEnabled()` (ver `./enabled`).
 * `INNGEST_ENV` en Cloud separa colas; no basta para DB compartida.
 */
export const inngest = new Inngest({
  id: "tival",
  name: "Tival",
});

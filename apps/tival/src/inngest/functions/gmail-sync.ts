import { cron } from "inngest";
import { inngest } from "@/inngest/client";
import { syncGmailMailbox } from "@/lib/integrations/gmail/sync";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

/**
 * Sync readonly del buzón hablemos@ (Gmail API + historyId).
 * Evidencia en `gmail_mailboxes` (lastAttemptAt / lastSuccessAt / lastError).
 *
 * Cada 15 min para caber cómodo en Inngest free (~2–4k exec/mes con 1 step).
 * También acepta evento manual `gmail/mailbox.sync`.
 */
export const syncGmailMailboxFn = inngest.createFunction(
  {
    id: "sync-gmail-mailbox",
    name: "Gmail mailbox sync (hablemos@)",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [
      cron("TZ=America/Santiago */15 * * * *"),
      { event: "gmail/mailbox.sync" },
    ],
  },
  async ({ step, event }) => {
    // Evitar que un sync accidental en local con DB compartida pise prod.
    // El cron de Cloud solo debería pegarle a la URL de production.
    const env = tivalRuntimeEnv();
    const force =
      event.name === "gmail/mailbox.sync" &&
      Boolean(
        event.data &&
          typeof event.data === "object" &&
          (event.data as { force?: unknown }).force === true
      );
    if (env !== "production" && !force) {
      return {
        ok: true as const,
        skipped: true as const,
        reason: "non_production_env",
        env,
      };
    }

    const result = await step.run("sync-mailbox", async () => {
      return syncGmailMailbox();
    });

    return result;
  }
);

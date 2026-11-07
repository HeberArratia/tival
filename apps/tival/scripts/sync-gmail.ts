/**
 * Corrida manual del sync Gmail (OAuth hablemos@).
 *
 *   npm run sync:gmail
 *
 * Antes: conectar en /integraciones/gmail con la cuenta hablemos@.
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
  const { syncGmailMailbox } = await import(
    "../src/lib/integrations/gmail/sync"
  );

  console.log("Sync Gmail…");
  const result = await syncGmailMailbox();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  if (result.skipped) {
    console.warn("Skipped:", result.reason);
    process.exit(result.reason === "not_configured" ? 2 : 0);
  }
  // Postgres deja el event loop vivo si no forzamos salida.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

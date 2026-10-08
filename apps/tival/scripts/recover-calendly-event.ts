/**
 * Recupera un evento Calendly que falló al crear el case (schema desfasado).
 *   npx tsx scripts/recover-calendly-event.ts [eventUuid]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.USE_PGLITE = process.env.USE_PGLITE === "1" ? "1" : "0";

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { integrationConnections, workspaces } from "../src/db/schema";
import { scheduleCase } from "../src/lib/cases";
import { decryptSecret } from "../src/lib/crypto-secrets";
import { fetchCalendlyScheduledEvent } from "../src/lib/integrations/calendly-api";
import { scheduleMeetEnrichmentJob } from "../src/inngest/functions/enrich-meet";
import { touchConnectionEvent } from "../src/lib/integrations/connections";

async function calendlyFetch(apiToken: string, path: string) {
  const res = await fetch(`https://api.calendly.com${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `calendly ${res.status}: ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  return data;
}

async function main() {
  const eventUuid =
    process.argv[2] || "55767ff1-7843-4700-a626-d0f9ab92b6f3";

  const db = await getDb();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "alfondo"))
    .limit(1);
  if (!ws) throw new Error("no workspace");

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, ws.id));
  const cal = rows.find((r) => r.provider === "calendly");
  if (!cal) throw new Error("no calendly");

  const credsRaw = decryptSecret(cal.credentialsEnc);
  const apiToken = credsRaw
    ? ((JSON.parse(credsRaw) as { apiToken?: string }).apiToken ?? null)
    : null;
  if (!apiToken) throw new Error("no pat");

  const event = await fetchCalendlyScheduledEvent({ apiToken, eventUuid });
  if (!event.ok) throw new Error(event.error);

  const invitees = (await calendlyFetch(
    apiToken,
    `/scheduled_events/${eventUuid}/invitees?count=10`
  )) as {
    collection?: Array<{
      name?: string;
      email?: string;
      text_reminder_number?: string;
      questions_and_answers?: Array<{ question?: string; answer?: string }>;
      tracking?: { utm_source?: string };
    }>;
  };

  const invitee = invitees.collection?.[0];
  if (!invitee) throw new Error("no invitee on event");

  const phone =
    invitee.text_reminder_number ||
    invitee.questions_and_answers?.find((q) =>
      /tel|whats|fono|celular/i.test(q.question || "")
    )?.answer ||
    null;

  console.log("event:", event.resource.name, event.resource.start_time);
  console.log("invitee:", invitee.name, invitee.email, phone);

  const created = await scheduleCase({
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    calendlyEventUuid: eventUuid,
    calendlyEventUri: `https://api.calendly.com/scheduled_events/${eventUuid}`,
    contactName: invitee.name ?? null,
    contactEmail: invitee.email ?? null,
    contactPhone: phone,
    scheduledAt: event.resource.start_time
      ? new Date(event.resource.start_time)
      : null,
    meetUrl: event.resource.location?.join_url ?? null,
  });

  await touchConnectionEvent(cal.id);
  await scheduleMeetEnrichmentJob(created.id, {
    calendlyEventUuid: created.calendlyEventUuid,
  });

  console.log("OK case:", created.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

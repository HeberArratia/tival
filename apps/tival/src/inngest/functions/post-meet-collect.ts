import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, cases } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { isInngestSendEnabled } from "@/inngest/enabled";
import {
  POST_MEET_LOOK_AFTER_MINUTES,
  POST_MEET_MAX_POLLS,
  POST_MEET_POLL_INTERVAL,
  attemptPostMeetCollect,
  setPostMeetState,
} from "@/lib/integrations/post-meet-collect";
import { tivalRuntimeEnv } from "@/lib/integrations/runtime-env";

type PostMeetEventData = { caseId: string };

/** True si el slot de reunión del case sigue siendo el que memoizó este run. */
async function isPostMeetSlotCurrent(
  caseId: string,
  expectedScheduledAt: string | null
): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ scheduledAt: cases.scheduledAt })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row) return false;
  const current = row.scheduledAt?.toISOString() ?? null;
  return current === expectedScheduledAt;
}

/**
 * Tras la reunión: espera → poll Meet API → mueve Notas/recording a Drive del case.
 */
export const collectPostMeetArtifacts = inngest.createFunction(
  {
    id: "collect-post-meet-artifacts",
    name: "Collect post-meet artifacts",
    retries: 3,
    concurrency: { limit: 5, key: "event.data.caseId" },
    triggers: [{ event: "case/post-meet.collect" }],
  },
  async ({ event, step }) => {
    const caseId = (event.data as PostMeetEventData).caseId;
    if (!caseId) throw new Error("missing_case_id");

    const meta = await step.run("load-case", async () => {
      const db = await getDb();
      const [row] = await db
        .select({
          id: cases.id,
          scheduledAt: cases.scheduledAt,
          meetCode: cases.meetCode,
          driveFolderId: cases.driveFolderId,
        })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new Error("case_not_found");
      return {
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
        meetCode: row.meetCode,
        driveFolderId: row.driveFolderId,
      };
    });

    await step.run("mark-scheduled", async () => {
      const current = await isPostMeetSlotCurrent(caseId, meta.scheduledAt);
      if (!current) return { skipped: true as const, reason: "superseded" };
      await setPostMeetState(caseId, { status: "scheduled", error: null });
      return { skipped: false as const };
    });

    const lookAfter = new Date(
      (meta.scheduledAt
        ? new Date(meta.scheduledAt).getTime()
        : Date.now()) +
        POST_MEET_LOOK_AFTER_MINUTES * 60_000
    );

    if (lookAfter.getTime() > Date.now()) {
      await step.sleepUntil("wait-until-after-meeting", lookAfter);
    }

    const stillCurrentAfterWait = await step.run(
      "check-slot-after-wait",
      async () => isPostMeetSlotCurrent(caseId, meta.scheduledAt)
    );
    if (!stillCurrentAfterWait) {
      return { ok: true, status: "superseded" as const };
    }

    for (let i = 0; i < POST_MEET_MAX_POLLS; i += 1) {
      const slotOk = await step.run(`check-slot-${i}`, async () =>
        isPostMeetSlotCurrent(caseId, meta.scheduledAt)
      );
      if (!slotOk) {
        return { ok: true, status: "superseded" as const };
      }

      const result = await step.run(`attempt-${i}`, async () =>
        attemptPostMeetCollect(caseId)
      );

      if (!result.ok) {
        await step.run(`mark-failed-${i}`, async () => {
          if (!(await isPostMeetSlotCurrent(caseId, meta.scheduledAt))) {
            return;
          }
          await setPostMeetState(caseId, {
            status: "failed",
            error: result.error,
          });
          const db = await getDb();
          await db.insert(caseEvents).values({
            caseId,
            type: "post_meet_failed",
            payload: { error: result.error, attempt: i },
            actor: "integracion",
          });
        });
        throw new Error(result.error);
      }

      if (result.done) {
        return {
          ok: true,
          status: result.status,
          moved: result.moved,
          attempts: i + 1,
        };
      }

      if (i < POST_MEET_MAX_POLLS - 1) {
        await step.sleep(`poll-wait-${i}`, POST_MEET_POLL_INTERVAL);
      }
    }

    await step.run("mark-timeout", async () => {
      if (!(await isPostMeetSlotCurrent(caseId, meta.scheduledAt))) {
        return;
      }
      await setPostMeetState(caseId, {
        status: "timeout",
        error: "artifacts_not_ready_within_window",
      });
      const db = await getDb();
      await db.insert(caseEvents).values({
        caseId,
        type: "post_meet_timeout",
        payload: { maxPolls: POST_MEET_MAX_POLLS },
        actor: "integracion",
      });
    });

    return { ok: false, status: "timeout" as const };
  }
);

/**
 * Encola la recolección (no bloquea).
 * Idempotente por case + `scheduledAt`: una reagenda genera un event id nuevo.
 */
export async function schedulePostMeetCollect(caseId: string) {
  if (!isInngestSendEnabled()) {
    console.info(
      "[inngest] send disabled (env=%s) — skip post-meet %s",
      tivalRuntimeEnv(),
      caseId
    );
    return;
  }

  // Cloud prod exige event key. Local + CLI (INNGEST_ENABLED=1) puede ir sin ella.
  if (!process.env.INNGEST_EVENT_KEY && tivalRuntimeEnv() === "production") {
    console.warn("[inngest] INNGEST_EVENT_KEY missing — skip post-meet");
    return;
  }

  try {
    const db = await getDb();
    const [row] = await db
      .select({ scheduledAt: cases.scheduledAt })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1);
    const slot = row?.scheduledAt?.toISOString() ?? "unscheduled";

    await inngest.send({
      id: `post-meet-${caseId}-${slot}`,
      name: "case/post-meet.collect",
      data: { caseId } satisfies PostMeetEventData,
    });
  } catch (e) {
    console.error(
      "[inngest] schedulePostMeetCollect",
      caseId,
      e instanceof Error ? e.message : e
    );
  }
}

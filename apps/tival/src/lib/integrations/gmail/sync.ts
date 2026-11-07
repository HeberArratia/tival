/**
 * Sync readonly de un buzón Gmail (OAuth hablemos@) → threads/messages
 * ligados a cases por contacts.email. Escribe evidencia en gmail_mailboxes.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cases,
  contacts,
  emailMessages,
  emailThreadCases,
  emailThreads,
  gmailMailboxes,
  workspaces,
  type GmailMailbox,
} from "@/db/schema";
import {
  getGmailConnectionForWorkspace,
  updateGmailConnection,
} from "@/lib/integrations/connections";
import {
  gmailSyncBootstrapDays,
  gmailSyncExcludeDomains,
  gmailSyncMailboxEmail,
  gmailSyncWorkspaceSlug,
} from "@/lib/integrations/gmail/config";
import {
  getGmailMessage,
  getGmailProfile,
  listHistoryMessageIds,
  listRecentMessageIds,
  type ParsedGmailMessage,
} from "@/lib/integrations/gmail/client";
import { refreshAccessToken } from "@/lib/integrations/gmail/oauth";
import {
  isExcludedSender,
  normalizeEmail,
} from "@/lib/integrations/gmail/parse";

export type GmailSyncStats = {
  mode: "bootstrap" | "history" | "skipped";
  messagesFetched: number;
  messagesUpserted: number;
  messagesSkippedNoise: number;
  messagesSkippedOther: number;
  threadsLinked: number;
  error?: string;
};

export type GmailSyncResult =
  | { ok: true; skipped?: false; mailbox: GmailMailbox; stats: GmailSyncStats }
  | {
      ok: true;
      skipped: true;
      reason: "not_configured" | "workspace_not_found";
      stats: GmailSyncStats;
    }
  | { ok: false; error: string; mailbox?: GmailMailbox; stats: GmailSyncStats };

function uniqueEmails(emails: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const e of emails) {
    const n = normalizeEmail(e);
    if (n) set.add(n);
  }
  return [...set];
}

async function ensureMailboxRow(input: {
  workspaceId: string;
  email: string;
}): Promise<GmailMailbox> {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(gmailMailboxes)
    .where(
      and(
        eq(gmailMailboxes.workspaceId, input.workspaceId),
        eq(gmailMailboxes.email, input.email)
      )
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(gmailMailboxes)
    .values({
      workspaceId: input.workspaceId,
      email: input.email,
      lastStats: {},
    })
    .returning();
  return created;
}

async function markAttempt(
  mailboxId: string,
  patch: {
    lastError?: string | null;
    lastSuccessAt?: Date | null;
    lastHistoryId?: string | null;
    lastStats: GmailSyncStats;
  }
): Promise<GmailMailbox> {
  const db = await getDb();
  const now = new Date();
  const [row] = await db
    .update(gmailMailboxes)
    .set({
      lastAttemptAt: now,
      lastError: patch.lastError ?? null,
      lastSuccessAt: patch.lastSuccessAt ?? undefined,
      lastHistoryId:
        patch.lastHistoryId === undefined
          ? undefined
          : patch.lastHistoryId,
      lastStats: patch.lastStats,
      updatedAt: now,
    })
    .where(eq(gmailMailboxes.id, mailboxId))
    .returning();
  return row;
}

async function linkThreadToCases(input: {
  workspaceId: string;
  threadId: string;
  participantEmails: string[];
  mailboxEmail: string;
}): Promise<number> {
  const candidates = input.participantEmails.filter(
    (e) => e !== input.mailboxEmail
  );
  if (!candidates.length) return 0;

  const db = await getDb();
  const contactRows = await db
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, input.workspaceId),
        inArray(contacts.email, candidates)
      )
    );
  if (!contactRows.length) return 0;

  const contactIds = contactRows.map((c) => c.id);
  const caseRows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.workspaceId, input.workspaceId),
        inArray(cases.contactId, contactIds)
      )
    );
  if (!caseRows.length) return 0;

  let linked = 0;
  for (const c of caseRows) {
    try {
      await db.insert(emailThreadCases).values({
        threadId: input.threadId,
        caseId: c.id,
      });
      linked += 1;
    } catch {
      // unique (thread_id, case_id) — ya ligado
    }
  }
  return linked;
}

async function upsertParsedMessage(input: {
  workspaceId: string;
  mailbox: GmailMailbox;
  message: ParsedGmailMessage;
  mailboxEmail: string;
  excludeDomains: string[];
}): Promise<{
  upserted: boolean;
  skippedNoise: boolean;
  linked: number;
}> {
  const { message, mailbox, mailboxEmail, excludeDomains, workspaceId } = input;
  const fromEmail = message.from?.email ?? null;

  if (isExcludedSender(fromEmail, excludeDomains)) {
    return { upserted: false, skippedNoise: true, linked: 0 };
  }

  const participants = uniqueEmails([
    fromEmail,
    ...message.to.map((a) => a.email),
    ...message.cc.map((a) => a.email),
    mailboxEmail,
  ]);

  const db = await getDb();
  const now = new Date();

  const [existingThread] = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.mailboxId, mailbox.id),
        eq(emailThreads.gmailThreadId, message.gmailThreadId)
      )
    )
    .limit(1);

  let threadId: string;
  if (existingThread) {
    threadId = existingThread.id;
    const merged = uniqueEmails([
      ...(existingThread.participantEmails ?? []),
      ...participants,
    ]);
    const lastAt =
      message.sentAt &&
      (!existingThread.lastMessageAt ||
        message.sentAt > existingThread.lastMessageAt)
        ? message.sentAt
        : existingThread.lastMessageAt;
    await db
      .update(emailThreads)
      .set({
        subject: message.subject ?? existingThread.subject,
        snippet: message.snippet ?? existingThread.snippet,
        lastMessageAt: lastAt,
        participantEmails: merged,
        updatedAt: now,
      })
      .where(eq(emailThreads.id, threadId));
  } else {
    const [created] = await db
      .insert(emailThreads)
      .values({
        workspaceId,
        mailboxId: mailbox.id,
        gmailThreadId: message.gmailThreadId,
        subject: message.subject,
        snippet: message.snippet,
        lastMessageAt: message.sentAt,
        participantEmails: participants,
      })
      .returning();
    threadId = created.id;
  }

  const [existingMsg] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(eq(emailMessages.gmailMessageId, message.gmailMessageId))
    .limit(1);

  let upserted = false;
  if (!existingMsg) {
    await db.insert(emailMessages).values({
      threadId,
      gmailMessageId: message.gmailMessageId,
      fromEmail,
      fromName: message.from?.name ?? null,
      toEmails: message.to.map((a) => a.email),
      ccEmails: message.cc.map((a) => a.email),
      subject: message.subject,
      bodyText: message.bodyText,
      sentAt: message.sentAt,
    });
    upserted = true;
  }

  const linked = await linkThreadToCases({
    workspaceId,
    threadId,
    participantEmails: participants,
    mailboxEmail,
  });

  return { upserted, skippedNoise: false, linked };
}

/** Sync principal — invocado por Inngest cron (o manual). */
export async function syncGmailMailbox(): Promise<GmailSyncResult> {
  const emptyStats = (): GmailSyncStats => ({
    mode: "skipped",
    messagesFetched: 0,
    messagesUpserted: 0,
    messagesSkippedNoise: 0,
    messagesSkippedOther: 0,
    threadsLinked: 0,
  });

  const expectedMailbox = gmailSyncMailboxEmail();
  const workspaceSlug = gmailSyncWorkspaceSlug();
  const excludeDomains = gmailSyncExcludeDomains();
  const bootstrapDays = gmailSyncBootstrapDays();

  const db = await getDb();
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!ws) {
    return {
      ok: true,
      skipped: true,
      reason: "workspace_not_found",
      stats: emptyStats(),
    };
  }

  const gmailConn = await getGmailConnectionForWorkspace(ws.id);
  if (!gmailConn?.tokens?.refreshToken) {
    return {
      ok: true,
      skipped: true,
      reason: "not_configured",
      stats: emptyStats(),
    };
  }

  const skewMs = 60_000;
  let tokens = gmailConn.tokens;
  if (
    !tokens.accessToken ||
    !tokens.expiresAt ||
    tokens.expiresAt <= Date.now() + skewMs
  ) {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    tokens = {
      ...tokens,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType ?? tokens.tokenType,
      scope: refreshed.scope ?? tokens.scope,
    };
    await updateGmailConnection({
      connectionId: gmailConn.connectionId,
      workspaceSlug,
      tokens,
      markConnected: true,
    });
  }

  const mailboxEmail = (
    tokens.accountEmail ||
    expectedMailbox
  ).toLowerCase();

  let mailbox = await ensureMailboxRow({
    workspaceId: ws.id,
    email: mailboxEmail,
  });

  // Marca intento temprano (evidencia aunque falle a mitad).
  mailbox = await markAttempt(mailbox.id, {
    lastError: null,
    lastStats: { ...emptyStats(), mode: "history" },
  });

  const opts = { accessToken: tokens.accessToken! };
  const stats = emptyStats();

  try {
    const profile = await getGmailProfile(opts);
    let messageIds: string[] = [];

    if (mailbox.lastHistoryId) {
      try {
        const hist = await listHistoryMessageIds(opts, mailbox.lastHistoryId);
        messageIds = hist.messageIds;
        stats.mode = "history";
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code: unknown }).code)
            : "";
        if (code !== "gmail_history_expired") throw e;
        // Cursor vencido → bootstrap.
        messageIds = await listRecentMessageIds(opts, {
          newerThanDays: bootstrapDays,
          maxResults: 200,
        });
        stats.mode = "bootstrap";
      }
    } else {
      messageIds = await listRecentMessageIds(opts, {
        newerThanDays: bootstrapDays,
        maxResults: 200,
      });
      stats.mode = "bootstrap";
    }

    stats.messagesFetched = messageIds.length;

    // Recargar mailbox (puede haber cambiado).
    const [fresh] = await db
      .select()
      .from(gmailMailboxes)
      .where(eq(gmailMailboxes.id, mailbox.id))
      .limit(1);
    mailbox = fresh ?? mailbox;

    for (const id of messageIds) {
      try {
        const parsed = await getGmailMessage(opts, id);
        const result = await upsertParsedMessage({
          workspaceId: ws.id,
          mailbox,
          message: parsed,
          mailboxEmail,
          excludeDomains,
        });
        if (result.skippedNoise) stats.messagesSkippedNoise += 1;
        else if (result.upserted) stats.messagesUpserted += 1;
        stats.threadsLinked += result.linked;
      } catch (e) {
        stats.messagesSkippedOther += 1;
        console.error(
          "[gmail-sync] message",
          id,
          e instanceof Error ? e.message : e
        );
      }
    }

    const updated = await markAttempt(mailbox.id, {
      lastError: null,
      lastSuccessAt: new Date(),
      lastHistoryId: profile.historyId,
      lastStats: stats,
    });

    return { ok: true, mailbox: updated, stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : "gmail_sync_failed";
    stats.error = error;
    const updated = await markAttempt(mailbox.id, {
      lastError: error,
      lastStats: stats,
    });
    return { ok: false, error, mailbox: updated, stats };
  }
}

/** Estado del buzón para UI (evidencia). */
export async function getGmailMailboxSyncState(workspaceId: string) {
  const db = await getDb();
  const email = gmailSyncMailboxEmail();
  const [row] = await db
    .select()
    .from(gmailMailboxes)
    .where(
      and(
        eq(gmailMailboxes.workspaceId, workspaceId),
        eq(gmailMailboxes.email, email)
      )
    )
    .limit(1);
  return row ?? null;
}

export type CaseEmailThreadView = {
  threadId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: Date | null;
  messages: Array<{
    id: string;
    fromEmail: string | null;
    fromName: string | null;
    toEmails: string[];
    ccEmails: string[];
    subject: string | null;
    bodyText: string | null;
    sentAt: Date | null;
  }>;
};

/** Threads + mensajes de un case (solo lectura DB). */
export async function listEmailThreadsForCase(
  caseId: string
): Promise<CaseEmailThreadView[]> {
  const db = await getDb();
  const links = await db
    .select({
      threadId: emailThreads.id,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      lastMessageAt: emailThreads.lastMessageAt,
      hidden: emailThreads.hidden,
    })
    .from(emailThreadCases)
    .innerJoin(emailThreads, eq(emailThreads.id, emailThreadCases.threadId))
    .where(eq(emailThreadCases.caseId, caseId));

  const visible = links.filter((t) => !t.hidden);
  if (!visible.length) return [];

  visible.sort((a, b) => {
    const ta = a.lastMessageAt?.getTime() ?? 0;
    const tb = b.lastMessageAt?.getTime() ?? 0;
    return tb - ta;
  });

  const threadIds = visible.map((t) => t.threadId);
  const msgs = await db
    .select()
    .from(emailMessages)
    .where(inArray(emailMessages.threadId, threadIds))
    .orderBy(sql`${emailMessages.sentAt} desc nulls last`);

  const byThread = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const list = byThread.get(m.threadId) ?? [];
    list.push(m);
    byThread.set(m.threadId, list);
  }

  return visible.map((t) => ({
    threadId: t.threadId,
    subject: t.subject,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt,
    messages: (byThread.get(t.threadId) ?? []).map((m) => ({
      id: m.id,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toEmails: (m.toEmails as string[]) ?? [],
      ccEmails: (m.ccEmails as string[]) ?? [],
      subject: m.subject,
      bodyText: m.bodyText,
      sentAt: m.sentAt,
    })),
  }));
}

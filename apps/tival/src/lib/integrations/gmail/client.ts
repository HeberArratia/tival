import {
  extractBodyText,
  headerValue,
  parseAddressList,
  type ParsedAddress,
} from "@/lib/integrations/gmail/parse";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailProfile = {
  emailAddress: string;
  historyId: string;
  messagesTotal?: number;
};

export type ParsedGmailMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  snippet: string | null;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bodyText: string | null;
  sentAt: Date | null;
  historyId?: string;
};

type GmailClientOpts = {
  accessToken: string;
};

async function authHeader(opts: GmailClientOpts): Promise<HeadersInit> {
  return { Authorization: `Bearer ${opts.accessToken}` };
}

async function gmailJson<T>(
  opts: GmailClientOpts,
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = {
    ...(await authHeader(opts)),
    ...(init?.headers || {}),
  };
  const res = await fetch(`${GMAIL_API}${path}`, { ...init, headers });
  const data = (await res.json()) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message || `gmail_api_${res.status}_${path.split("?")[0]}`
    );
  }
  return data;
}

export async function getGmailProfile(
  opts: GmailClientOpts
): Promise<GmailProfile> {
  const data = await gmailJson<{
    emailAddress?: string;
    historyId?: string;
    messagesTotal?: number;
  }>(opts, "/profile");
  if (!data.emailAddress || !data.historyId) {
    throw new Error("gmail_profile_incomplete");
  }
  return {
    emailAddress: data.emailAddress,
    historyId: data.historyId,
    messagesTotal: data.messagesTotal,
  };
}

/** Lista ids recientes (bootstrap). */
export async function listRecentMessageIds(
  opts: GmailClientOpts,
  input: { newerThanDays: number; maxResults?: number }
): Promise<string[]> {
  const q = `newer_than:${input.newerThanDays}d`;
  const maxResults = input.maxResults ?? 100;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      maxResults: String(Math.min(maxResults - ids.length, 100)),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailJson<{
      messages?: Array<{ id?: string }>;
      nextPageToken?: string;
    }>(opts, `/messages?${params}`);
    for (const m of data.messages ?? []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < maxResults);
  return ids;
}

/**
 * Cambios desde historyId. Si el cursor expiró, Gmail responde 404 → caller hace bootstrap.
 */
export async function listHistoryMessageIds(
  opts: GmailClientOpts,
  startHistoryId: string
): Promise<{ messageIds: string[]; historyId: string | null }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;
  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${GMAIL_API}/history?${params}`, {
      headers: await authHeader(opts),
    });
    const data = (await res.json()) as {
      history?: Array<{
        messagesAdded?: Array<{ message?: { id?: string } }>;
      }>;
      historyId?: string;
      nextPageToken?: string;
      error?: { message?: string; code?: number };
    };
    if (res.status === 404) {
      const err = new Error("gmail_history_expired") as Error & {
        code: string;
      };
      err.code = "gmail_history_expired";
      throw err;
    }
    if (!res.ok) {
      throw new Error(
        data.error?.message || `gmail_history_failed_${res.status}`
      );
    }
    for (const h of data.history ?? []) {
      for (const added of h.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    if (data.historyId) latestHistoryId = data.historyId;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { messageIds: [...ids], historyId: latestHistoryId };
}

export async function getGmailMessage(
  opts: GmailClientOpts,
  messageId: string
): Promise<ParsedGmailMessage> {
  const data = await gmailJson<{
    id?: string;
    threadId?: string;
    snippet?: string;
    historyId?: string;
    internalDate?: string;
    payload?: {
      mimeType?: string;
      headers?: Array<{ name?: string; value?: string }>;
      body?: { data?: string; size?: number };
      parts?: unknown[];
    };
  }>(opts, `/messages/${encodeURIComponent(messageId)}?format=full`);
  if (!data.id || !data.threadId) {
    throw new Error("gmail_message_incomplete");
  }
  const headers = data.payload?.headers;
  const fromList = parseAddressList(headerValue(headers, "From"));
  const to = parseAddressList(headerValue(headers, "To"));
  const cc = parseAddressList(headerValue(headers, "Cc"));
  const subject = headerValue(headers, "Subject");
  const internalMs = data.internalDate ? Number(data.internalDate) : NaN;
  const sentAt = Number.isFinite(internalMs) ? new Date(internalMs) : null;

  return {
    gmailMessageId: data.id,
    gmailThreadId: data.threadId,
    subject,
    snippet: data.snippet?.trim() || null,
    from: fromList[0] ?? null,
    to,
    cc,
    bodyText: extractBodyText(data.payload as never),
    sentAt,
    historyId: data.historyId,
  };
}

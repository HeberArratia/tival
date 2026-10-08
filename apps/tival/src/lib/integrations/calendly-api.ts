/** Cliente mínimo Calendly API v2. */

const CALENDLY_API = "https://api.calendly.com";

export type CalendlyScheduledEventResource = {
  uri?: string;
  name?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  location?: {
    type?: string;
    status?: string;
    join_url?: string;
  };
  calendar_event?: {
    kind?: string;
    external_id?: string;
  } | null;
};

export type CalendlyUserMe = {
  uri: string;
  name?: string;
  email?: string;
  current_organization: string;
};

export type CalendlyWebhookSubscription = {
  uri: string;
  callback_url: string;
  created_at?: string;
  updated_at?: string;
  retry_started_at?: string | null;
  state?: string;
  events?: string[];
  scope?: string;
  organization?: string;
  user?: string | null;
  creator?: string;
};

type ApiErrorBody = {
  title?: string;
  message?: string;
  details?: Array<{ message?: string }>;
};

async function calendlyFetch<T>(
  apiToken: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${CALENDLY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return { ok: true, data: undefined as T };
  }

  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    const detail = data.details?.map((d) => d.message).filter(Boolean).join("; ");
    return {
      ok: false,
      status: res.status,
      error:
        detail ||
        data.message ||
        data.title ||
        `calendly_api_${res.status}`,
    };
  }
  return { ok: true, data };
}

export async function fetchCalendlyScheduledEvent(input: {
  apiToken: string;
  eventUuid: string;
}): Promise<
  | { ok: true; resource: CalendlyScheduledEventResource }
  | { ok: false; error: string; status?: number }
> {
  const result = await calendlyFetch<{ resource: CalendlyScheduledEventResource }>(
    input.apiToken,
    `/scheduled_events/${encodeURIComponent(input.eventUuid)}`
  );
  if (!result.ok) return result;
  if (!result.data.resource) {
    return { ok: false, error: "calendly_scheduled_event_empty" };
  }
  return { ok: true, resource: result.data.resource };
}

/** Cancela el evento en Calendly (cascada a Calendar/Meet + webhook invitee.canceled). */
export async function cancelCalendlyScheduledEvent(input: {
  apiToken: string;
  eventUuid: string;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const result = await calendlyFetch<{
    resource?: { canceled_by?: string; reason?: string | null };
  }>(
    input.apiToken,
    `/scheduled_events/${encodeURIComponent(input.eventUuid)}/cancellation`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason?.trim() || "No pagó · oportunidad perdida",
      }),
    }
  );
  if (!result.ok) return result;
  return { ok: true };
}

export async function fetchCalendlyCurrentUser(apiToken: string): Promise<
  | { ok: true; user: CalendlyUserMe }
  | { ok: false; error: string; status?: number }
> {
  const result = await calendlyFetch<{ resource: CalendlyUserMe }>(
    apiToken,
    "/users/me"
  );
  if (!result.ok) return result;
  if (!result.data.resource?.current_organization) {
    return { ok: false, error: "calendly_org_missing" };
  }
  return { ok: true, user: result.data.resource };
}

export async function listCalendlyWebhookSubscriptions(input: {
  apiToken: string;
  organization: string;
  scope?: "organization" | "user";
}): Promise<
  | { ok: true; collection: CalendlyWebhookSubscription[] }
  | { ok: false; error: string; status?: number }
> {
  const params = new URLSearchParams({
    organization: input.organization,
    scope: input.scope ?? "organization",
    count: "100",
  });
  const result = await calendlyFetch<{
    collection?: CalendlyWebhookSubscription[];
  }>(input.apiToken, `/webhook_subscriptions?${params}`);
  if (!result.ok) return result;
  return { ok: true, collection: result.data.collection ?? [] };
}

export async function createCalendlyWebhookSubscription(input: {
  apiToken: string;
  url: string;
  organization: string;
  scope?: "organization" | "user";
  events?: string[];
  signingKey: string;
}): Promise<
  | { ok: true; resource: CalendlyWebhookSubscription }
  | { ok: false; error: string; status?: number }
> {
  const result = await calendlyFetch<{ resource: CalendlyWebhookSubscription }>(
    input.apiToken,
    "/webhook_subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        url: input.url,
        events: input.events ?? ["invitee.created", "invitee.canceled"],
        organization: input.organization,
        scope: input.scope ?? "organization",
        signing_key: input.signingKey,
      }),
    }
  );
  if (!result.ok) return result;
  if (!result.data.resource) {
    return { ok: false, error: "calendly_webhook_create_empty" };
  }
  return { ok: true, resource: result.data.resource };
}

export async function deleteCalendlyWebhookSubscription(input: {
  apiToken: string;
  subscriptionUuid: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const result = await calendlyFetch<undefined>(
    input.apiToken,
    `/webhook_subscriptions/${encodeURIComponent(input.subscriptionUuid)}`,
    { method: "DELETE" }
  );
  if (!result.ok) return result;
  return { ok: true };
}

export function extractCalendlyUuid(uri: string): string | null {
  const parts = uri.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

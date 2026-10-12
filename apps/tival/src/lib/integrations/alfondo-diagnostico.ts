/**
 * Cliente de lectura: cuestionario + segmento calculado en Alfondo.
 * GET /api/diagnostico/log/:id — no bloquea el intake Calendly.
 */

export type AlfondoSegmento = "S1" | "S2" | "S2S3" | "S3";
export type AlfondoFitInnovacion = "true" | "false" | "n_a";
export type AlfondoWizardKind = "s12" | "innovacion";

export type AlfondoDiagnosticoSelection = {
  id?: string;
  label?: string;
  hint?: string;
  question?: { title?: string; subtitle?: string };
};

export type AlfondoDiagnosticoAnswers = {
  schemaVersion?: string;
  wizardKind?: string;
  segmento_alfondo?: string;
  fit_innovacion?: string;
  selections?: Record<string, AlfondoDiagnosticoSelection>;
  [key: string]: unknown;
};

export type AlfondoDiagnosticoLog = {
  ok: true;
  id: string;
  route?: string | null;
  landing_source?: string | null;
  created_at?: string | null;
  segmento: AlfondoSegmento | string;
  segmento_alfondo?: AlfondoSegmento | string;
  segmento_label?: string | null;
  fit_innovacion?: AlfondoFitInnovacion | string | null;
  fit_innovacion_label?: string | null;
  wizardKind?: AlfondoWizardKind | string | null;
  schemaVersion?: string | null;
  answers?: AlfondoDiagnosticoAnswers | null;
};

export type FetchDiagnosticoLogResult =
  | { ok: true; data: AlfondoDiagnosticoLog }
  | {
      ok: false;
      error: string;
      status?: number;
      retryable?: boolean;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDiagnosticoLogId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function alfondoBaseUrl() {
  return (process.env.ALFONDO_BASE_URL || "https://alfondo.cl").replace(
    /\/$/,
    ""
  );
}

/** Key para llamar a Alfondo (= `TIVAL_API_KEY` en el env de alfondo). */
function alfondoApiKey() {
  return (
    process.env.ALFONDO_API_KEY?.trim() ||
    // legacy alias
    process.env.TIVAL_API_KEY?.trim() ||
    null
  );
}

/**
 * Lee un diagnostico_logs por id (utm_content de Calendly).
 */
export async function fetchDiagnosticoLog(
  logId: string,
  opts?: { signal?: AbortSignal }
): Promise<FetchDiagnosticoLogResult> {
  const id = logId.trim();
  if (!isDiagnosticoLogId(id)) {
    return { ok: false, error: "invalid_log_id", status: 400 };
  }

  const apiKey = alfondoApiKey();
  if (!apiKey) {
    return { ok: false, error: "tival_api_key_missing", retryable: false };
  }

  const url = `${alfondoBaseUrl()}/api/diagnostico/log/${id}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-tival-api-key": apiKey,
      },
      signal: opts?.signal,
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "network_error",
      retryable: true,
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = (
    isJson ? await res.json().catch(() => null) : null
  ) as AlfondoDiagnosticoLog | { ok?: false; error?: string } | null;

  // HTML 404 de Next = ruta aún no desplegada (distinto de registro inexistente).
  if (!isJson && res.status === 404) {
    return {
      ok: false,
      error: "endpoint_not_deployed",
      status: 404,
      retryable: true,
    };
  }
  if (res.status === 404) {
    return { ok: false, error: "not_found", status: 404, retryable: false };
  }
  if (res.status === 401) {
    return { ok: false, error: "unauthorized", status: 401, retryable: false };
  }
  if (res.status === 400) {
    return { ok: false, error: "invalid_log_id", status: 400, retryable: false };
  }
  if (res.status === 503) {
    return { ok: false, error: "alfondo_unavailable", status: 503, retryable: true };
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `http_${res.status}`;
    return {
      ok: false,
      error: msg,
      status: res.status,
      retryable: res.status >= 500 || !isJson,
    };
  }

  if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
    return { ok: false, error: "invalid_response", status: res.status };
  }

  const data = body as AlfondoDiagnosticoLog;
  if (!data.id || !data.segmento) {
    return { ok: false, error: "incomplete_response", status: res.status };
  }

  return { ok: true, data };
}

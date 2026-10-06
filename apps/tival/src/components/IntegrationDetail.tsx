"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ConnectionPublic } from "@/lib/integrations/connection-types";
import {
  appBaseUrl,
  calendlyWebhookUrl,
  tivalRuntimeEnv,
} from "@/lib/integrations/runtime-env";
import type { ProviderMeta } from "@/lib/integrations/providers";

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "connected"
      ? "pill pill-ok"
      : status === "error"
        ? "pill pill-warn"
        : "pill";
  const label =
    status === "connected"
      ? "conectado"
      : status === "error"
        ? "error"
        : "sin conectar";
  return <span className={cls}>{label}</span>;
}

export function IntegrationDetail({
  workspaceSlug,
  provider,
  connection,
}: {
  workspaceSlug: string;
  provider: ProviderMeta;
  connection: ConnectionPublic | null;
}) {
  const status = connection?.status ?? "disconnected";

  return (
    <div className="integration-detail">
      <div className="panel" style={{ marginBottom: "1.25rem" }}>
        <div className="integration-card-head">
          <div>
            <p className="panel-kicker">{provider.slug}</p>
            <h3 style={{ margin: 0 }}>{provider.name}</h3>
          </div>
          <StatusBadge status={status} />
        </div>
        <p className="lede" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          {provider.blurb}
        </p>
      </div>

      {provider.id === "calendly" && provider.connectable ? (
        <CalendlyConnectPanel
          workspaceSlug={workspaceSlug}
          connection={connection}
        />
      ) : provider.id === "google_drive" && provider.connectable ? (
        <DriveConnectPanel
          workspaceSlug={workspaceSlug}
          connection={connection}
        />
      ) : provider.connectable ? (
        <div className="panel">
          <p className="integration-soon">Conectable · UI pendiente</p>
        </div>
      ) : (
        <div className="panel">
          <p className="lede" style={{ marginBottom: 0 }}>
            Todavía no disponible para conectar desde Tival.
          </p>
        </div>
      )}

      <p style={{ marginTop: "1.25rem" }}>
        <Link className="btn" href="/integraciones">
          ← Integraciones
        </Link>
      </p>
    </div>
  );
}

function DriveConnectPanel({
  workspaceSlug,
  connection,
}: {
  workspaceSlug: string;
  connection: ConnectionPublic | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [local, setLocal] = useState(connection);
  const [rootFolderId, setRootFolderId] = useState(
    typeof connection?.config?.rootFolderId === "string"
      ? connection.config.rootFolderId
      : ""
  );

  useEffect(() => {
    setLocal(connection);
    if (typeof connection?.config?.rootFolderId === "string") {
      setRootFolderId(connection.config.rootFolderId);
    }
  }, [connection]);

  useEffect(() => {
    const drive = searchParams.get("drive");
    if (drive === "connected") {
      setFlash("Google conectado.");
      router.replace("/integraciones/google");
    } else if (drive === "error") {
      setError(searchParams.get("reason") || "Error al conectar con Google");
      router.replace("/integraciones/google");
    }
  }, [searchParams, router]);

  async function ensure() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug, provider: "google_drive" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error");
      setLocal(data.connection);
      if (typeof data.connection?.config?.rootFolderId === "string") {
        setRootFolderId(data.connection.config.rootFolderId);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function saveRoot(e: React.FormEvent) {
    e.preventDefault();
    if (!local) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${local.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          config: { rootFolderId: rootFolderId.trim() },
          markConnected: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error");
      setLocal(data.connection);
      setFlash("Configuración guardada");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (!local) {
    return (
      <div className="panel">
        <div className="integration-actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={ensure}
          >
            {busy ? "Creando…" : "Activar conexión"}
          </button>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  const oauthHref = `/api/integrations/google-drive/start?workspace=${encodeURIComponent(workspaceSlug)}`;

  return (
    <div className="panel">
      <p className="panel-kicker">Configuración</p>
      {flash ? <p className="row-meta">{flash}</p> : null}

      <p className="lede" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
        OAuth pide Drive + Calendar + Meet (lectura). Usá la cuenta host de
        Calendly (ej. hablemos@…).
      </p>

      <div className="integration-actions" style={{ marginTop: "0.75rem" }}>
        <a className="btn btn-primary" href={oauthHref}>
          {local.hasRefreshToken ? "Reconectar Google" : "Conectar con Google"}
        </a>
      </div>

      {local.hasRefreshToken ? (
        <p className="row-meta" style={{ marginTop: "0.65rem" }}>
          OAuth · OK
          {local.accountEmail ? ` · ${local.accountEmail}` : ""}
        </p>
      ) : (
        <p className="row-meta" style={{ marginTop: "0.65rem" }}>
          Pendiente · autorizá la cuenta de Google
        </p>
      )}

      <form className="integration-form" onSubmit={saveRoot} style={{ marginTop: "1rem" }}>
        <label className="field">
          <span>ID carpeta raíz</span>
          <input
            type="text"
            autoComplete="off"
            className="mono"
            placeholder="ID de carpeta en Drive"
            value={rootFolderId}
            onChange={(e) => setRootFolderId(e.target.value)}
          />
        </label>

        {error ? <p className="field-error">{error}</p> : null}

        <div className="integration-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !rootFolderId.trim()}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>

      {local.lastError ? (
        <p className="field-error" style={{ marginTop: "0.75rem" }}>
          Último error · {local.lastError}
        </p>
      ) : null}
    </div>
  );
}

function CalendlyConnectPanel({
  workspaceSlug,
  connection,
}: {
  workspaceSlug: string;
  connection: ConnectionPublic | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"ensure" | "pat" | "webhook" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [rotatePat, setRotatePat] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [local, setLocal] = useState(connection);
  const runtimeEnv = tivalRuntimeEnv();
  const isBusy = busy !== null;

  useEffect(() => {
    setLocal(connection);
  }, [connection]);

  async function ensure() {
    setBusy("ensure");
    setError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug, provider: "calendly" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error");
      setLocal(data.connection);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function savePat(e: React.FormEvent) {
    e.preventDefault();
    if (!local || !apiToken.trim()) return;
    setBusy("pat");
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${local.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          apiToken: apiToken.trim(),
          markConnected: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error");
      setLocal(data.connection);
      setApiToken("");
      setRotatePat(false);
      setFlash("Personal Access Token guardado.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function registerWebhook() {
    if (!local) return;
    setBusy("webhook");
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/integrations/${local.id}/calendly-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error");
      setLocal(data.connection);
      setFlash(
        data.action === "recreated"
          ? `Webhook actualizado (env: ${data.env ?? runtimeEnv}).`
          : `Webhook registrado (env: ${data.env ?? runtimeEnv}).`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  if (!local) {
    return (
      <div className="panel">
        <div className="integration-actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isBusy}
            onClick={ensure}
          >
            {busy === "ensure" ? "Creando…" : "Activar conexión"}
          </button>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      </div>
    );
  }

  const webhookRegistered = Boolean(
    local.hasSigningKey &&
      typeof local.config?.calendlyWebhookSubscriptionUri === "string"
  );
  const canRegister = local.hasApiToken;
  const previewWebhookUrl =
    local.webhookUrl ?? calendlyWebhookUrl(local.webhookToken);

  return (
    <div className="panel">
      <p className="panel-kicker">Configuración</p>

      {flash ? (
        <p className="integration-flash" role="status">
          {flash}
        </p>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}

      <form className="integration-form" onSubmit={savePat}>
        <SecretSlot
          title="Personal Access Token"
          blurb="API de Calendly · registra el webhook y resuelve el Meet."
          configured={local.hasApiToken}
          masked={local.apiTokenMasked}
          rotating={rotatePat || !local.hasApiToken}
          onToggleRotate={() => {
            setRotatePat((v) => !v);
            setApiToken("");
            setFlash(null);
            setError(null);
          }}
          value={apiToken}
          onChange={(v) => {
            setApiToken(v);
            setFlash(null);
            setError(null);
          }}
          placeholder="Pegá el Personal Access Token"
          emptyHint="Crealo en Calendly → Integrations → API & webhooks."
        />

        {(rotatePat || !local.hasApiToken) && (
          <div className="integration-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isBusy || !apiToken.trim()}
            >
              {busy === "pat" ? "Guardando…" : "Guardar token"}
            </button>
          </div>
        )}
      </form>

      <section className="integration-secret" aria-labelledby="calendly-webhook-reg">
        <div className="integration-secret-top">
          <div>
            <h4 id="calendly-webhook-reg">Webhook</h4>
            <p>
              Entorno <code className="mono">{runtimeEnv}</code>
              {" · "}
              <code className="mono">{appBaseUrl()}</code>
              {" · solo reemplaza este env."}
            </p>
          </div>
          <span className={webhookRegistered ? "pill pill-ok" : "pill pill-warn"}>
            {webhookRegistered ? "registrado" : "sin registrar"}
          </span>
        </div>

        <p
          className="integration-secret-note mono"
          style={{ marginTop: "0.65rem", wordBreak: "break-all" }}
        >
          {previewWebhookUrl}
        </p>

        <div className="integration-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={isBusy || !canRegister}
            onClick={registerWebhook}
          >
            {busy === "webhook"
              ? "Registrando…"
              : webhookRegistered
                ? "Actualizar webhook"
                : "Registrar webhook"}
          </button>
        </div>
        {!local.hasApiToken ? (
          <p className="integration-secret-note">
            Guardá primero el Personal Access Token.
          </p>
        ) : (
          <p className="integration-secret-note">
            La URL sale de <code className="mono">NEXT_PUBLIC_APP_URL</code>.
            La signing key se genera sola al registrar.
          </p>
        )}
      </section>

      {local.hasSigningKey ? (
        <section
          className="integration-secret"
          data-configured="true"
          aria-labelledby="calendly-signing"
        >
          <div className="integration-secret-top">
            <div>
              <h4 id="calendly-signing">Signing key</h4>
              <p>Generada al registrar el webhook. Guardada en vault.</p>
            </div>
            <span className="pill pill-ok">en vault</span>
          </div>
          <div
            className="integration-secret-vault"
            aria-label="Signing key guardada"
          >
            <span className="integration-secret-lock" aria-hidden>
              ●
            </span>
            <code className="mono">{local.signingKeyMasked}</code>
            <span className="integration-secret-vault-label">en Tival</span>
          </div>
        </section>
      ) : null}

      {local.lastEventAt ? (
        <p className="row-meta" style={{ marginTop: "0.9rem" }}>
          Último webhook · {new Date(local.lastEventAt).toLocaleString("es-CL")}
          {local.lastError ? ` · error: ${local.lastError}` : ""}
        </p>
      ) : (
        <p className="row-meta" style={{ marginTop: "0.9rem" }}>
          Aún no llegó ningún webhook
        </p>
      )}
    </div>
  );
}

function SecretSlot({
  title,
  blurb,
  configured,
  masked,
  rotating,
  onToggleRotate,
  value,
  onChange,
  placeholder,
  emptyHint,
}: {
  title: string;
  blurb: string;
  configured: boolean;
  masked: string | null;
  rotating: boolean;
  onToggleRotate: () => void;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  emptyHint: string;
}) {
  return (
    <section
      className="integration-secret"
      data-configured={configured}
      data-rotating={rotating}
    >
      <div className="integration-secret-top">
        <div>
          <h4>{title}</h4>
          <p>{blurb}</p>
        </div>
        <span className={configured ? "pill pill-ok" : "pill pill-warn"}>
          {configured ? "guardado" : "sin configurar"}
        </span>
      </div>

      {configured && !rotating ? (
        <>
          <div className="integration-secret-vault" aria-label={`${title} guardado`}>
            <span className="integration-secret-lock" aria-hidden>
              ●
            </span>
            <code className="mono">{masked ?? "••••••••"}</code>
            <span className="integration-secret-vault-label">en Tival</span>
          </div>
          <div className="integration-secret-actions">
            <button type="button" className="btn" onClick={onToggleRotate}>
              Rotar
            </button>
          </div>
        </>
      ) : (
        <>
          {!configured ? (
            <p className="integration-secret-note">{emptyHint}</p>
          ) : (
            <p className="integration-secret-note">
              Pegá un valor nuevo para reemplazar el actual. Cancelá para dejar
              el guardado.
            </p>
          )}
          <input
            type="password"
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {configured ? (
            <div className="integration-secret-actions">
              <button type="button" className="btn" onClick={onToggleRotate}>
                Cancelar
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

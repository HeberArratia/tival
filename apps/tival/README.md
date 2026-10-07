# Tival (apps/tival)

Sistema operativo comercial. La UI expresa el modelo conceptual (aunque parte sea fake).

## Glosario

| Término | Qué es |
|---------|--------|
| **Playbook** | Plantilla: etapas + triggers + efectos · `compatibleTypes` |
| **Tipo** | Familia de iniciativa (guía, webinar, agenda…) + playbook default + entry |
| **Iniciativa** | Oferta concreta: tipo + playbook + config canal |
| **Oportunidad** | Persona/empresa en una iniciativa, en una etapa |
| **Trigger / Efecto / Evento** | Entrada → trabajo → historia |
| **Miembro / Rol** | Persona del workspace (`ops`, `consultor`) · distinto del actor de etapa |
| **Asignación** | Consultor dueño de la opp (`assigned_consultant_id`) · warning si falta |
| **Usuario / Sesión** | Login email+password · cookie `tival_session` · seed Bigin |

### Auth (V1)

- `/login` — email + password (default seed: `tival`, override `SEED_DEFAULT_PASSWORD`)
- Tablas: `users`, `workspace_members`, `sessions`
- Seed: Heber (ops) + consultores Nico, Marcelo, Cristian, Aylin, Walter
- Middleware protege la app; webhooks y `/api/payments` siguen públicos con su key

```
Tipo webinar → playbook Captación webinar (default)
Tipo guia/form → playbook Captación guía (mismas etapas)
Tipo agenda → playbook Consultoría
```

## Arquitectura multi-workspace

Tival es **genérico**. La lógica de una organización vive en un **workspace pack**:

```
src/lib/workspace/     # tipos + registry (core)
src/workspaces/
  alfondo/             # segmentos, Q&A Calendly, aliases UTM, MP prefix…
  # futuro: otra-org/
```

| Qué | Dónde |
|-----|--------|
| Adapters (Calendly webhook, MP, pagos) | core genérico |
| Q&A Calendly, segmentos S1–S3, `diag_` | `workspaces/alfondo` |
| Defaults de instancia | `DEFAULT_WORKSPACE_SLUG` en `.env` |

Plantillas de playbook reutilizables (consultoría, captación) pueden vivir como catálogo compartido; el pack de la org elige/configura cuáles usa.

Para otro cliente: crear `src/workspaces/<slug>/pack.ts`, registrarlo en `lib/workspace/registry.ts`, y apuntar `DEFAULT_WORKSPACE_SLUG` (o resolver por host/sesión).

## Integraciones (multi-tenant)

Credenciales viven **por workspace** en `integration_connections` (cifradas), no en `.env` compartido.

| Pieza | Rol |
|-------|-----|
| UI `/integraciones` | Calendly (webhook) + Google (OAuth Drive + Calendar + Meet) |
| `POST /api/webhooks/calendly/{token}` | Trigger scoped al workspace de esa conexión |
| `GET /api/integrations/google-drive/start` | OAuth Google → callback guarda refresh_token |
| `INTEGRATIONS_ENCRYPTION_KEY` | Llave de plataforma para cifrar secrets at-rest |
| `GOOGLE_CLIENT_ID` / `SECRET` | App OAuth (tokens por workspace en DB) |

Tras `invitee.created` / reschedule, un enrichment async (no bloquea el webhook) hace GET Calendly → Calendar y guarda `meet_url` real + `meet_code` + `google_calendar_event_id`. Requiere PAT Calendly en la conexión (o `TEST_TIVAL_CALENDLY` en local) y Google OAuth con Calendar.

```bash
npx tsx scripts/enrich-meet.ts --calendly=<scheduled_event_uuid>
npx tsx scripts/enrich-meet.ts --case=<case_uuid>
```

Al pagar (`markPaid` → etapa pagado) se crea la carpeta Drive bajo `config.rootFolderId` y se guarda `drive_folder_id` en el case.

### Post-meet (Inngest)

Tras enrich Meet y/o crear carpeta Drive se encola `case/post-meet.collect`. La function espera ~**2 h** desde `scheduledAt` (inicio reunión; override `POST_MEET_LOOK_AFTER_MINUTES`), hace poll a Meet API y mueve Notas/recording/transcript a la carpeta del case. Estado en `qualification.post_meet`.

Por defecto **solo encola** si `NEXT_PUBLIC_TIVAL_ENV=production` (evita duplicar jobs local+prod con DB compartida). En local, para probar el flow completo:

```bash
# .env.local: INNGEST_ENABLED=1
# Terminal 1: Next
npm run dev
# Terminal 2: bridge local ↔ Inngest Dev Server
npm run inngest:dev
```

Env Cloud (Vercel): `INNGEST_ENV`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` del env production.

### Propuesta (n8n)

Cuando post-meet mueve por primera vez un artifact `notes`, Tival hace `POST` al webhook n8n con el contexto del case (`caseId`, carpeta, `notesFileId`, consultor, etc.). n8n redacta el correo, lo envía al consultor y avisa en Slack `#novedades`.

```bash
# .env.local / Vercel
N8N_PROPOSAL_WEBHOOK_URL=https://<n8n>/webhook/tival-proposal-draft
# opcional (si el webhook exige header)
# N8N_PROPOSAL_WEBHOOK_SECRET=...
```

Sin `N8N_PROPOSAL_WEBHOOK_URL` el disparo se omite (`proposal_n8n_skipped`). Eventos: `proposal_n8n_triggered` / `proposal_n8n_failed` / `proposal_n8n_skipped`.

Mercado Pago, Slack y Bigin aparecen en el catálogo (próximos).

### Simular webhook Calendly (sin túnel)

```bash
npm run fake:calendly          # crea oportunidad en DB (handler directo)
npm run fake:pago-mp           # simula POST Alfondo MP approved (última opp sin pagar)
npm run fake:pago-mp -- --case=<uuid>
npm run fake:calendly -- --http   # POST al server local (debe estar up)
npm run fake:calendly -- --n8n-array  # envuelve como array (forma n8n)
```

Pago — referencia Alfondo: `external_reference = diag_{calendlyEventUuid}` → `POST /api/payments` con `action: payment_approved`.

Transfer — botón **Confirmar transferencia** en la ficha si `payment_status !== paid` (no depende de lo elegido en la web).

Cada ejecución de `fake:calendly` genera nombre, email, teléfono, RUT y proyecto distintos.

### Status de oportunidad (simplificado)

| Campo | Valores | Rol |
|-------|---------|-----|
| `current_stage_id` | lead → pago → … | Dónde está en el playbook |
| `status` | `open` · `cancelled` · `no_show` · `rescheduled_away` | Excepciones Calendly (fuera del canvas). Cierre comercial = etapa ganado/perdido |
| `payment_status` | `none` · `pending` · `paid` | Sub-estado de cobro |
| `lost_reason` | `no_pago` · `no_compra` · … | Motivo si etapa = Perdido |

Cierre ganado/perdido = **etapa** (`ganado` / `perdido`), no status.

## Nav

**Iniciativas (operar):** ◆ Diagnóstico  
**Operar:** Oportunidades  
**Configurar:** Iniciativas · Segmentos · Integraciones · Playbooks

## Rutas

| Ruta | Qué |
|------|-----|
| `/iniciativas` | Index |
| `/iniciativas/nueva` | Crear (localStorage) |
| `/iniciativas/[slug]` | Show |
| `/playbooks` | Index playbooks |
| `/playbooks/[slug]` | Show playbook |
| `/integraciones` | Conexiones por workspace (Calendly, …) |
| `/procesos/diagnostico` | Canvas de la iniciativa Diagnóstico |
| `/procesos/diagnostico-innovacion`, `/procesos/consultoria` | Redirect → diagnóstico |

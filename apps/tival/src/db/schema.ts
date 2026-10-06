import { randomUUID } from "crypto";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const caseStatusEnum = pgEnum("case_status", [
  /** En proceso — la posición la dice current_stage_id (incl. ganado/perdido) */
  "open",
  "cancelled",
  "no_show",
  "rescheduled_away",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "mercadopago",
  "transferencia",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "none",
  "pending",
  "paid",
]);

export const stageActorEnum = pgEnum("stage_actor", [
  "sistema",
  "integracion",
  "humano",
  "agente",
]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "calendly",
  "mercadopago",
  "google_drive",
  "slack",
  "bigin",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "disconnected",
  "connected",
  "error",
]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Usuario de la plataforma (login). */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("users_email").on(t.email)]
);

/** Membresía en un workspace + roles ops/consultor. */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Roles operativos: ops | consultor */
    roles: jsonb("roles").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("workspace_members_workspace_user").on(t.workspaceId, t.userId),
    index("workspace_members_workspace").on(t.workspaceId),
    index("workspace_members_user").on(t.userId),
  ]
);

/** Sesión de login (cookie → token hash). */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash").on(t.tokenHash),
    index("sessions_user").on(t.userId),
    index("sessions_expires").on(t.expiresAt),
  ]
);

/** Conexión de un proveedor externo a un workspace (multi-tenant). */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: integrationProviderEnum("provider").notNull(),
    label: text("label"),
    status: integrationStatusEnum("status").default("disconnected").notNull(),
    /** Token opaco en la URL del webhook — identifica la conexión sin exponer el workspace. */
    webhookToken: text("webhook_token").notNull(),
    /** Secret de firma del webhook, cifrado at-rest. */
    webhookSigningKeyEnc: text("webhook_signing_key_enc"),
    /** Tokens OAuth / API cifrados (JSON). */
    credentialsEnc: text("credentials_enc"),
    /** Config no secreta: org URI, event types, carpeta raíz, etc. */
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("integration_connections_workspace_provider").on(
      t.workspaceId,
      t.provider
    ),
    uniqueIndex("integration_connections_webhook_token").on(t.webhookToken),
    index("integration_connections_workspace").on(t.workspaceId),
  ]
);

export const playbooks = pgTable("playbooks", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const playbookStages = pgTable(
  "playbook_stages",
  {
    id: id(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull(),
    requiresPayment: boolean("requires_payment").default(false).notNull(),
    requiresHuman: boolean("requires_human").default(false).notNull(),
    actor: stageActorEnum("actor").default("sistema").notNull(),
  },
  (t) => [
    uniqueIndex("playbook_stages_playbook_key").on(t.playbookId, t.key),
    index("playbook_stages_playbook_order").on(t.playbookId, t.sortOrder),
  ]
);

/** Persona / identidad. Email único por workspace cuando existe. */
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    email: text("email"),
    name: text("name"),
    primaryPhone: text("primary_phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("contacts_workspace").on(t.workspaceId),
    uniqueIndex("contacts_workspace_email").on(t.workspaceId, t.email),
  ]
);

/** Teléfonos del contacto — se acumulan; primary vive en contacts.primary_phone. */
export const contactPhones = pgTable(
  "contact_phones",
  {
    id: id(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    phone: text("phone").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("contact_phones_contact_phone").on(t.contactId, t.phone),
    index("contact_phones_contact").on(t.contactId),
  ]
);

/** Sociedad / RUT — identidad de empresa. */
export const companies = pgTable(
  "companies",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    rut: text("rut"),
    name: text("name"),
    societyType: text("society_type"),
    antiquity: text("antiquity"),
    sales12m: text("sales_12m"),
    sales12mAt: timestamp("sales_12m_at", { withTimezone: true }),
    region: text("region"),
    giro: text("giro"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("companies_workspace").on(t.workspaceId),
    uniqueIndex("companies_workspace_rut").on(t.workspaceId, t.rut),
  ]
);

/** Contacto ↔ empresas (N sociedades por persona). */
export const contactCompanies = pgTable(
  "contact_companies",
  {
    id: id(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("contact_companies_pair").on(t.contactId, t.companyId),
    index("contact_companies_contact").on(t.contactId),
    index("contact_companies_company").on(t.companyId),
  ]
);

export const cases = pgTable(
  "cases",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id),
    currentStageId: uuid("current_stage_id").references(() => playbookStages.id),
    status: caseStatusEnum("status").default("open").notNull(),

    /** Persona de la oportunidad. */
    contactId: uuid("contact_id").references(() => contacts.id),
    /** Empresa primaria (facturación / postulación) de este deal. */
    companyId: uuid("company_id").references(() => companies.id),

    calendlyEventUuid: text("calendly_event_uuid"),
    calendlyEventUri: text("calendly_event_uri"),
    calendlyRoute: text("calendly_route"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /** Link Meet (proxy Calendly al agendar; luego hangoutLink real). */
    meetUrl: text("meet_url"),
    /** Código Meet (`xxx-xxxx-xxx`) para Meet API. */
    meetCode: text("meet_code"),
    /** ID del evento en Google Calendar (`calendar_event.external_id` de Calendly). */
    googleCalendarEventId: text("google_calendar_event_id"),

    qualification: jsonb("qualification").$type<Record<string, unknown>>(),
    landingSource: text("landing_source"),
    qualificationLogId: text("qualification_log_id"),

    paymentMethod: paymentMethodEnum("payment_method"),
    paymentStatus: paymentStatusEnum("payment_status").default("none").notNull(),
    mpPaymentId: text("mp_payment_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentConfirmedBy: text("payment_confirmed_by"),

    cancelReason: text("cancel_reason"),
    /** Motivo al cerrar en etapa Perdido (no_pago, no_compra, …). */
    lostReason: text("lost_reason"),
    /**
     * Consultor asignado (id de member del pack / futuro workspace_members).
     * Se define en Diagnóstico pagado; warning si falta, no bloquea.
     */
    assignedConsultantId: text("assigned_consultant_id"),
    driveFolderId: text("drive_folder_id"),
    driveFolderKey: text("drive_folder_key"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("cases_workspace_calendly_event_uuid").on(
      t.workspaceId,
      t.calendlyEventUuid
    ),
    uniqueIndex("cases_mp_payment_id").on(t.mpPaymentId),
    index("cases_workspace_status").on(t.workspaceId, t.status),
    index("cases_scheduled_at").on(t.scheduledAt),
    index("cases_contact").on(t.contactId),
    index("cases_company").on(t.companyId),
  ]
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    actor: text("actor").default("sistema").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("case_events_case_created").on(t.caseId, t.createdAt)]
);

/** Producto del workspace — catálogo plano. */
export const products = pgTable(
  "products",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Key estable para referenciar desde oportunidades. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    priceListClp: integer("price_list_clp"),
    paymentLink: text("payment_link"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("products_workspace_key").on(t.workspaceId, t.key),
    index("products_workspace_active").on(t.workspaceId, t.active),
  ]
);

export type Workspace = typeof workspaces.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type PlaybookStage = typeof playbookStages.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type ContactPhoneRow = typeof contactPhones.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type ContactCompanyRow = typeof contactCompanies.$inferSelect;
export type CaseRow = typeof cases.$inferSelect;
export type CaseEvent = typeof caseEvents.$inferSelect;
export type CaseStatus = (typeof caseStatusEnum.enumValues)[number];
export type IntegrationConnection =
  typeof integrationConnections.$inferSelect;
export type IntegrationProvider =
  (typeof integrationProviderEnum.enumValues)[number];
export type IntegrationStatus =
  (typeof integrationStatusEnum.enumValues)[number];
export type ProductRow = typeof products.$inferSelect;

import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import path from "path";
import * as schema from "./schema";

export type Db =
  | ReturnType<typeof drizzlePg<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
  pglite?: PGlite;
  drizzleDb?: Db;
  migrated?: boolean;
};

function shouldUsePglite() {
  const url = process.env.DATABASE_URL ?? "";
  return process.env.USE_PGLITE === "1" || url.startsWith("pglite:");
}

async function ensurePgliteSchema(client: PGlite) {
  if (globalForDb.migrated) return;
  await client.exec(`
    DO $$ BEGIN
      CREATE TYPE case_status AS ENUM (
        'open','cancelled','no_show','rescheduled_away'
      );
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE payment_method AS ENUM ('mercadopago','transferencia');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE payment_status AS ENUM ('none','pending','paid');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE stage_actor AS ENUM ('sistema','integracion','humano','agente');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE integration_provider AS ENUM (
        'calendly','mercadopago','google_drive','slack','bigin'
      );
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE integration_status AS ENUM ('disconnected','connected','error');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS integration_connections (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      provider integration_provider NOT NULL,
      label text,
      status integration_status NOT NULL DEFAULT 'disconnected',
      webhook_token text NOT NULL,
      webhook_signing_key_enc text,
      credentials_enc text,
      config jsonb DEFAULT '{}'::jsonb,
      last_event_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_workspace_provider
      ON integration_connections(workspace_id, provider);
    CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_webhook_token
      ON integration_connections(webhook_token);
    CREATE INDEX IF NOT EXISTS integration_connections_workspace
      ON integration_connections(workspace_id);

    CREATE TABLE IF NOT EXISTS playbooks (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      name text NOT NULL,
      slug text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS playbook_stages (
      id uuid PRIMARY KEY,
      playbook_id uuid NOT NULL REFERENCES playbooks(id),
      key text NOT NULL,
      name text NOT NULL,
      description text,
      sort_order integer NOT NULL,
      requires_payment boolean NOT NULL DEFAULT false,
      requires_human boolean NOT NULL DEFAULT false,
      actor stage_actor NOT NULL DEFAULT 'sistema'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS playbook_stages_playbook_key ON playbook_stages(playbook_id, key);

    CREATE TABLE IF NOT EXISTS contacts (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      email text,
      name text,
      primary_phone text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contacts_workspace ON contacts(workspace_id);
    CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_email
      ON contacts(workspace_id, email);

    CREATE TABLE IF NOT EXISTS contact_phones (
      id uuid PRIMARY KEY,
      contact_id uuid NOT NULL REFERENCES contacts(id),
      phone text NOT NULL,
      source text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_contact_phone
      ON contact_phones(contact_id, phone);
    CREATE INDEX IF NOT EXISTS contact_phones_contact ON contact_phones(contact_id);

    CREATE TABLE IF NOT EXISTS companies (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      rut text,
      name text,
      society_type text,
      antiquity text,
      sales_12m text,
      sales_12m_at timestamptz,
      region text,
      giro text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS companies_workspace ON companies(workspace_id);
    CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_rut
      ON companies(workspace_id, rut);

    CREATE TABLE IF NOT EXISTS contact_companies (
      id uuid PRIMARY KEY,
      contact_id uuid NOT NULL REFERENCES contacts(id),
      company_id uuid NOT NULL REFERENCES companies(id),
      role text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS contact_companies_pair
      ON contact_companies(contact_id, company_id);
    CREATE INDEX IF NOT EXISTS contact_companies_contact ON contact_companies(contact_id);
    CREATE INDEX IF NOT EXISTS contact_companies_company ON contact_companies(company_id);

    CREATE TABLE IF NOT EXISTS cases (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      playbook_id uuid NOT NULL REFERENCES playbooks(id),
      current_stage_id uuid REFERENCES playbook_stages(id),
      status case_status NOT NULL DEFAULT 'open',
      contact_id uuid REFERENCES contacts(id),
      company_id uuid REFERENCES companies(id),
      calendly_event_uuid text,
      calendly_event_uri text,
      calendly_route text,
      scheduled_at timestamptz,
      meet_url text,
      meet_code text,
      google_calendar_event_id text,
      qualification jsonb,
      landing_source text,
      qualification_log_id text,
      payment_method payment_method,
      payment_status payment_status NOT NULL DEFAULT 'none',
      mp_payment_id text,
      paid_at timestamptz,
      payment_confirmed_by text,
      cancel_reason text,
      lost_reason text,
      assigned_consultant_id text,
      drive_folder_id text,
      drive_folder_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cases_workspace_calendly_event_uuid
      ON cases(workspace_id, calendly_event_uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS cases_mp_payment_id ON cases(mp_payment_id);
    CREATE INDEX IF NOT EXISTS cases_workspace_status ON cases(workspace_id, status);
    CREATE INDEX IF NOT EXISTS cases_scheduled_at ON cases(scheduled_at);
    CREATE INDEX IF NOT EXISTS cases_contact ON cases(contact_id);
    CREATE INDEX IF NOT EXISTS cases_company ON cases(company_id);

    ALTER TABLE cases ADD COLUMN IF NOT EXISTS lost_reason text;
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_consultant_id text;
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id);
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS meet_code text;
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS google_calendar_event_id text;
    -- Legacy contact_* / company_name: dropear con npm run db:migrate-contacts

    CREATE TABLE IF NOT EXISTS case_events (
      id uuid PRIMARY KEY,
      case_id uuid NOT NULL REFERENCES cases(id),
      type text NOT NULL,
      payload jsonb DEFAULT '{}'::jsonb,
      actor text NOT NULL DEFAULT 'sistema',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS products (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES workspaces(id),
      key text NOT NULL,
      name text NOT NULL,
      price_list_clp integer,
      payment_link text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS products_workspace_key
      ON products(workspace_id, key);
    CREATE INDEX IF NOT EXISTS products_workspace_active
      ON products(workspace_id, active);
    ALTER TABLE products DROP COLUMN IF EXISTS service_type;
    ALTER TABLE products DROP COLUMN IF EXISTS fund_key;
    ALTER TABLE products DROP COLUMN IF EXISTS fund_name;
    ALTER TABLE products DROP COLUMN IF EXISTS institution;
    DROP INDEX IF EXISTS products_workspace_fund;
  `);
  globalForDb.migrated = true;
}

export async function getDb(): Promise<Db> {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  if (shouldUsePglite()) {
    const dataDir = path.join(process.cwd(), "data", "pglite");
    const client = globalForDb.pglite ?? new PGlite(dataDir);
    if (!globalForDb.pglite) {
      await client.waitReady;
      globalForDb.pglite = client;
    }
    await ensurePgliteSchema(client);
    globalForDb.drizzleDb = drizzlePglite(client, { schema });
    return globalForDb.drizzleDb;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client =
    globalForDb.pgClient ??
    postgres(connectionString, { max: 10, prepare: false });
  globalForDb.pgClient = client;
  globalForDb.drizzleDb = drizzlePg(client, { schema });
  return globalForDb.drizzleDb;
}

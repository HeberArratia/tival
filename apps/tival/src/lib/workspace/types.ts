/**
 * Contrato de un “workspace pack”: lógica de negocio de una organización.
 * El core de Tival es genérico; cada cliente registra su pack.
 */

import type { OpportunityFieldDef } from "@/lib/opportunity-fields";
import type { WorkspaceSegment } from "@/lib/segments";

export type CalendlyQa = {
  question?: string;
  answer?: string;
  position?: number;
};

/** Cómo mapear Q&A de Calendly → campos de oportunidad. */
export type CalendlyInviteeMapping = {
  phoneQuestion?: RegExp[];
  mensajeQuestion?: RegExp[];
  rutQuestion?: RegExp[];
  /** Preferir utm_medium vs utm_source como landing_source */
  landingFromTracking?: "utm_medium" | "utm_source" | "either";
};

export type LandingAliasRule = {
  /** Match sobre landing_source / utm (lowercase) */
  match: RegExp;
  /** Slug de iniciativa del workspace */
  initiativeSlug: string;
};

/** Rol operativo de una persona (distinto del actor de etapa). */
export type WorkspaceRole = "ops" | "consultor";

/** Miembro del workspace — V1 pack-defined (sin auth). */
export type WorkspaceMember = {
  id: string;
  name: string;
  email?: string;
  roles: WorkspaceRole[];
};

export type WorkspacePack = {
  slug: string;
  name: string;
  timezone: string;
  locale: string;
  /** Playbook slug activo por defecto en este workspace */
  defaultPlaybookSlug: string;
  segments: WorkspaceSegment[];
  /** Personas ops / consultores del workspace */
  members?: WorkspaceMember[];
  calendlyMapping: CalendlyInviteeMapping;
  /** utm / landing → iniciativa */
  landingAliases: LandingAliasRule[];
  /** Prefijo external_reference Mercado Pago (ej. diag_) */
  mpExternalRefPrefix?: string;
  /** Campos de oportunidad del playbook consultoría (o plantilla local) */
  consultoriaFields?: OpportunityFieldDef[];
};

export type WorkspaceRuntime = {
  slug: string;
  /** Override vía env; si no, el primer pack o el pedido explícito */
  isDefault: boolean;
};

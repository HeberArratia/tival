import type { IntegrationProvider } from "@/db/schema";

export type ProviderMeta = {
  id: IntegrationProvider;
  /** Segmento de URL / etiqueta corta en UI (puede diferir del id de DB). */
  slug: string;
  name: string;
  blurb: string;
  /** v1: cableable en UI */
  connectable: boolean;
  webhookEvents?: string[];
};

/** Alias de URL → id de DB (ej. /integraciones/google → google_drive). */
const PROVIDER_SLUG_ALIASES: Record<string, IntegrationProvider> = {
  google: "google_drive",
};

export const INTEGRATION_PROVIDERS: ProviderMeta[] = [
  {
    id: "calendly",
    slug: "calendly",
    name: "Calendly",
    blurb: "Agenda y webhooks de invitados.",
    connectable: true,
    webhookEvents: [
      "invitee.created",
      "invitee.canceled",
      "invitee_no_show.created",
    ],
  },
  {
    id: "mercadopago",
    slug: "mercadopago",
    name: "Mercado Pago",
    blurb: "Pagos y notificaciones de cobro.",
    connectable: false,
  },
  {
    id: "google_drive",
    slug: "google",
    name: "Google",
    blurb:
      "Drive, Calendar y Meet: carpetas del caso, link real de la reunión y artefactos post-meet.",
    connectable: true,
  },
  {
    id: "slack",
    slug: "slack",
    name: "Slack",
    blurb: "Avisos al equipo.",
    connectable: false,
  },
  {
    id: "bigin",
    slug: "bigin",
    name: "Zoho Bigin",
    blurb: "CRM del workspace.",
    connectable: false,
  },
];

export function resolveProviderId(
  value: string
): IntegrationProvider | null {
  if (PROVIDER_SLUG_ALIASES[value]) return PROVIDER_SLUG_ALIASES[value];
  if (INTEGRATION_PROVIDERS.some((p) => p.id === value)) {
    return value as IntegrationProvider;
  }
  return null;
}

export function isIntegrationProvider(
  value: string
): value is IntegrationProvider {
  return resolveProviderId(value) !== null;
}

export function providerMeta(
  idOrSlug: IntegrationProvider | string
): ProviderMeta {
  const id = resolveProviderId(idOrSlug) ?? (idOrSlug as IntegrationProvider);
  return (
    INTEGRATION_PROVIDERS.find((p) => p.id === id) ?? {
      id,
      slug: String(idOrSlug),
      name: String(idOrSlug),
      blurb: "",
      connectable: false,
    }
  );
}

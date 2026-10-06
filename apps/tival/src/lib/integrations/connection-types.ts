import type {
  IntegrationProvider,
  IntegrationStatus,
} from "@/db/schema";

/** Vista pública de una conexión (segura para pasar a client components). */
export type ConnectionPublic = {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  provider: IntegrationProvider;
  label: string | null;
  status: IntegrationStatus;
  webhookToken: string;
  webhookUrl: string | null;
  hasSigningKey: boolean;
  signingKeyMasked: string | null;
  hasApiToken: boolean;
  apiTokenMasked: string | null;
  /** Google (Drive/Calendar): refresh token presente */
  hasRefreshToken: boolean;
  accountEmail: string | null;
  config: Record<string, unknown>;
  lastEventAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

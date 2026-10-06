import type { WorkspacePack } from "@/lib/workspace/types";
import { alfondoPack } from "@/workspaces/alfondo/pack";

const PACKS: Record<string, WorkspacePack> = {
  [alfondoPack.slug]: alfondoPack,
};

/** Slug por defecto de la instancia (no hardcodear org en el core). */
export function defaultWorkspaceSlug(): string {
  return (
    process.env.DEFAULT_WORKSPACE_SLUG?.trim() ||
    process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE?.trim() ||
    alfondoPack.slug
  );
}

export function getWorkspacePack(slug?: string | null): WorkspacePack {
  const key = (slug ?? defaultWorkspaceSlug()).toLowerCase();
  const pack = PACKS[key];
  if (!pack) {
    throw new Error(
      `Workspace pack no registrado: ${key}. Packs: ${Object.keys(PACKS).join(", ")}`
    );
  }
  return pack;
}

export function tryGetWorkspacePack(slug?: string | null): WorkspacePack | null {
  try {
    return getWorkspacePack(slug);
  } catch {
    return null;
  }
}

export function listWorkspacePacks(): WorkspacePack[] {
  return Object.values(PACKS);
}

export function registerWorkspacePack(pack: WorkspacePack) {
  PACKS[pack.slug] = pack;
}

/**
 * Usuarios Alfondo (migración Bigin) — IDs estables para seed + assignedConsultantId.
 * Contraseña por defecto: SEED_DEFAULT_PASSWORD o "tival".
 */
import type { WorkspaceRole } from "@/lib/workspace/types";

export type SeedUserDef = {
  id: string;
  name: string;
  email: string;
  roles: WorkspaceRole[];
};

export const SEED_DEFAULT_PASSWORD =
  process.env.SEED_DEFAULT_PASSWORD?.trim() || "tival";

/** UUIDs fijos — no regenerar entre seeds. */
export const SEED_USERS: SeedUserDef[] = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    name: "Heber Arratia",
    email: "heber@alfondo.cl",
    roles: ["ops"],
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    name: "Nico Jara",
    email: "nico@jarascript.cl",
    roles: ["consultor"],
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    name: "Marcelo Esperguel",
    email: "marcelo@alfondo.cl",
    roles: ["consultor"],
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    name: "Cristian Oyarzún",
    email: "cristian@alfondo.cl",
    roles: ["consultor"],
  },
  {
    id: "a0000000-0000-4000-8000-000000000005",
    name: "Aylin Jara",
    email: "aylin@alfondo.cl",
    roles: ["consultor"],
  },
  {
    id: "a0000000-0000-4000-8000-000000000006",
    name: "Walter Noack",
    email: "walter@alfondo.cl",
    roles: ["consultor"],
  },
];

export const SEED_USER_HEBER_ID = SEED_USERS[0]!.id;
export const SEED_USER_NICO_ID = SEED_USERS[1]!.id;
export const SEED_USER_MARCELO_ID = SEED_USERS[2]!.id;

export function seedUserById(id: string | null | undefined): SeedUserDef | null {
  if (!id) return null;
  return SEED_USERS.find((u) => u.id === id) ?? null;
}

export function seedUserByEmail(email: string): SeedUserDef | null {
  const key = email.trim().toLowerCase();
  return SEED_USERS.find((u) => u.email.toLowerCase() === key) ?? null;
}

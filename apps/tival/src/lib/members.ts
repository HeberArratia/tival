/**
 * Miembros del workspace — server (DB).
 * Client Components: importar desde `@/lib/members-catalog`.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { SEED_USERS } from "@/lib/auth/seed-users";
import {
  CURRENT_MEMBER_ID,
} from "@/lib/members-catalog";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/workspace/types";

export type { WorkspaceMember, WorkspaceRole };
export {
  CURRENT_MEMBER_ID,
  ROLE_LABEL,
  memberById,
  isMemberId,
  memberInitials,
  handoffActionsForCase,
  canAssignConsultant,
  HANDOFF_ACTION_OWNER,
  HANDOFF_ACTION_LABEL,
  type HandoffActionId,
  type ActionOwner,
} from "@/lib/members-catalog";

function fakeOn() {
  return process.env.USE_FAKE_DATA !== "0";
}

function catalogMembers(): WorkspaceMember[] {
  return SEED_USERS.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles,
  }));
}

export async function listMembers(
  workspaceSlug?: string | null
): Promise<WorkspaceMember[]> {
  if (fakeOn()) return catalogMembers();

  const slug = workspaceSlug ?? defaultWorkspaceSlug();
  try {
    const db = await getDb();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        roles: workspaceMembers.roles,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaces.slug, slug));

    if (rows.length === 0) return catalogMembers();

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      roles: (r.roles ?? []).filter(
        (x): x is WorkspaceRole => x === "ops" || x === "consultor"
      ),
    }));
  } catch {
    return catalogMembers();
  }
}

export async function membersWithRole(
  role: WorkspaceRole,
  workspaceSlug?: string | null
): Promise<WorkspaceMember[]> {
  const all = await listMembers(workspaceSlug);
  return all.filter((m) => m.roles.includes(role));
}

export async function currentMember(
  workspaceSlug?: string | null
): Promise<WorkspaceMember | null> {
  const all = await listMembers(workspaceSlug);
  return all.find((m) => m.id === CURRENT_MEMBER_ID) ?? all[0] ?? null;
}

export async function ensureMemberIsConsultor(
  consultantId: string,
  workspaceSlug?: string | null
): Promise<WorkspaceMember> {
  const consultants = await membersWithRole("consultor", workspaceSlug);
  const m = consultants.find((c) => c.id === consultantId);
  if (!m) throw new Error("Member is not a consultor");
  return m;
}

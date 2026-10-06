import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import {
  SEED_DEFAULT_PASSWORD,
  SEED_USERS,
} from "@/lib/auth/seed-users";

/** Upsert usuarios + memberships del workspace. */
export async function seedWorkspaceUsers(workspaceSlug = "alfondo") {
  const db = await getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceSlug} not found for user seed`);
  }

  const passwordHash = await hashPassword(SEED_DEFAULT_PASSWORD);
  let created = 0;
  let updated = 0;

  for (const u of SEED_USERS) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, u.id))
      .limit(1);

    if (existing) {
      await db
        .update(users)
        .set({
          name: u.name,
          email: u.email.toLowerCase(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, u.id));
      updated++;
    } else {
      // Por email (re-seed si cambió el id fijo)
      const [byEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, u.email.toLowerCase()))
        .limit(1);
      if (byEmail) {
        await db
          .update(users)
          .set({
            name: u.name,
            passwordHash,
            updatedAt: new Date(),
          })
          .where(eq(users.id, byEmail.id));
        updated++;
      } else {
        await db.insert(users).values({
          id: u.id,
          name: u.name,
          email: u.email.toLowerCase(),
          passwordHash,
        });
        created++;
      }
    }

    const userId = existing?.id ?? u.id;
    const [resolved] = await db
      .select()
      .from(users)
      .where(eq(users.email, u.email.toLowerCase()))
      .limit(1);
    const finalUserId = resolved?.id ?? userId;

    const memRows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, finalUserId));
    const mem = memRows.find((m) => m.workspaceId === workspace.id);

    if (mem) {
      await db
        .update(workspaceMembers)
        .set({ roles: u.roles })
        .where(eq(workspaceMembers.id, mem.id));
    } else {
      await db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: finalUserId,
        roles: u.roles,
      });
    }
  }

  return {
    created,
    updated,
    total: SEED_USERS.length,
    defaultPassword: SEED_DEFAULT_PASSWORD,
  };
}

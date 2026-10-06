import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users, workspaceMembers, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/lib/workspace/types";
import { defaultWorkspaceSlug } from "@/lib/workspace/registry";

export const SESSION_COOKIE = "tival_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: WorkspaceRole[];
  workspaceId: string;
  workspaceSlug: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string): Promise<string> {
  const db = await getDb();
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return token;
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function getSessionUser(
  workspaceSlug = defaultWorkspaceSlug()
): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;

  const db = await getDb();
  const tokenHash = hashToken(token);
  const now = new Date();

  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      roles: workspaceMembers.roles,
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, now),
        eq(workspaces.slug, workspaceSlug)
      )
    )
    .limit(1);

  if (!row) return null;

  const roles = (row.roles ?? []).filter(
    (r): r is WorkspaceRole => r === "ops" || r === "consultor"
  );

  return {
    id: row.userId,
    name: row.name,
    email: row.email,
    roles,
    workspaceId: row.workspaceId,
    workspaceSlug: row.workspaceSlug,
  };
}

export function actorLabel(user: SessionUser | null | undefined): string {
  return user?.name ?? user?.email ?? "sistema";
}

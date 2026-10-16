import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { caseEvents, caseNotes, cases, type CaseNote } from "@/db/schema";
import { isFakeDataEnabled } from "@/lib/fake-data";

const MAX_BODY_LENGTH = 8000;

type FakeStore = Map<string, CaseNote[]>;

const globalFake = globalThis as unknown as { __tivalCaseNotes?: FakeStore };

function fakeStore(): FakeStore {
  if (!globalFake.__tivalCaseNotes) {
    globalFake.__tivalCaseNotes = new Map();
  }
  return globalFake.__tivalCaseNotes;
}

function normalizeBody(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

async function assertCaseExists(caseId: string) {
  if (isFakeDataEnabled()) return;
  const db = await getDb();
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row) throw new Error("Case not found");
}

async function appendNoteEvent(
  caseId: string,
  type: string,
  payload: Record<string, unknown>,
  actor: string
) {
  if (isFakeDataEnabled()) return;
  const db = await getDb();
  await db.insert(caseEvents).values({ caseId, type, payload, actor });
}

export async function listCaseNotes(caseId: string): Promise<CaseNote[]> {
  if (isFakeDataEnabled()) {
    return [...(fakeStore().get(caseId) ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  const db = await getDb();
  return db
    .select()
    .from(caseNotes)
    .where(eq(caseNotes.caseId, caseId))
    .orderBy(desc(caseNotes.createdAt));
}

export async function addCaseNote(input: {
  caseId: string;
  body: string;
  authorUserId: string | null;
  authorName: string;
}): Promise<CaseNote> {
  const body = normalizeBody(input.body);
  if (!body) throw new Error("empty_note");
  if (body.length > MAX_BODY_LENGTH) throw new Error("note_too_long");

  const authorName = input.authorName.trim() || "sistema";
  await assertCaseExists(input.caseId);

  if (isFakeDataEnabled()) {
    const now = new Date();
    const note: CaseNote = {
      id: crypto.randomUUID(),
      caseId: input.caseId,
      body,
      authorUserId: input.authorUserId,
      authorName,
      createdAt: now,
      updatedAt: now,
    };
    const list = fakeStore().get(input.caseId) ?? [];
    list.unshift(note);
    fakeStore().set(input.caseId, list);
    return note;
  }

  const db = await getDb();
  const [created] = await db
    .insert(caseNotes)
    .values({
      caseId: input.caseId,
      body,
      authorUserId: input.authorUserId,
      authorName,
    })
    .returning();

  await appendNoteEvent(
    input.caseId,
    "note_added",
    { noteId: created.id },
    authorName
  );
  return created;
}

export async function updateCaseNote(input: {
  caseId: string;
  noteId: string;
  body: string;
  actor: string;
}): Promise<CaseNote> {
  const body = normalizeBody(input.body);
  if (!body) throw new Error("empty_note");
  if (body.length > MAX_BODY_LENGTH) throw new Error("note_too_long");

  if (isFakeDataEnabled()) {
    const list = fakeStore().get(input.caseId) ?? [];
    const idx = list.findIndex((n) => n.id === input.noteId);
    if (idx < 0) throw new Error("Note not found");
    const updated: CaseNote = {
      ...list[idx],
      body,
      updatedAt: new Date(),
    };
    list[idx] = updated;
    fakeStore().set(input.caseId, list);
    return updated;
  }

  const db = await getDb();
  const [current] = await db
    .select()
    .from(caseNotes)
    .where(eq(caseNotes.id, input.noteId))
    .limit(1);
  if (!current || current.caseId !== input.caseId) {
    throw new Error("Note not found");
  }

  const [updated] = await db
    .update(caseNotes)
    .set({ body, updatedAt: new Date() })
    .where(eq(caseNotes.id, input.noteId))
    .returning();

  await appendNoteEvent(
    input.caseId,
    "note_updated",
    { noteId: updated.id },
    input.actor
  );
  return updated;
}

export async function deleteCaseNote(input: {
  caseId: string;
  noteId: string;
  actor: string;
}): Promise<void> {
  if (isFakeDataEnabled()) {
    const list = fakeStore().get(input.caseId) ?? [];
    const next = list.filter((n) => n.id !== input.noteId);
    if (next.length === list.length) throw new Error("Note not found");
    fakeStore().set(input.caseId, next);
    return;
  }

  const db = await getDb();
  const [current] = await db
    .select()
    .from(caseNotes)
    .where(eq(caseNotes.id, input.noteId))
    .limit(1);
  if (!current || current.caseId !== input.caseId) {
    throw new Error("Note not found");
  }

  await db.delete(caseNotes).where(eq(caseNotes.id, input.noteId));
  await appendNoteEvent(
    input.caseId,
    "note_deleted",
    { noteId: input.noteId },
    input.actor
  );
}

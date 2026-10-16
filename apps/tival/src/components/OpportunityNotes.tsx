"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CaseNote } from "@/db/schema";

type NoteItem = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Busy = "idle" | "saving" | "deleting";

function formatWhen(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function wasEdited(note: NoteItem) {
  const created =
    note.createdAt instanceof Date
      ? note.createdAt.getTime()
      : new Date(note.createdAt).getTime();
  const updated =
    note.updatedAt instanceof Date
      ? note.updatedAt.getTime()
      : new Date(note.updatedAt).getTime();
  return updated - created > 2000;
}

/** Notas internas del consultor: crear, editar y eliminar. */
export function OpportunityNotes({
  caseId,
  initialNotes,
}: {
  caseId: string;
  initialNotes: CaseNote[] | NoteItem[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteItem[]>(
    initialNotes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.authorName,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }))
  );
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNotes(
      initialNotes.map((n) => ({
        id: n.id,
        body: n.body,
        authorName: n.authorName,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }))
    );
  }, [initialNotes]);

  async function postAction(
    payload: Record<string, unknown>
  ): Promise<{ ok: boolean; note?: NoteItem; error?: string }> {
    const res = await fetch(`/api/cases/${caseId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: typeof data?.error === "string" ? data.error : "error",
      };
    }
    return { ok: true, note: data.note as NoteItem | undefined };
  }

  async function handleAdd() {
    const body = draft.trim();
    if (!body || busy !== "idle") return;
    setBusy("saving");
    setError(null);
    const result = await postAction({ action: "add_note", body });
    setBusy("idle");
    if (!result.ok || !result.note) {
      setError(
        result.error === "empty_note"
          ? "Escribí algo antes de guardar."
          : result.error === "note_too_long"
            ? "La nota es demasiado larga."
            : "No se pudo guardar. Probá de nuevo."
      );
      return;
    }
    setDraft("");
    setNotes((prev) => [result.note!, ...prev]);
    router.refresh();
  }

  function startEdit(note: NoteItem) {
    setEditingId(note.id);
    setEditDraft(note.body);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function handleSaveEdit(noteId: string) {
    const body = editDraft.trim();
    if (!body || busy !== "idle") return;
    setBusy("saving");
    setError(null);
    const result = await postAction({
      action: "update_note",
      noteId,
      body,
    });
    setBusy("idle");
    if (!result.ok || !result.note) {
      setError(
        result.error === "empty_note"
          ? "La nota no puede quedar vacía."
          : "No se pudo actualizar. Probá de nuevo."
      );
      return;
    }
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, ...result.note! } : n))
    );
    cancelEdit();
    router.refresh();
  }

  async function handleDelete(noteId: string) {
    if (busy !== "idle") return;
    if (!window.confirm("¿Eliminar esta nota?")) return;
    setBusy("deleting");
    setError(null);
    const result = await postAction({ action: "delete_note", noteId });
    setBusy("idle");
    if (!result.ok) {
      setError("No se pudo eliminar. Probá de nuevo.");
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    if (editingId === noteId) cancelEdit();
    router.refresh();
  }

  const disabled = busy !== "idle";

  return (
    <div className="opp-notes">
      <div className="opp-note-card opp-note-card--composer">
        <div className="opp-note-card-top">
          <span className="opp-note-card-label">Nueva nota</span>
        </div>
        <textarea
          id="opp-note-draft"
          className="opp-notes-textarea"
          rows={4}
          value={draft}
          disabled={disabled}
          placeholder="Apuntes del diagnóstico, seguimiento, acuerdos…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="opp-note-card-foot">
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || !draft.trim()}
            onClick={() => void handleAdd()}
          >
            {busy === "saving" && !editingId ? "Guardando…" : "Agregar nota"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="opp-notes-error" role="alert">
          {error}
        </p>
      ) : null}

      {notes.length === 0 ? (
        <p className="empty opp-notes-empty">Sin notas todavía.</p>
      ) : (
        <ul className="opp-notes-list">
          {notes.map((note, index) => {
            const editing = editingId === note.id;
            const tone = index % 3;
            return (
              <li
                key={note.id}
                className={`opp-note-card opp-note-card--tone-${tone}${
                  editing ? " is-editing" : ""
                }`}
              >
                <div className="opp-note-card-top">
                  <span className="opp-note-byline">
                    <span className="opp-note-author">{note.authorName}</span>
                    <span className="opp-note-sep" aria-hidden>
                      ·
                    </span>
                    <time dateTime={String(note.createdAt)}>
                      {formatWhen(note.createdAt)}
                      {wasEdited(note) ? " · editada" : ""}
                    </time>
                  </span>
                </div>

                {editing ? (
                  <>
                    <textarea
                      className="opp-notes-textarea"
                      rows={4}
                      value={editDraft}
                      disabled={disabled}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                    <div className="opp-note-card-foot">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={disabled || !editDraft.trim()}
                        onClick={() => void handleSaveEdit(note.id)}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={disabled}
                        onClick={cancelEdit}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="opp-note-body">{note.body}</p>
                    <div className="opp-note-card-foot">
                      <button
                        type="button"
                        className="opp-note-link"
                        disabled={disabled}
                        onClick={() => startEdit(note)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="opp-note-link opp-note-link--danger"
                        disabled={disabled}
                        onClick={() => void handleDelete(note.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

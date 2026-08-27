import { useState } from "react";
import * as lecturesStore from "../../../stores/lectures.js";
import { saveLectureToCloud } from "../../../supabase.js";

export async function renameLecture(userId, lectureId, title, deps = {}) {
  const store = deps.store || lecturesStore;
  const save = deps.save || saveLectureToCloud;
  const name = String(title || "").trim();
  if (!name) throw new Error("Enter a lecture name.");
  const lecture = (store.read(userId) || []).find((l) => l.id === lectureId);
  if (!lecture) throw new Error("Lecture not found. Refresh and try again.");
  if (userId) {
    const result = await save(userId, {
      id: lectureId, blockId: lecture.blockId, termId: lecture.termId,
      lectureTitle: name, title: name,
    });
    if (!result?.saved) throw new Error("Could not save the new name. Please retry.");
  }
  store.write(userId, (store.read(userId) || []).map((l) => l.id === lectureId
    ? { ...l, lectureTitle: name, title: name } : l));
  return name;
}

export function RenameLecture({ userId, lectureId, title, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!editing) return <button className="min-h-11 rounded px-2 text-sm text-text-2 hover:bg-panel" onClick={() => { setDraft(title || ""); setEditing(true); }}>Rename lecture…</button>;
  return <form className="flex max-w-xl flex-wrap items-center gap-2" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { const name = await renameLecture(userId, lectureId, draft); onRenamed?.(name); setEditing(false); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }}>
    <input autoFocus aria-label="Lecture name" maxLength={200} value={draft} disabled={busy}
      onChange={(e) => setDraft(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded border border-border bg-panel px-3 text-base" />
    <button disabled={busy || !draft.trim()} className="min-h-11 px-3 text-sm">{busy ? "Saving…" : "Save name"}</button>
    <button type="button" disabled={busy} className="min-h-11 px-2 text-sm" onClick={() => setEditing(false)}>Cancel</button>
    {error && <p role="alert" className="w-full text-sm text-bad">{error}</p>}
  </form>;
}

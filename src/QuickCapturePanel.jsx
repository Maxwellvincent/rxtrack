import { useEffect, useRef, useState } from "react";

function mkNoteId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function renderNoteBody(noteText, textStyle) {
  const lines = String(noteText || "").split("\n").filter(Boolean);
  if (lines.length <= 1) {
    return (
      <div style={{ fontSize: 12, color: textStyle.color, lineHeight: 1.4 }}>{noteText}</div>
    );
  }
  return (
    <div style={{ fontSize: 12, color: textStyle.color, lineHeight: 1.4 }}>
      {lines.map((line, i) => (
        <div key={i} style={{ paddingLeft: 8 }}>
          – {line}
        </div>
      ))}
    </div>
  );
}

export default function QuickCapturePanel({
  onSave,
  onClose,
  onViewAllNotes,
  currentLectureName,
  currentLectureId,
  currentBlockId,
  T,
}) {
  const [captureText, setCaptureText] = useState("");
  const [captureTag, setCaptureTag] = useState("lookup");
  const [notes, setNotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rxt-quick-notes") || "[]");
    } catch {
      return [];
    }
  });
  const [editingCaptureId, setEditingCaptureId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [savedFlashId, setSavedFlashId] = useState(null);
  const editTextareaRef = useRef(null);
  const suppressEditBlurRef = useRef(false);

  const border = T.border || T.border1;
  const surface = T.surface || T.cardBg;
  const surfaceAlt = T.surfaceAlt || T.inputBg;
  const text = T.text || T.text1;
  const textSecondary = T.textSecondary || T.text3;

  useEffect(() => {
    if (!editingCaptureId || !editTextareaRef.current) return;
    const el = editTextareaRef.current;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* ignore */
    }
  }, [editingCaptureId]);

  function handleSave() {
    if (!captureText.trim()) return;
    const note = {
      id: mkNoteId(),
      text: captureText.trim(),
      tag: captureTag,
      createdAt: new Date().toISOString(),
      lectureName: currentLectureName || null,
      lectureId: currentLectureId || null,
      blockId: currentBlockId || null,
      resolved: false,
    };
    const updated = [note, ...notes];
    setNotes(updated);
    try {
      localStorage.setItem("rxt-quick-notes", JSON.stringify(updated));
    } catch {}
    setCaptureText("");
    setCaptureTag("lookup");
    onSave?.(note);
    onClose?.();
  }

  function deleteNote(id) {
    if (id === editingCaptureId) {
      setEditingCaptureId(null);
      setEditDraft("");
    }
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    try {
      localStorage.setItem("rxt-quick-notes", JSON.stringify(updated));
    } catch {}
  }

  function beginEdit(note) {
    setEditingCaptureId(note.id);
    setEditDraft(note.text ?? "");
  }

  function cancelEdit() {
    setEditingCaptureId(null);
    setEditDraft("");
  }

  function commitEdit(noteId, originalText) {
    if (editingCaptureId !== noteId) return;
    const trimmed = editDraft.replace(/^\s+|\s+$/g, "");
    if (!trimmed) {
      setEditingCaptureId(null);
      setEditDraft("");
      return;
    }
    const orig = originalText ?? "";
    const origTrim = String(orig).replace(/^\s+|\s+$/g, "");
    if (trimmed === origTrim && editDraft === orig) {
      setEditingCaptureId(null);
      setEditDraft("");
      return;
    }
    const updated = notes.map((n) => (n.id === noteId ? { ...n, text: trimmed } : n));
    setNotes(updated);
    try {
      localStorage.setItem("rxt-quick-notes", JSON.stringify(updated));
    } catch {}
    setEditingCaptureId(null);
    setEditDraft("");
    setSavedFlashId(noteId);
    window.setTimeout(() => setSavedFlashId((cur) => (cur === noteId ? null : cur)), 1500);
  }

  const unresolved = notes.filter((n) => !n.resolved);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        right: 24,
        width: 320,
        background: surface,
        borderRadius: 12,
        border: `1px solid ${border}`,
        boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
        zIndex: 901,
        overflow: "hidden",
        animation: "slideUp 0.2s ease",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13 }}>✏️ Quick Capture</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: textSecondary,
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: "10px 16px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { id: "lookup", label: "🔍 Look up" },
          { id: "confused", label: "❓ Confused" },
          { id: "important", label: "⭐ Important" },
          { id: "connection", label: "🔗 Connection" },
        ].map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => setCaptureTag(tag.id)}
            style={{
              padding: "3px 8px",
              borderRadius: 20,
              border: `1px solid ${captureTag === tag.id ? T.accent : border}`,
              background: captureTag === tag.id ? T.accent : "transparent",
              color: captureTag === tag.id ? "white" : textSecondary,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: captureTag === tag.id ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            {tag.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "10px 16px" }}>
        <textarea
          autoFocus
          value={captureText}
          onChange={(e) => setCaptureText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="What do you need to look up or remember?"
          style={{
            width: "100%",
            minHeight: 80,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${border}`,
            background: surfaceAlt,
            color: text,
            fontSize: 13,
            lineHeight: 1.5,
            resize: "vertical",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 10, color: textSecondary }}>⌘+Enter to save</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={!captureText.trim()}
            style={{
              padding: "6px 16px",
              borderRadius: 7,
              border: "none",
              background: captureText.trim() ? T.accent : border,
              color: "white",
              cursor: captureText.trim() ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 600,
              opacity: captureText.trim() ? 1 : 0.9,
            }}
          >
            Save →
          </button>
        </div>
      </div>

      {unresolved.length > 0 && (
        <div style={{ borderTop: `1px solid ${border}`, maxHeight: 160, overflowY: "auto" }}>
          <div
            style={{
              padding: "8px 16px 4px",
              fontSize: 10,
              fontWeight: 600,
              color: textSecondary,
              letterSpacing: "0.05em",
            }}
          >
            RECENT
          </div>
          {unresolved.slice(0, 5).map((note) => (
            <div
              key={note.id}
              style={{
                padding: "6px 16px",
                borderBottom: `1px solid ${border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: T.accent, marginBottom: 2 }}>
                  {note.tag === "lookup" ? "🔍" : note.tag === "confused" ? "❓" : note.tag === "important" ? "⭐" : "🔗"}{" "}
                  {note.tag}
                  {note.lectureName && (
                    <span style={{ color: textSecondary }}> · {String(note.lectureName).slice(0, 20)}</span>
                  )}
                </div>
                {editingCaptureId === note.id ? (
                  <textarea
                    ref={editTextareaRef}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onBlur={() => {
                      if (suppressEditBlurRef.current) {
                        suppressEditBlurRef.current = false;
                        return;
                      }
                      commitEdit(note.id, note.text);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                        return;
                      }
                      if (e.key === "Enter" && e.metaKey) {
                        e.preventDefault();
                        suppressEditBlurRef.current = true;
                        commitEdit(note.id, note.text);
                      }
                    }}
                    style={{
                      width: "100%",
                      minHeight: 56,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: `1px solid ${border}`,
                      background: surfaceAlt,
                      color: text,
                      fontSize: 12,
                      lineHeight: 1.4,
                      resize: "vertical",
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => beginEdit(note)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        beginEdit(note);
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      borderRadius: 4,
                    }}
                  >
                    {renderNoteBody(note.text, { color: text })}
                  </div>
                )}
                {savedFlashId === note.id && (
                  <div style={{ fontSize: 10, color: T.accent, marginTop: 4 }}>✓ saved</div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNote(note.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: textSecondary,
                  fontSize: 14,
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
          {unresolved.length > 5 && onViewAllNotes && (
            <div
              role="button"
              tabIndex={0}
              style={{ padding: "6px 16px", fontSize: 11, color: T.accent, cursor: "pointer" }}
              onClick={onViewAllNotes}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onViewAllNotes();
                }
              }}
            >
              View all {unresolved.length} notes →
            </div>
          )}
        </div>
      )}
    </div>
  );
}

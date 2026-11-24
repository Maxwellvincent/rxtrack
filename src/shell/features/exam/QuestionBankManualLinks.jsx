import { useMemo, useState } from "react";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import { assignQuestionToLecture } from "./questionBankLinks.js";
import { formatLectureLabel } from "../../../lectureTitle.js";

const identity = (question, index) => String(question.id || question.questionId || `${index}:${question.stem}`);
const objectiveText = objective => objective.objective || objective.text || objective.content || objective.id;

function linkStatus(question) {
  const lecture = question.lectureLabel || question.lectureId;
  if (question.curriculumLinkStatus === "user-confirmed") return { symbol: "✓", label: `Linked by you to ${lecture}`, linked: true };
  if (question.curriculumLinkStatus === "evidence-verified") return { symbol: "✓", label: `Verified link to ${lecture}`, linked: true };
  if (question.lectureLinkBasis === "user-assigned") return { symbol: "◆", label: `Lecture pinned by you: ${lecture} · objective not chosen yet`, linked: false };
  return { symbol: "◇", label: question.curriculumMappingReview?.reason ? `Unresolved: ${String(question.curriculumMappingReview.reason).slice(0, 220)}` : "Not linked yet", linked: false };
}

/** Learner-controlled lecture/objective assignment for uploaded school questions. */
export function QuestionBankManualLinks({ userId, blockId, filename, questions = [], lectures = [], objectives = [] }) {
  const [showAll, setShowAll] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [message, setMessage] = useState("");
  const [savingKey, setSavingKey] = useState(null);
  const blockLectures = useMemo(() => lectures.filter(lecture => lecture.blockId === blockId && !lecture.mergedInto)
    .sort((a, b) => (Number(a.lectureNumber) || 999) - (Number(b.lectureNumber) || 999) || formatLectureLabel(a).localeCompare(formatLectureLabel(b))), [lectures, blockId]);
  const rows = questions.map((question, index) => ({ question, index, key: identity(question, index), status: linkStatus(question) }))
    .filter(row => row.question?.stem && row.question?.correct);
  const unresolved = rows.filter(row => !row.status.linked).length;
  const visible = showAll ? rows : rows.filter(row => !row.status.linked);

  async function save(row, lectureId, objectiveIds) {
    const current = questionBanksStore.read(userId) || {};
    const list = current[filename];
    if (!Array.isArray(list)) { setMessage("This bank is still saving. Try again in a moment."); return; }
    const updated = assignQuestionToLecture(row.question, { lectureId, objectiveIds }, { lectures: blockLectures, objectives });
    if (!updated) { setMessage("Choose a lecture in this block and at most two of its objectives."); return; }
    setSavingKey(row.key);
    try {
      await questionBanksStore.writeAwait(userId, { ...current, [filename]: list.map((item, index) => identity(item, index) === row.key && item.stem === row.question.stem ? updated : item) });
      setDrafts(previous => { const next = { ...previous }; delete next[row.key]; return next; });
      setMessage(lectureId ? `Saved Q${row.question.num || row.index + 1}.` : `Cleared Q${row.question.num || row.index + 1}.`);
    } catch (error) {
      setMessage(`Not saved: ${error.message}`);
    } finally { setSavingKey(null); }
  }

  if (!rows.length) return null;
  return <details className="mt-2 text-xs text-text-2">
    <summary className="cursor-pointer font-semibold">Assign questions to lectures · {unresolved} not linked</summary>
    <p className="mt-1">Pick the lecture that teaches each question. Adding up to two objectives (from one or two lectures for integrated IMCQ/ESoft items) gives full objective credit; a lecture alone pins it and automatic linking will only look for objectives inside that lecture.</p>
    <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Show linked questions too</label>
    {message && <p className="mt-1 font-semibold" role="status">{message}</p>}
    <ul className="mt-2 space-y-2">{visible.map(row => {
      const draft = drafts[row.key] || { lectureId: row.question.lectureLinkBasis === "user-assigned" ? row.question.lectureId : "", secondLectureId: "", objectiveIds: row.question.curriculumLinkStatus === "user-confirmed" ? row.question.objectiveIds || [] : [] };
      const update = patch => setDrafts(previous => ({ ...previous, [row.key]: { ...draft, ...patch } }));
      const choices = objectives.filter(objective => objective.linkedLecId && [draft.lectureId, draft.secondLectureId].includes(objective.linkedLecId));
      const toggle = id => update({ objectiveIds: draft.objectiveIds.includes(id) ? draft.objectiveIds.filter(value => value !== id) : [...draft.objectiveIds, id].slice(-2) });
      return <li key={row.key} className="rounded border border-border px-2 py-1.5">
        <div className="font-mono text-[11px] text-text-3">Q{row.question.num || row.index + 1}</div>
        <p className="text-text-1">{String(row.question.stem).slice(0, 260)}{String(row.question.stem).length > 260 ? "…" : ""}</p>
        <p className="mt-1">{row.status.symbol} {row.status.label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label>Lecture <select value={draft.lectureId} onChange={event => update({ lectureId: event.target.value, objectiveIds: draft.objectiveIds.filter(id => objectives.find(o => o.id === id)?.linkedLecId !== draft.lectureId) })} className="rounded border border-border bg-bg px-1 py-0.5">
            <option value="">— choose —</option>{blockLectures.map(lecture => <option key={lecture.id} value={lecture.id}>{formatLectureLabel(lecture)}</option>)}
          </select></label>
          {draft.lectureId && <label>Also uses (optional) <select value={draft.secondLectureId} onChange={event => update({ secondLectureId: event.target.value })} className="rounded border border-border bg-bg px-1 py-0.5">
            <option value="">none</option>{blockLectures.filter(lecture => lecture.id !== draft.lectureId).map(lecture => <option key={lecture.id} value={lecture.id}>{formatLectureLabel(lecture)}</option>)}
          </select></label>}
        </div>
        {choices.length > 0 && <fieldset className="mt-1"><legend>Objectives tested (up to 2)</legend>{choices.map(objective => <label key={objective.id} className="flex items-start gap-1">
          <input type="checkbox" checked={draft.objectiveIds.includes(objective.id)} onChange={() => toggle(objective.id)} /> <span><strong>{objective.code || ""}</strong> {objectiveText(objective)}</span>
        </label>)}</fieldset>}
        <div className="mt-1 flex gap-2">
          <button type="button" disabled={!draft.lectureId || savingKey === row.key} onClick={() => save(row, draft.lectureId, draft.objectiveIds)} className="rounded border border-border px-2 py-0.5 font-semibold disabled:opacity-50">{savingKey === row.key ? "Saving…" : "Save link"}</button>
          {(row.question.lectureLinkBasis === "user-assigned") && <button type="button" disabled={savingKey === row.key} onClick={() => save(row, null, [])} className="rounded border border-border px-2 py-0.5">Clear my link</button>}
        </div>
      </li>;
    })}</ul>
  </details>;
}

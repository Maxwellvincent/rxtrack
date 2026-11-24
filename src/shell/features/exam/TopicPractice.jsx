import { useState } from "react";
import { matchTopicObjectives, topicFocusNotes } from "../../../engine/topicFocus.js";
import { lectureTextFrom } from "../lectures/lectureStudy.js";

/** Type a weak topic (e.g. "PICA vs AICA, medial medulla"), confirm the matching objectives, practice them. */
export function TopicPractice({ blockId, userId = null, lectures = [], objectives = [], onPractice, fetchContent = null }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [texts, setTexts] = useState(null);
  const [searching, setSearching] = useState(false);

  // Lecture text is where most topic detail lives (key facts are sparse), so the
  // block's lectures are loaded once, on the first search.
  async function loadTexts() {
    if (texts) return texts;
    const loader = fetchContent || (await import("../../../firebaseData.js")).fetchLectureContent;
    const block = lectures.filter(lecture => lecture.blockId === blockId && !lecture.mergedInto);
    const loaded = {};
    for (let i = 0; i < block.length; i += 6) {
      await Promise.all(block.slice(i, i + 6).map(async lecture => {
        const local = lectureTextFrom(lecture);
        if (local.trim()) { loaded[lecture.id] = local; return; }
        try { const remote = userId ? await loader(userId, lecture.id) : null; loaded[lecture.id] = remote ? lectureTextFrom(remote) : ""; }
        catch { loaded[lecture.id] = ""; }
      }));
    }
    setTexts(loaded);
    return loaded;
  }

  const find = async event => {
    event.preventDefault();
    setSearching(true);
    const lectureTexts = await loadTexts();
    setSearching(false);
    const found = matchTopicObjectives(query, { blockId, lectures, objectives, lectureTexts });
    setResult(found);
    setSelected(new Set(found.objectives.map(row => row.id)));
  };
  const toggle = id => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <section className="mb-5 rounded-xl border border-border p-3" aria-labelledby="topic-practice-title">
    <h3 id="topic-practice-title" className="text-sm font-semibold">Practice a topic</h3>
    <p className="mt-1 text-xs text-text-2">Type a weak area in this block. RxTrack finds the objectives that teach it; questions start where your mastery ladder is weakest (repair and recall first, then look-alike discrimination).</p>
    <form onSubmit={find} className="mt-2 flex flex-wrap gap-2">
      <input aria-label="Topic to practice" value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. PICA vs AICA lesions, medial medulla" className="min-w-[16rem] flex-1 rounded border border-border bg-bg px-2 py-1.5 text-sm" />
      <button type="submit" disabled={!query.trim() || searching} className="rounded border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-50">{searching ? "Searching lectures…" : "Find"}</button>
    </form>
    {result && !result.objectives.length && <p className="mt-2 text-sm">◇ No objective in this block mentions that topic. Try the structure, artery or syndrome name used on your slides.</p>}
    {result?.objectives.length > 0 && <div className="mt-2 text-sm">
      <p className="text-text-2">Found in {result.lectures.map(lecture => lecture.title).join(" · ")}</p>
      <ul className="mt-1 space-y-1">{result.objectives.map(row => <li key={row.id}>
        <label className="flex items-start gap-2"><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
          <span>{row.objective.objective || row.objective.text} <span className="text-xs text-text-3">({row.reasons.join(" · ")})</span></span></label>
      </li>)}</ul>
      <button type="button" disabled={!selected.size} onClick={() => onPractice({ studyMode: "repair", objectiveIds: [...selected], focusNotes: topicFocusNotes(query) })}
        className="mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-40">Practice {selected.size} objective{selected.size === 1 ? "" : "s"}</button>
    </div>}
  </section>;
}

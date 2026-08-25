import { useState, useCallback, useEffect, useMemo } from "react";
import * as masterGuideStore from "../../../stores/masterGuide.js";
import * as studyGuideStore from "../../../stores/studyGuide.js";
import { generateMasterGuide } from "../../../engine/masterGuide.js";
import { callAIJSON } from "../../../aiClient.js";

function GroupProgress({ topics }) {
  const done = topics.filter((t) => t.checked).length;
  const total = topics.length;
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct === 100 ? "var(--color-good)" : "var(--color-accent)" }}
        />
      </div>
      <span className="font-mono text-[11px] text-text-3 flex-shrink-0">
        {done}/{total}
      </span>
    </div>
  );
}

function TopicRow({ topic, lectureMap, onCheck }) {
  const lectures = useMemo(() => {
    const ids = new Set((topic.sourceIds || []).map((s) => s.split(":")[0]));
    return [...ids].map((id) => lectureMap[id]).filter(Boolean);
  }, [topic.sourceIds, lectureMap]);

  return (
    <label className="flex items-start gap-2.5 group cursor-pointer py-0.5">
      <input
        type="checkbox"
        checked={topic.checked || false}
        className="mt-[3px] accent-accent shrink-0"
        onChange={(e) => onCheck(topic.id, e.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <span className={[
          "text-[13px] leading-snug",
          topic.checked ? "text-text-3 line-through" : "text-text-1",
        ].join(" ")}>
          {topic.text}
        </span>
        {lectures.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {lectures.map((name) => (
              <span
                key={name}
                className="rounded px-1.5 py-0 font-mono text-[10px] text-text-3"
                style={{ background: "var(--color-border)" }}
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function GuideGroup({ group, lectureMap, onTopicCheck, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const done = group.topics.filter((t) => t.checked).length;
  const total = group.topics.length;
  const allDone = total > 0 && done === total;

  return (
    <div className="rounded-sm border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
          allDone ? "bg-good/5" : "bg-bg-elevated hover:bg-panel",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={[
            "font-condensed text-[13px] font-bold uppercase tracking-wide",
            allDone ? "text-good" : "text-text-1",
          ].join(" ")}>
            {allDone ? "✓ " : ""}{group.name}
          </span>
          <span className="font-mono text-[11px] text-text-3">
            {done}/{total}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-20">
            <GroupProgress topics={group.topics} />
          </div>
          <span className="text-text-3 text-xs">{open ? "▴" : "▾"}</span>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-0 divide-y divide-border/40">
          {group.topics.map((topic) => (
            <div key={topic.id} className="px-4 py-2">
              <TopicRow
                topic={topic}
                lectureMap={lectureMap}
                onCheck={(topicId, checked) => onTopicCheck(group.id, topicId, checked)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MasterGuide({ blockId, userId, lectures = [] }) {
  const [guide, setGuide] = useState(() => masterGuideStore.read(userId, blockId));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Re-read if blockId changes
  useEffect(() => {
    setGuide(masterGuideStore.read(userId, blockId));
    setError(null);
  }, [blockId, userId]);

  const lectureMap = useMemo(() => {
    const m = {};
    for (const l of lectures) {
      m[l.id] = l.lectureTitle || l.fileName || l.filename || "Lecture";
    }
    return m;
  }, [lectures]);

  // Collect per-lecture study guide topics
  const lectureTopics = useMemo(() =>
    lectures.map((l) => {
      const sg = studyGuideStore.read(userId, l.id);
      return {
        lectureId: l.id,
        lectureName: l.lectureTitle || l.fileName || l.filename || "Lecture",
        topics: sg?.topics || [],
      };
    }),
    [lectures, userId]
  );

  const totalTopics = lectureTopics.reduce((s, lt) => s + lt.topics.length, 0);

  const generate = useCallback(async () => {
    const blockName = lectures[0]?.blockName || "this module";
    setGenerating(true);
    setError(null);
    const result = await generateMasterGuide(
      { lectureTopics, blockName, blockId },
      { callAIJSON }
    );
    setGenerating(false);
    if (result.error) { setError(result.error); return; }
    masterGuideStore.write(userId, blockId, result);
    setGuide(result);
  }, [lectureTopics, blockId, userId, lectures]);

  const onTopicCheck = useCallback((groupId, topicId, checked) => {
    // Update master guide
    const next = masterGuideStore.setTopicChecked(userId, blockId, groupId, topicId, checked);
    if (!next) return;
    setGuide(next);

    // Propagate to lecture study guides
    const sourceIds = masterGuideStore.getSourceIds(userId, blockId, groupId, topicId);
    for (const sid of sourceIds) {
      const [lecId, topicId2] = sid.split(":");
      if (lecId && topicId2) {
        studyGuideStore.setTopicChecked(userId, lecId, topicId2, checked);
      }
    }
  }, [userId, blockId]);

  const totalChecked = useMemo(() =>
    (guide?.groups || []).flatMap((g) => g.topics).filter((t) => t.checked).length,
    [guide]
  );
  const totalMasterTopics = useMemo(() =>
    (guide?.groups || []).flatMap((g) => g.topics).length,
    [guide]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-condensed text-xl font-bold uppercase tracking-wider text-text-1">
            Module Study Guide
          </h2>
          {guide?.generatedAt && (
            <div className="mt-0.5 font-mono text-[11px] text-text-3">
              Generated {new Date(guide.generatedAt).toLocaleDateString()} · {totalChecked}/{totalMasterTopics} complete
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={generate}
            disabled={generating || totalTopics === 0}
            className="rounded-sm border border-border bg-bg-elevated px-3 py-1.5 font-condensed text-[12px] font-semibold uppercase tracking-wide text-text-2 transition-colors hover:border-border-strong hover:text-text-1 disabled:opacity-40"
          >
            {generating ? "Generating…" : guide ? "↻ Regenerate" : "Generate Guide"}
          </button>
          {totalTopics === 0 && (
            <span className="font-mono text-[11px] text-text-3">
              Study some lectures first to generate topics
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 font-mono text-[12px] text-warn">
          {error}
        </div>
      )}

      {generating && (
        <div className="flex flex-col gap-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-sm bg-bg-elevated" />
          ))}
        </div>
      )}

      {!generating && !guide && totalTopics > 0 && (
        <div className="rounded-sm border border-border bg-bg-elevated px-5 py-8 text-center">
          <div className="mb-1 font-condensed text-sm font-semibold uppercase tracking-wide text-text-2">
            {totalTopics} topics across {lectures.filter((l) => {
              const sg = studyGuideStore.read(userId, l.id);
              return sg?.topics?.length > 0;
            }).length} lectures ready to organize
          </div>
          <div className="font-mono text-[12px] text-text-3">
            Generate a master guide to see how the lectures connect and where to focus.
          </div>
        </div>
      )}

      {!generating && guide?.groups?.length > 0 && (
        <div className="flex flex-col gap-2">
          {guide.groups.map((group, i) => (
            <GuideGroup
              key={group.id}
              group={group}
              lectureMap={lectureMap}
              onTopicCheck={onTopicCheck}
              defaultOpen={i < 3}
            />
          ))}
        </div>
      )}

      {guide?.groups?.length > 0 && (
        <div className="font-mono text-[11px] text-text-3">
          Checks inside individual lecture guides sync here automatically.
        </div>
      )}
    </div>
  );
}

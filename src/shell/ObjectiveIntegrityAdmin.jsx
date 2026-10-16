import { useCallback, useEffect, useMemo, useState } from "react";
import { auditObjectiveSlideCoverage } from "../engine/objectiveSlideTargets.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import { fetchLectureContent } from "../supabase.js";
import { createObjectiveCommands, selectBlockObjectives } from "./logic/objectives.js";
import { useLectures } from "./hooks/useLectures.js";
import { useObjectives } from "./hooks/useObjectives.js";
import { ObjectiveLinkReview } from "./features/lectures/ObjectiveLinkReview.jsx";
import { lectureTextFrom } from "./features/lectures/lectureStudy.js";

export function ObjectiveIntegrityAdmin({ userId }) {
  const lecturesResource = useLectures(null, userId);
  const objectivesResource = useObjectives(null, userId);
  const [selectedLectureId, setSelectedLectureId] = useState("");
  const [source, setSource] = useState({ lectureId: "", chunks: [], text: "", loading: false, error: "" });
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState(null);

  const lectures = lecturesResource.data || [];
  useEffect(() => {
    if (!selectedLectureId && lectures.length) setSelectedLectureId(lectures[0].id);
  }, [lectures, selectedLectureId]);
  const activeLecture = lectures.find((lecture) => lecture.id === selectedLectureId) || null;

  useEffect(() => {
    if (!activeLecture) return undefined;
    let alive = true;
    setSource({ lectureId: activeLecture.id, chunks: activeLecture.chunks || [], text: lectureTextFrom(activeLecture), loading: true, error: "" });
    fetchLectureContent(userId, activeLecture.id).then((remote) => {
      if (!alive) return;
      const chunks = Array.isArray(remote?.chunks) && remote.chunks.length ? remote.chunks : (activeLecture.chunks || []);
      const remoteText = remote ? lectureTextFrom(remote) : "";
      const text = remoteText || lectureTextFrom(activeLecture);
      setSource({ lectureId: activeLecture.id, chunks, text, loading: false, error: "" });
    }).catch((error) => {
      if (!alive) return;
      setSource((current) => ({
        ...current,
        loading: false,
        error: current.text || current.chunks.length ? `Using local source; cloud fetch failed: ${error?.message || String(error)}` : (error?.message || String(error)),
      }));
    });
    return () => { alive = false; };
  }, [activeLecture, userId]);

  const blockObjectives = useMemo(
    () => activeLecture ? selectBlockObjectives(objectivesResource.data, activeLecture.blockId) : [],
    [objectivesResource.data, activeLecture]
  );
  const slideAudit = useMemo(() => auditObjectiveSlideCoverage(
    blockObjectives,
    source.lectureId === activeLecture?.id ? source.chunks : [],
    source.lectureId === activeLecture?.id ? source.text : ""
  ), [blockObjectives, source, activeLecture?.id]);
  const commands = useMemo(() => createObjectiveCommands({
    read: () => objectivesStore.read(userId) || {},
    write: (next) => objectivesStore.write(userId, next),
    notify: () => window.dispatchEvent(new CustomEvent("rxt-objectives-updated")),
  }), [userId]);

  const confirmLink = useCallback((objective, targetLecture) => {
    if (objectivesResource.loading || !objective?.id || !targetLecture?.id) return;
    setSavingId(String(objective.id));
    try {
      commands.updateObjective(activeLecture.blockId, objective.id, {
        linkedLecId: targetLecture.id,
        sourceFile: targetLecture.id,
        lectureType: targetLecture.lectureType || "LEC",
        lectureNumber: targetLecture.lectureNumber ?? null,
        manuallyAligned: true,
        alignedAt: new Date().toISOString(),
      });
      setNotice(`Link updated to ${targetLecture.lectureType || "LEC"} ${targetLecture.lectureNumber ?? "—"}; cloud sync is queued. Learning history and notes were preserved.`);
    } catch (error) {
      setNotice(`Could not update link: ${error?.message || String(error)}`);
    } finally {
      setSavingId(null);
    }
  }, [commands, objectivesResource.loading, activeLecture]);

  return <section className="mt-8 border-t border-border pt-5">
    <h3 className="text-lg font-semibold">Objective source and lecture links</h3>
    <p className="mb-3 text-sm text-text-2">Technical review · exact SOM-code evidence and manual link repair. Missing slide-code matches are advisory because OCR may omit them.</p>
    {lecturesResource.loading || objectivesResource.loading
      ? <p className="text-sm text-text-3">Loading lecture and objective metadata…</p>
      : !lectures.length ? <p className="text-sm text-text-3">No lectures are available to audit.</p>
        : <>
          <label className="mb-3 block text-sm font-medium" htmlFor="objective-integrity-lecture">Lecture source to inspect</label>
          <select id="objective-integrity-lecture" value={activeLecture?.id || ""} onChange={(event) => { setSelectedLectureId(event.target.value); setNotice(""); }} className="mb-3 min-h-10 w-full rounded border border-border bg-panel px-2 text-sm">
            {lectures.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.lectureType || "LEC"} {lecture.lectureNumber ?? "—"} · {lecture.lectureTitle || lecture.title || "Untitled"} [{lecture.blockId || "no block"}]</option>)}
          </select>
          {source.loading && <p className="mb-2 text-sm text-text-3">Loading source slides for code matching…</p>}
          {source.error && <p role="status" className="mb-2 text-sm text-warn">{source.error}</p>}
          {notice && <p role="status" className="mb-2 text-sm text-good">{notice}</p>}
          {activeLecture && <ObjectiveLinkReview
            objectives={blockObjectives}
            lectures={lectures.filter((lecture) => lecture.blockId === activeLecture.blockId)}
            activeLecture={activeLecture}
            slideAudit={slideAudit}
            onConfirmLink={confirmLink}
            savingId={savingId}
            disabled={objectivesResource.loading || source.loading}
          />}
        </>}
  </section>;
}

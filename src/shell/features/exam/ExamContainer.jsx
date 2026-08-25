/**
 * Task 12 — the "Integrated Exam" tab's top-level container.
 *
 * Owns view-state (launch modal / active session / dashboard) and assembles
 * every bit of data the earlier tasks' components need but don't fetch
 * themselves: eligible lectures, a sensible default question count, and the
 * lecture/objective/atom/weak-concept maps `launchExamSession` (Task 8)
 * threads through to allocation (Task 4) and generation (Task 5).
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { dedupeByText, selectBlockObjectives } from "../../logic/objectives.js";
import { statsForLecture } from "../../../stores/lectureQuestionStats.js";
import * as weakConceptsStore from "../../../stores/weakConcepts.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../../stores/questionBankMeta.js";
import { readTutorModeEnabled, writeTutorModeEnabled } from "./tutorPrefs.js";
import { ExamLaunchModal } from "./ExamLaunchModal.jsx";
import { ExamSessionRunner } from "./ExamSessionRunner.jsx";
import { ExamDashboard } from "./ExamDashboard.jsx";
import { launchExamSession } from "./launchExam.js";
import { callAI, callAIJSON } from "../../../aiClient.js";

const DEFAULT_QUESTION_COUNT_FALLBACK = 20;

// I5 fix — `resolveDefaultQuestionCount`/`weakConceptsStore.read` are
// synchronous store reads with no hydration signal. Mirrors the
// `isHydrated`/`subscribe` contract `useStoreResource.js` already uses for
// every other Firestore-backed store in this codebase: subscribing here
// forces a re-render (and therefore a memo recompute, since this hydration
// flag is a dependency below) once hydration actually completes, instead of
// permanently freezing on whatever the store read before hydration landed —
// a real path via `readLastView` restoring the Exam tab as the last-viewed
// tab on reload.
function useStoreHydrated(store, userId) {
  return useSyncExternalStore(
    (cb) => (typeof store.subscribe === "function" ? store.subscribe(cb) : () => {}),
    () => (typeof store.isHydrated === "function" ? store.isHydrated(userId) : true),
    () => (typeof store.isHydrated === "function" ? store.isHydrated(userId) : true)
  );
}

function resolveDefaultQuestionCount(userId, blockId) {
  const banks = questionBanksStore.read(userId) || {};
  const existingFilenames = Object.keys(banks);
  const match = questionBankMetaStore.newestForBlock(userId, blockId, { existingFilenames });
  if (match && banks[match.filename]) {
    return banks[match.filename].length || DEFAULT_QUESTION_COUNT_FALLBACK;
  }
  return DEFAULT_QUESTION_COUNT_FALLBACK;
}

export function ExamContainer({ blockId, blockName, userId, onNavigateToLecture }) {
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const [launching, setLaunching] = useState(false);
  // I4 fix — `launchExamSession`'s `generationErrors` (a per-lecture
  // generation shortfall after retries) was computed and returned but never
  // read; surfaced here as a brief, dismissable warning once the user is in
  // the session, rather than silently dropped.
  const [launchWarning, setLaunchWarning] = useState(null);

  const lecturesRes = useLectures(blockId, userId);
  const objectivesRes = useObjectives(null, userId);

  const lectures = useMemo(() => lecturesRes.data || [], [lecturesRes.data]);

  const objectives = useMemo(
    () => dedupeByText(selectBlockObjectives(objectivesRes.data, blockId)),
    [objectivesRes.data, blockId]
  );

  const lecturesById = useMemo(() => {
    const map = {};
    for (const lec of lectures) {
      if (lec?.id) map[lec.id] = lec;
    }
    return map;
  }, [lectures]);

  // I6 fix — real lecture display labels for `finalizeExamSession`'s
  // `lectureLabelsByLectureId` option, built from the same `lecturesById`
  // map ExamContainer already assembles, instead of every exam-derived
  // weak-concept entry getting a raw lectureId as its label forever.
  const lectureLabelsByLectureId = useMemo(() => {
    const map = {};
    for (const [id, lec] of Object.entries(lecturesById)) {
      map[id] = lec?.lectureTitle || lec?.fileName || id;
    }
    return map;
  }, [lecturesById]);

  const objectivesByLecture = useMemo(() => {
    const map = {};
    for (const obj of objectives) {
      const lecId = obj?.linkedLecId;
      if (!lecId) continue;
      if (!map[lecId]) map[lecId] = [];
      map[lecId].push(obj);
    }
    return map;
  }, [objectives]);

  // Task 5's startObjectiveQuiz reuse already falls back gracefully with an
  // empty atoms array — v1 of the exam tab doesn't need atom-based
  // generation to work, so every lecture gets no atoms.
  const atomsByLecture = useMemo(() => ({}), []);

  const weakConceptAccuracyByLecture = useMemo(() => {
    const map = {};
    for (const lec of lectures) {
      if (!lec?.id) continue;
      map[lec.id] = statsForLecture(userId, lec.id).accuracy;
    }
    return map;
  }, [lectures, userId]);

  const weakConceptsHydrated = useStoreHydrated(weakConceptsStore, userId);
  const weakConcepts = useMemo(
    () => weakConceptsStore.read(userId),
    // `weakConceptsHydrated` is a deliberate recompute-trigger dependency
    // (same pattern as the controller hook's `tick`) — it carries no value
    // itself, it just forces this memo to re-run once hydration lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, weakConceptsHydrated]
  );

  const eligibleLectures = useMemo(
    () =>
      lectures
        .filter((lec) => lec?.id && (objectivesByLecture[lec.id]?.length || 0) > 0)
        .map((lec) => ({
          lectureId: lec.id,
          lectureLabel: lec.lectureTitle || lec.fileName || lec.id,
          objectiveCount: objectivesByLecture[lec.id].length,
        })),
    [lectures, objectivesByLecture]
  );

  const questionBanksHydrated = useStoreHydrated(questionBanksStore, userId);
  const questionBankMetaHydrated = useStoreHydrated(questionBankMetaStore, userId);
  const defaultQuestionCount = useMemo(
    () => resolveDefaultQuestionCount(userId, blockId),
    // Same deliberate recompute-trigger pattern as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, blockId, questionBanksHydrated, questionBankMetaHydrated]
  );

  // Task 12 review fix #1 — Tutor mode had no reachable on-switch anywhere
  // in the app (writeTutorModeEnabled was called from nowhere outside its
  // own test file). This is the last task in the build, so the toggle
  // lives here: initial state from the stored preference, writes back on
  // every change, and the resulting boolean is what actually drives
  // ExamSessionRunner's tutorModeEnabled prop below.
  const [tutorModeEnabled, setTutorModeEnabledState] = useState(() => readTutorModeEnabled());
  const toggleTutorMode = () => {
    setTutorModeEnabledState((prev) => {
      const next = !prev;
      writeTutorModeEnabled(next);
      return next;
    });
  };

  const handleLaunch = async (config) => {
    // Task 12 review fix #2 — in-flight guard: without this, a second click
    // on "Start exam" during the multi-second generation call fires a
    // second full (real-AI-cost) generation run and creates an orphaned
    // second session doc. ExamLaunchModal also disables its own button
    // while `launching`, but this early-return is the actual race-closer.
    if (launching) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const result = await launchExamSession(
        {
          userId,
          blockId,
          ...config,
          eligibleLectures,
          objectivesByLecture,
          atomsByLecture,
          lecturesById,
          lectures,
          weakConceptAccuracyByLecture,
          weakConcepts,
        },
        // C1 fix — no caller ever supplied the AI transport: `deps` defaulted
        // to `{}` all the way down to `generateMcqs`, so every generation
        // call threw and every launch failed with "Could not generate any
        // questions." Same DI pattern Shell.jsx uses for `startObjectiveQuiz`.
        { callAIJSON }
      );
      if (result.ok) {
        setShowLaunchModal(false);
        setActiveSessionId(result.sessionId);
        setLaunchWarning(
          result.generationErrors && result.generationErrors.length
            ? result.generationErrors.map((e) => e.message || String(e)).join(" ")
            : null
        );
      } else {
        setLaunchError(result.error || "Could not start the exam.");
      }
    } catch (err) {
      // Task 12 review fix #3 — neither this nor launchExamSession had a
      // try/catch around the parts that can genuinely throw (Firestore,
      // the AI client). Uncaught, `setLaunching(false)` below would never
      // run and the UI would be stuck showing "launching" with no
      // recovery short of a reload.
      setLaunchError(err?.message || "Something went wrong starting the exam.");
    } finally {
      setLaunching(false);
    }
  };

  if (activeSessionId) {
    return (
      <div>
        {launchWarning && (
          <div
            role="alert"
            className="m-3 rounded-lg border border-accent/40 bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-accent-text"
          >
            {launchWarning}
          </div>
        )}
        <ExamSessionRunner
          sessionId={activeSessionId}
          userId={userId}
          blockId={blockId}
          blockName={blockName}
          lectureLabelsByLectureId={lectureLabelsByLectureId}
          tutorModeEnabled={tutorModeEnabled}
          callAI={callAI}
          onExit={() => {
            setActiveSessionId(null);
            setLaunchWarning(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-text-1">Integrated Exam</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 font-mono text-[12px] text-text-3">
            <input type="checkbox" checked={tutorModeEnabled} onChange={toggleTutorMode} />
            Tutor mode
          </label>
          <Button
            onClick={() => {
              setLaunchError(null);
              setShowLaunchModal(true);
            }}
          >
            Start Integrated Exam
          </Button>
        </div>
      </div>

      {showLaunchModal && (
        <ExamLaunchModal
          blockId={blockId}
          userId={userId}
          eligibleLectures={eligibleLectures}
          defaultQuestionCount={defaultQuestionCount}
          onLaunch={handleLaunch}
          onCancel={() => setShowLaunchModal(false)}
          launching={launching}
        />
      )}

      {showLaunchModal && launchError && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit rounded-lg border border-bad/40 bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-bad shadow-xl"
        >
          {launchError}
        </div>
      )}

        <ExamDashboard
          blockId={blockId}
          userId={userId}
          lecturesById={lecturesById}
          objectives={objectives}
          onNavigateToLecture={onNavigateToLecture}
        />
    </div>
  );
}

export default ExamContainer;

/**
 * Task 12 — the "Integrated Exam" tab's top-level container.
 *
 * Owns view-state (launch modal / active session / dashboard) and assembles
 * every bit of data the earlier tasks' components need but don't fetch
 * themselves: eligible lectures, a sensible default question count, and the
 * lecture/objective/atom/weak-concept maps `launchExamSession` (Task 8)
 * threads through to allocation (Task 4) and generation (Task 5).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { startBackgroundJob } from "../../backgroundJobs.js";
import { launchQuestionBankSession } from "./launchQuestionBank.js";
import { examDurationMinutes } from "./examTiming.js";
import { callAI, callAIJSON } from "../../../aiClient.js";
import { createQuestionPool } from "../../../questionPool.js";
import { listExamSessions } from "../../../supabase.js";
import { cleanLectureTitle } from "../../../lectureTitle.js";
import { read as readLearnerEvidence } from "../../../stores/learnerEvidence.js";
import { buildFocusedRepairScope } from "./focusedRepair.js";

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
  const [launchProgress, setLaunchProgress] = useState(null);
  const [bankLaunching, setBankLaunching] = useState(null);
  const [questionReserve, setQuestionReserve] = useState({ ready: 0, loading: true });
  const [partialLaunch, setPartialLaunch] = useState(null);
  const [resumableSessions, setResumableSessions] = useState([]);
  const [bankAttempts, setBankAttempts] = useState([]);
  const [bankCategory, setBankCategory] = useState(null);
  const [bankStoreRevision, setBankStoreRevision] = useState(0);
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
          ...(lec.weekNumber != null ? { weekNumber: lec.weekNumber } : {}),
        })),
    [lectures, objectivesByLecture]
  );

  const questionBanksHydrated = useStoreHydrated(questionBanksStore, userId);
  const questionBankMetaHydrated = useStoreHydrated(questionBankMetaStore, userId);
  useEffect(() => {
    const refresh = () => setBankStoreRevision((value) => value + 1);
    const unsubBanks = questionBanksStore.subscribe(refresh);
    const unsubMeta = questionBankMetaStore.subscribe(refresh);
    return () => { unsubBanks?.(); unsubMeta?.(); };
  }, []);
  const defaultQuestionCount = useMemo(
    () => resolveDefaultQuestionCount(userId, blockId),
    // Same deliberate recompute-trigger pattern as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, blockId, questionBanksHydrated, questionBankMetaHydrated]
  );

  const blockQuestionBanks = useMemo(() => {
    const banks = questionBanksStore.read(userId) || {};
    const meta = questionBankMetaStore.read?.(userId) || {};
    const scoped = new Set(
      Object.values(meta)
        .filter((entry) => entry?.blockId === blockId && banks[entry.filename])
        .map((entry) => entry.filename)
    );
    const filenames = [...scoped];
    return filenames.sort((a, b) => cleanLectureTitle(a).localeCompare(cleanLectureTitle(b), undefined, { numeric: true })).map((filename) => {
      const entry = Object.values(meta).find((item) => item?.filename === filename);
      return { filename, questions: banks[filename] || [], aliases: entry?.aliases || [], assignedDate: entry?.assignedDate || null, weekNumber: entry?.weekNumber ?? null };
    });
    // Hydration flags deliberately trigger a fresh synchronous store read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, blockId, questionBanksHydrated, questionBankMetaHydrated, bankStoreRevision]);

  // Task 12 review fix #1 — Tutor mode had no reachable on-switch anywhere
  // in the app (writeTutorModeEnabled was called from nowhere outside its
  // own test file). This is the last task in the build, so the toggle
  // lives here: initial state from the stored preference, writes back on
  // every change, and the resulting boolean is what actually drives
  // ExamSessionRunner's tutorModeEnabled prop below.
  const [tutorModeEnabled, setTutorModeEnabledState] = useState(() => readTutorModeEnabled());

  const refreshQuestionReserve = async () => {
    if (!userId || !blockId) return;
    try {
      const summary = await createQuestionPool(userId, blockId).summary();
      setQuestionReserve({ ...summary, loading: false });
    } catch {
      setQuestionReserve((current) => ({ ...current, loading: false }));
    }
  };

  useEffect(() => {
    setQuestionReserve({ ready: 0, loading: true });
    refreshQuestionReserve();
    // The reserve is refreshed after each preparation run below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, blockId]);

  const refreshResumableSessions = async () => {
    if (!userId || !blockId) return;
    try {
      const sessions = await listExamSessions(userId, blockId, { status: "in_progress" });
      setResumableSessions(sessions.sort((a, b) => (b.updatedAt?.toMillis?.() || b.startedAt || 0) - (a.updatedAt?.toMillis?.() || a.startedAt || 0)));
    } catch {
      setResumableSessions([]);
    }
  };

  useEffect(() => {
    refreshResumableSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, blockId]);

  const refreshBankAttempts = async () => {
    if (!userId || !blockId) return;
    try {
      const submitted = await listExamSessions(userId, blockId, { status: "submitted" });
      setBankAttempts((submitted || []).filter((session) => session?.sourceType === "question-bank"));
    } catch {
      setBankAttempts([]);
    }
  };

  useEffect(() => {
    refreshBankAttempts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, blockId, activeSessionId]);

  const renameBank = (bank) => {
    const requested = window.prompt("Rename this practice set", cleanLectureTitle(bank.filename));
    const title = String(requested || "").trim().replace(/\s+/g, " ");
    if (!title) return;
    const extension = /\.pdf$/i.test(bank.filename) ? ".pdf" : "";
    const nextFilename = `${title.replace(/\.pdf$/i, "")}${extension}`;
    if (nextFilename === bank.filename) return;
    const banks = questionBanksStore.read(userId) || {};
    if (banks[nextFilename]) {
      setLaunchError("A practice set already uses that name.");
      return;
    }
    const nextBanks = { ...banks, [nextFilename]: banks[bank.filename] };
    delete nextBanks[bank.filename];
    questionBanksStore.write(userId, nextBanks);
    const meta = questionBankMetaStore.read(userId) || {};
    const nextMeta = Object.fromEntries(Object.entries(meta).map(([id, entry]) => [id,
      entry?.filename === bank.filename
        ? { ...entry, filename: nextFilename, aliases: [...new Set([...(entry.aliases || []), bank.filename])] }
        : entry
    ]));
    questionBankMetaStore.write(userId, nextMeta);
    setBankStoreRevision((value) => value + 1);
  };

  const scheduleBank = (bank) => {
    const requested = window.prompt("Assign a date (YYYY-MM-DD)", bank.assignedDate || "");
    if (requested == null) return;
    const assignedDate = requested.trim();
    if (assignedDate && !/^\d{4}-\d{2}-\d{2}$/.test(assignedDate)) {
      setLaunchError("Use a date in YYYY-MM-DD format.");
      return;
    }
    let weekNumber = null;
    if (assignedDate) {
      const target = new Date(`${assignedDate}T12:00:00`);
      const datedLectures = lectures.filter((lecture) => lecture?.weekNumber != null && (lecture.lectureDate || lecture.date));
      const startOfWeek = (date) => {
        const copy = new Date(date);
        const day = copy.getDay() || 7;
        copy.setDate(copy.getDate() - day + 1);
        return copy.toISOString().slice(0, 10);
      };
      const sameWeek = datedLectures.find((lecture) => {
        const date = new Date(`${lecture.lectureDate || lecture.date}T12:00:00`);
        return startOfWeek(target) === startOfWeek(date);
      });
      if (sameWeek) weekNumber = sameWeek.weekNumber;
      else if (datedLectures.length) {
        const nearest = [...datedLectures].sort((a, b) => {
          const distance = (lecture) => Math.abs(target - new Date(`${lecture.lectureDate || lecture.date}T12:00:00`));
          return distance(a) - distance(b);
        })[0];
        const anchor = new Date(`${nearest.lectureDate || nearest.date}T12:00:00`);
        weekNumber = Math.max(1, Number(nearest.weekNumber) + Math.round((target - anchor) / (7 * 86400000)));
      }
    }
    const meta = questionBankMetaStore.read(userId) || {};
    const next = Object.fromEntries(Object.entries(meta).map(([id, entry]) => [id,
      entry?.filename === bank.filename ? { ...entry, assignedDate: assignedDate || null, weekNumber } : entry
    ]));
    questionBankMetaStore.write(userId, next);
    setBankStoreRevision((value) => value + 1);
  };

  const bankGroups = useMemo(() => {
    const groups = {};
    for (const bank of blockQuestionBanks) {
      const title = cleanLectureTitle(bank.filename);
      const match = title.match(/\bweek\s*(\d+)\b/i);
      const label = bank.weekNumber != null
        ? `Week ${bank.weekNumber}`
        : match
          ? `Week ${match[1]}`
        : /\b(?:examsoft|esoft|imcq|exam)\b/i.test(title)
          ? "Exams"
          : /\b(?:homework|practice questions?|worksheet)\b/i.test(title)
            ? "Homework"
            : "Other";
      (groups[label] ||= []).push(bank);
    }
    return Object.entries(groups).map(([label, banks]) => [label, banks.sort((a, b) => cleanLectureTitle(a.filename).localeCompare(cleanLectureTitle(b.filename), undefined, { numeric: true }))]).sort(([a], [b]) => {
      const rank = (label) => label.startsWith("Week ") ? Number(label.slice(5)) : label === "Homework" ? 100 : label === "Exams" ? 101 : 102;
      return rank(a) - rank(b);
    });
  }, [blockQuestionBanks]);
  const activeBankCategory = bankGroups.some(([label]) => label === bankCategory) ? bankCategory : bankGroups[0]?.[0];

  const statsForBank = (bank) => {
    const names = new Set([bank.filename, ...(bank.aliases || [])]);
    const attempts = bankAttempts.filter((session) => names.has(session.sourceFile)).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    const scored = attempts.map((session) => {
      const answers = new Map((session.answers || []).map((answer) => [answer.questionId, answer]));
      const answered = (session.questions || []).filter((question) => answers.has(question.questionId));
      const correct = answered.filter((question) => answers.get(question.questionId)?.value === question.correct).length;
      const missed = answered.filter((question) => answers.get(question.questionId)?.value !== question.correct);
      return { session, answered: answered.length, correct, score: answered.length ? Math.round(correct / answered.length * 100) : null, missed };
    }).filter((item) => item.score !== null);
    const latest = scored.at(-1);
    return { attempts: scored.length, history: scored, latest, improvement: scored.length > 1 ? latest.score - scored[0].score : null };
  };
  const toggleTutorMode = () => {
    setTutorModeEnabledState((prev) => {
      const next = !prev;
      writeTutorModeEnabled(next);
      return next;
    });
  };

  const prepareQuestions = (config) => {
    let scopedLectures = config.weekNumber != null
      ? eligibleLectures.filter((lecture) => String(lecture.weekNumber) === String(config.weekNumber))
      : eligibleLectures;
    let scopedObjectives = objectivesByLecture;
    if (config.studyMode === "repair") {
      const focus = buildFocusedRepairScope({ eligibleLectures: scopedLectures, objectivesByLecture, weakConcepts, learnerEvidence: readLearnerEvidence(userId), blockId });
      scopedLectures = focus.eligibleLectures;
      scopedObjectives = focus.objectivesByLecture;
    }
    setShowLaunchModal(false);
    startBackgroundJob({ label: "Preparing exam questions", detail: "Checking saved questions…",
      run: async report => {
        const result = await launchExamSession({ userId, blockId, ...config, prepareOnly: true,
          eligibleLectures: scopedLectures, objectivesByLecture: scopedObjectives, atomsByLecture, lecturesById, lectures,
          weakConceptAccuracyByLecture, weakConcepts },
          { callAIJSON, onProgress: p => report(`${p.completed || 0}/${p.total || config.questionCount} ready · ${p.message}`) });
        if (!result.ok) throw new Error(result.error);
        await refreshQuestionReserve();
        return `${result.prepared}/${config.questionCount} questions saved in Firestore. Start an exam when ready.${result.generationErrors?.length ? " Some slots still need generation." : ""}`;
      },
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
    setPartialLaunch(null);
    setLaunchProgress({ message: "Checking exam storage access…", completed: 0 });
    try {
      let scopedLectures = config.weekNumber != null
        ? eligibleLectures.filter((lecture) => String(lecture.weekNumber) === String(config.weekNumber))
        : eligibleLectures;
      let scopedObjectives = objectivesByLecture;
      if (config.studyMode === "repair") {
        const focus = buildFocusedRepairScope({ eligibleLectures: scopedLectures, objectivesByLecture, weakConcepts, learnerEvidence: readLearnerEvidence(userId), blockId });
        scopedLectures = focus.eligibleLectures;
        scopedObjectives = focus.objectivesByLecture;
        if (!scopedLectures.length) throw new Error("No weak objectives need focused repair right now. Use a balanced exam to build more evidence.");
      }
      const result = await launchExamSession(
        {
          userId,
          blockId,
          ...config,
          eligibleLectures: scopedLectures,
          objectivesByLecture: scopedObjectives,
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
        { callAIJSON, onProgress: setLaunchProgress }
      );
      if (result.ok) {
        await refreshQuestionReserve();
        setShowLaunchModal(false);
        setActiveSessionId(result.sessionId);
        setLaunchWarning(
          result.generationErrors && result.generationErrors.length
            ? result.generationErrors.map((e) => e.message || String(e)).join(" ")
            : null
        );
      } else {
        setLaunchError(result.error || "Could not start the exam.");
        if (result.canStartSaved && result.readyCount > 0) {
          setPartialLaunch({ config, readyCount: result.readyCount });
        }
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

  const handleBankLaunch = async (bank, format) => {
    if (bankLaunching) return;
    setBankLaunching(`${bank.filename}:${format}`);
    setLaunchError(null);
    try {
      const result = await launchQuestionBankSession({
        userId,
        blockId,
        filename: bank.filename,
        questions: bank.questions,
        format,
      });
      if (result.ok) setActiveSessionId(result.sessionId);
      else setLaunchError(result.error || "Could not start this question bank.");
    } catch (err) {
      setLaunchError(err?.message || "Could not start this question bank.");
    } finally {
      setBankLaunching(null);
    }
  };

  if (activeSessionId) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-5">
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
            refreshResumableSessions();
            refreshBankAttempts();
          }}
        />
      </div>
    );
  }

  return (
    <div className="desk-page desk-exam mx-auto w-full max-w-6xl p-4 sm:p-5">
      <div className="desk-page-heading mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-1">Integrated exam center</h2>
          <p className="mt-1 text-sm text-text-3">School banks for faithful practice. Integrated exams for fresh readiness checks.</p>
        </div>
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
          progress={launchProgress}
          error={launchError}
          partialLaunch={partialLaunch}
          onStartSaved={() => handleLaunch({ ...partialLaunch.config, savedOnly: true })}
          onPrepare={prepareQuestions}
        />
      )}

      {launchError && !showLaunchModal && (
        <div role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-bad">
          {launchError}
        </div>
      )}

      {resumableSessions.length > 0 && <section className="mb-4 rounded-xl border border-accent bg-bg-elevated p-4">
        <div className="text-sm font-bold text-text-1">Continue an unfinished session</div>
        <p className="mt-1 text-sm text-text-2">Answers are saved after every selection. Timed-exam clocks continue while you are away.</p>
        <div className="mt-3 space-y-2">{resumableSessions.map(session => <div key={session.sessionId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-panel p-3">
          <div>
            <div className="font-semibold text-text-1">{session.format === "exam" ? "Timed exam" : "Practice session"}</div>
            <div className="text-sm text-text-3">{session.answers?.length || 0}/{session.questions?.length || 0} answered</div>
          </div>
          <Button onClick={() => setActiveSessionId(session.sessionId)}>Resume</Button>
        </div>)}</div>
      </section>}

      <section className="mb-4 grid gap-3 rounded-xl border border-border bg-bg-elevated p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="text-sm font-bold text-text-1">Prepared question reserve</div>
          <p className="mt-1 text-sm text-text-2">
            Generate while credits are available. Saved questions stay private in Firestore and can be used later without regenerating them.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-panel px-4 py-3 text-center">
          <div className="text-2xl font-bold text-text-1">{questionReserve.loading ? "…" : questionReserve.ready}</div>
          <div className="font-mono text-[11px] uppercase tracking-wide text-text-3">ready questions</div>
          {!questionReserve.loading && questionReserve.ready > 0 && (
            <Button className="mt-2" disabled={launching} onClick={() => handleLaunch({
              format: "exam",
              questionCount: Math.min(100, questionReserve.ready),
              durationMinutes: examDurationMinutes(Math.min(100, questionReserve.ready)),
              savedOnly: true,
            })}>Start saved exam</Button>
          )}
        </div>
      </section>

      {blockQuestionBanks.length > 0 && (
        <section className="mb-4 rounded-xl border border-border bg-bg-elevated p-3">
          <div className="mb-1 text-sm font-bold text-text-1">Original school question banks</div>
          <div className="mb-3 font-mono text-[11px] text-text-3">
            Authentic uploaded questions. Timed sessions use 90 seconds per question; practice reveals the keyed rationale after each answer.
          </div>
          <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="School question bank categories">
            {bankGroups.map(([group]) => <button key={group} type="button" role="tab" aria-selected={activeBankCategory === group} onClick={() => setBankCategory(group)} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold ${activeBankCategory === group ? "border-accent text-accent-text" : "border-transparent text-text-3 hover:text-text-1"}`}>{group}</button>)}
          </div>
          <div className="space-y-2">
            {(bankGroups.find(([group]) => group === activeBankCategory)?.[1] || []).map((bank) => {
              const minutes = examDurationMinutes(bank.questions.length);
              const expectedCount = /examsoftpractice/i.test(cleanLectureTitle(bank.filename)) ? 30 : null;
              const incomplete = expectedCount && bank.questions.length < expectedCount;
              const stats = statsForBank(bank);
              return (
                <div key={bank.filename} className="flex flex-col gap-2 rounded-lg border border-border bg-panel px-3 py-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-1">{cleanLectureTitle(bank.filename)}</div>
                    <div className="font-mono text-[11px] text-text-3">{bank.questions.length} questions · {minutes} min timed{bank.assignedDate ? ` · assigned ${bank.assignedDate}` : ""} · {stats.attempts} attempt{stats.attempts === 1 ? "" : "s"}{stats.latest ? ` · latest ${stats.latest.score}%` : ""}{stats.improvement != null ? ` · ${stats.improvement >= 0 ? "+" : ""}${stats.improvement}% change` : ""}</div>
                    {stats.latest?.missed?.length > 0 && <div className="mt-1 text-[11px] text-text-2">Mental-model repair: {stats.latest.missed.length} missed concept{stats.latest.missed.length === 1 ? "" : "s"}</div>}
                    {stats.attempts > 0 && <details className="mt-2 text-xs text-text-2">
                      <summary className="cursor-pointer font-semibold">Attempt history · {stats.attempts}</summary>
                      <div className="mt-2 flex flex-wrap gap-2">{stats.history.map((attempt, index) => <Button key={attempt.session.sessionId || attempt.session.id} variant="outline" onClick={() => setActiveSessionId(attempt.session.sessionId || attempt.session.id)}>Review attempt {index + 1} · {attempt.score}%</Button>)}</div>
                    </details>}
                    {incomplete && <div className="mt-1 text-[11px] font-bold text-bad">⚠ Incomplete import: {bank.questions.length}/{expectedCount}. Re-upload this PDF once to replace the old parse.</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" disabled={!!bankLaunching} onClick={() => renameBank(bank)}>Rename</Button>
                    <Button variant="ghost" disabled={!!bankLaunching} onClick={() => scheduleBank(bank)}>{bank.assignedDate ? "Change date" : "Assign date"}</Button>
                    {stats.latest && <Button variant="ghost" onClick={() => setActiveSessionId(stats.latest.session.sessionId || stats.latest.session.id)}>Review latest</Button>}
                    <Button variant="outline" disabled={!!bankLaunching} onClick={() => handleBankLaunch(bank, "practice")}>Practice</Button>
                    <Button disabled={!!bankLaunching} onClick={() => handleBankLaunch(bank, "exam")}>Timed quiz</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

        <ExamDashboard
          blockId={blockId}
          userId={userId}
          lecturesById={lecturesById}
          objectives={objectives}
          onNavigateToLecture={onNavigateToLecture}
          onReviewSession={setActiveSessionId}
        />
    </div>
  );
}

export default ExamContainer;

import { PracticeModeTabs } from "../lectures/PracticeModeTabs.jsx";
import {SourceUseAdmin} from '../../SourceUseAdmin.jsx';
import {MissedQuestions} from '../../../ui/MissedQuestions.jsx';
import {ReadinessValidation} from './ReadinessValidation.jsx';
import * as sourceUseStore from '../../../stores/sourceUse.js';
import {isEvaluationReserved} from '../../../engine/sourceUse.js';
import {subscribeExamSessionChanges} from "../../../examSessionChanges.js";
import {MissedPracticeActions} from "./MissedPracticeActions.jsx";
import {useQuestionPractice} from "../../hooks/useQuestionPractice.js";
import {SchoolAlignmentPanel} from "../today/SchoolAlignmentPanel.jsx";
import {questionProgress} from "./questionProgress.js";
import {missedBankQuestions} from "./missedBankQuestions.js";
import * as questionRatingsStore from "../../../stores/questionRatings.js";
import {QuestionBankMappingStatus} from './QuestionBankMappingStatus.jsx';
import { RelinkQuestionBanks } from './RelinkQuestionBanks.jsx';
import { QuestionBankManualLinks } from "./QuestionBankManualLinks.jsx";
import { ScoreReportUpload } from "./ScoreReportUpload.jsx";
import { HighYieldPanel } from "./HighYieldPanel.jsx";
import { TopicPractice } from "./TopicPractice.jsx";
import { selectMixedExamQuestions } from "./mixedExam.js";
import { readPreference, writePreference } from "../../../browserStorage.js";
import { blockBlueprintContext, blockBlueprintBanks } from "./blueprintScope.js";
import { BpmBlueprintDashboard } from "./BpmBlueprintDashboard.jsx";
import { recoverExamPreparation } from "./preparationRecovery.js";
import { generateExamQuestions } from "./generation.js";
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
import { useLectureQuestionStats } from "../../hooks/useLectureQuestionStats.js";
import { dedupeByText, selectBlockObjectives } from "../../logic/objectives.js";
import { useObjectivesWithParts } from "../../hooks/useObjectiveParts.js";
import { ensureObjectiveParts } from "../objectives/objectivePartsLoader.js";
import { statsForLecture } from "../../../stores/lectureQuestionStats.js";
import * as weakConceptsStore from "../../../stores/weakConcepts.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../../stores/questionBankMeta.js";
import * as questionBankAnalysisStore from "../../../stores/questionBankAnalysis.js";
import { readTutorModeEnabled, writeTutorModeEnabled } from "./tutorPrefs.js";
import { ExamLaunchModal } from "./ExamLaunchModal.jsx";
import { ExamSessionRunner } from "./ExamSessionRunner.jsx";
import { ExamDashboard } from "./ExamDashboard.jsx";
import { WeakConcepts } from "../tracker/WeakConcepts.jsx";
import { launchExamSession } from "./launchExam.js";
import { startBackgroundJob } from "../../backgroundJobs.js";
import { launchQuestionBankSession } from "./launchQuestionBank.js";
import { examDurationMinutes } from "./examTiming.js";
import { callAI, callAIJSON } from "../../../aiClient.js";
import { createQuestionPool } from "../../../questionPool.js";
import { listExamSessions, updateExamSessionTransaction } from "../../../firebaseData.js";
import {releaseUnansweredQuestions} from '../../../questionPool.js';
import { cleanLectureTitle, formatLectureLabel } from "../../../lectureTitle.js";
import * as learnerEvidenceStore from "../../../stores/learnerEvidence.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { read as readLearnerEvidence } from "../../../stores/learnerEvidence.js";
import { buildFocusedRepairScope } from "./focusedRepair.js";
import { sourceLabel } from "../../logic/questionBankAnalysis.js";
import { filterLecturesByScope } from "../../logic/weekScope.js";
import { namePreparedReplacementAttempt } from "./preparedSetNaming.js";
import { updateQuestionBankMetadata } from "../../logic/questionBankMetadataEdits.js";
import { prepareBankQuestionSet, scoreAnsweredQuestions } from "./questionBankLinks.js";
import { BPM_BLUEPRINTS, questionSlot } from "./bpmBlueprint.js";
import { listedForBlock } from '../../logic/bankExamBlocks.js';
import { BankExamMaterial } from './BankExamMaterial.jsx';

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

function preparedSetEditDraft(set) {
  const scope = set.contentScope || (set.weekNumber != null ? `week:${set.weekNumber}` : "block-so-far");
  const dateMatch = /^date-range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(scope);
  return {
    examName: set.examName || (set.format === "exam" ? "Timed exam" : "Practice quiz"),
    scopeMode: dateMatch ? "date-range" : /^\d+$/.test(String(scope)) || /^week:\d+$/.test(scope) ? `week:${String(scope).replace(/^week:/, "")}` : "block-so-far",
    rangeStart: dateMatch?.[1] || "",
    rangeEnd: dateMatch?.[2] || "",
  };
}

function isValidCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Block-wide mixed timed exam from the block's own school questions. */
function MixedExamCard({ blockId, blockName, banks, busy, isReserved, onStart }) {
  const [count, setCount] = useState(40);
  // Today's "Set up mixed exam" sets a one-shot highlight, cleared once the card has shown it.
  const [highlight] = useState(() => readPreference(`rxt-exam-mixed:${blockId}`) === "1");
  const preview = useMemo(() => selectMixedExamQuestions(banks, { count, isReserved }), [banks, count, isReserved]);
  const shown = preview.available > 0;
  useEffect(() => { if (highlight && shown) writePreference(`rxt-exam-mixed:${blockId}`, ""); }, [highlight, shown, blockId]);
  if (!preview.available) return null;
  return <section aria-label="Mixed timed exam" className={`mb-4 rounded-xl border bg-bg-elevated p-4 ${highlight ? "border-2 border-accent" : "border-border"}`}>
    <h2 className="text-sm font-bold text-text-1">Mixed timed exam · {blockName || "this block"}</h2>
    <p className="mt-1 text-sm text-text-2">Keyed school questions from {preview.lectures} lectures, spread evenly and shuffled, at 72 seconds each. {preview.available} available.</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="text-sm">Questions <select aria-label="Mixed exam length" value={count} onChange={(event) => setCount(Number(event.target.value))} className="rounded border border-border bg-bg p-1">{[20, 40, 60, 80].map((n) => <option key={n} value={n} disabled={n > preview.available && n !== 20}>{n}</option>)}</select></label>
      <Button disabled={busy || !preview.questions.length} onClick={() => onStart(selectMixedExamQuestions(banks, { count, isReserved }).questions)}>Start {Math.min(count, preview.available)}-question timed exam</Button>
    </div>
  </section>;
}

export function ExamContainer({ blockId, blockName, userId, onNavigateToLecture, initialSessionId = null, onInitialSessionOpened = null }) {
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);
  useEffect(() => { if (initialSessionId) onInitialSessionOpened?.(); }, [initialSessionId, onInitialSessionOpened]);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [launchProgress, setLaunchProgress] = useState(null);
  const [bankLaunching, setBankLaunching] = useState(null);
  const [bankEditBusy, setBankEditBusy] = useState(false);
  const [questionReserve, setQuestionReserve] = useState({ ready: 0, loading: true });
  const [preparedSets, setPreparedSets] = useState([]);
  const [confirmDeleteSetId, setConfirmDeleteSetId] = useState(null);
  const [editingPreparedSetId, setEditingPreparedSetId] = useState(null);
  const [preparedSetDraft, setPreparedSetDraft] = useState(null);
  const [savingPreparedSet, setSavingPreparedSet] = useState(false);
  const [preparedSetEditError, setPreparedSetEditError] = useState(null);
  const [deleteSetError, setDeleteSetError] = useState(null);
  const [deletingSet, setDeletingSet] = useState(false);
  const [partialLaunch, setPartialLaunch] = useState(null);
  const [resumableSessions, setResumableSessions] = useState([]);
  const [bankAttempts, setBankAttempts] = useState([]);
  const [validationSessions,setValidationSessions]=useState([]);
  const [validationLoading,setValidationLoading]=useState(true);
  const [validationError,setValidationError]=useState(null);
  const [bankCategory, setBankCategory] = useState(null);
  const [examPageSection, setExamPageSection] = useState(() => {
    try {
      const saved = localStorage.getItem(`rxt-exam-page:${blockId}`);
      return saved === "validation" ? "results" : ["start", "highyield", "banks", "results", "weak", "missed"].includes(saved) ? saved : "start";
    } catch { return "start"; }
  });
  const [bankStoreRevision, setBankStoreRevision] = useState(0);
  // I4 fix — `launchExamSession`'s `generationErrors` (a per-lecture
  // generation shortfall after retries) was computed and returned but never
  // read; surfaced here as a brief, dismissable warning once the user is in
  // the session, rather than silently dropped.
  const [launchWarning, setLaunchWarning] = useState(null);
  const [generationCoverage, setGenerationCoverage] = useState(null);
  const [selectedBlueprint, setSelectedBlueprint] = useState("");
  const [launchStudyMode, setLaunchStudyMode] = useState("balanced");
  const [launchTarget, setLaunchTarget] = useState({ objectiveIds: [], focusNotes: "" });
  const [launchKind, setLaunchKind] = useState("");

  const openExamLaunch = ({ studyMode = "balanced", blueprint = "", objectiveIds = [], focusNotes = "", kind = "" } = {}) => {
    setLaunchError(null);
    setLaunchKind(kind);
    setSelectedBlueprint(String(blueprint));
    setLaunchStudyMode(studyMode);
    setLaunchTarget({ objectiveIds, focusNotes });
    setShowLaunchModal(true);
  };

  const selectExamPageSection = (section) => {
    setExamPageSection(section);
    try { localStorage.setItem(`rxt-exam-page:${blockId}`, section); } catch { /* optional preference */ }
  };

  const weakTopicTargets = (topic) => {
    const items = topic?.items || (topic ? [topic] : []);
    const rawLectureIds = [...new Set(items.flatMap(item => item?.linkedLecIds || []).filter(Boolean))];
    const explicitObjectiveIds = [...new Set(items.flatMap(item => [
      ...(item?.objectiveIds || []),
      item?.linkedObjId,
    ]).filter(Boolean))];
    const lectureIds = rawLectureIds.filter(lectureId => lecturesById[lectureId] || objectivesByLecture[lectureId]?.length);
    for (const objectiveId of explicitObjectiveIds) {
      const linkedLectureId = objectivesById[objectiveId]?.linkedLecId;
      if (linkedLectureId && !lectureIds.includes(linkedLectureId)) lectureIds.push(linkedLectureId);
    }
    if (!lectureIds.length) {
      const labels = items.flatMap(item => item?.lectureLabels || []).filter(Boolean);
      const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      for (const label of labels) {
        const wanted = normalize(label);
        const match = lectures.find(lecture => {
          const candidate = normalize(formatLectureLabel(lecture));
          return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
        });
        if (match?.id && !lectureIds.includes(match.id)) lectureIds.push(match.id);
      }
    }
    const currentObjectiveIds = new Set(lectureIds.flatMap(lectureId =>
      (objectivesByLecture[lectureId] || []).map(objective => objective?.id || objective?.code).filter(Boolean)
    ));
    const validExplicitObjectiveIds = explicitObjectiveIds.filter(objectiveId => currentObjectiveIds.has(objectiveId));
    const fallbackObjectiveIds = lectureIds.flatMap(lectureId =>
      (objectivesByLecture[lectureId] || []).map(objective => objective?.id || objective?.code).filter(Boolean)
    );
    return {
      lectureIds,
      objectiveIds: validExplicitObjectiveIds.length ? validExplicitObjectiveIds : [...new Set(fallbackObjectiveIds)],
    };
  };

  const studyWeakTopic = (topic) => {
    const { lectureIds, objectiveIds } = weakTopicTargets(topic);
    if (!lectureIds[0]) {
      setLaunchError(`“${topic?.concept || "This concept"}” needs a verified lecture link before its study page can open.`);
      return;
    }
    onNavigateToLecture?.(lectureIds[0], { focusObjectiveIds: objectiveIds, weakConcept: topic?.concept });
  };

  const quizWeakTopic = (topic) => {
    const { objectiveIds } = weakTopicTargets(topic);
    if (!objectiveIds.length) {
      setLaunchError(`“${topic?.concept || "This concept"}” needs a verified objective link before a focused quiz can start.`);
      return;
    }
    const count = 5;
    handleLaunch({
      format: "practice",
      questionCount: count,
      durationMinutes: examDurationMinutes(count),
      examName: `Weak concept · ${topic.concept} · ${count} questions`,
      focusNotes: `Test this weak concept specifically: ${topic.concept}. Use fresh second- or third-order Step 1-style applications tied to the linked lecture objectives.`,
      studyMode: "repair",
      targetObjectiveIds: objectiveIds,
      includeSeen: false,
      startWhilePreparing: true,
    });
  };

  const lecturesRes = useLectures(blockId, userId);
  const objectivesRes = useObjectives(null, userId);
  const blueprintEvidenceRes = useStoreResource(learnerEvidenceStore, userId);
  const sourceUseRes=useStoreResource(sourceUseStore,userId);
  const questionRatingsRes = useStoreResource(questionRatingsStore, userId);
  const questionStats = useLectureQuestionStats(userId);
  const practiceHistory = useQuestionPractice(userId,blockId);

  const lectures = useMemo(() => lecturesRes.data || [], [lecturesRes.data]);
  const completedQuestionTotal = useMemo(() => questionProgress(practiceHistory.studyAnswers,practiceHistory.sessions,{},practiceHistory.manualEntries,practiceHistory.historicalStudy).answered, [practiceHistory.studyAnswers,practiceHistory.sessions,practiceHistory.manualEntries,practiceHistory.historicalStudy]);

  const blockObjectives = useMemo(
    () => dedupeByText(selectBlockObjectives(objectivesRes.data, blockId)),
    [objectivesRes.data, blockId]
  );
  // Objective parts (engine/objectiveParts.js): dashboards, readiness and the
  // exam writer all see which lecture elements of each objective are untested.
  const objectives = useObjectivesWithParts(userId, blockObjectives, blueprintEvidenceRes.data?.learningJournal);

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
      map[id] = formatLectureLabel(lec);
    }
    return map;
  }, [lecturesById]);

  const objectivesById = useMemo(() => Object.fromEntries(
    objectives.filter((objective) => objective?.id || objective?.code).map((objective) => [objective.id || objective.code, objective])
  ), [objectives]);

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

  // Metadata may be chunk-light; generation hydrates cloud content on demand.
  const atomsByLecture = useMemo(() => Object.fromEntries(lectures.map(lecture =>
    [lecture.id, Array.isArray(lecture.atoms) ? lecture.atoms : []]
  )), [lectures]);

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
          lectureLabel: formatLectureLabel(lec),
          objectiveCount: objectivesByLecture[lec.id].length,
          ...(lec.lectureDate || lec.date ? { lectureDate: lec.lectureDate || lec.date } : {}),
          ...(lec.weekNumber != null ? { weekNumber: lec.weekNumber } : {}),
        })),
    [lectures, objectivesByLecture]
  );

  const blueprintContext = useMemo(
    () => blockBlueprintContext(blockId, lectures, objectivesRes.data || {}, blueprintEvidenceRes.data || {}),
    [blockId, lectures, objectivesRes.data, blueprintEvidenceRes.data]
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
    const scoped = new Set(Object.values(meta).filter((entry) => listedForBlock(entry, blockId) && banks[entry.filename]).map((entry) => entry.filename));
    // Older uploads can have questions stamped with a block but no surviving
    // metadata row. Keep them visible instead of hiding a valid homework bank.
    for (const [filename, questions] of Object.entries(banks)) {
      if (questions?.some((question) => question?.blockId === blockId)) scoped.add(filename);
    }
    const filenames = [...scoped];
    return filenames.sort((a, b) => cleanLectureTitle(a).localeCompare(cleanLectureTitle(b), undefined, { numeric: true })).map((filename) => {
      const entry = Object.values(meta).find((item) => item?.filename === filename);
      const questions = banks[filename] || [];
      return { filename, questions, aliases: entry?.aliases || [], displayName: entry?.displayName || "", assignedDate: entry?.assignedDate || null, weekNumber: entry?.weekNumber ?? null, sourceKind: entry?.sourceKind || questions[0]?.sourceKind || "school", expectedQuestions: entry?.expectedQuestions ?? null, analysis: questionBankAnalysisStore.read(userId, filename), blockId: entry?.blockId || questions.find((question) => question?.blockId)?.blockId || null };
    });
    // Hydration flags deliberately trigger a fresh synchronous store read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, blockId, questionBanksHydrated, questionBankMetaHydrated, bankStoreRevision]);

  // IMCQ keys are cross-block style references. Keep them available as one
  // compact "Other" category, while leaving unrelated ExamSoft/comprehensive
  // banks archived unless they belong to the active block.
  const imcqReferenceBanks = useMemo(() => {
    const banks = questionBanksStore.read(userId) || {};
    const meta = questionBankMetaStore.read?.(userId) || {};
    const current = new Set(blockQuestionBanks.map((bank) => bank.filename));
    return Object.keys(banks).filter((filename) => {
      if (current.has(filename)) return false;
      const entry = Object.values(meta).find((item) => item?.filename === filename);
      const sourceKind = entry?.sourceKind || banks[filename]?.[0]?.sourceKind || "";
      // School-bank practice is block-scoped by default. Cross-block IMCQ
      // decks belong in a separately requested comprehensive review, not in
      // every current block's exam center.
      return entry?.blockId === blockId && (sourceKind === "imcq" || /\bimcq\b/i.test(cleanLectureTitle(filename)));
    }).map((filename) => {
      const entry = Object.values(meta).find((item) => item?.filename === filename);
      const questions = banks[filename] || [];
      return { filename, questions, aliases: entry?.aliases || [], displayName: entry?.displayName || "", assignedDate: entry?.assignedDate || null, weekNumber: entry?.weekNumber ?? null, sourceKind: entry?.sourceKind || questions[0]?.sourceKind || "imcq", analysis: questionBankAnalysisStore.read(userId, filename), blockId: entry?.blockId || null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, questionBanksHydrated, questionBankMetaHydrated, bankStoreRevision, blockQuestionBanks]);

  useEffect(() => {
    const filenames = Object.keys(questionBanksStore.read(userId) || {});
    const refresh = () => setBankStoreRevision((value) => value + 1);
    const unsubs = filenames.map((filename) => questionBankAnalysisStore.subscribe(filename, refresh));
    return () => unsubs.forEach((unsubscribe) => unsubscribe?.());
  }, [userId, questionBanksHydrated, questionBankMetaHydrated]);

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

  const refreshPreparedSets = async () => {
    if (!userId || !blockId) return;
    try { setPreparedSets(await createQuestionPool(userId, blockId).preparedSets()); }
    catch { setPreparedSets([]); }
  };

  const deletePreparedSet = async (set) => {
    if (!set?.id || deletingSet) return;
    setDeletingSet(true);
    setDeleteSetError(null);
    try {
      const result = await createQuestionPool(userId, blockId).deletePreparedSet(set.id);
      if (!result?.ok) throw new Error(result?.error || "Could not delete this prepared set.");
      setConfirmDeleteSetId(null);
      await Promise.all([refreshPreparedSets(), refreshQuestionReserve()]);
    } catch (error) {
      setDeleteSetError(error?.message || "Could not delete this prepared set.");
    } finally {
      setDeletingSet(false);
    }
  };

  const editPreparedSet = (set) => {
    setPreparedSetEditError(null);
    setPreparedSetDraft(preparedSetEditDraft(set));
    setEditingPreparedSetId(set.id);
  };

  const savePreparedSet = async (set) => {
    if (!preparedSetDraft || savingPreparedSet) return;
    const examName = preparedSetDraft.examName.trim().replace(/\s+/g, " ");
    if (!examName) { setPreparedSetEditError("Enter a name for this quiz or exam."); return; }
    let contentScope = "block-so-far";
    let weekNumber = null;
    if (preparedSetDraft.scopeMode === "date-range") {
      const { rangeStart, rangeEnd } = preparedSetDraft;
      if (!isValidCalendarDate(rangeStart) || !isValidCalendarDate(rangeEnd) || rangeStart > rangeEnd) {
        setPreparedSetEditError("Choose a valid start and end date, with the start date first.");
        return;
      }
      contentScope = `date-range:${rangeStart}:${rangeEnd}`;
    } else if (preparedSetDraft.scopeMode.startsWith("week:")) {
      weekNumber = Number(preparedSetDraft.scopeMode.slice(5));
      if (!Number.isInteger(weekNumber) || weekNumber < 1) { setPreparedSetEditError("Choose a valid week."); return; }
    }
    setSavingPreparedSet(true);
    setPreparedSetEditError(null);
    try {
      await createQuestionPool(userId, blockId).updatePreparedSetMetadata(set.id, { examName, contentScope, weekNumber });
      await refreshPreparedSets();
      setEditingPreparedSetId(null);
      setPreparedSetDraft(null);
    } catch (error) {
      setPreparedSetEditError(error?.message || "Could not save this quiz or exam.");
    } finally { setSavingPreparedSet(false); }
  };

  useEffect(() => {
    setQuestionReserve({ ready: 0, loading: true });
    refreshQuestionReserve();
    refreshPreparedSets();
    // The reserve and named prepared sets are refreshed after preparation/launch.
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
    setValidationLoading(true);setValidationError(null);
    try {
      const submitted = await listExamSessions(userId, blockId, { status: "submitted" });
      setValidationSessions(submitted||[]);
      setBankAttempts((submitted || []).filter((session) => session?.sourceType === "question-bank"));
    } catch (error) {
      setValidationError(error.message||'Could not load saved test evidence.');
      setBankAttempts([]);
    } finally {setValidationLoading(false);}
  };

  useEffect(() => {
    refreshBankAttempts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, blockId, activeSessionId]);

  const renameBank = async (bank) => {
    const requested = window.prompt("Rename this practice set", bank.displayName || cleanLectureTitle(bank.filename));
    if (requested == null) return;
    const displayName = String(requested).trim().replace(/\s+/g, " ");
    if (!displayName) { setLaunchError("Enter a name for this practice set."); return; }
    if (displayName === (bank.displayName || cleanLectureTitle(bank.filename))) return;
    setBankEditBusy(true);
    setLaunchError(null);
    try {
      await updateQuestionBankMetadata(userId, bank, { displayName }, questionBankMetaStore);
      setBankStoreRevision((value) => value + 1);
    } catch (error) {
      setLaunchError(`Could not save the practice-set name: ${error?.message || String(error)}`);
    } finally { setBankEditBusy(false); }
  };

  const scheduleBank = async (bank) => {
    const requested = window.prompt("Assign a date (YYYY-MM-DD)", bank.assignedDate || "");
    if (requested == null) return;
    const assignedDate = requested.trim();
    if (assignedDate && !/^\d{4}-\d{2}-\d{2}$/.test(assignedDate)) {
      setLaunchError("Use a date in YYYY-MM-DD format.");
      return;
    }
    if (assignedDate) {
      const parsedDate = new Date(`${assignedDate}T12:00:00`);
      const [year, month, day] = assignedDate.split("-").map(Number);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month - 1 || parsedDate.getDate() !== day) {
        setLaunchError("Choose a valid calendar date.");
        return;
      }
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
    setBankEditBusy(true);
    setLaunchError(null);
    try {
      await updateQuestionBankMetadata(userId, bank, { assignedDate: assignedDate || null, weekNumber }, questionBankMetaStore);
      setBankStoreRevision((value) => value + 1);
    } catch (error) {
      setLaunchError(`Could not save the practice-set date: ${error?.message || String(error)}`);
    } finally { setBankEditBusy(false); }
  };

  const bankGroups = useMemo(() => {
    // The Exam tab is block-scoped. IMCQ keys are the intentional exception:
    // they are style references and appear together under Other. Other-block
    // ExamSoft/comprehensive banks remain archived in Firestore.
    const source = [...blockQuestionBanks, ...imcqReferenceBanks];
    const groups = {};
    for (const bank of source) {
      const title = cleanLectureTitle(bank.filename);
      const match = title.match(/\bweek\s*(\d+)\b/i);
      const isImcq = bank.sourceKind === "imcq" || /\bimcq\b/i.test(title);
      const isExamSoft = /\b(?:examsoft|esoft)\b/i.test(title);
      const label = isImcq || isExamSoft
        ? "Other"
        : bank.weekNumber != null
        ? `Week ${bank.weekNumber}`
        : match
          ? `Week ${match[1]}`
        : /\bexam\b/i.test(title)
          ? "Other"
          : /\b(?:homework|practice questions?|worksheet)\b/i.test(title)
            ? "Homework"
            : "Other";
      (groups[label] ||= []).push(bank);
    }
    return Object.entries(groups).map(([label, banks]) => [label, banks.sort((a, b) => cleanLectureTitle(a.filename).localeCompare(cleanLectureTitle(b.filename), undefined, { numeric: true }))]).sort(([a], [b]) => {
      const rank = (label) => label.startsWith("Week ") ? Number(label.slice(5)) : label === "Homework" ? 100 : label === "Exams" ? 101 : 102;
      return rank(a) - rank(b);
    });
  }, [blockQuestionBanks, imcqReferenceBanks]);
  const activeBankCategory = bankGroups.some(([label]) => label === bankCategory) ? bankCategory : bankGroups[0]?.[0];
  useEffect(()=>{
    const refresh=()=>{refreshResumableSessions();refreshBankAttempts();};
    const off=subscribeExamSessionChanges(change=>{if(change.userId===userId&&(!change.blockId||change.blockId===blockId))refresh();});
    window.addEventListener('focus',refresh);const timer=setInterval(refresh,60000);
    return()=>{off();window.removeEventListener('focus',refresh);clearInterval(timer);};
    // Refreshers read this account and block only; state writes do not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[userId,blockId]);
  const statsForBank = (bank) => {
    const names = new Set([bank.filename, ...(bank.aliases || [])]);
    const attempts = bankAttempts.filter((session) => names.has(session.sourceFile) && session.purpose!=="reserved-assessment").sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
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

  const allBlueprintBanks = () => {
    const banks = questionBanksStore.read(userId) || {};
    const metadata = Object.values(questionBankMetaStore.read(userId) || {});
    return blockBlueprintBanks(Object.entries(banks).map(([filename,questions]) => ({filename,questions,
      blockId: metadata.find(m=>m.filename===filename)?.blockId || questions?.find(q=>q.blockId)?.blockId || null,
      analysis: questionBankAnalysisStore.read(userId,filename)})), blockId, blueprintContext.lectures);
  };

  const prepareQuestions = (config) => {
    let scopedLectures = filterLecturesByScope(eligibleLectures, config.contentScope || (config.weekNumber != null ? `week-number:${config.weekNumber}` : "block-so-far"));
    let scopedObjectives = objectivesByLecture;
    if (config.studyMode === "repair" && !config.blueprintExam) {
      const focus = buildFocusedRepairScope({ eligibleLectures: scopedLectures, objectivesByLecture, weakConcepts, learnerEvidence: readLearnerEvidence(userId), blockId });
      scopedLectures = focus.eligibleLectures;
      scopedObjectives = focus.objectivesByLecture;
    }
    setShowLaunchModal(false);
    startBackgroundJob({ label: "Preparing exam questions", detail: "Checking saved questions…",
      run: async report => {
        const target = Number(config.questionCount) || 0;
        let result = null;
        let passConfig = { ...config };
        let previousPrepared = Math.max(0, Number(config.initialPreparedCount) || 0);
        let stalledPasses = 0;
        // One explicit Prepare request owns the whole requested set. Continue
        // bounded refill waves automatically instead of making the learner
        // return to the dashboard and press another button after every wave.
        for (let pass = 0; pass < 5 && previousPrepared < target; pass += 1) {
          result = await launchExamSession({ userId, blockId, ...passConfig, prepareOnly: true,
            eligibleLectures: scopedLectures, objectivesByLecture: scopedObjectives, atomsByLecture, lecturesById, lectures,
            ...(passConfig.blueprintExam ? {...blueprintContext,schoolBanks:allBlueprintBanks()} : {}),
            weakConceptAccuracyByLecture, weakConcepts },
            { callAIJSON, ensureObjectiveParts, onProgress: p => {
              const confirmed = Number(p.completed) || 0;
              const ready = Math.min(target, Math.max(previousPrepared, confirmed));
              report(`${Math.max(0, target - ready)} remaining · ${ready}/${target} ready · ${p.message}`);
            } });
          if (!result.ok) throw new Error(result.error);
          const prepared = Math.max(previousPrepared, Number(result.prepared) || 0);
          report(prepared < target
            ? `${target - prepared} remaining · ${prepared}/${target} ready · continuing automatically`
            : `${prepared}/${target} ready · complete`);
          stalledPasses = prepared > previousPrepared ? 0 : stalledPasses + 1;
          previousPrepared = prepared;
          if (prepared >= target || stalledPasses >= 2) break;
          passConfig = {
            ...config,
            preparedGenerationId: result.preparedGenerationId,
            preparedQuestionIds: result.preparedQuestionIds,
            preparedAllocation: result.preparedAllocation,
            appendToPreparedSet: true,
            initialPreparedCount: prepared,
          };
        }
        if (!result) throw new Error("Question preparation did not start.");
        setGenerationCoverage(result.coverage || null);
        await refreshQuestionReserve();
        await refreshPreparedSets();
        if (previousPrepared < target) throw new Error(`${previousPrepared}/${target} questions are safely saved. Preparation stopped after two refill waves made no progress; the timer has not started.`);
        return `${target}/${target} questions prepared. This named set is saved below and will still be there after reload.`;
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
      let launchConfig = config;
      if (config.preparedSetHasUsedQuestions) {
        const priorSessions = await listExamSessions(userId, blockId).catch(() => []);
        launchConfig = { ...config, examName: namePreparedReplacementAttempt(config.examName, priorSessions) };
      }
      let scopedLectures = filterLecturesByScope(eligibleLectures, launchConfig.contentScope || (launchConfig.weekNumber != null ? `week-number:${launchConfig.weekNumber}` : "block-so-far"));
      let scopedObjectives = objectivesByLecture;
      if (launchConfig.studyMode === "repair" && !launchConfig.blueprintExam && !launchConfig.targetObjectiveIds?.length) {
        const focus = buildFocusedRepairScope({ eligibleLectures: scopedLectures, objectivesByLecture, weakConcepts, learnerEvidence: readLearnerEvidence(userId), blockId });
        scopedLectures = focus.eligibleLectures;
        scopedObjectives = focus.objectivesByLecture;
        if (!scopedLectures.length) throw new Error("No weak objectives need focused repair right now. Use a balanced exam to build more evidence.");
      }
      if (launchConfig.targetObjectiveIds?.length) {
        const selectedIds=new Set(launchConfig.targetObjectiveIds);
        scopedObjectives=Object.fromEntries(Object.entries(objectivesByLecture).map(([id,list])=>[id,list.filter(objective=>selectedIds.has(objective.id)).map(objective=>({...objective,...(launchConfig.targetObjectiveOrders?.[objective.id]?{_transferOrder:launchConfig.targetObjectiveOrders[objective.id]}:{})}))]).filter(([,list])=>list.length));
        scopedLectures=eligibleLectures.filter(lecture=>scopedObjectives[lecture.lectureId]?.length).map(lecture=>({...lecture,objectiveCount:scopedObjectives[lecture.lectureId].length}));
        if(!scopedLectures.length)throw new Error("These objectives need valid lecture links before a targeted retest can start.");
      }
      const result = await launchExamSession(
        {
          userId,
          blockId,
          ...launchConfig,
          schoolBanks: blockQuestionBanks,
          eligibleLectures: scopedLectures,
          objectivesByLecture: scopedObjectives,
          atomsByLecture,
          lecturesById,
          lectures,
          weakConceptAccuracyByLecture,
          weakConcepts,
          ...(launchConfig.blueprintExam ? {...blueprintContext,schoolBanks:allBlueprintBanks()} : {}),
        },
        // C1 fix — no caller ever supplied the AI transport: `deps` defaulted
        // to `{}` all the way down to `generateMcqs`, so every generation
        // call threw and every launch failed with "Could not generate any
        // questions." Same DI pattern Shell.jsx uses for `startObjectiveQuiz`.
        { callAIJSON, ensureObjectiveParts, onProgress: setLaunchProgress }
      );
      if (result.ok) {
        setGenerationCoverage(result.coverage || null);
        await refreshQuestionReserve();
        await refreshPreparedSets();
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
          setPartialLaunch({ config: launchConfig, readyCount: result.readyCount });
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

  const handleBankLaunch = async (bank, format, selectedQuestions = null, purpose = "practice") => {
    if (bankLaunching) return;
    setBankLaunching(`${bank.filename}:${format}`);
    setLaunchError(null);
    try {
      const result = await launchQuestionBankSession({
        userId,
        blockId,
        filename: bank.filename,
        questions: selectedQuestions ?? bank.questions,
        analysis: bank.analysis,
        lectures,
        format,
        purpose,
      });
      if (result.ok) {
        if (result.removedDuplicateCount) setLaunchWarning(`${result.removedDuplicateCount} repeated question${result.removedDuplicateCount === 1 ? " was" : "s were"} skipped for this run. The source bank is unchanged.`);
        setActiveSessionId(result.sessionId);
      }
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
        {launchError && <p role="alert" className="mb-3 rounded border border-bad p-3 text-sm">{launchError}</p>}
        {launchWarning && <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded border border-border bg-panel p-3 text-sm">
          <p>{launchWarning}</p>
          <button type="button" className="shrink-0 underline" aria-label="Dismiss preparation notice" onClick={() => setLaunchWarning(null)}>Dismiss</button>
        </div>}
        <ExamSessionRunner
          retestBusy={launching}
          onTargetedRetest={({objectives: targets,count,focusNotes})=>handleLaunch({format:"practice",questionCount:count,durationMinutes:examDurationMinutes(count),examName:`Targeted retest · ${count} questions`,focusNotes,studyMode:"repair",targetObjectiveIds:targets.map(o=>o.id),targetObjectiveOrders:Object.fromEntries(targets.filter(o=>o._transferOrder).map(o=>[o.id,o._transferOrder])),includeSeen:false,startWhilePreparing:true})}
          onRecoverPreparation={(session,manual=false,report) => recoverExamPreparation({ session, manual, report, userId, pool: createQuestionPool(userId, blockId), generate: generateExamQuestions, context: { lecturesById, objectivesByLecture, atomsByLecture, lectures, ...(session.blueprintExam ? blueprintContext : {}), callAIJSON, ensureObjectiveParts } })}
          sessionId={activeSessionId}
          userId={userId}
          blockId={blockId}
          blockName={blockName}
          lectureLabelsByLectureId={lectureLabelsByLectureId}
          lectures={lectures}
          onNavigateToLecture={onNavigateToLecture}
          objectivesById={objectivesById}
          tutorModeEnabled={tutorModeEnabled}
          callAI={callAI}
          onExit={() => {
            setActiveSessionId(null);
            setLaunchWarning(null);
            refreshResumableSessions();
            refreshBankAttempts();
            practiceHistory.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="desk-page desk-exam mx-auto w-full max-w-6xl p-4 sm:p-5">
      <div className="desk-page-heading mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text-1">Exam</h2>
          <p className="mt-1 text-sm text-text-3" aria-label="Exam study overview">{practiceHistory.loading ? "—" : completedQuestionTotal.toLocaleString()} questions done · {questionReserve.loading ? "—" : questionReserve.ready.toLocaleString()} prepared and unused · {resumableSessions.length} in progress</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-text-2">
            <input type="checkbox" checked={tutorModeEnabled} onChange={toggleTutorMode} />
            Tutor mode
          </label>
          <Button onClick={() => openExamLaunch()}>+ New practice set</Button>
        </div>
      </div>

      <div className="mb-4"><PracticeModeTabs ariaLabel="Exam center sections" value={examPageSection} onChange={selectExamPageSection} modes={[
        { id: "start", label: "Start" },
        { id: "highyield", label: "High yield" },
        { id: "weak", label: "Weak concepts" },
        { id: "missed", label: "Missed questions" },
        { id: "results", label: "Results" },
        { id: "banks", label: "Question banks", badge: blockQuestionBanks.length || null },
      ]} /></div>
      {examPageSection==='results'&&<>{validationError&&<p role="alert">{validationError}</p>}<ReadinessValidation key={blockId} userId={userId} blockId={blockId} blockName={blockName} lectures={lectures} objectives={objectives} evidence={blueprintEvidenceRes.data||{}} ratings={questionRatingsRes.data?.ratings||{}} sessions={validationSessions} loading={validationLoading||!!validationError||lecturesRes.loading||!!lecturesRes.error||objectivesRes.loading||!!objectivesRes.error||blueprintEvidenceRes.loading||!!blueprintEvidenceRes.error||questionRatingsRes.loading||!!questionRatingsRes.error} onRefresh={refreshBankAttempts}/></>}
      {examPageSection === 'missed' && <MissedQuestions userId={userId} evidence={blueprintEvidenceRes.data || {}} blockId={blockId} lectures={lectures} busy={!!bankLaunching} onReplay={questions=>handleBankLaunch({filename:'Missed questions · all sources',questions},'practice',questions)} onStudy={group=>onNavigateToLecture?.(group.lectureId,{focusObjectiveIds:[...new Set(group.questions.flatMap(q=>q.objectiveIds||[]))],weakConcept:group.concept})} />}

      {showLaunchModal && (
        <ExamLaunchModal
          blockId={blockId}
          userId={userId}
          defaultBlueprintExam={selectedBlueprint}
          defaultKind={launchKind}
          defaultStudyMode={launchStudyMode}
          defaultTargetObjectiveIds={launchTarget.objectiveIds}
          defaultFocusNotes={launchTarget.focusNotes}
          eligibleLectures={eligibleLectures}
          blueprintLectures={blueprintContext.eligibleLectures}
          blueprintObjectives={blueprintContext.objectivesByLecture}
          defaultQuestionCount={defaultQuestionCount}
          onLaunch={handleLaunch}
          onCancel={() => setShowLaunchModal(false)}
          launching={launching}
          progress={launchProgress}
          error={launchError}
          partialLaunch={partialLaunch}
          savedQuestionCount={questionReserve.ready}
          existingNames={[...preparedSets.map(set => set.examName), ...resumableSessions.map(session => session.title)]}
          onStartSaved={(config) => handleLaunch({ ...config, startWhilePreparing: true })}
          onPrepare={prepareQuestions}
        />
      )}

      {launchError && !showLaunchModal && (
        <div role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-bad">
          {launchError}
        </div>
      )}

      {examPageSection === "start" && <>
      {resumableSessions.length > 0 && <section className="mb-4 rounded-xl border border-accent bg-bg-elevated p-4">
        <div className="text-sm font-bold text-text-1">Continue an unfinished session</div>
        <p className="mt-1 text-sm text-text-2">Answers are saved after every selection. Timed-exam clocks continue while you are away.</p>
        <div className="mt-3 space-y-2">{resumableSessions.map(session => <div key={session.sessionId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-panel p-3">
          <div>
            <div className="font-semibold text-text-1">{session.title || (session.format === "exam" ? "Timed exam" : "Practice session")}</div>
            <div className="text-sm text-text-3">{session.answers?.length || 0}/{session.questions?.length || 0} answered{session.fillStatus === "generating" ? ` · preparing to ${session.targetQuestionCount}` : ""}</div>
            {Number(session.targetQuestionCount)>(session.questions?.length||0)&&<p className="text-xs text-warn">{session.targetQuestionCount-(session.questions?.length||0)} questions still needed · Resume to generate the remainder and keep your answers.</p>}
          </div>
          <div className="flex gap-2"><Button onClick={() => setActiveSessionId(session.sessionId)}>Resume</Button>
          <Button variant="outline" onClick={async()=>{
            if(!window.confirm('Remove this unfinished session from the list? Saved answers remain archived; unanswered questions return to the reserve.'))return;
            try {
              const archived=await updateExamSessionTransaction(userId,session.sessionId,current=>current?.status==='in_progress'?{...current,status:'abandoned',fillLeaseUntil:0}:null);
              if(archived?.status==='abandoned')await releaseUnansweredQuestions(userId,archived);
              await refreshResumableSessions();
            }catch(error){setLaunchError(error.message||'Could not remove session. Please retry.');}
          }}>Remove</Button></div>
        </div>)}</div>
      </section>}

      <section aria-label="Start practice" className="mb-4 rounded-xl border border-border bg-bg-elevated p-4">
        <h3 className="text-base font-semibold text-text-1">Start a practice set</h3>
        <p className="mt-0.5 text-sm text-text-3">Pick the school format to practice. You choose the lecture or week next.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { kind: "homework", label: "Homework", note: "One lecture" },
            { kind: "imcq", label: "IMCQ", note: "One week" },
            { kind: "esoft", label: "ESoft", note: "2–3 weeks" },
            { kind: "full", label: "Full NB exam", note: "Whole block, timed" },
          ].map(item => <button key={item.kind} type="button" onClick={() => openExamLaunch(item.kind === "full" ? { blueprint: Object.keys(BPM_BLUEPRINTS).slice(-1)[0] || "", kind: "full" } : { kind: item.kind })}
            className="rounded-lg border border-border bg-panel p-3 text-left hover:border-accent">
            <span className="block text-sm font-semibold text-text-1">{item.label}</span>
            <span className="block text-xs text-text-3">{item.note}</span>
          </button>)}
        </div>
      </section>

      <MixedExamCard blockId={blockId} blockName={blockName} banks={blockQuestionBanks} busy={!!bankLaunching || sourceUseRes.loading || !!sourceUseRes.error}
        isReserved={question => isEvaluationReserved(question, sourceUseRes.data || {})}
        onStart={questions => handleBankLaunch({ filename: `Mixed timed exam · ${blockName || "block"}`, questions }, "exam", questions)} />

      <TopicPractice blockId={blockId} userId={userId} lectures={lectures} objectives={objectives} onPractice={openExamLaunch} />

      <section aria-label="Prepared exams to start" className="mb-4 rounded-xl border border-border bg-bg-elevated p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-text-1">Prepared quizzes & exams · start later</h2>
          <span className="text-xs text-text-3">{preparedSets.length} saved set{preparedSets.length === 1 ? "" : "s"}</span>
        </div>
        {deleteSetError && <div role="alert" className="mt-3 rounded border border-bad/40 px-3 py-2 text-sm text-bad">{deleteSetError}</div>}
        {preparedSetEditError && <div role="alert" className="mt-3 rounded border border-bad/40 px-3 py-2 text-sm text-bad">{preparedSetEditError}</div>}
        {preparedSets.length ? <ul className="mt-3 space-y-2">{preparedSets.map((set) => {
          const requested = Number(set.requestedCount) || set.questions.length;
          const available = set.questions.length;
          const preparedCount = Math.min(requested, Number.isFinite(set.preparedCount) ? set.preparedCount : available);
          const actualShortfall = Math.max(0, requested - preparedCount);
          const launchQuestions = set.questions.slice(0, requested);
          const launchQuestionIds = launchQuestions.map(question => question.poolId).filter(Boolean);
          const launchAllocation = launchQuestions.reduce((counts, question) => {
            const slot = questionSlot(question);
            if (slot) counts[slot] = (counts[slot] || 0) + 1;
            return counts;
          }, {});
          const reserveExtras = Math.max(0, available - requested);
          const savedWeekNumber = set.weekNumber ?? (/^\d+$/.test(String(set.contentScope || "")) ? Number(set.contentScope) : null);
          return <li key={set.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-panel p-3">
            <div>
              <div className="font-semibold text-text-1">{set.examName || (set.format === "exam" ? "Timed exam" : "Practice quiz")}</div>
              <div className="text-sm text-text-2">{preparedCount}/{requested} exam questions ready{reserveExtras ? ` · ${reserveExtras} extra kept in reserve` : ""}{set.assignedCount ? ` · ${set.assignedCount} assigned to prior attempts` : ""} · {set.difficultyOverride || "adaptive difficulty"} · {set.contentScope || "block-so-far"} · {set.format === "exam" ? `${set.durationMinutes || 0} min timed` : "untimed practice"}</div>
              {editingPreparedSetId === set.id && preparedSetDraft && <div className="mt-3 grid max-w-2xl gap-2 rounded border border-border bg-bg-elevated p-3 sm:grid-cols-2">
                <label className="text-xs text-text-2 sm:col-span-2">Quiz / exam name
                  <input aria-label="Prepared set name" maxLength={80} value={preparedSetDraft.examName} disabled={savingPreparedSet} onChange={event => setPreparedSetDraft(current => ({ ...current, examName: event.target.value }))} className="mt-1 min-h-10 w-full rounded border border-border bg-panel px-2 text-sm text-text-1" />
                </label>
                <label className="text-xs text-text-2 sm:col-span-2">Question date scope
                  <select aria-label="Prepared set scope" value={preparedSetDraft.scopeMode} disabled={savingPreparedSet} onChange={event => setPreparedSetDraft(current => ({ ...current, scopeMode: event.target.value }))} className="mt-1 min-h-10 w-full rounded border border-border bg-panel px-2 text-sm text-text-1">
                    <option value="block-so-far">Block so far</option>
                    {savedWeekNumber != null && <option value={`week:${savedWeekNumber}`}>Week {savedWeekNumber}</option>}
                    <option value="date-range">Specific date range</option>
                  </select>
                </label>
                {preparedSetDraft.scopeMode === "date-range" && <>
                  <label className="text-xs text-text-2">From
                    <input aria-label="Prepared set start date" type="date" value={preparedSetDraft.rangeStart} disabled={savingPreparedSet} onChange={event => setPreparedSetDraft(current => ({ ...current, rangeStart: event.target.value }))} className="mt-1 min-h-10 w-full rounded border border-border bg-panel px-2 text-sm text-text-1" />
                  </label>
                  <label className="text-xs text-text-2">Through
                    <input aria-label="Prepared set end date" type="date" value={preparedSetDraft.rangeEnd} disabled={savingPreparedSet} onChange={event => setPreparedSetDraft(current => ({ ...current, rangeEnd: event.target.value }))} className="mt-1 min-h-10 w-full rounded border border-border bg-panel px-2 text-sm text-text-1" />
                  </label>
                </>}
                <div className="flex gap-2 sm:col-span-2">
                  <button type="button" disabled={savingPreparedSet} onClick={() => savePreparedSet(set)} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingPreparedSet ? "Saving…" : "Save changes"}</button>
                  <button type="button" disabled={savingPreparedSet} onClick={() => { setEditingPreparedSetId(null); setPreparedSetDraft(null); setPreparedSetEditError(null); }} className="rounded border border-border px-3 py-2 text-sm text-text-2 disabled:opacity-50">Cancel</button>
                </div>
              </div>}
              {set.assignedCount > 0 && <div className="text-xs text-text-3">Starting will create a separately named attempt and fill the remaining {Math.max(0, requested - available)} slots from unused reserve questions or generation. The original set’s name and question list will not be changed.</div>}
              {actualShortfall > 0 && <div className="text-xs text-warn">{actualShortfall} question{actualShortfall === 1 ? "" : "s"} still need preparation. Nothing is generating until you choose Prepare missing.</div>}
              {confirmDeleteSetId === set.id && <div className="mt-2 rounded border border-bad/40 bg-bg-elevated p-2 text-sm text-text-2">
                Remove this saved set and its {available} still-unused question{available === 1 ? "" : "s"}? Questions already assigned to an exam will be kept.
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={deletingSet} onClick={() => deletePreparedSet(set)} className="rounded bg-bad px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{deletingSet ? "Deleting…" : "Confirm delete"}</button>
                  <button type="button" disabled={deletingSet} onClick={() => setConfirmDeleteSetId(null)} className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-text-2">Keep set</button>
                </div>
              </div>}
            </div>
            <div className="flex flex-wrap gap-2">
            <button type="button" disabled={savingPreparedSet || deletingSet} onClick={() => editingPreparedSetId === set.id ? (setEditingPreparedSetId(null), setPreparedSetDraft(null)) : editPreparedSet(set)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text-2 hover:bg-bg-elevated disabled:opacity-50">{editingPreparedSetId === set.id ? "Close editor" : "Edit"}</button>
            {actualShortfall > 0 ? <Button disabled={launching} onClick={() => prepareQuestions({
              blueprintExam: set.blueprintExam || null,
              format: set.format || "exam",
              questionCount: requested,
              durationMinutes: Number(set.durationMinutes) || examDurationMinutes(requested),
              contentScope: set.contentScope || "block-so-far",
              studyMode: set.studyMode || "balanced",
              difficultyOverride: set.difficultyOverride || null,
              focusNotes: set.focusNotes || "",
              weekNumber: set.weekNumber ?? null,
              examName: set.examName || "Integrated exam",
              preparedGenerationId: set.id,
              preparedQuestionIds: set.preparedQuestionIds || set.questions.map((question) => question.poolId),
              preparedAllocation: set.allocation || null,
              initialPreparedCount: available,
              appendToPreparedSet: true,
            })}>Prepare missing {actualShortfall}</Button> : <Button disabled={launching || !available} onClick={() => handleLaunch({
              blueprintExam: set.blueprintExam || null,
              format: set.format || "exam",
              questionCount: requested,
              durationMinutes: Number(set.durationMinutes) || examDurationMinutes(requested),
              contentScope: set.contentScope || "block-so-far",
              studyMode: set.studyMode || "balanced",
              difficultyOverride: set.difficultyOverride || null,
              focusNotes: set.focusNotes || "",
              weekNumber: set.weekNumber ?? null,
              examName: set.examName || "Integrated exam",
              preparedSetHasUsedQuestions: set.assignedCount > 0,
              preparedGenerationId: set.id,
              preparedQuestionIds: set.assignedCount > 0 ? (set.preparedQuestionIds || launchQuestionIds) : launchQuestionIds,
              preparedAllocation: set.assignedCount > 0 ? (set.allocation || null) : launchAllocation,
              savedOnly: set.assignedCount > 0 ? false : true,
              startWhilePreparing: set.assignedCount > 0,
            })}>Start this {requested}-question set</Button>}
            <button type="button" disabled={deletingSet} onClick={() => { setDeleteSetError(null); setConfirmDeleteSetId(confirmDeleteSetId === set.id ? null : set.id); }} className="rounded-lg border border-bad/40 px-3 py-2 text-sm font-semibold text-bad hover:bg-bad/5 disabled:opacity-50">Delete</button>
            </div>
          </li>;
        })}</ul> : <p className="mt-2 text-sm text-text-3">No named sets prepared yet. Start a practice set above and choose “Prepare for later”.</p>}
      </section>
      <details className="mb-5 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">Optional school subject weighting</summary>
      <BpmBlueprintDashboard blockId={blockId} userId={userId} objectivesByLecture={blueprintContext.objectivesByLecture} lectures={blueprintContext.lectures}
        onReview={onNavigateToLecture} onStart={exam => openExamLaunch({ blueprint: exam })} />
      </details>
      </>}

      {examPageSection === "banks" && blockQuestionBanks.length > 0 && (
        <section className="mb-4 rounded-xl border border-border bg-bg-elevated p-3">
          <div className="mb-1 text-sm font-bold text-text-1">Original question banks · ExamSoft, IMCQ, homework & clicker examples</div>
          <RelinkQuestionBanks userId={userId} />
          <div className="mb-3 font-mono text-[11px] text-text-3">
            {blockQuestionBanks.length ? "Authentic uploaded questions for this block." : "No uploaded bank is assigned to this block yet, so all imported banks are shown here."} Timed sessions use 72 seconds per question; practice reveals the keyed rationale after each answer. Source keys are preserved and analyzed separately from medical correctness.
          </div>
          <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="School question bank categories">
            {bankGroups.map(([group]) => <button key={group} type="button" role="tab" aria-selected={activeBankCategory === group} onClick={() => setBankCategory(group)} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold ${activeBankCategory === group ? "border-accent text-accent-text" : "border-transparent text-text-3 hover:text-text-1"}`}>{group}</button>)}
          </div>
          <SourceUseAdmin title="Assessment setup" userId={userId} banks={Object.fromEntries(blockQuestionBanks.filter(bank=>bank.sourceKind!=="clicker").map(bank=>[bank.filename,bank.questions]))} />
          <div className="space-y-2">
            {(bankGroups.find(([group]) => group === activeBankCategory)?.[1] || []).map((bank) => {
              const distinctQuestionSet = prepareBankQuestionSet(bank.questions, bank.analysis);
              const minutes = examDurationMinutes(distinctQuestionSet.questions.length);
              const expectedCount = bank.expectedQuestions || (/examsoftpractice/i.test(cleanLectureTitle(bank.filename)) ? 30 : null);
              const incomplete = expectedCount && bank.questions.length < expectedCount;
              const exampleOnly = bank.sourceKind === "clicker";
              const reserved=distinctQuestionSet.questions.length>0 && distinctQuestionSet.questions.every(q=>isEvaluationReserved({...q,sourceFile:bank.filename},sourceUseRes.data || {}));
              const stats = statsForBank(bank);
              const missedOnly = missedBankQuestions({bank, sessions:[...bankAttempts,...resumableSessions], blockId, ratings:questionRatingsRes.data?.ratings || {}});
              const analysis = bank.analysis;
              const bankNames = new Set([bank.filename, ...(bank.aliases || [])]);
              const resumableBankSession = resumableSessions.find((session) => session?.sourceType === "question-bank" && bankNames.has(session.sourceFile));
              const partialScore = resumableBankSession ? scoreAnsweredQuestions(resumableBankSession) : null;
              const focusSummary = analysis?.focusCounts ? Object.entries(analysis.focusCounts).slice(0, 3).map(([label, count]) => `${label} ${count}`).join(" · ") : null;
              return (
                <div key={bank.filename} className="grid min-w-0 gap-3 rounded-lg border border-border bg-panel px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-1">{bank.displayName || cleanLectureTitle(bank.filename)}</div>
                    <div className="font-mono text-[11px] text-text-3">{distinctQuestionSet.questions.length} distinct questions{distinctQuestionSet.removedDuplicateCount ? ` · ${distinctQuestionSet.removedDuplicateCount} repeats skipped` : ""} · {minutes} min timed · {sourceLabel(bank.sourceKind, bank.filename)}{bank.assignedDate ? ` · assigned ${bank.assignedDate}` : ""} · {stats.attempts} practice attempt{stats.attempts === 1 ? "" : "s"}{stats.latest ? ` · latest ${stats.latest.score}%` : ""}{stats.improvement != null ? ` · ${stats.improvement >= 0 ? "+" : ""}${stats.improvement}% change` : ""}</div>
                    <QuestionBankMappingStatus userId={userId} blockId={blockId} filename={bank.filename} lectures={lectures} objectives={objectives}/>
                    {!exampleOnly && <BankExamMaterial userId={userId} filename={bank.filename}/>}
                    {!exampleOnly && <QuestionBankManualLinks userId={userId} blockId={blockId} filename={bank.filename} questions={bank.questions} lectures={lectures} objectives={objectives} blockBankFilenames={blockQuestionBanks.map(item => item.filename)}/>}
                    {analysis && <div className="mt-1 text-[11px] text-text-2">Question analysis: {analysis.clinicalQuestionCount || 0} clinical cue item{analysis.clinicalQuestionCount === 1 ? "" : "s"}{focusSummary ? ` · ${focusSummary}` : ""} · uploaded source preserved</div>}
                    {stats.latest?.missed?.length > 0 && <div className="mt-1 text-[11px] text-text-2">Mental-model repair: {stats.latest.missed.length} missed concept{stats.latest.missed.length === 1 ? "" : "s"}</div>}
                    {resumableBankSession && partialScore && <div className="mt-1 text-[11px] text-accent-text">In progress · {partialScore.answered}/{resumableBankSession.questions?.length || 0} answered{resumableBankSession.purpose!=="reserved-assessment" && partialScore.accuracy != null ? ` · ${partialScore.accuracy}% so far (${partialScore.correct} right, ${partialScore.incorrect} wrong)` : ""}</div>}
                    {reserved && <p className="mt-1 text-xs text-accent-text">Reserved for assessment · excluded from generation examples. Prior exposure will be checked at launch.</p>}
                    {stats.attempts > 0 && <details className="mt-2 text-xs text-text-2">
                      <summary className="cursor-pointer font-semibold">Attempt history · {stats.attempts}</summary>
                      <div className="mt-2 flex flex-wrap gap-2">{stats.history.map((attempt, index) => <Button key={attempt.session.sessionId || attempt.session.id} variant="outline" onClick={() => setActiveSessionId(attempt.session.sessionId || attempt.session.id)}>Review attempt {index + 1} · {attempt.score}%</Button>)}</div>
                    </details>}
                    {bankAttempts.filter(s=>s.purpose==="reserved-assessment" && bankNames.has(s.sourceFile)).map((s,i)=><Button key={s.sessionId} variant="outline" onClick={()=>setActiveSessionId(s.sessionId)}>Assessment result {i+1}</Button>)}
                    {incomplete && <div className="mt-1 text-[11px] font-bold text-bad">⚠ Incomplete import: {bank.questions.length}/{expectedCount}. Re-upload this PDF once to replace the old parse.</div>}
                    {exampleOnly && <div className="mt-1 text-[11px] text-accent-text">Example-only bank: use these clicker stems and images to guide generation; unkeyed slides are not scored as practice questions.</div>}
                    {!reserved && analysis?.items?.length > 0 && <details className="mt-2 text-xs text-text-2">
                      <summary className="cursor-pointer font-semibold">Question analysis & automatic curriculum links</summary>
                      <div className="mt-2 space-y-2">{analysis.items.slice(0, 8).map((item) => {
                        const linkedQuestion = bank.questions.find((question, index) => String(question?.id ?? question?.num ?? index + 1) === String(item.id ?? item.num));
                        const verified = ["evidence-verified", "user-confirmed"].includes(linkedQuestion?.curriculumLinkStatus);
                        const objectiveLabels = (linkedQuestion?.objectiveIds || []).map((id) => objectivesById[id]?.objective || objectivesById[id]?.text || objectivesById[id]?.content || id).filter(Boolean);
                        const lectureLabel = linkedQuestion?.lectureLabel || lecturesById[linkedQuestion?.lectureId]?.lectureTitle || lecturesById[linkedQuestion?.lectureId]?.title;
                        return <div key={item.id} className="rounded border border-border px-2 py-1.5">
                        <div className="font-mono text-[11px] text-text-3">Q{item.num} · {item.focus} · source answer preserved</div>
                        {(item.clinicalCues?.length || item.buzzwords?.length) > 0 && <div className="text-text-3">Cues: {[...(item.clinicalCues || []), ...(item.buzzwords || [])].join(" · ")}</div>}
                        {verified ? <div className="mt-1 text-good">Automatically linked{lectureLabel ? ` to ${lectureLabel}` : ""}{objectiveLabels.length ? ` · ${objectiveLabels.join(" · ")}` : ""}</div> : <div className="mt-1 text-text-3">No source-supported current-block lecture/objective link was found. This question remains available for practice and as a generation reference.</div>}
                      </div>})}</div>
                      {analysis.items.length > 8 && <div className="mt-1 text-text-3">Showing the first 8; practice all {analysis.items.length} questions to see the imported questions and available rationales.</div>}
                    </details>}
                  </div>
                  <div data-testid="bank-study-actions" aria-label="Question bank study actions" className="grid min-w-0 grid-cols-2 items-start gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                    {resumableBankSession && <Button className="w-full min-w-0 self-start whitespace-normal text-center leading-tight" variant="outline" disabled={!!bankLaunching} onClick={() => setActiveSessionId(resumableBankSession.sessionId || resumableBankSession.id)}>Resume · {partialScore?.answered || 0}/{resumableBankSession.questions?.length || 0}</Button>}
                    {!exampleOnly && !reserved && <Button className="w-full min-w-0 self-start" variant="outline" disabled={!!bankLaunching || sourceUseRes.loading || !!sourceUseRes.error} onClick={() => handleBankLaunch(bank, "practice")}>Practice</Button>}
                    {!exampleOnly && !reserved && <MissedPracticeActions questions={missedOnly} lectures={lectures} blockId={blockId} busy={!!bankLaunching || sourceUseRes.loading || !!sourceUseRes.error} onLaunch={questions=>handleBankLaunch(bank,"practice",questions)} />}
                    {!exampleOnly && <Button className="w-full min-w-0 self-start whitespace-normal text-center leading-tight" disabled={!!bankLaunching || sourceUseRes.loading || !!sourceUseRes.error} onClick={() => handleBankLaunch(bank, "exam", null, reserved ? "reserved-assessment" : "practice")}>{reserved ? "Reserved timed assessment" : "Timed quiz"}</Button>}
                  </div>
                  <div data-testid="bank-management-actions" aria-label="Question bank management actions" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2">
                    <Button className="min-h-9 px-2 py-1 text-xs" variant="ghost" disabled={!!bankLaunching || bankEditBusy} onClick={() => renameBank(bank)}>{bankEditBusy ? "Saving…" : "Rename"}</Button>
                    <Button className="min-h-9 px-2 py-1 text-xs" variant="ghost" disabled={!!bankLaunching || bankEditBusy} onClick={() => scheduleBank(bank)}>{bankEditBusy ? "Saving…" : bank.assignedDate ? "Change date" : "Assign date"}</Button>
                    {stats.latest && <Button className="min-h-9 px-2 py-1 text-xs" variant="ghost" onClick={() => setActiveSessionId(stats.latest.session.sessionId || stats.latest.session.id)}>Review latest</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Other-block/comprehensive banks remain in Firestore as generation evidence.
          They are intentionally not rendered in the block view; showing dozens of
          unrelated banks here made the current block feel like an archive browser. */}

        {examPageSection === "highyield" && (
          <HighYieldPanel blockId={blockId} blockName={blockName} lectures={lectures} objectives={objectives} banks={blockQuestionBanks} weakConcepts={weakConcepts || {}} evidence={blueprintEvidenceRes.data || null} onOpenLecture={onNavigateToLecture ? lectureId => onNavigateToLecture(lectureId) : null} />
        )}

        {examPageSection === "banks" && (
          <ScoreReportUpload userId={userId} blocks={[{ id: blockId, name: blockName }]} defaultBlockId={blockId} lectures={lectures} objectivesForBlock={() => objectives} />
        )}

        {examPageSection === "results" && (
          <details className="mb-4 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">School-style alignment</summary>
          <SchoolAlignmentPanel
            blockId={blockId}
            userId={userId}
            sessions={practiceHistory.sessions}
            historyReady={!practiceHistory.loading && !practiceHistory.error}
          />
          </details>
        )}

        {examPageSection === "results" && <ExamDashboard
          blockId={blockId}
          userId={userId}
          lectures={lectures}
          questionStats={questionStats.data || {}}
          lecturesById={lecturesById}
          objectives={objectives}
          generationCoverage={generationCoverage}
          onNavigateToLecture={onNavigateToLecture}
          onReviewSession={setActiveSessionId}
        />}

        {examPageSection === "weak" && <WeakConcepts
          blockId={blockId}
          userId={userId}
          embedded
          onStartFocusedRepair={(topics = []) => {
            const selectedTopics = Array.isArray(topics) ? topics : [];
            const objectiveIds = [...new Set(selectedTopics.flatMap(topic => weakTopicTargets(topic).objectiveIds))];
            const names = selectedTopics.map(topic => topic?.concept).filter(Boolean).slice(0, 8);
            openExamLaunch({
              studyMode: "repair",
              objectiveIds,
              focusNotes: names.length ? `Prioritize these highest-benefit weak concepts: ${names.join("; ")}. Use fresh second- and third-order applications.` : "",
            });
          }}
          onStudyTopic={studyWeakTopic}
          onQuizTopic={quizWeakTopic}
          quizBusy={launching}
        />}
    </div>
  );
}

export default ExamContainer;

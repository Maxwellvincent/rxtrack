import {LectureCheckpoint} from './LectureCheckpoint.jsx';
import {lecturePracticeTargets} from './lecturePracticeTargets.js';
import {ObjectiveConnections,connectionMapKey} from './ObjectiveConnections.jsx';
import {objectivesWithConnectionGaps} from '../../../engine/objectiveConnections.js';
import {UnfinishedLectureQuizzes} from "./UnfinishedLectureQuizzes.jsx";
import {MissedQuestions} from '../../../ui/MissedQuestions.jsx';
import {missedQuestionGroups} from '../../../engine/missedQuestions.js';
import * as dismissedMissesStore from '../../../stores/dismissedMisses.js';
import {PracticeModeTabs} from './PracticeModeTabs.jsx';
import {repairTransferPlan,repairTransferPrompt} from "../../../engine/repairTransfer.js";
import {isIndependentAttempt} from '../../../engine/practiceAssistance.js';
import {ReviewSourceStatus} from './ReviewSourceStatus.jsx';
import {LectureProgressOverview} from './LectureProgressOverview.jsx';
import {StudyGuidePanel} from './StudyGuidePanel.jsx';
import {useLectureStats} from '../../hooks/useLectureQuestionStats.js';
import * as relationshipsStore from '../../../stores/sourceRelationships.js';
import * as objectivePartsStore from '../../../stores/objectiveParts.js';
import { withPartTargets } from '../../../engine/objectiveParts.js';
import { ensureObjectiveParts } from '../objectives/objectivePartsLoader.js';
import {relationshipPages,relationshipCoverage} from '../../../engine/sourceRelationships.js';
import {useLectureWorkspace} from "./useLectureWorkspace.js";
import {LectureWorkspaceNav,LecturePanel} from './LectureWorkspaceNav.jsx';
import * as sourceUseStore from "../../../stores/sourceUse.js";
import { hasReusableQuestionReview, isReusableForObjective } from "../../../engine/questionReuse.js";
import { exceedsAnswerConcentration } from "../../../engine/questionSimilarity.js";
import { latestLearningRecords } from "../../../engine/learningLoop.js";
import { ObjectiveLearningReport } from "../../../ui/ObjectiveLearningReport.jsx";
import { lectureSourceObjectives } from "../../../engine/sourceObjectiveScope.js";
import { schoolContinuationQuestions } from "./lectureQuizContinuation.js";
import { answeredQuestionKeys } from "../../../engine/questionHistory.js";
import { preparationJobKey, getPreparationJob, startPreparationJob, recoverPreparationFailure, subscribePreparationJob, cancelOtherAccountJobs } from "../../../questionPreparationJobs.js";
import { preparationErrorMessage } from "../../../preparationError.js";
import { readQuestionDiagnostics, saveQuestionDiagnostics } from "../../../questionDiagnostics.js";
import * as weakConceptsStore from "../../../stores/weakConcepts.js";
import { objectivesForWeakConcept, weakConceptsForLectureView } from "./lectureWeakConcepts.js";
/**
 * SP1 T2.1 — one surface for studying a lecture.
 *
 * Replaces the two upload modals (🔬 Extract, ❓ Quiz): instead of dropping a
 * file and throwing the result away, this runs against a lecture that already
 * exists in the store, and the atoms it extracts persist on that lecture. The
 * upload path survives here as the fallback for chunk-light lectures — which is
 * most of them, since only the active term keeps chunks in localStorage.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { callAIJSON } from "../../../aiClient.js";
import { withDeadline } from "../../../asyncDeadline.js";
import { questionPreparationDeps, questionPreparationStatus, questionPreparationBudget } from "../../../questionPreparation.js";
import {
  fetchLectureContent,
  fetchLectureSourceUrl,
  saveLectureAtoms,
  saveLectureImages,
  uploadLectureImages,
} from "../../../firebaseData.js";
import { HY_TYPES } from "../../../engine/highYield.js";
import { locallyValidClinicalQuestions } from "../../../engine/mcq.js";
import { objectiveLectureNumberConflict } from "../../../engine/lectureIdentity.js";
import { reasoningGuidance } from "../../../engine/questionReasoning.js";
import { buildClinicalCorrelateLibrary } from "../../../engine/clinicalCorrelates.js";
import { tagAtomsWithObjectives } from "../../../engine/tagAtoms.js";
import { createObjectiveCommands, selectBlockObjectives, selectLectureObjectives } from "../../logic/objectives.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import * as performanceStore from "../../../stores/performance.js";
import * as atomTermIndex from "../../../stores/atomTermIndex.js";
import * as lecturesStore from "../../../stores/lectures.js";
import { lectureCompletion } from "../../../engine/lectureCompletion.js";
import { LECTURE_QUIZ_CROSS_SHARE, lectureQuizPartner } from "./lectureQuizPartner.js";
import { normAtomKey, partitionAtomsForRound } from "../../../engine/atomNorm.js";
import { AtomQuiz } from "../../AtomQuiz.jsx";
import { markTodayLectureComplete } from "../today/todayProgress.js";
import { FigureReview } from "./FigureReview.jsx";
import { bridgeComplete } from "../../../llmBridge.js";
import {
  applyStoredLabels,
  labelCandidates,
  readStoredLabels,
  selectCandidates,
} from "../../../lectureFigures.js";
import { pendingQuizAction } from "./lectureQuizRetry.js";
import { PREPARE_BATCH_SIZE, buildAdaptiveObjectivePlan, prepareObjectiveQuiz, readClinicalAnalysesForBlock, resolveDefaultDifficulty, selectClinicalExamplesForBlock, selectExemplarsForBlock } from "../objectives/quizLaunch.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import { useQuestionBankMeta } from "../../hooks/useQuestionBankMeta.js";
import * as mentalModelStore from "../../../stores/mentalModel.js";
import { ROUND_SIZE, prioritizeAtomRounds, extractAtoms, isActiveQuizComplete, loadLecture, quizFromAtoms, roundDifficulty, roundLabel } from "./lectureStudy.js";
import {
  clearRoundProgress,
  readRoundProgress,
  saveRoundProgress,
} from "./lectureProgress.js";
import * as questionStats from "../../../stores/lectureQuestionStats.js";
import * as atomProgressStore from "../../../stores/atomProgress.js";
import * as generatedQuestionsStore from "../../../stores/generatedQuestions.js";
import * as questionRatingsStore from "../../../stores/questionRatings.js";
import * as lectureQuizSessionsStore from "../../../stores/lectureQuizSessions.js";
import { deleteLectureFully } from "../../logic/deleteLecture.js";
import { RenameLecture } from "./RenameLecture.jsx";
import { ModelRepairs } from "./ModelRepairs.jsx";
import { LectureRetrievalEnrollment } from "./LectureRetrievalEnrollment.jsx";
import { ObjectiveCoverage } from "./ObjectiveCoverage.jsx";
import { MasteryLadderPanel, LadderSummaryLine } from "./MasteryLadderPanel.jsx";
import * as learnerEvidenceStore from "../../../stores/learnerEvidence.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { objectivePracticePlan, objectivesWithPracticeEvidence } from "../../../engine/objectivePractice.js";

const CheckpointRunner=lazy(()=>import('../exam/ExamSessionRunner.jsx').then(module=>({default:module.ExamSessionRunner})));



export function LectureStudyFlow({
  lecture, blockId, blockName = "", userId, logActivity, examDates, onClose, onLectureRenamed = null,
  onReExtract = null,
  // Set by an external "Quiz" button (Today, Lectures list, ObjectiveTracker) instead of
  // launching its own separate screen — opens the same picker this file's "Quiz this lecture"
  // button opens, just pre-triggered rather than waiting for a click.
  autoOpenQuiz = false,
  autoQuizCount = 15,
  // Pre-read's misses are the reason a quiz got launched from Today in the first place —
  // preserved here as a priority order rather than dropped when that entry point stopped
  // having its own generation call to apply it to.
  focusObjectiveIds = null,
  examRepairContext = null,
}) {
  const [workspace,setWorkspace,visitedWorkspaces]=useLectureWorkspace();
  const [practiceMode,setPracticeMode]=useState(()=>examRepairContext?.weakConcept?'weak':'quiz');
  const [learnMode,setLearnMode]=useState('connections');
  const [atoms, setAtoms] = useState([]);
  const [lectureChunks, setLectureChunks] = useState(() => Array.isArray(lecture?.chunks) ? lecture.chunks : []);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [figures, setFigures] = useState(null); // in-review, not yet uploaded
  const [stage, setStage] = useState("loading"); // loading | upload | extract | quiz
  const [questions, setQuestions] = useState(null);
  const [checkpointSession,setCheckpointSession]=useState(null);
  const [checkpointPreparing,setCheckpointPreparing]=useState(false);
  // Completion belongs to a particular generated question set. A bare boolean can be written
  // by an older AtomQuiz after a replacement quiz has already started, which is how a fresh
  // question 1/10 could appear above the previous quiz's "complete" banner.
  const quizSessionCounter = useRef(0);
  const loggedQuizActivityRef = useRef(null);
  const [quizSessionId, setQuizSessionId] = useState(0);
  const [quizResumeState, setQuizResumeState] = useState(null);
  const [savedLectureQuizzes, setSavedLectureQuizzes] = useState(() => lectureQuizSessionsStore.read(userId, lecture?.id, blockId));
  const quizMetaRef = useRef(null);
  const [completedQuizSessionId, setCompletedQuizSessionId] = useState(null);
  const [completedQuizRecords, setCompletedQuizRecords] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [objectiveNotice, setObjectiveNotice] = useState("");
  const [renamedTitle, setRenamedTitle] = useState("");
  const objectiveResource = useObjectives(null, userId);
  const linkedObjectives = useMemo(() => selectBlockObjectives(objectiveResource.data, blockId)
    .filter((o) => o?.linkedLecId === lecture?.id), [objectiveResource.data, blockId, lecture?.id]);
  const mismatchedLectureObjectives = useMemo(() => linkedObjectives
    .filter((objective) => objectiveLectureNumberConflict(objective, lecture)), [linkedObjectives, lecture]);
  const learnerEvidence = useStoreResource(learnerEvidenceStore, userId);
  const weakConceptResource = useStoreResource(weakConceptsStore, userId);
  const recentLearningRecords = useMemo(()=>latestLearningRecords(learnerEvidence.data || {}, lecture?.id, blockId, true),[learnerEvidence.data,lecture?.id,blockId]);
  // Objective parts (lecture elements each objective covers): attached as _parts so
  // the ladder, readiness and quiz targeting all see the same coverage.
  const partsAdapter = useMemo(() => ({
    read: id => lecture?.id ? objectivePartsStore.read(id, lecture.id) : null,
    isHydrated: id => !lecture?.id || objectivePartsStore.isHydrated(id, lecture.id),
    readError: () => null,
    subscribe: callback => lecture?.id ? objectivePartsStore.subscribe(lecture.id, callback) : () => {},
  }), [lecture?.id]);
  const partsResource = useStoreResource(partsAdapter, userId);
  const lectureObjectives = useMemo(() => withPartTargets(selectLectureObjectives(
    selectBlockObjectives(objectiveResource.data, blockId), lecture, learnerEvidence.data
  ), partsResource.data, learnerEvidence.data?.learningJournal || []), [objectiveResource.data, blockId, lecture, learnerEvidence.data, partsResource.data]);
  const lectureWeakConcepts = useMemo(() => weakConceptsForLectureView(weakConceptResource.data || {}, {
    blockId,
    lectureId: lecture?.id,
    objectives: lectureObjectives,
    evidence: learnerEvidence.data?.learningJournal || [],
  }), [weakConceptResource.data, learnerEvidence.data, blockId, lecture?.id, lectureObjectives]);
  const title = lecture?.lectureTitle || lecture?.title || lecture?.fileName || "Lecture";
  const objectivePractice = useMemo(
    () => objectivePracticePlan(lectureObjectives, learnerEvidence.data),
    [lectureObjectives, learnerEvidence.data]
  );
  // A saved framework from the retired mental-model view is still the reference text for slides-and-notes review.
  const [savedModelReference] = useState(() => mentalModelStore.read(userId, lecture?.id)?.bigPicture || "");
  const [round, setRound] = useState(0);
  // Rounds already finished, read once on mount — this component is keyed by lecture id, so it
  // remounts (and re-reads) whenever you switch lectures.
  const [done, setDone] = useState(() => readRoundProgress(userId, lecture?.id));
  const qStats=useLectureStats(userId,lecture?.id);
  // The real progress bar: atoms answered correctly at least once, out of the atoms this lecture
  // actually has right now. Empty until atoms load (the effect below recomputes it then), refreshed at round/quiz end and on manual exit.
  const [_atomMastery, setAtomMastery] = useState({ masteredCount: 0, totalCount: 0 });
  const refreshAtomMastery = useCallback(
    (currentAtoms) => {
      const keys = (currentAtoms || atoms).map((a) => normAtomKey(a.term));
      setAtomMastery(atomProgressStore.masterySummary(userId, lecture?.id, keys));
    },
    [atoms, userId, lecture?.id]
  );
  const [skippedAtoms, setSkippedAtoms] = useState([]);
  // Inline quiz config picker state
  const [quizPicker, setQuizPicker] = useState(null); // null | { count, difficulty }
  const [quizPreparation, setQuizPreparation] = useState(null);
  const [pendingQuiz, setPendingQuiz] = useState(null);
  // True while `questions` came from the picker's ad-hoc "Quiz this lecture" (any count, any
  // atoms) rather than a sequential Study round — onDone below skips round-index bookkeeping
  // for these (there is no "next round" to resume into) but still updates atom/objective
  // mastery exactly the same way. One runner, two ways in.
  const [adHocQuiz, setAdHocQuiz] = useState(false);
  useEffect(() => {
    const refresh = () => setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId, lecture?.id, blockId));
    refresh();
    const unsubscribe = lectureQuizSessionsStore.subscribe(userId, refresh);
    lectureQuizSessionsStore.hydrate(userId).then(refresh).catch(refresh);
    return unsubscribe;
  }, [userId, lecture?.id, blockId]);
  const [confirmDeleteLecture, setConfirmDeleteLecture] = useState(false);
  const [deletingLecture, setDeletingLecture] = useState(false);
  const [sourceUrls, setSourceUrls] = useState({});
  const [openingSource, setOpeningSource] = useState("");

  const openOriginalSource = useCallback(async (source) => {
    if (!source?.storagePath || !userId) return;
    setOpeningSource(source.filename);
    setError("");
    try {
      const url = await fetchLectureSourceUrl(source.storagePath);
      if (!url) throw new Error("The original file is not available for this account.");
      setSourceUrls((current) => ({ ...current, [source.filename]: url }));
    } catch (e) {
      setError(`Could not open ${source.filename}: ${e?.message || String(e)}`);
    } finally {
      setOpeningSource("");
    }
  }, [userId]);

  // Start both cloud subscriptions as soon as Study opens. Previously the first generation
  // itself started hydration and immediately read an empty fallback, so uploaded Esoft examples
  // were often absent from precisely the first quiz where they were expected.
  const questionBanksRes = useQuestionBanks(userId);
  const questionBankMetaRes = useQuestionBankMeta(userId);
  const sourceUseResource=useStoreResource(sourceUseStore,userId);
  const relationshipAdapter=useMemo(()=>({
    read:id=>lecture?.id?relationshipsStore.read(id,lecture.id):{},
    isHydrated:id=>!lecture?.id || relationshipsStore.isHydrated(id,lecture.id),
    readError:id=>lecture?.id?relationshipsStore.readError(id,lecture.id):null,
    subscribe:callback=>lecture?.id?relationshipsStore.subscribe(lecture.id,callback):()=>{},
  }),[lecture?.id]);
  const relationshipResource=useStoreResource(relationshipAdapter,userId);
  const [relationshipNow,setRelationshipNow]=useState(()=>Date.now());
  useEffect(()=>{
    if(workspace!=="progress")return;
    setRelationshipNow(Date.now());
    const timer=setInterval(()=>setRelationshipNow(Date.now()),60000);
    return ()=>clearInterval(timer);
  },[workspace]);
  const connectionScope=useMemo(()=>({blockId,lectureId:lecture?.id,objectives:lectureObjectives,pages:relationshipPages({...lecture,chunks:lectureChunks},text)}),[blockId,lecture,lectureObjectives,lectureChunks,text]);
  const relationshipRows=useMemo(()=>relationshipCoverage(relationshipResource.data,learnerEvidence.data || {},{
    blockId,lectureId:lecture?.id,objectives:lectureObjectives,pages:relationshipPages({...lecture,chunks:lectureChunks},text),
  },relationshipNow),[relationshipResource.data,learnerEvidence.data,blockId,lecture,lectureObjectives,lectureChunks,text,relationshipNow]);
  const schoolExemplars = useMemo(
    () => sourceUseResource.loading || sourceUseResource.error ? [] : selectExemplarsForBlock(questionBanksRes.data, questionBankMetaRes.data, blockId,sourceUseResource.data),
    [questionBanksRes.data, questionBankMetaRes.data, blockId,sourceUseResource.data,sourceUseResource.loading,sourceUseResource.error]
  );
  const clinicalCorrelateLibrary = useMemo(
    () => buildClinicalCorrelateLibrary({
      atoms,
      examples: selectClinicalExamplesForBlock(schoolExemplars, blockId),
      analyses: readClinicalAnalysesForBlock(userId, blockId),
      lecture,
      lectureTitle: renamedTitle || title,
    }),
    [atoms, schoolExemplars, userId, blockId, lecture, renamedTitle, title]
  );
  const schoolExamplesLoading = questionBanksRes.loading || questionBankMetaRes.loading || sourceUseResource.loading;

  const checkpointLectureQuiz = useCallback((progress) => {
    const current = quizMetaRef.current;
    if (!current) return;
    const session = { ...current, progress };
    quizMetaRef.current = session;
    const saved=lectureQuizSessionsStore.save(userId, session);
    setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId, lecture?.id, blockId));
    return saved;
  }, [blockId, lecture?.id, userId]);

  const startQuizSession = useCallback((nextQuestions, options = {}) => {
    const nextId = quizSessionCounter.current + 1;
    quizSessionCounter.current = nextId;
    setQuizSessionId(nextId);
    setCompletedQuizSessionId(null);
    setQuizResumeState(null);
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lecture-quiz-${Date.now()}-${nextId}`;
    const session = {
      id,
      lectureId: lecture?.id,
      blockId,
      lectureTitle: renamedTitle || title,
      blockName,
      questions: nextQuestions,
      requestedCount: options.expectedCount || nextQuestions.length,
      progress: { i: 0, picked: null, confidence: null, records: [], crossed: [], errorReason: null, highlights: {} },
      isAdHoc: options.isAdHoc ?? true,
      roundIndex: options.roundIndex ?? round,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    quizMetaRef.current = session;
    lectureQuizSessionsStore.save(userId, session);
    setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId, lecture?.id, blockId));
    setActiveRequestedCount(options.expectedCount || nextQuestions.length);
    quizMetaRef.current.requestedCount = options.expectedCount || nextQuestions.length;
    setQuestions(nextQuestions);
  }, [blockId, blockName, lecture?.id, renamedTitle, round, title, userId]);

  const resumeLectureQuiz = useCallback((session) => {
    if (!session?.questions?.length) return;
    quizMetaRef.current = session;
    if (Number(session.requestedCount) > session.questions.length) {
      setPendingQuiz({ sessionId: session.id, questions: session.questions, count: Number(session.requestedCount), difficulty: session.questions[0]?.difficulty || "medium", reason: session.preparationShortfall || "The original requested set was only partially prepared." });
    }
    setQuizResumeState(session.progress || null);
    setActiveRequestedCount(session.requestedCount || session.questions.length);
    setQuestions(session.questions);
    setAdHocQuiz(session.isAdHoc !== false);
    setRound(Number.isInteger(session.roundIndex) ? session.roundIndex : 0);
    const nextId = quizSessionCounter.current + 1;
    quizSessionCounter.current = nextId;
    setQuizSessionId(nextId);
    setCompletedQuizSessionId(null);
  }, []);

  const referenceDetailsRef = useRef(null);

  // Keep busy states useful without presenting elapsed time in two different places. The
  // preparation card owns progress; buttons should only say what is happening.
  const busyLabel = busy || "";

  // atomMastery is computed against the CURRENT atom list, so it has to recompute whenever atoms
  // themselves load or change (initial async load, a re-extraction) — not just at round/quiz end.
  useEffect(() => { refreshAtomMastery(atoms); }, [atoms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shell keys this component by lecture id, so switching lectures remounts it
  // with fresh state instead of needing a synchronous reset in here.
  useEffect(() => {
    let alive = true;
    loadLecture(lecture, { fetchContent: fetchLectureContent, userId }).then((r) => {
      if (!alive) return;
      setAtoms(r.atoms); setLectureChunks(r.chunks || []); setText(r.text); setImages(r.images || []); setStage(r.stage);
      if (r.error) setError(r.error);
    });
    return () => { alive = false; };
  }, [lecture, userId]);

  useEffect(() => {
    if (objectiveResource.loading || !text || !lecture?.id) return;
    const sourceObjectives = lectureSourceObjectives(text, lecture, blockId);
    if (!sourceObjectives.length) return;
    const commands = createObjectiveCommands({
      read: () => objectivesStore.read(userId) || {},
      write: next => objectivesStore.write(userId, next),
      notify: () => window.dispatchEvent(new CustomEvent("rxt-objectives-updated")),
    });
    const repaired = commands.repairSourceLinks(blockId, lecture, sourceObjectives);
    if (repaired) setObjectiveNotice("Lecture objective links repaired from the source codes. Your notes and practice history were preserved.");
  }, [text, lecture, blockId, userId, objectiveResource.loading, objectiveResource.data]);

  const recoverObjectives = useCallback(async (sourceText) => {
    if (objectiveResource.loading) throw new Error("Objectives are still syncing. Try again in a moment.");
    const found = await extractObjectivesFromLecture(sourceText, { ...lecture, chunks: lectureChunks }, blockId);
    if (!found.length) throw new Error("No explicit objectives recovered from the stored text. The atoms have been preserved.");
    const commands = createObjectiveCommands({
      read: () => objectivesStore.read(userId) || {},
      write: (next) => objectivesStore.write(userId, next),
      notify: () => window.dispatchEvent(new CustomEvent("rxt-objectives-updated")),
    });
    commands.replaceLectureObjectives(blockId, lecture?.id, found);
    setObjectiveNotice(`${found.length} lecture objectives recovered and linked; cloud sync is queued.`);
    return found;
  }, [lecture, lectureChunks, blockId, userId, objectiveResource.loading]);

  const runExtract = useCallback(async (sourceText) => {
    setBusy("Reading the lecture…"); setError("");
    try {
      let objectivesForTagging = lectureObjectives;
      try {
        if (!lectureObjectives.length) objectivesForTagging = await recoverObjectives(sourceText);
      } catch (e) {
        setError(`Objective recovery: ${e?.message || String(e)}`);
      }
      // Defer persistence until after objective tagging so this extraction
      // writes the lecture's atom document only once.
      const r = await extractAtoms({ ...lecture, chunks: lectureChunks }, sourceText, {
        callAIJSON, userId, objectives: objectivesForTagging, onProgress: setBusy,
      });
      if (r.error) {
        const suffix = /timed out/i.test(r.error)
          ? " Check that the local LLM bridge is running, then retry."
          : " Retry extraction; no quiz was started.";
        setError(`${r.error}${suffix}`);
        return;
      }
      let finalAtoms = r.atoms;
      if (objectivesForTagging.length) {
        setBusy("Matching atoms to lecture objectives…");
        const tagged = await tagAtomsWithObjectives(r.atoms, objectivesForTagging, { callAIJSON });
        finalAtoms = tagged.atoms || r.atoms;
        if (tagged.error) setError(`Atoms extracted; some objective links still need review: ${tagged.error}`);
      }
      // Save once, after tagging. If it fails, keep the in-session atoms but
      // make the persistence failure visible so this can be retried.
      try { await saveLectureAtoms(userId, lecture?.id, finalAtoms, { ...lecture, chunks: lectureChunks }); }
      catch (e) { setError(`Atoms extracted, but their objective links did not save: ${e?.message || String(e)}`); }
      setAtoms(finalAtoms);
      setStage("quiz");
      if (r.warning) setError(r.warning);
      // Update cross-lecture atom index (non-blocking, non-critical)
      try { atomTermIndex.upsertLectureAtoms(userId, blockId, lecture?.id, finalAtoms); } catch { /* ok */ }
    } catch (e) {
      setError(`Lecture extraction failed: ${e?.message || String(e)} Check the local LLM bridge and retry.`);
    } finally {
      // Every success, returned error, thrown exception and timeout must make
      // the page interactive again.
      setBusy("");
    }
  }, [lecture, lectureChunks, userId, blockId, recoverObjectives, lectureObjectives.length]);

  const onFile = useCallback(async (file) => {
    if (!file) return;
    const uploaded = await file.text();
    // This one-file path has no per-slide metadata; never audit it against
    // chunks from a previously loaded source revision.
    setLectureChunks([]);
    setText(uploaded);
    if (uploaded.trim().length < 200) { setError("That file has almost no text in it."); return; }
    await runExtract(uploaded);
  }, [runExtract]);

  const objectiveById = useMemo(
    () => new Map(lectureObjectives.map((o) => [o.id, o])),
    [lectureObjectives]
  );

  const untagged = atoms.filter((a) => !a.objectiveIds?.length).length;


  /**
   * Tag atoms to the objectives they serve. This is the join SP2's learner
   * model reads: a missed question on an atom becomes evidence against the
   * objective the curriculum is written in.
   */
  const runTagging = useCallback(async () => {
    setBusy("Matching atoms to objectives…"); setError("");
    const r = await tagAtomsWithObjectives(atoms, lectureObjectives, { callAIJSON });
    setBusy("");
    if (r.error && !r.tagged) { setError(r.error); return; }
    if (r.error) setError(`Partly tagged (${r.byTerm} by name): ${r.error}`);
    setAtoms(r.atoms);
    try {
      await saveLectureAtoms(userId, lecture?.id, r.atoms, lecture);
    } catch (e) {
      setError(`Tagged, but saving failed: ${e?.message || String(e)}`);
    }
  }, [atoms, lectureObjectives, lecture, userId]);

  /**
   * Pick the lecture's folder and get cards back: harvest the figures its markdown references,
   * label them against the local bridge, and show them for review. Nothing is uploaded here —
   * that waits for `confirmFigures`, so a figure you reject never leaves the machine.
   *
   * The lecture's own markdown is what says which images belong to it and what text surrounds
   * them, so a folder without it cannot be placed.
   */
  const onFigures = useCallback(async (files) => {
    setError("");
    const mdFile = files.find((f) => /\.(md|markdown)$/i.test(f.name));
    const markdown = mdFile ? await mdFile.text() : text;
    if (!markdown) {
      setError("Include the lecture's .md in the selection — it says which figures belong where.");
      return;
    }

    setBusy("Reading the folder…");
    const candidates = await selectCandidates({ files, markdown });
    if (!candidates.length) {
      setBusy("");
      setError("No figures in that folder — either it has none, or they are all too small to be content.");
      return;
    }

    // Shown as soon as they exist: labelling adds captions, it is not what makes them reviewable.
    setFigures(candidates.map((c) => ({ ...c, kind: "unlabelled", shows: "", keep: true })));

    // A folder pre-labelled by scripts/label-lecture-images.mjs skips straight to review —
    // relabelling it would spend minutes to arrive at the same captions.
    const stored = await readStoredLabels(files);
    if (stored) {
      setFigures(applyStoredLabels(candidates, stored));
      setBusy("");
      return;
    }

    setBusy(`Labelling ${candidates.length} figures…`);
    const labelled = await labelCandidates(candidates, {
      complete: bridgeComplete,
      onProgress: (n, total) => setBusy(`Labelling figures… ${n}/${total}`),
    });
    setFigures(labelled);
    setBusy("");
  }, [text]);

  /** Upload only what survived review, then remember it on the lecture. */
  const confirmFigures = useCallback(async () => {
    const kept = figures.filter((f) => f.keep && f.kind !== "decorative");
    if (!kept.length) return;
    setBusy("Uploading figures…");
    const byName = new Map(kept.map((f) => [f.name, f.file]));
    // A figure kept without a label still has to have a kind, or nothing will ever render it.
    // "diagram" is the neutral choice: it claims the least about what the picture is.
    const manifest = kept.map((f) => ({
      file: f.name,
      kind: f.kind === "unlabelled" ? "diagram" : f.kind,
      shows: f.shows,
      context: f.context,
    }));
    const stored = await uploadLectureImages(userId, lecture?.id, manifest, byName, (n, total) =>
      setBusy(`Uploading figures… ${n}/${total}`)
    );
    setBusy("");
    if (!stored.length) {
      setError("Upload failed — the figures are still selected, try again.");
      return;
    }
    setImages(stored);
    setFigures(null);
    try {
      await saveLectureImages(userId, lecture?.id, stored);
    } catch (e) {
      setError(`Figures loaded for this session but not saved: ${e?.message || e}`);
    }
  }, [figures, lecture, userId]);

  const rounds = useMemo(() => prioritizeAtomRounds(atoms, focusObjectiveIds), [atoms, focusObjectiveIds]);
  /** Questions for one round only — five atoms, with mastered-objective skip + HY sort. */
  const runRound = useCallback(async (index) => {
    if (schoolExamplesLoading) {
      setError("Your uploaded school examples are still loading. Try again in a moment.");
      return;
    }
    const roundAtoms = rounds[index];
    if (!roundAtoms?.length) return;
    setBusy("Writing questions…"); setError(""); setQuestions(null);

    // Progressive difficulty, starting from what you've already earned on this
    // lecture rather than always at round-1-easy — same accuracy-based default
    // Quiz mode uses, so the two surfaces agree.
    const baseDifficulty = resolveDefaultDifficulty(questionStats.statsForLecture(userId, lecture?.id).accuracy);
    const difficulty = roundDifficulty(baseDifficulty, index);

    // Cross-lecture partition: skip atoms whose objectives are all mastered, flag recurring ones
    const termIndex = atomTermIndex.read(userId, blockId) || {};
    const { toQuiz, skipped } = partitionAtomsForRound(roundAtoms, termIndex, objectiveById);
    setSkippedAtoms(skipped);

    const quizAtoms = toQuiz.length ? toQuiz : roundAtoms; // fallback: quiz all if nothing left
    const generatedHistory = generatedQuestionsStore.questionsForAllLectures(userId);
    const r = await quizFromAtoms({ ...lecture, images }, quizAtoms, {
      callAIJSON,
      userId,
      exemplars: schoolExemplars,
      objectives: [...objectiveById.values()],
      lectureText: text,
      count: ROUND_SIZE,
      difficulty,
      clinicalCorrelateLibrary,
      avoidStems: generatedHistory.map((q) => q.stem).filter(Boolean),
    });
    setBusy("");
    if (r.error) { setError(r.error); return; }
    if (!r.questions?.length) {
      setError(
        r.reason || r.error || "No reviewed questions were prepared. Please retry."
      );
      return;
    }
    // Stamp each question with _isHighYield from its source atom
    const hyKeys = new Set(quizAtoms.filter((a) => a.isHighYield).map((a) => normAtomKey(a.term)));
    const questions = (r.questions || []).map((q) =>
      q.topic && hyKeys.has(normAtomKey(q.topic)) ? { ...q, _isHighYield: true } : q
    );
    if (lecture?.id) generatedQuestionsStore.addQuestions(userId, lecture.id, questions);

    setRound(index);
    setAdHocQuiz(false);
    startQuizSession(questions, { isAdHoc: false, roundIndex: index });
  }, [lecture, text, images, rounds, userId, blockId, objectiveById, logActivity, startQuizSession, schoolExemplars, schoolExamplesLoading, clinicalCorrelateLibrary]);

  /**
   * "Quiz this lecture" — any count, any difficulty, drawn from real atoms same as a Study
   * round (startObjectiveQuiz prioritizes not-yet-complete atoms per Q4), just not sliced into
   * a fixed 5-atom round. Was a Shell-level generation call handed off to a separate top-level
   * overlay; now it's the same runner Study rounds already use, so there is exactly one place
   * questions get shown, one place answers get recorded, one place objective status updates.
   *
   * focusObjectiveIds (a pre-read's gaps, when this quiz was launched from Today) moves those
   * objectives to the front — startObjectiveQuiz's own weakest-first sort still applies within
   * and after that, it's a priority order, not a filter.
   */
  const orderedObjectives = useMemo(() => {
    const adaptiveObjectives = objectivesWithPracticeEvidence(lectureObjectives, learnerEvidence.data);
    if (!focusObjectiveIds?.length) return adaptiveObjectives;
    const rank = (o) => {
      const i = focusObjectiveIds.indexOf(o.id || o.code);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return adaptiveObjectives
      .map((objective) => ({
        ...objective,
        _focusPriority: rank(objective) === Number.MAX_SAFE_INTEGER ? 1 : 0,
      }))
      .sort((a, b) => rank(a) - rank(b));
  }, [lectureObjectives, focusObjectiveIds, learnerEvidence.data]);

  const practiceExamDate=useMemo(()=>{ const raw = examDates?.[blockId]?.examDate ?? examDates?.[blockId]; const ms = raw ? Date.parse(raw) : NaN; return Number.isFinite(ms) ? ms : null; },[examDates,blockId]);
  const dismissedMisses=useStoreResource(dismissedMissesStore,userId);
  const missedCount=useMemo(()=>missedQuestionGroups(learnerEvidence.data||{},{blockId,lectureId:lecture?.id,dismissed:dismissedMisses.data}).reduce((n,group)=>n+group.questions.length,0),[learnerEvidence.data,blockId,lecture?.id,dismissedMisses.data]);

  const [, setPreparationDetails] = useState(null);
  useEffect(() => { setPreparationDetails(readQuestionDiagnostics(userId, lecture?.id)); }, [userId, lecture?.id]);
  const preparationRunRef = useRef(0);
  const preparationControllerRef = useRef(null);
  const [activeRequestedCount, setActiveRequestedCount] = useState(null);
  useEffect(() => {
    cancelOtherAccountJobs(userId);
    const job = getPreparationJob(preparationJobKey(userId, lecture?.id));
    const detach = job ? subscribePreparationJob(job, current => {
      preparationControllerRef.current = current.controller;
      if (current.latestProgress?.diagnostics) setPreparationDetails(current.latestProgress.diagnostics);
      if (current.status === "running") {
        setBusy("Preparing quiz…");
        setQuizPreparation(current.latestProgress || { requested: current.count, ready: current.questions.length, phase: "generating" });
      } else {
        setBusy(""); setQuizPreparation(null);
        const saved = new Map(generatedQuestionsStore.questionsForLecture(userId, lecture?.id).map(q => [q.stem, q]));
        const unseen = current.questions.filter(q => generatedQuestionsStore.isQuestionUnseen(saved.get(q.stem) || q));
        if (unseen.length) setPendingQuiz({ questions: unseen, count: current.count, difficulty: current.difficulty,
          reason: current.result?.reason || current.result?.error || "Your background questions are ready." });
        else if (current.result?.error) setError(preparationErrorMessage(current.result.error));
      }
    }) : () => {};
    return () => { detach(); preparationRunRef.current += 1; };
  }, [lecture?.id, userId]);

  const runQuiz = useCallback(async (count, difficulty, startingQuestions = [], continueSession = false, retestObjectives = null, transferFocus = "") => {
    if(checkpointPreparing)return;
    const connectionRows=repairTransferPlan(retestObjectives?.length?retestObjectives:orderedObjectives,learnerEvidence.data||{}).filter(row=>row.state!=="waiting");
    transferFocus=transferFocus||repairTransferPrompt(connectionRows.slice(0,3));
    const quizObjectives = lecturePracticeTargets(retestObjectives?.length ? objectivesWithPracticeEvidence(retestObjectives,learnerEvidence.data) : orderedObjectives,relationshipResource.data,learnerEvidence.data||{},connectionScope);
    if (!quizObjectives.length && mismatchedLectureObjectives.length) {
      setError("This lecture needs its objective links reviewed before questions can be prepared. Open More → Admin → Objective source and lecture links.");
      return;
    }
    const continuing = continueSession && !!quizMetaRef.current;
    const jobKey = preparationJobKey(userId, lecture?.id);
    if (getPreparationJob(jobKey)?.status === "running") {
      setError("Questions for this lecture are still being prepared in the background. Wait for that run to finish, then retry. Your answers are saved.");
      return;
    }
    preparationControllerRef.current?.abort();
    const controller = new AbortController();
    preparationControllerRef.current = controller;
    const runId = ++preparationRunRef.current;
    setActiveRequestedCount(count);
    setPreparationDetails(null);
    const generationVersion = "v2";
    if (schoolExamplesLoading) {
      setError("Your uploaded school examples are still loading. Try again in a moment.");
      return;
    }
    try {
    setPendingQuiz(null);
    setBusy("Preparing quiz…"); setError(""); setObjectiveNotice("");
    if (!continuing) setQuestions(null);
    setQuizPreparation({ requested: count, ready: 0, attempt: 0, phase: "generating" });

    const priorQuestions = lecture?.id
      ? generatedQuestionsStore.questionsForLecture(userId, lecture.id)
      : [];
    const generatedHistory = generatedQuestionsStore.questionsForAllLectures(userId);

    // Older checkpoints predate firstPresentedAt. Exclude their displayed prefix
    // too, so abandoning an unanswered question cannot make it "new" again.
    const previouslyPresented = new Set(lectureQuizSessionsStore.read(userId, lecture?.id, blockId)
      .flatMap(session => (session.questions || []).slice(0, Math.max(0, Number(session.progress?.i) || 0) + 1))
      .map(question => question.stem));
    const validReserve = new Set(locallyValidClinicalQuestions(priorQuestions));
    const adaptivePlan = buildAdaptiveObjectivePlan(quizObjectives, count);
    const adaptiveRank = new Map(adaptivePlan.map((objective, index) => [objective.id || objective.code, index]));
    const reserveCounts = new Map();
    const reservedForVariety = [];
    const seedQuestions = (Array.isArray(startingQuestions) ? startingQuestions : [])
      .filter((question) => question?.stem && (continuing || hasReusableQuestionReview(question)))
      .slice(0, count);
    const seedStems = new Set(seedQuestions.map((question) => String(question.stem).trim().toLowerCase()));
    const reserve = [...seedQuestions, ...priorQuestions
      .filter((question) => question.generationMode !== "grounded-fallback")
      .filter((question) => (question.generationVersion || "v2") === generationVersion)
      .filter((question) => validReserve.has(question))
      .filter(hasReusableQuestionReview)
      .filter((question) => !questionRatingsStore.ratingFor(userId, question)?.sourceIssue)
      .filter(generatedQuestionsStore.isQuestionUnseen)
      .filter(question => !previouslyPresented.has(question.stem))
      .filter((question) => !question.difficulty || String(question.difficulty).toLowerCase() === difficulty)
      .sort((a, b) => {
        const questionRank = (question) => Math.min(
          ...(question.objectiveIds || []).map((id) => adaptiveRank.get(id) ?? Number.MAX_SAFE_INTEGER),
          Number.MAX_SAFE_INTEGER
        );
        return questionRank(a) - questionRank(b)
          || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      })
      .filter(question => !seedStems.has(String(question.stem).trim().toLowerCase()))
      .filter(question => {
        const objective = adaptivePlan.find(item => question.objectiveIds?.includes(item.id || item.code));
        if (!objective || !isReusableForObjective(question, objective)) return false;
        if (objective._targetOrder === "third-order" && question.reasoningAudit?.orderLevel !== "third-order") return false;
        const id = objective.id || objective.code;
        const used = reserveCounts.get(id) || 0;
        if (used >= objective._targetQuestionCount) return false;
        if (exceedsAnswerConcentration(question, [...seedQuestions, ...reservedForVariety], count)) return false;
        reserveCounts.set(id, used + 1);
        reservedForVariety.push(question);
        return true;
      })]
      .slice(0, count);
    const originalSchoolItems = continuing ? schoolContinuationQuestions({
      banks: questionBanksRes.data || {}, metadata: questionBankMetaRes.data || {}, lecture, blockId,
      missing: Math.max(0, count - reserve.length), difficulty,
      history: [...generatedHistory, ...reserve], ratings: questionRatingsStore.read(userId).ratings || {},
      answeredKeys: answeredQuestionKeys(learnerEvidence.data?.evidenceJournal || []),
    }) : [];
    reserve.push(...originalSchoolItems);
    if (originalSchoolItems.length) setObjectiveNotice(`Added ${originalSchoolItems.length} unseen original school question${originalSchoolItems.length === 1 ? "" : "s"} to continue this quiz. Original wording and answer keys are preserved.`);
    const missing = Math.max(0, count - reserve.length);
    if (!missing) {
      setBusy("");
      setAdHocQuiz(true);
      if (continuing) {
        setQuestions(reserve);
        quizMetaRef.current = { ...quizMetaRef.current, questions: reserve, requestedCount: count, originalRequestedCount: count, preparationShortfall: null };
        lectureQuizSessionsStore.save(userId, quizMetaRef.current);
      } else startQuizSession(reserve);
      setQuizPreparation(null);
      return;
    }

    // Open after a reviewed starter batch; append without restarting the session.
    // Requested count remains visible even if later preparation stops.
    let startedEarly = continuing;
    let progressiveQuestions = [...reserve];
    const appendPrepared = (batch = []) => {
      const known = new Set(progressiveQuestions.map((question) => String(question?.stem || "").trim().toLowerCase()));
      for (const question of batch) {
        const key = String(question?.stem || "").trim().toLowerCase();
        if (!key || known.has(key)) continue;
        known.add(key);
        progressiveQuestions.push({ ...question, objectiveTexts: question.objectiveTexts?.length ? question.objectiveTexts
          : (question.objectiveIds || []).map(id => objectiveById.get(id)).filter(Boolean).map(objective => ({ id: objective.id, code: objective.code || "", text: objective.objective || objective.text || objective.title || "" })).filter(objective => objective.text) });
      }
      progressiveQuestions = progressiveQuestions.slice(0, count);
      if (preparationRunRef.current !== runId) return;
      if (!startedEarly && progressiveQuestions.length >= 1) {
        startedEarly = true;
        setAdHocQuiz(true);
        startQuizSession([...progressiveQuestions], { expectedCount: count });
      } else if (startedEarly) {
        setQuestions([...progressiveQuestions]);
        if (quizMetaRef.current) {
          quizMetaRef.current = { ...quizMetaRef.current, questions: [...progressiveQuestions] };
          lectureQuizSessionsStore.save(userId, quizMetaRef.current);
        }
      }
    };
    if (reserve.length) appendPrepared([]);

    let preparationDeps;
    try {
      preparationDeps = await questionPreparationDeps(callAIJSON);
    } catch (error) {
      controller.abort();
      if (preparationRunRef.current === runId) {
        setBusy("");
        setQuizPreparation(null);
        setError(preparationErrorMessage(error));
      }
      return;
    }
    if (preparationRunRef.current !== runId || controller.signal.aborted) return;
    const preparationBudget = questionPreparationBudget(missing, preparationDeps.localFallbackAvailable);
    // After the first pass, a share of the quiz joins this lecture with an
    // earlier one (IMCQ/ESoft style). Retests stay on their target objectives.
    let crossLecturePartner = null;
    if (!retestObjectives?.length && lecture?.id) {
      try {
        crossLecturePartner = await lectureQuizPartner({
          userId, lecture: { ...lecture, blockId: lecture.blockId || blockId }, lectures: lecturesStore.read(userId) || [],
          blockObjectives: selectBlockObjectives(objectiveResource.data, blockId),
          firstPassComplete: lectureCompletion(lectureObjectives, learnerEvidence.data || {}).complete,
          termIndex: atomTermIndex.read(userId, blockId) || {},
          schoolQuestions: Object.values(questionBanksRes.data || {}).flat(),
          evidenceObjectives: learnerEvidence.data?.objectives || {},
        }, { fetchContent: fetchLectureContent });
      } catch { crossLecturePartner = null; }
    }
    if (preparationRunRef.current !== runId || controller.signal.aborted) return;
    const job = startPreparationJob(jobKey, { userId, controller, count, difficulty, initialQuestions: reserve }, currentJob => withDeadline(async (signal) => prepareObjectiveQuiz(
      {
        objectives: quizObjectives,
        evidenceModel: learnerEvidence.data,
        initialQuestions: reserve,
        plannedCount: count,
        lectureTitle: title,
        lectureText: text,
        sourcePages: connectionScope.pages,
        reasoningPolicy: quizObjectives.some(o=>o._connectionTargetIds?.length)?"challenge":"school",
        lectureIdHint: lecture?.id,
        blockId,
        atoms,
        difficulty,
        generationVersion,
        questionCount: missing,
        userId,
        exemplars: schoolExemplars,
        clinicalCorrelateLibrary,
        feedback: questionRatingsStore.feedbackFor(userId, lecture?.id, generationVersion),
        avoidStems: generatedHistory.map((q) => q.stem).filter(Boolean),
        avoidQuestions: generatedHistory,
        focusNotes: [reasoningGuidance(learnerEvidence.data?.testTaking?.missTypes, missing),transferFocus].filter(Boolean).join("\n\n"),
        ...(crossLecturePartner ? { crossLecturePartner, crossLectureShare: LECTURE_QUIZ_CROSS_SHARE } : {}),
      },
      {
        ...preparationDeps,
        ensureObjectiveParts,
        // Leave time to return the detailed engine result before the outer guard.
        maxPreparationMs: preparationBudget - 5000,
        signal,
        onAccepted: (questions) => {
          if (lecture?.id) generatedQuestionsStore.addQuestions(userId, lecture.id, questions);
          currentJob.accept(questions);
          if (preparationRunRef.current === runId) appendPrepared(questions);
        },
      },
      (progress) => {
        currentJob.progress({ ...progress, requested: count, ready: reserve.length + progress.ready });
        if (progress.diagnostics) saveQuestionDiagnostics(userId, lecture?.id, { ...progress.diagnostics, requested: count, accepted: reserve.length + progress.diagnostics.accepted });
        if (preparationRunRef.current === runId) {
        setQuizPreparation({ ...progress, requested: count, ready: reserve.length + progress.ready });
        if (progress.diagnostics) { const report = { ...progress.diagnostics, requested: count, accepted: reserve.length + progress.diagnostics.accepted }; setPreparationDetails(report); saveQuestionDiagnostics(userId, lecture?.id, report); }
      } }
    ), preparationBudget, controller.signal, "Quiz preparation").catch(error => recoverPreparationFailure(currentJob,error)));
    const result = await job.promise;
    if (preparationRunRef.current !== runId) return;
    // The outer deadline can finish before cancelled jobs deliver their last
    // progress callback. Invalidate this run before clearing the UI so a late
    // callback cannot resurrect the spinner or append questions to the session.
    preparationRunRef.current += 1;
    controller.abort();
    setQuizPreparation(null);
    if (result.diagnostics) { const report = { ...result.diagnostics, requested: count, accepted: reserve.length + result.diagnostics.accepted }; setPreparationDetails(report); saveQuestionDiagnostics(userId, lecture?.id, report); }
    setBusy("");
    if (startedEarly) {
      // Preserve the learner's requested target. Previously the progressive
      // session was silently relabeled to its shorter prepared length here,
      // which hid the shortfall and discarded the retry path.
      setActiveRequestedCount(count);
      if (quizMetaRef.current) {
        const reason = preparationErrorMessage(result.reason || result.error, "Remaining questions did not pass review.");
        quizMetaRef.current = { ...quizMetaRef.current, originalRequestedCount: count, requestedCount: count, preparationShortfall: reason };
        lectureQuizSessionsStore.save(userId, quizMetaRef.current);
      }
      if (progressiveQuestions.length < count) {
        const reason = preparationErrorMessage(result.reason || result.error, "Remaining questions did not pass review.");
        setPendingQuiz({ sessionId: quizMetaRef.current?.id, questions: [...progressiveQuestions], count, difficulty, reason });
        setObjectiveNotice("");
      }
      return;
    }
    const attachObjectiveTexts = (items) => items.map((question) => ({
      ...question,
      objectiveTexts: question.objectiveTexts?.length
        ? question.objectiveTexts
        : (question.objectiveIds || []).map((id) => objectiveById.get(id)).filter(Boolean).map((objective) => ({
          id: objective.id,
          code: objective.code || "",
          text: objective.objective || objective.text || objective.title || "",
        })).filter((objective) => objective.text),
    }));
    const retainPartialQuiz = (items, detail) => {
      const partial = attachObjectiveTexts(items);
      if (lecture?.id) generatedQuestionsStore.addQuestions(userId, lecture.id, partial);
      setPendingQuiz({ questions: partial, count, difficulty, reason: preparationErrorMessage(detail) });
      setObjectiveNotice("");
      setQuizPreparation(null);
    };
    if (result.error) {
      setQuizPreparation(null);
      if (progressiveQuestions.length) {
        retainPartialQuiz(progressiveQuestions, result.reason || result.error);
        return;
      }
      // Saved questions are an offline/error fallback, never the default path. Reusing them
      // before generation made a requested harder round repeat the exact prior quiz.
      const matching = reserve.filter((q) =>
        hasReusableQuestionReview(q) &&
        q.generationMode !== "grounded-fallback" &&
        (q.generationVersion || "v2") === generationVersion &&
        generatedQuestionsStore.isQuestionUnseen(q) && !previouslyPresented.has(q.stem) &&
        validReserve.has(q) &&
        String(q?.difficulty || "").toLowerCase() === difficulty &&
        (!quizObjectives.length || q.objectiveIds?.length)
      );
      if (matching.length >= count) {
        startQuizSession([...matching].sort(() => Math.random() - 0.5).slice(0, count));
        setAdHocQuiz(true);
        setQuizPreparation(null);
        return;
      }
      if (lecture?.id && result.questions?.length) {
        generatedQuestionsStore.addQuestions(userId, lecture.id, result.questions);
      }
      setError(result.error);
      return;
    }
    if (progressiveQuestions.length < count && !result.questions?.length) {
      setQuizPreparation(null);
      setError(
        result.reason || result.error || "No reviewed questions were prepared. Please retry."
      );
      return;
    }
    if (result.incomplete || progressiveQuestions.length < count) {
      if (progressiveQuestions.length) {
        retainPartialQuiz(progressiveQuestions, result.reason || result.error || "The remaining questions did not pass preparation checks.");
      } else {
        setQuizPreparation(null);
        setError(`No questions could be prepared for this ${count}-question quiz. Retry after the source is available.`);
      }
      return;
    }
    if (result.warning) setObjectiveNotice(result.warning);
    const questionsWithObjectiveText = attachObjectiveTexts([...reserve, ...(result.questions || [])].slice(0, count));
    if (lecture?.id) generatedQuestionsStore.addQuestions(userId, lecture.id, questionsWithObjectiveText);
    setAdHocQuiz(true);
    startQuizSession(questionsWithObjectiveText);
    setQuizPreparation(null);
    } catch (error) {
      if (preparationRunRef.current === runId) { setBusy(""); setQuizPreparation(null); setError(error?.message || "Quiz preparation failed. Please retry."); }
    }
  }, [checkpointPreparing, orderedObjectives, title, text, blockId, atoms, userId, lecture?.id, logActivity, startQuizSession, schoolExemplars, schoolExamplesLoading, clinicalCorrelateLibrary, objectiveById, learnerEvidence.data, mismatchedLectureObjectives.length, questionBanksRes.data, questionBankMetaRes.data, lecture, connectionScope, relationshipResource.data, objectiveResource.data, lectureObjectives]);

  // Prepare at most one small reserve batch per active quiz, never on page load.
  // Background work only saves unseen questions; it does not create a session or grade answers.
  const prefetchQuizRef = useRef(null);
  const prefetchInFlightRef = useRef(false);
  useEffect(() => {
    if (quizPreparation || busy || !questions?.length || !lecture?.id || !userId || schoolExamplesLoading || prefetchInFlightRef.current) return;
    // A stopped short quiz must not immediately launch another hidden refill.
    if (activeRequestedCount > questions.length || pendingQuiz) return;
    const key = `${userId}:${lecture.id}:${quizSessionId}`;
    if (prefetchQuizRef.current === key) return;
    prefetchQuizRef.current = key;
    const history = generatedQuestionsStore.questionsForAllLectures(userId);
    const activeStems = new Set(questions.map(question => question.stem));
    const pool = generatedQuestionsStore.questionsForLecture(userId, lecture.id);
    const unused = pool.filter(question => generatedQuestionsStore.isQuestionUnseen(question)
      && hasReusableQuestionReview(question) && !activeStems.has(question.stem));
    if (unused.length >= PREPARE_BATCH_SIZE * 2) return;
    prefetchInFlightRef.current = true;
    void (async () => prepareObjectiveQuiz({
      objectives: orderedObjectives, evidenceModel: learnerEvidence.data,
      lectureTitle: title, lectureText: text, lectureIdHint: lecture.id, blockId, atoms, userId,
      difficulty: questions[0]?.difficulty || resolveDefaultDifficulty(qStats.accuracy), generationVersion: "v2",
      questionCount: PREPARE_BATCH_SIZE, exemplars: schoolExemplars, clinicalCorrelateLibrary,
      avoidStems: [...history, ...questions].map(question => question.stem).filter(Boolean),
      avoidQuestions: [...history, ...questions],
    }, {
      ...await questionPreparationDeps(callAIJSON), ensureObjectiveParts, maxPrepareAttempts: 1, maxPreparationMs: 90000, prepareConcurrency: 1,
      onAccepted: batch => generatedQuestionsStore.addQuestions(userId, lecture.id, batch),
    }))().catch(() => {}).finally(() => { prefetchInFlightRef.current = false; });
  }, [quizPreparation, busy, questions, activeRequestedCount, pendingQuiz, lecture?.id, userId, quizSessionId, schoolExamplesLoading, orderedObjectives,
    learnerEvidence.data, title, text, blockId, atoms, schoolExemplars, clinicalCorrelateLibrary, qStats.accuracy]);

  const reviewableQuizQuestions = lecture?.id
    ? locallyValidClinicalQuestions(generatedQuestionsStore.questionsForLecture(userId, lecture.id))
      .filter((question) => generatedQuestionsStore.isQuestionReviewDue(question))
    : [];
  const runSavedQuiz = useCallback((count) => {
    const saved = locallyValidClinicalQuestions(
      lecture?.id ? generatedQuestionsStore.questionsForLecture(userId, lecture.id) : []
    );
    const due = saved.filter((question) => generatedQuestionsStore.isQuestionReviewDue(question));
    if (!due.length) {
      setError("No previous questions are due for review. The adaptive quiz will use unseen questions instead.");
      return;
    }
    const selected = [...due]
      .sort((a, b) => Number(b.lastCorrect === false) - Number(a.lastCorrect === false)
        || String(a.lastAnsweredAt || "").localeCompare(String(b.lastAnsweredAt || ""))
        || (Number(a.timesAnswered) || 0) - (Number(b.timesAnswered) || 0))
      .slice(0, Math.min(Math.max(1, Number(count) || due.length), due.length));
    setError("");
    setAdHocQuiz(true);
    startQuizSession(selected);
  }, [lecture?.id, startQuizSession, userId]);

  // An external "Quiz" click (Today/Lectures/ObjectiveTracker) opens the same picker the
  // in-page button opens — once per mount, so revisiting Study later for the same lecture
  // doesn't keep re-triggering it.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenQuiz || autoOpenedRef.current || stage !== "quiz" || !atoms.length) return;
    autoOpenedRef.current = true;
    setQuizPicker({ count: [5,10,15,20,25,50].includes(autoQuizCount) ? autoQuizCount : Math.min(50, Number(autoQuizCount) || 10) });
  }, [autoOpenQuiz, autoQuizCount, stage, atoms.length]);


  /*
   * The app cannot see your disk, so it can never say "this lecture has 21 figures waiting".
   * What it knows is that it holds none, which is enough to offer once and then get out of the
   * way — figures are optional, and a lecture without them just asks text-only questions.
   *
   * Rendered in BOTH views deliberately. Study auto-starts into questions, so the atoms screen
   * is somewhere you may never look; between rounds is the moment you are actually free to go
   * fetch a folder.
   */
  const figuresPrompt = stage === "quiz" && atoms.length > 0 && !images.length && !figures && !busy && (
    <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-2.5 hover:border-border-strong">
      <span className="text-xs text-text-2">
        No figures for this lecture yet — add its histology and diagrams
        <span className="ml-1.5 text-text-3">
          (pick the lecture's folder from your marker output · once per lecture · ~2 min)
        </span>
      </span>
      <span className="font-mono text-[12px] text-text-3">browse</span>
      <input type="file" multiple webkitdirectory="" directory="" className="hidden" disabled={!!busy||checkpointPreparing}
        onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; onFigures(f); }} />
    </label>
  );

  /*
   * Reviewing figures takes over the screen, before the questions branch gets a look in.
   *
   * The prompt that starts this is reachable from the quiz — which is the whole point, since
   * Study auto-starts there — so rendering the grid only on the atoms view meant clicking the
   * prompt appeared to do nothing at all. Picking figures is a task, not a side panel: it owns
   * the screen until you confirm or cancel, and the round is still there afterwards.
   */
  if (figures) {
    return (
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-text-3">{title} · figures</span>
          {busyLabel && <span className="font-mono text-[13px] text-text-3">{busyLabel}</span>}
        </div>
        {quizPreparation && <button type="button" className="mb-3 text-sm underline text-text-2" onClick={() => preparationControllerRef.current?.abort(new Error("Question preparation stopped. Reviewed questions are saved."))}>Stop preparation · keep ready questions</button>}
      {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
        <FigureReview
          figures={figures}
          busy={busy}
          onToggle={(i) => setFigures((prev) => prev.map((f, j) => (j === i ? { ...f, keep: !f.keep } : f)))}
          onKind={(i, kind) =>
            setFigures((prev) =>
              prev.map((f, j) => (j === i ? { ...f, kind, keep: kind !== "decorative" } : f))
            )
          }
          onConfirm={confirmFigures}
          onCancel={() => setFigures(null)}
        />
      </div>
    );
  }

  if (questions) {
    // An ad-hoc quiz has no "next round" to resume into — it's a one-shot session.
    const hasNext = !adHocQuiz && round + 1 < rounds.length;
    const stoppedShort = adHocQuiz && !quizPreparation && activeRequestedCount > questions.length;
    return (
      <div className="p-5">
        {objectiveNotice && !stoppedShort && <div role="status" className="mb-3 rounded-lg border border-accent bg-bg-elevated p-3 text-sm text-text-2">{objectiveNotice}</div>}
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            onClick={() => {
              // Atom mastery refreshes on exit; question totals subscribe live.
              refreshAtomMastery();
              setQuestions(null);
            }}
            className="font-mono text-xs text-text-3 hover:text-text-1"
          >
            ← back to lecture
          </button>
          <div className="text-right font-mono text-[13px] text-text-3">
            <div>
              {adHocQuiz
                ? quizPreparation
                  ? `${questions.length}/${quizPreparation.requested} questions ready · ${questions[0]?.difficulty || "medium"}`
                  : `${questions.length}-question quiz · ${questions[0]?.difficulty || "medium"}`
                : `round ${round + 1} of ${rounds.length} · ${roundLabel(round, rounds, atoms.length)} · ${questions[0]?.difficulty || roundDifficulty(resolveDefaultDifficulty(qStats.accuracy), round)}`}
            </div>
          </div>
        </div>
        {(skippedAtoms.length > 0 || questions?.some((q) => q._isHighYield)) && (
          <div className="mb-3 flex flex-wrap gap-2 font-mono text-[12px]">
            {skippedAtoms.length > 0 && (
              <span className="rounded bg-good/10 px-2 py-0.5 text-good">
                ✓ {skippedAtoms.length} atom{skippedAtoms.length === 1 ? "" : "s"} skipped — objectives already mastered
              </span>
            )}
            {questions?.filter((q) => q._isHighYield).length > 0 && (
              <span className="rounded bg-accent/10 px-2 py-0.5 text-accent">
                ⭐ {questions.filter((q) => q._isHighYield).length} high-yield — recurring across lectures
              </span>
            )}
          </div>
        )}
        {quizPreparation && <p role="status" aria-live="polite" className="mb-2 text-sm text-text-2">{quizPreparation.ready}/{quizPreparation.requested} questions ready · {questionPreparationStatus(quizPreparation)}</p>}
        {quizPreparation && <button type="button" className="mb-2 text-sm underline" onClick={() => preparationControllerRef.current?.abort(new Error("Question preparation stopped. Reviewed questions are saved."))}>Stop preparing more · keep ready questions</button>}

        <AtomQuiz
          key={quizSessionId}
          questions={questions}
          sessionKey={quizMetaRef.current?.id}
          initialState={quizResumeState}
          blockId={blockId}
          lectureId={lecture?.id ?? null}
          lectureTitle={renamedTitle || title}
          blockName={blockName}
          lectureNumber={lecture?.lectureNumber ?? lecture?.number ?? null}
          userId={userId}
          objectiveReport={<ObjectiveLearningReport objectives={lectureObjectives} evidence={learnerEvidence.data || {}} records={completedQuizRecords} busy={!!busy||checkpointPreparing}
            onReviewNotes={() => { setQuestions(null); setQuizResumeState(null); }}
            onRetest={({count,objectives,focusNotes})=>runQuiz(count, "medium", [], false, objectives,focusNotes)} />}
          expectedCount={activeRequestedCount || questions.length}
          preparationError={stoppedShort ? error || pendingQuiz?.reason || quizMetaRef.current?.preparationShortfall : null}
          onPrepareMore={stoppedShort && !busy ? () => runQuiz(activeRequestedCount, questions[0]?.difficulty || "medium", questions, true) : null}
          preparing={!!quizPreparation && quizPreparation.ready < quizPreparation.requested}
          onCheckpoint={checkpointLectureQuiz}
          onExit={() => { preparationRunRef.current += 1; setBusy(""); setQuizPreparation(null); setActiveRequestedCount(null); setQuestions(null); setQuizResumeState(null); }}
          onAnswer={() => {
            // Opening or abandoning a quiz is not study activity. Record the
            // lecture only after the learner actually submits an answer, once
            // per quiz session, so an immediate exit cannot mark it done today.
            if (loggedQuizActivityRef.current === quizSessionId) return;
            loggedQuizActivityRef.current = quizSessionId;
            logActivity?.({ lectureId: lecture?.id, activityType: "deep_learn", confidenceRating: null });
          }}
          onDone={({ correct = 0, total = 0, avgConfidence = 0, hasLandmines = false, records = [], allRecords = records } = {}) => {
            setCompletedQuizRecords(allRecords.filter(record => !questionRatingsStore.isExcluded(userId, record, "objective")));
            setCompletedQuizSessionId(quizSessionId);
            lectureQuizSessionsStore.remove(userId, quizMetaRef.current?.id);
            quizMetaRef.current = null;
            // Finished means submitted: offering "Retry"/"Start with N" here rebuilt the
            // same questions as a new quiz from question 1.
            setPendingQuiz(null);
            // An ad-hoc quiz doesn't advance the round-resume bookmark — there is no sequence
            // for it to be a position in. Linked answer evidence is recorded independently.
            const nextDone = adHocQuiz ? done : Math.max(done, round + 1);
            if (!adHocQuiz) {
              saveRoundProgress(userId, lecture?.id, nextDone);
              setDone(nextDone);
            }

            refreshAtomMastery();
            const score = total > 0 ? Math.round((correct / total) * 100) : 0;

            // A completed lecture quiz is real work for Today's frozen plan.
            // Previously only manual checkboxes/log buttons or 60% of Study
            // rounds could advance 0/3, even after a full 15-question quiz.
            if (total > 0 && lecture?.id) {
              markTodayLectureComplete(blockId, lecture.id);
              window.dispatchEvent(new CustomEvent("rxt-lecture-quiz-complete", {
                detail: { lectureId: lecture.id, total, correct },
              }));
            }

            // Signal Today to auto-check once ≥60% of rounds are complete
            if (rounds.length > 0 && nextDone / rounds.length >= 0.6 && lecture?.id) {
              window.dispatchEvent(new CustomEvent("rxt-lecture-progress-60", {
                detail: { lectureId: lecture.id },
              }));
            }

            // Write session outcome to performance store after every completed round
            try {
              const independent=records.filter(isIndependentAttempt);
              const hadHelp=independent.length!==records.length;
              if(!hadHelp || independent.length)performanceStore.appendSession(userId, {
                lectureId: lecture?.id,
                blockId,
                score:hadHelp?Math.round(100*independent.filter(r=>r.correct).length/independent.length):score,
                avgConfidence:hadHelp?independent.reduce((sum,r)=>sum+(r.confidence||0),0)/(5*independent.length):avgConfidence,
                hasLandmines:hadHelp?independent.some(r=>!r.correct&&r.confidence>=4):hasLandmines,
              });
            } catch { /* non-critical */ }

            // Linked answers already update objective evidence in AtomQuiz. A lecture-level
            // session score cannot establish practice or mastery for untouched objectives.
          }}
        />
        {isActiveQuizComplete(completedQuizSessionId, quizSessionId) && (
        <div className="mt-4 flex items-center gap-3">
          {hasNext ? (
            <>
              <Button onClick={() => runRound(round + 1)} disabled={!!busy||checkpointPreparing}>
                {busyLabel || `▸ Next round (${Math.min(ROUND_SIZE, atoms.length - (round + 1) * ROUND_SIZE)} atoms)`}
              </Button>
              <button onClick={() => setQuestions(null)} className="font-mono text-[12px] text-text-3 hover:text-text-1">
                stop here
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3 w-full">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={onClose}>← Back to Today</Button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    );
  }

  if(checkpointSession)return <main className="mx-auto max-w-[1120px] px-4 py-6"><Suspense fallback={<p>Loading independent checkpoint…</p>}><CheckpointRunner sessionId={checkpointSession} userId={userId} blockId={blockId} blockName={blockName} lectures={[lecture]} objectivesById={Object.fromEntries(lectureObjectives.map(o=>[o.id,o]))} lectureLabelsByLectureId={{[lecture.id]:title}} checkpointConnectionLabels={Object.fromEntries(relationshipRows.map(row=>[row.id,row.label]))} onExit={()=>setCheckpointSession(null)} /></Suspense></main>;

  const accuracyPct = qStats.accuracy == null ? 0 : Math.round(qStats.accuracy * 100);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:py-8">
      <header className="border-b border-border pb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button onClick={onClose} className="font-mono text-xs text-text-3 hover:text-text-1">← back</button>
        <div hidden={workspace!=="sources"}>
        {!confirmDeleteLecture ? (
          <div className="flex items-center gap-3">
            {onReExtract && (
              <button
                onClick={() => onReExtract(lecture)}
                className="font-mono text-[11px] text-accent hover:text-accent-text"
              >
                ↻ Re-extract PDF
              </button>
            )}
            <button onClick={() => setConfirmDeleteLecture(true)} className="font-mono text-[11px] text-text-3 hover:text-bad">delete lecture…</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded border border-bad/40 bg-bad/5 px-2 py-1">
            <span className="text-[12px] text-text-2">Permanently delete?</span>
            <button
              disabled={deletingLecture}
              onClick={async () => {
                setDeletingLecture(true); setError("");
                try {
                  await deleteLectureFully({ userId, lectureId: lecture?.id, blockId });
                  onClose?.();
                } catch (e) {
                  setError(`Delete failed: ${e?.message || String(e)}`);
                  setDeletingLecture(false);
                  setConfirmDeleteLecture(false);
                }
              }}
              className="rounded bg-bad px-2 py-0.5 text-[12px] font-bold text-white disabled:opacity-50"
            >
              {deletingLecture ? "Deleting…" : "Confirm"}
            </button>
            <button onClick={() => setConfirmDeleteLecture(false)} disabled={deletingLecture} className="text-[12px] text-text-3">Cancel</button>
          </div>
        )}
      </div>
        </div>
      <p className="mb-1 font-condensed text-xs font-semibold uppercase tracking-[0.16em] text-accent">Lecture</p>
      <RenameLecture inline userId={userId} lectureId={lecture?.id} title={renamedTitle || title} onRenamed={(name) => { setRenamedTitle(name); onLectureRenamed?.(name); }} />
      </header>
      <LectureWorkspaceNav value={workspace} onChange={setWorkspace} />
      {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
      <LecturePanel name="progress" workspace={workspace} visited={visitedWorkspaces} aria-label="Lecture review progress">
      <MasteryLadderPanel defaultOpen objectives={lectureObjectives} evidence={learnerEvidence.data || {}} examDate={practiceExamDate} />
      <LectureProgressOverview historyLoading={learnerEvidence.loading} model={learnerEvidence.data || {}} ratings={questionRatingsStore.read(userId).ratings || {}} blockId={blockId} lectureId={lecture?.id} stats={qStats} objectivePractice={objectivePractice} relationshipRows={relationshipRows} />
      <LectureRetrievalEnrollment key={`${userId}:${blockId}:${lecture?.id}`} userId={userId} blockId={blockId} lectureId={lecture?.id} title={renamedTitle || title} reference={savedModelReference} rows={objectivePractice.rows} evidenceModel={learnerEvidence.data} examDate={examDates?.[blockId]?.examDate ?? examDates?.[blockId] ?? null} />


      </LecturePanel>
      <LecturePanel name="sources" workspace={workspace} visited={visitedWorkspaces} aria-label="Lecture sources">
      <details className="my-3 text-sm"><summary className="cursor-pointer">Older study-round tools</summary><p className="mt-2 text-xs text-text-3">Restart the legacy round bookmark without changing answers, objective evidence, or review history.</p>
              {done > 0 && (
                <button
                  onClick={() => { clearRoundProgress(userId, lecture?.id); setDone(0); setRound(0); }}
                  /* Resets only the in-session round bookmark (where the next Study pass picks
                     up) — atom mastery and question counts are the lecture's real history and
                     deliberately survive "start over", same as they always have. */
                  disabled={!!busy||checkpointPreparing}
                  className="font-mono text-[12px] text-text-3 underline decoration-dotted hover:text-text-1"
                >
                  Restart study-round bookmark
                </button>
              )}
      </details>
      <ReviewSourceStatus userId={userId} blockId={blockId} />
      <StudyGuidePanel userId={userId} blockId={blockId} lecture={lecture} objectives={lectureObjectives} />
      {lecture?.sourceFiles?.length > 0 && (
        <details id="lecture-sources" className="mt-3 max-w-4xl rounded-lg border border-border bg-panel px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-text-2">
            Source files · {lecture.sourceFiles.length} part{lecture.sourceFiles.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1">
            {lecture.sourceFiles.map((source) => (
              <li key={`${source.filename}-${source.part || ""}`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
                <span>{source.filename}</span>
                {source.storagePath && (sourceUrls[source.filename] ? (
                  <a className="text-accent underline" href={sourceUrls[source.filename]} target="_blank" rel="noreferrer">Open original PDF</a>
                ) : (
                  <button type="button" className="text-accent underline disabled:opacity-50" disabled={openingSource === source.filename} onClick={() => openOriginalSource(source)}>
                    {openingSource === source.filename ? "Preparing…" : "Open original PDF"}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
      </LecturePanel>
      <LecturePanel name="practice" workspace={workspace} visited={visitedWorkspaces} aria-label="Lecture practice follow-up">
      {examRepairContext && (examRepairContext.weakObjectives?.length || examRepairContext.missedQuestions?.length || examRepairContext.reportTopics?.length) > 0 && (
        <section id="lecture-repair" aria-label="Exam repair context" className="mt-4 rounded-lg border border-bad/30 bg-bad/5 p-3">
          <h3 className="font-semibold text-text-1">Review, then retest your weak areas</h3>
          {!!examRepairContext.reportTopics?.length && <p className="mt-1 text-sm text-text-2">Uploaded report topics to review: {examRepairContext.reportTopics.join("; ")}. These are report signals, not scored objective attempts.</p>}
          {!!examRepairContext.conceptsToReview?.length && <p className="mt-1 text-sm text-text-1"><strong>Concepts to revisit:</strong> {examRepairContext.conceptsToReview.join(" · ")}</p>}
          {examRepairContext.weakObjectives?.length > 0 && <>
            <p className="mt-1 text-sm text-text-2">Objectives below your target or with a recent miss are prioritized in your lecture quiz:</p>
            <ul className="mt-1 list-inside list-disc text-sm text-text-1">{examRepairContext.weakObjectives.slice(0, 6).map((objective) => <li key={objective.id}>{objective.label}{objective.attempts ? ` · ${objective.misses}/${objective.attempts} missed` : " · flagged struggling"}</li>)}</ul>
          </>}
          {examRepairContext.missedQuestions?.length > 0 && <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-accent">Review {examRepairContext.missedQuestions.length} unresolved missed question{examRepairContext.missedQuestions.length === 1 ? "" : "s"}</summary>
            <div className="mt-2 space-y-2">{examRepairContext.missedQuestions.map((miss) => <article key={miss.key} className="rounded border border-border bg-panel p-2 text-sm">
              <p className="font-medium text-text-1">{miss.stem}</p>
              <p className="mt-1 text-text-2"><span className="text-bad">Your answer:</span> {miss.selected} · <span className="text-good">Keyed answer:</span> {miss.correct}</p>
              {miss.explanation && <p className="mt-1 text-text-2"><strong>Source explanation / clinical connection:</strong> {miss.explanation}</p>}
              <p className="mt-0.5 text-xs text-text-3">{miss.title}{miss.submittedAt ? ` · ${new Date(miss.submittedAt).toLocaleDateString()}` : ""}</p>
            </article>)}</div>
          </details>}
        </section>
      )}
      {!questions && <UnfinishedLectureQuizzes sessions={savedLectureQuizzes} busy={!!busy||checkpointPreparing} onResume={resumeLectureQuiz} onDiscard={session=>{lectureQuizSessionsStore.remove(userId,session.id);setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId,lecture?.id,blockId).filter(item=>item.id!==session.id));}} />}

      </LecturePanel>
      <LecturePanel name="learn" workspace={workspace} visited={visitedWorkspaces} aria-label="Learn this lecture">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">Learn</h2>
          <span className="text-xs text-text-3">{lectureObjectives.length} objectives · {atoms.length} facts</span>
        </div>
        <PracticeModeTabs ariaLabel="Learn mode" value={learnMode} onChange={setLearnMode} modes={[
          { id: "connections", label: "Connections" },
          { id: "repairs", label: "Repairs" },
        ]} />
      </div>
      <div hidden={learnMode !== "connections"}>
      <ObjectiveConnections key={connectionMapKey(connectionScope)} userId={userId} catalog={relationshipResource.data||{}} evidence={learnerEvidence.data||{}} scope={connectionScope} loading={relationshipResource.loading||learnerEvidence.loading} error={relationshipResource.error} enabled={workspace==='learn'} busy={!!busy||checkpointPreparing||!!questions} onPractice={({count,objectives,focusNotes})=>runQuiz(count,resolveDefaultDifficulty(qStats.accuracy),[],false,objectives,focusNotes)} />
      <StudyGuidePanel mode="learn" userId={userId} blockId={blockId} lecture={lecture} objectives={lectureObjectives} />
      </div>

      </LecturePanel>
      <LecturePanel name="practice" workspace={workspace} visited={visitedWorkspaces} aria-label="Practice this lecture">
      {pendingQuiz && <div role="status" className="my-3 rounded-lg border border-border bg-panel p-3 text-sm">
        <strong>{pendingQuiz.questions.length}/{pendingQuiz.count} questions ready</strong>
        <p className="mt-1 text-text-2">Your ready questions are saved. Finish or exit the current quiz before retrying the remaining {pendingQuiz.count - pendingQuiz.questions.length} slots, or choose a shorter quiz.</p>
        <details className="mt-2 text-xs text-text-3"><summary className="cursor-pointer">Why preparation stopped</summary><p className="mt-1">{pendingQuiz.reason}</p></details>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => {
            const action = pendingQuizAction(pendingQuiz, savedLectureQuizzes, "retry");
            if (action.type === "resume-and-prepare") { resumeLectureQuiz(action.session); runQuiz(action.count, pendingQuiz.difficulty, action.session.questions, true); }
            else runQuiz(action.count, pendingQuiz.difficulty, action.questions);
          }} disabled={!!busy||checkpointPreparing || !!questions}>{pendingQuizAction(pendingQuiz, savedLectureQuizzes).type === "resume-and-prepare" ? "Resume and prepare the rest" : "Retry missing questions"}</Button>
          <Button onClick={() => {
            const action = pendingQuizAction(pendingQuiz, savedLectureQuizzes, "start");
            if (action.type === "resume") { quizMetaRef.current = action.session; lectureQuizSessionsStore.save(userId, action.session); resumeLectureQuiz(action.session); }
            else { setAdHocQuiz(true); startQuizSession(action.questions); }
            setPendingQuiz(null);
          }} disabled={!!busy||checkpointPreparing || !!questions}>{pendingQuizAction(pendingQuiz, savedLectureQuizzes).type === "resume-and-prepare" ? "Continue" : "Start"} with {pendingQuiz.questions.length}</Button>
        </div>
      </div>}
      {objectiveNotice && <p role="status" className="my-2 text-sm text-good">{objectiveNotice}</p>}
      {stage !== "loading" && !lectureObjectives.length && text.trim().length >= 200 && (
        <div className="my-3 flex flex-wrap items-center gap-3 rounded border border-warn/40 p-3">
          <span className="text-sm text-text-2">{objectiveResource.loading ? "Syncing lecture objectives…" : mismatchedLectureObjectives.length
            ? "Some objective links need review before this lecture can be quizzed. Use More → Admin → Objective source and lecture links."
            : "No objectives linked yet. Recover them from the saved lecture without replacing your atoms."}</span>
          {!mismatchedLectureObjectives.length && <Button variant="outline" disabled={!!busy||checkpointPreparing || objectiveResource.loading} onClick={async () => {
            setBusy("Recovering lecture objectives…"); setError("");
            try { await recoverObjectives(text); }
            catch (e) { setError(e?.message || String(e)); }
            finally { setBusy(""); }
          }}>{busy || "Recover lecture objectives"}</Button>}
        </div>
      )}


      {stage === "upload" && (
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">
            No stored text for this lecture — choose its .md {busy ? "" : "(from pdf2md)"}
          </span>
          <span className="font-mono text-[12px] text-text-3">{busy || "browse"}</span>
          <input type="file" accept=".md,.markdown,.txt" className="hidden" disabled={!!busy||checkpointPreparing}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
        </label>
      )}

      {stage === "extract" && (
        <div className="mb-4 flex items-center gap-3">
          <Button onClick={() => runExtract(text)} disabled={!!busy||checkpointPreparing}>
            {busyLabel || "▸ Extract the signal"}
          </Button>
          <span className="text-[12px] text-text-3">definitions, mechanisms, relationships, results — fluff dropped</span>
        </div>
      )}

      <section aria-label="Practice" className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-bg-elevated p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">Practice</h2>
          <button type="button" className="text-xs text-text-2 hover:text-text-1" title="Open the full mastery ladder" onClick={() => setWorkspace("progress")}>
            <LadderSummaryLine objectives={lectureObjectives} evidence={learnerEvidence.data || {}} examDate={practiceExamDate} /> <span aria-hidden="true">›</span>
          </button>
        </div>
        <PracticeModeTabs value={practiceMode} onChange={setPracticeMode} modes={[
          { id: "quiz", label: "Quiz" },
          { id: "weak", label: "Weak spots", badge: lectureWeakConcepts.length || null },
          { id: "missed", label: "Missed", badge: missedCount || null },
          { id: "checkpoint", label: "Checkpoint" },
        ]} />
        {practiceMode === "quiz" && (stage === "quiz" && atoms.length > 0 ? <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-text-2">Questions
                <select aria-label="Number of questions" value={quizPicker?.count ?? 10} onChange={(event) => setQuizPicker({ count: Number(event.target.value) })}
                  className="rounded border border-border bg-bg px-2 py-1 font-mono text-sm text-text-1">
                  {[5, 10, 15, 20, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <Button
                onClick={() => {
                  const count = quizPicker?.count ?? 10;
                  setQuizPreparation(null);
                  setQuizPicker(null);
                  runQuiz(count, resolveDefaultDifficulty(qStats.accuracy));
                }}
                disabled={!!busy||checkpointPreparing}
              >
                {busyLabel || `▸ Start ${quizPicker?.count ?? 10}-question quiz`}
              </Button>
              {reviewableQuizQuestions.length > 0 && (
                <Button variant="outline" disabled={!!busy||checkpointPreparing} title="Missed items return now; correct items return after 3, 7, then 14 days."
                  onClick={() => { const count = quizPicker?.count ?? 10; setQuizPicker(null); runSavedQuiz(count); }}>
                  ↻ Review {Math.min(quizPicker?.count ?? 10, reviewableQuizQuestions.length)} due
                </Button>
              )}
            </div>
            <p className="text-xs text-text-3">
              {qStats.loading ? "Loading your lecture performance…"
                : qStats.answered ? `${qStats.answered} answered · ${accuracyPct}% correct · starts at ${resolveDefaultDifficulty(qStats.accuracy)}`
                : "First quiz on this lecture"}
              {" · questions follow your mastery ladder"}
            </p>
          </div>

            {quizPreparation && (
            <div role="status" aria-live="polite" className="rounded-xl border border-accent/40 bg-bg-elevated p-4">
              <div className="flex items-center justify-between gap-3 text-sm font-semibold text-text-1">
                <span className="flex items-center gap-2">
                  {quizPreparation.ready < quizPreparation.requested && (
                    <span
                      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
                      aria-hidden="true"
                    />
                  )}
                  {quizPreparation.ready >= quizPreparation.requested
                  ? "Quiz ready"
                  : quizPreparation.phase === "refilling"
                    ? "Replacing questions that did not pass review"
                    : quizPreparation.phase === "reviewing"
                      ? "Checking accuracy and objective alignment"
                      : quizPreparation.phase === "fallback"
                        ? "Building grounded recall from your lecture"
                        : "Generating school-style questions"}
                </span>
                <span className="font-mono">{quizPreparation.ready}/{quizPreparation.requested} ready</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-border" aria-hidden="true">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((quizPreparation.ready / quizPreparation.requested) * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-text-3">{questionPreparationStatus(quizPreparation)}. Accepted questions stay saved. Preparation pauses if three replacement rounds add nothing.</p>
            </div>
          )}

          {lectureObjectives.length > 0 && untagged > 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-text-2">Lecture maintenance</summary>
            <div className="mt-2 flex items-center gap-3">
              <Button variant="outline" onClick={runTagging} disabled={!!busy||checkpointPreparing}>
                ◇ Tag atoms to objectives
              </Button>
              <span className="text-[12px] text-text-3">
                {untagged} of {atoms.length} untagged · {lectureObjectives.length} objectives
              </span>
            </div>
            </details>
          )}
          {images.length > 0 && (
            <span className="text-[12px] text-text-3">{images.length} figures attached</span>
          )}
          {!savedLectureQuizzes.length && recentLearningRecords.length > 0 && <details className="rounded-lg border border-border px-3 py-2 text-sm"><summary className="cursor-pointer font-semibold">Last quiz · what to repair</summary><div className="mt-2"><ObjectiveLearningReport objectives={lectureObjectives} evidence={learnerEvidence.data || {}} records={recentLearningRecords} busy={!!busy||checkpointPreparing} onRetest={({count,objectives,focusNotes})=>runQuiz(count,"medium",[],false,objectives,focusNotes)} /></div></details>}
        </div> : <p className="text-sm text-text-3">◇ Quizzes unlock once this lecture&apos;s text is extracted.</p>)}
        {practiceMode === "weak" && (lectureWeakConcepts.length ? <div>
          <p className="text-xs text-text-3">Concepts you have missed. Four fresh correct answers in a row clears one.</p>
          <ul className="mb-1 mt-1 divide-y divide-border">
            {lectureWeakConcepts.map((concept) => {
              const targets = objectivesForWeakConcept(concept, lectureObjectives);
              const focused = examRepairContext?.weakConcept && String(examRepairContext.weakConcept).toLowerCase() === String(concept.concept).toLowerCase();
              const recovery = Math.min(4, concept.consecutiveCorrect || 0);
              return <li key={concept.id || concept.concept} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${focused ? "font-semibold" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{focused ? "▸ " : ""}{concept.concept || concept.description}</p>
                  <p className="text-xs text-text-3" title="Recovery counts consecutive fresh answers without help. At 4/4 the concept leaves this list; the original misses stay in history.">✕ {concept.misses} missed · ✓ {concept.correct} correct · recovery {recovery}/4</p>
                  {!targets.length && <p className="text-xs">◇ Needs an objective link before targeted questions.</p>}
                </div>
                <Button variant="outline" className="px-3 py-1 text-xs" disabled={!!busy||checkpointPreparing || !targets.length} onClick={() => runQuiz(5, resolveDefaultDifficulty(qStats.accuracy), [], false, targets, `Test this weak concept specifically: ${concept.concept}. Use fresh second- or third-order applications tied to this lecture's linked objectives.`)}>Quiz · 5</Button>
              </li>;
            })}
          </ul>
        </div> : <p className="text-sm text-text-3">✓ No active weak concepts in this lecture.</p>)}
        {practiceMode === "missed" && <MissedQuestions bare userId={userId} evidence={learnerEvidence.data || {}} blockId={blockId} lectureId={lecture?.id} lectures={[lecture]} busy={!!busy||checkpointPreparing || !!questions} onReplay={items=>{setAdHocQuiz(true);startQuizSession(items);}} onStudy={()=>setWorkspace('learn')} />}
        {practiceMode === "checkpoint" && <LectureCheckpoint bare userId={userId} lecture={lecture} blockId={blockId} busy={!!busy||checkpointPreparing||!!questions||schoolExamplesLoading||learnerEvidence.loading} onOpenSession={setCheckpointSession} onWorkingChange={setCheckpointPreparing} config={{objectives:objectivesWithConnectionGaps(orderedObjectives,relationshipResource.data,learnerEvidence.data||{},connectionScope),evidenceModel:learnerEvidence.data,lectureText:text,sourcePages:connectionScope.pages,atoms,exemplars:schoolExemplars,difficulty:resolveDefaultDifficulty(qStats.accuracy)}} />}
      </section>

      </LecturePanel>
      <LecturePanel name="sources" workspace={workspace} visited={visitedWorkspaces} aria-label="Lecture figure tools">{figuresPrompt}<div className="mt-4"><ObjectiveCoverage atoms={atoms} objectives={lectureObjectives} examples={schoolExemplars} lectureText={text} lecture={lecture} blockId={blockId} /></div></LecturePanel>

      <LecturePanel name="learn" workspace={workspace} visited={visitedWorkspaces} id="lecture-reference" sectionRef={referenceDetailsRef}>
        <div>


      <div id="lecture-learning-plan" hidden={learnMode !== "repairs"}>
        <h3 className="mb-2 text-base font-semibold text-text-1">Model repairs &amp; clinical correlates</h3>
        <div className="space-y-4">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <ModelRepairs userId={userId} lectureId={lecture?.id} title={renamedTitle || title} atoms={atoms} objectives={lectureObjectives} chunks={lectureChunks} />
          </div>
          {clinicalCorrelateLibrary.length > 0 && (
            <details className="rounded-lg border border-border bg-bg-elevated p-3">
              <summary className="cursor-pointer text-sm font-semibold text-text-1">
                Quiz and exam clinical correlates ({clinicalCorrelateLibrary.length})
              </summary>
              <p className="mt-2 text-xs text-text-3">Lecture-matched correlates are deliberately sampled for recognition, mechanism, and discrimination practice. Repeated signals from uploaded questions supplement them.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {clinicalCorrelateLibrary.map((entry) => (
                  <div key={`${entry.label}-${entry.sourceKinds?.join("-")}`} className="rounded border border-border p-2 text-sm">
                    <div className="font-medium text-text-1">{entry.label}</div>
                    <div className="mt-1 text-xs text-text-3">{entry.curated ? `Priority ${entry.priority} · ${entry.sourcePage}` : `${entry.sourceKinds?.join(" · ")} · ${entry.frequency} references`}</div>
                    {entry.recognitionCue && <div className="mt-1 text-xs text-text-2">Recognize: {entry.recognitionCue}</div>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
        </div>
      </LecturePanel>
    </main>
  );
}

export default LectureStudyFlow;

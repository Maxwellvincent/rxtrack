/**
 * SP1 T2.1 — one surface for studying a lecture.
 *
 * Replaces the two upload modals (🔬 Extract, ❓ Quiz): instead of dropping a
 * file and throwing the result away, this runs against a lecture that already
 * exists in the store, and the atoms it extracts persist on that lecture. The
 * upload path survives here as the fallback for chunk-light lectures — which is
 * most of them, since only the active term keeps chunks in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { callAIJSON } from "../../../aiClient.js";
import {
  fetchLectureContent,
  fetchLectureSourceUrl,
  saveLectureAtoms,
  saveLectureImages,
  uploadLectureImages,
} from "../../../supabase.js";
import { HY_TYPES } from "../../../engine/highYield.js";
import { locallyValidClinicalQuestions } from "../../../engine/mcq.js";
import { reasoningGuidance } from "../../../engine/questionReasoning.js";
import { buildClinicalCorrelateLibrary } from "../../../engine/clinicalCorrelates.js";
import { tagAtomsWithObjectives } from "../../../engine/tagAtoms.js";
import { createObjectiveCommands, selectBlockObjectives, setStatus, storageKeyFor, toEntry } from "../../logic/objectives.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { resolveObjectiveTarget } from "../../logic/graduationGate.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import * as performanceStore from "../../../stores/performance.js";
import * as atomTermIndex from "../../../stores/atomTermIndex.js";
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
import { PREPARE_BATCH_SIZE, buildAdaptiveObjectivePlan, prepareObjectiveQuiz, readClinicalAnalysesForBlock, resolveDefaultDifficulty, selectClinicalExamplesForBlock, selectExemplarsForBlock } from "../objectives/quizLaunch.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import { useQuestionBankMeta } from "../../hooks/useQuestionBankMeta.js";
import { generateStudyGuide } from "../../../engine/studyGuide.js";
import * as studyGuideStore from "../../../stores/studyGuide.js";
import * as masterGuideStore from "../../../stores/masterGuide.js";
import { generateMentalModel } from "../../../engine/mentalModel.js";
import * as mentalModelStore from "../../../stores/mentalModel.js";
import * as mentalModelImpactStore from "../../../stores/mentalModelImpact.js";
import { ROUND_SIZE, prioritizeAtomRounds, extractAtoms, isActiveQuizComplete, loadLecture, quizFromAtoms, roundDifficulty, roundLabel, topicsToAutoCheck } from "./lectureStudy.js";
import {
  clearRoundProgress,
  readRoundProgress,
  resumeRound,
  saveRoundProgress,
} from "./lectureProgress.js";
import * as questionStats from "../../../stores/lectureQuestionStats.js";
import * as atomProgressStore from "../../../stores/atomProgress.js";
import * as generatedQuestionsStore from "../../../stores/generatedQuestions.js";
import * as questionRatingsStore from "../../../stores/questionRatings.js";
import * as tutorSessionsStore from "../../../stores/tutorSessions.js";
import * as lectureQuizSessionsStore from "../../../stores/lectureQuizSessions.js";
import {
  createTutorSession,
  finishTutorSession,
  pauseTutorSession,
  resumeTutorSession,
  tickTutorSession,
  tutorSessionSummary,
  tutorStepPrompt,
  tutorPacingContext,
  extendTutorSession,
  recordTutorTurn,
  attachTutorCase,
} from "../../../engine/tutorSession.js";
import { deleteLectureFully } from "../../logic/deleteLecture.js";
import { RenameLecture } from "./RenameLecture.jsx";
import { ModelRepairs } from "./ModelRepairs.jsx";
import { LectureRetrievalEnrollment } from "./LectureRetrievalEnrollment.jsx";
import { ObjectiveCoverage } from "./ObjectiveCoverage.jsx";
import * as learnerEvidenceStore from "../../../stores/learnerEvidence.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { objectivePracticePlan } from "../../../engine/objectivePractice.js";

const TYPE_META = {
  definition: { label: "Definitions", hint: "what it is", accent: "border-l-accent" },
  mechanism: { label: "Mechanisms", hint: "how it works", accent: "border-l-good" },
  relationship: { label: "Relationships", hint: "how things relate", accent: "border-l-accent" },
  result: { label: "Results", hint: "the outcome", accent: "border-l-bad" },
};

const TIER_META = {
  anchor: { label: "Anchor", className: "border-accent/40 bg-accent/10 text-accent-text" },
  core: { label: "Core", className: "border-good/40 bg-good/10 text-good" },
  supporting: { label: "Supporting", className: "border-border bg-bg-muted text-text-3" },
  discriminator: { label: "Exam discriminator", className: "border-bad/40 bg-bad/10 text-bad" },
};

/**
 * One chip per objective an atom serves. Objectives without a SOM code fall
 * back to their text, and chips are deduped by label because this data has
 * duplicate objective rows sharing a code — four identical chips on one atom
 * says nothing useful.
 */
function objectiveChips(objectiveIds, objectiveById) {
  const seen = new Map();
  for (const id of objectiveIds) {
    const objective = objectiveById.get(id);
    const text = objective ? objective.objective || objective.text || "" : "";
    const label = objective?.code || (text ? `${text.slice(0, 26)}${text.length > 26 ? "…" : ""}` : "objective");
    if (!seen.has(label)) seen.set(label, { key: id, label, title: text || id });
  }
  return [...seen.values()];
}

/** Clickable terms under a framework node — jumps to that atom in the review list below. */
function AtomChips({ terms, onAtomClick }) {
  if (!terms?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {terms.map((term) => (
        <button
          key={term}
          onClick={() => onAtomClick(term)}
          className="rounded border border-border px-1.5 py-0.5 font-mono text-[12px] text-text-3 hover:border-accent hover:text-accent"
        >
          {term}
        </button>
      ))}
    </div>
  );
}

/**
 * A reasoning framework, not a summary — big picture -> components -> relationships ->
 * mechanisms -> cause/effect -> clinical application -> easily-confused pairs. Every node that
 * traces to real atoms shows them as chips so the atoms attach onto the structure instead of
 * sitting beside it.
 */
export function ModelSection({ title, children, count }) {
  return <details className="rounded-lg border border-border bg-bg-elevated p-3">
    <summary className="min-h-11 cursor-pointer rounded py-2 text-base font-semibold text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      {title}{count != null && <span className="ml-2 text-sm font-normal text-text-2">({count})</span>}
    </summary>
    <div className="mt-2 text-sm leading-relaxed">{children}</div>
  </details>;
}

export function MentalModelView({ model, onAtomClick }) {
  const {
    bigPicture, components = [], relationships = [], mechanisms = [],
    causeEffect = [], clinicalApplication = [], confusedPairs = [], reasoningLadders = [],
  } = model;

  return (
    <div className="mt-3 flex flex-col gap-4">
      {bigPicture && (
        <ModelSection title="Big picture">
          <p className="text-sm text-text-1">{bigPicture}</p>
        </ModelSection>
      )}

      {components.length > 0 && (
        <ModelSection title="Components" count={components.length}>
          <div className="flex flex-col gap-1.5">
            {components.map((c, i) => (
              <ModelSection key={i} title={c.name}>
                {c.role && <span className="text-text-2"> — {c.role}</span>}
                <AtomChips terms={c.atomTerms} onAtomClick={onAtomClick} />
              </ModelSection>
            ))}
          </div>
        </ModelSection>
      )}

      {relationships.length > 0 && (
        <ModelSection title="Relationships" count={relationships.length}>
          <div className="flex flex-col gap-1.5">
            {relationships.map((r, i) => (
              <ModelSection key={i} title={`${r.from} → ${r.to}`}>
                {r.connection && <span className="text-text-2"> — {r.connection}</span>}
                {r.why && <div className="mt-1 text-text-3">why: {r.why}</div>}
                <AtomChips terms={r.atomTerms} onAtomClick={onAtomClick} />
              </ModelSection>
            ))}
          </div>
        </ModelSection>
      )}

      {mechanisms.length > 0 && (
        <ModelSection title="Mechanisms & flows" count={mechanisms.length}>
          <div className="flex flex-col gap-1.5">
            {mechanisms.map((m, i) => (
              <ModelSection key={i} title={m.name}>
                {m.steps?.length > 0 && (
                  <ol className="mt-1 list-decimal pl-4 text-text-2">
                    {m.steps.map((s, j) => <li key={j}>{s}</li>)}
                  </ol>
                )}
                <AtomChips terms={m.atomTerms} onAtomClick={onAtomClick} />
              </ModelSection>
            ))}
          </div>
        </ModelSection>
      )}

      {causeEffect.length > 0 && (
        <ModelSection title="Cause & effect" count={causeEffect.length}>
          <div className="flex flex-col gap-1.5">
            {causeEffect.map((ce, i) => (
              <ModelSection key={i} title={ce.cause}>
                <span className="text-text-2"> ⇒ {ce.effect}</span>
                {ce.why && <div className="mt-1 text-text-3">why: {ce.why}</div>}
                <AtomChips terms={ce.atomTerms} onAtomClick={onAtomClick} />
              </ModelSection>
            ))}
          </div>
        </ModelSection>
      )}

      {clinicalApplication.length > 0 && (
        <ModelSection title="Clinical application" count={clinicalApplication.length}>
          <div className="flex flex-col gap-1.5">
            {clinicalApplication.map((c, i) => (
              <ModelSection key={i} title={c.scenario}>
                {c.connection && <span className="text-text-2"> — {c.connection}</span>}
                <AtomChips terms={c.atomTerms} onAtomClick={onAtomClick} />
              </ModelSection>
            ))}
          </div>
        </ModelSection>
      )}

      {confusedPairs.length > 0 && (
        <ModelSection title="Easily confused" count={confusedPairs.length}>
          <div className="flex flex-col gap-1.5">
            {confusedPairs.map((p, i) => (
              <ModelSection key={i} title={`${p.a} vs ${p.b}`}>
                {p.distinction && <div className="mt-1 text-text-2">{p.distinction}</div>}
              </ModelSection>
            ))}
          </div>
        </ModelSection>
      )}

      {reasoningLadders.length > 0 && (
        <ModelSection title="Objective reasoning ladders" count={reasoningLadders.length}>
          <p className="mb-2 text-xs text-text-3">Move from recognition to relationship-based application, then integrate only when the objective and lecture facts support it.</p>
          <div className="flex flex-col gap-2">
            {reasoningLadders.map((ladder, i) => (
              <div key={`${ladder.objectiveId || "objective"}-${i}`} className="rounded border border-border bg-panel p-2.5">
                <div className="text-sm font-semibold text-text-1">{ladder.objective || ladder.objectiveId || `Objective ${i + 1}`}</div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  {[['1st', ladder.firstOrder], ['2nd', ladder.secondOrder], ['3rd', ladder.thirdOrder]].map(([label, text]) => (
                    <div key={label} className="rounded border border-border bg-bg p-2">
                      <div className="font-mono font-bold text-accent-text">{label} order</div>
                      <div className="mt-1 text-text-2">{text || "Not supported by the supplied evidence."}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ModelSection>
      )}
    </div>
  );
}

export function MentalModelOverview({ model, onAtomClick, children }) {
  return <div className="mt-3 space-y-3">
    <p className="text-base leading-relaxed text-text-1">
      {model.bigPicture || "No overview paragraph was saved for this model. Supporting details are available below."}
    </p>
    <p className="text-xs text-text-3">Use the sections below as optional lookup material, not a checklist.</p>
    <MentalModelView model={{ ...model, bigPicture: null }} onAtomClick={onAtomClick} />
    {children}
  </div>;
}

const pct = (value) => value == null ? "—" : `${Math.round(value * 100)}%`;
const seconds = (ms) => ms == null ? "—" : `${Math.round(ms / 1000)}s`;

function MentalModelImpact({ entry, onMarkReviewed }) {
  const impact = mentalModelImpactStore.impactFor(entry);
  if (impact.state === "not-started") {
    return (
      <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-4">
        <div className="text-sm font-semibold text-text-1">Measure whether this model works</div>
        <p className="mt-1 text-[13px] leading-relaxed text-text-2">
          Explain the framework aloud without looking, then mark it reviewed. RXtrack will compare your existing baseline with new, timed questions.
        </p>
        <Button variant="outline" onClick={onMarkReviewed} className="mt-3">Start impact tracking</Button>
      </div>
    );
  }

  const labels = {
    collecting: "Collecting evidence",
    working: "Working",
    partial: "Partially working",
    "not-working": "Not improving yet",
    mixed: "Mixed result",
  };
  const statusClass = impact.state === "working" ? "text-good" : impact.state === "not-working" ? "text-bad" : "text-accent";
  const metric = (label, value, detail) => (
    <div className="rounded border border-border bg-bg p-3">
      <div className="font-mono text-[11px] uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-1 text-lg font-bold text-text-1">{value}</div>
      <div className="font-mono text-[11px] text-text-3">{detail}</div>
    </div>
  );
  return (
    <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-1">Mental Model Impact</div>
          <div className={`font-mono text-[12px] font-bold ${statusClass}`}>{labels[impact.state]}</div>
        </div>
        <button onClick={onMarkReviewed} className="font-mono text-[11px] text-text-3 underline">log another review</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        {metric("Baseline", pct(impact.baseline.accuracy), `${impact.baseline.count} questions`)}
        {metric("After model", pct(impact.post.accuracy), `${impact.post.count}/10 needed`)}
        {metric("Hard / expert", pct(impact.transfer.accuracy), `${impact.transfer.count} transfer Qs`)}
        {metric("24h+ retention", pct(impact.delayed24h.accuracy), `${impact.delayed24h.count} delayed Qs`)}
        {metric("Median speed", seconds(impact.post.medianMs), impact.baseline.medianMs == null ? "new tracking" : `was ${seconds(impact.baseline.medianMs)}`)}
      </div>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-text-3">
        A verdict appears after ≥5 baseline and ≥10 post-model questions. Seven-day retention: {pct(impact.retained7d.accuracy)} ({impact.retained7d.count}).
      </p>
    </div>
  );
}

function TutorCountdown({ remainingSeconds, active }) {
  const [seconds, setSeconds] = useState(Math.max(0, Number(remainingSeconds) || 0));
  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  return <span className="min-w-[54px] text-center font-mono text-sm font-semibold text-text-1">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

export function LectureStudyFlow({
  lecture, blockId, blockName = "", userId, logActivity, examDates, onClose, onGoDeep, onLectureRenamed = null,
  onReExtract = null,
  // Set by an external "Quiz" button (Today, Lectures list, ObjectiveTracker) instead of
  // launching its own separate screen — opens the same picker this file's "Quiz this lecture"
  // button opens, just pre-triggered rather than waiting for a click.
  autoOpenQuiz = false,
  // Pre-read's misses are the reason a quiz got launched from Today in the first place —
  // preserved here as a priority order rather than dropped when that entry point stopped
  // having its own generation call to apply it to.
  focusObjectiveIds = null,
  examRepairContext = null,
}) {
  const [atoms, setAtoms] = useState([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [figures, setFigures] = useState(null); // in-review, not yet uploaded
  const [stage, setStage] = useState("loading"); // loading | upload | extract | quiz
  const [questions, setQuestions] = useState(null);
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [objectiveNotice, setObjectiveNotice] = useState("");
  const [renamedTitle, setRenamedTitle] = useState("");
  const objectiveResource = useObjectives(null, userId);
  const lectureObjectives = useMemo(() => {
    const all = selectBlockObjectives(objectiveResource.data, blockId);
    return all.filter((o) => o?.linkedLecId === lecture?.id);
  }, [objectiveResource.data, blockId, lecture?.id]);
  const title = lecture?.lectureTitle || lecture?.title || lecture?.fileName || "Lecture";
  const learnerEvidence = useStoreResource(learnerEvidenceStore, userId);
  const objectivePractice = useMemo(
    () => objectivePracticePlan(lectureObjectives, learnerEvidence.data),
    [lectureObjectives, learnerEvidence.data]
  );
  const [round, setRound] = useState(0);
  // Rounds already finished, read once on mount — this component is keyed by lecture id, so it
  // remounts (and re-reads) whenever you switch lectures.
  const [done, setDone] = useState(() => readRoundProgress(userId, lecture?.id));
  // Refreshed when a round ends rather than per answer: the panel is not on screen mid-round.
  const [qStats, setQStats] = useState(() => questionStats.statsForLecture(userId, lecture?.id));
  // The real progress bar: atoms answered correctly at least once, out of the atoms this lecture
  // actually has right now. Empty until atoms load (the effect below recomputes it then), same
  // staleness contract as qStats — refreshed at round/quiz end and on manual exit, not live.
  const [atomMastery, setAtomMastery] = useState({ masteredCount: 0, totalCount: 0 });
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

  // A lecture tutor is a bounded, resumable layer over the existing study surface.
  // The checkpoint is per lecture so leaving one lecture never loses the place in another.
  const [tutorSession, setTutorSession] = useState(() => userId ? null : tutorSessionsStore.get(userId, lecture?.id));
  const [tutorStoreHydrated, setTutorStoreHydrated] = useState(() => tutorSessionsStore.isHydrated(userId));
  const [tutorCloudStatus, setTutorCloudStatus] = useState(() => tutorSessionsStore.syncStatus(userId, lecture?.id));
  const [tutorResponse, setTutorResponse] = useState("");
  const [tutorConfidence, setTutorConfidence] = useState("");
  const [tutorNotice, setTutorNotice] = useState("");
  const [tutorWorkspaceOpen, setTutorWorkspaceOpen] = useState(true);
  const [tutorLoading, setTutorLoading] = useState(false);
  const [tutorReviewing, setTutorReviewing] = useState(false);
  const tutorCaseGenerationRef = useRef(null);
  const [mentalModel, setMentalModel] = useState(() => mentalModelStore.read(userId, lecture?.id));
  const [generatingModel, setGeneratingModel] = useState(false);
  const tutorSessionRef = useRef(tutorSession);
  const tutorSessionSummaryValue = useMemo(() => tutorSessionSummary(tutorSession), [tutorSession]);
  const tutorPacing = useMemo(() => tutorPacingContext(tutorSession), [tutorSession]);
  useEffect(() => { tutorSessionRef.current = tutorSession; }, [tutorSession]);

  const saveTutorSession = useCallback((next) => {
    if (!next) return;
    tutorSessionRef.current = next;
    setTutorSession(next);
    const saved = tutorSessionsStore.save(userId, next);
    if (saved && typeof saved.then === "function") {
      saved.then((ok) => {
        if (!ok) setTutorNotice("Cloud save failed. Your tutor progress remains in this tab; keep RXTrack open and retry when connected.");
      });
      return true;
    }
    if (!saved) setTutorNotice("This tutor checkpoint could not be saved.");
    return Boolean(saved);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setTutorStoreHydrated(true);
      return undefined;
    }
    let mounted = true;
    const refreshFromCloud = () => {
      if (!mounted) return;
      const hydrated = tutorSessionsStore.isHydrated(userId);
      setTutorCloudStatus(tutorSessionsStore.syncStatus(userId, lecture?.id));
      if (!hydrated) return;
      const stored = tutorSessionsStore.get(userId, lecture?.id);
      tutorSessionRef.current = stored;
      setTutorSession(stored);
      setTutorStoreHydrated(true);
    };
    const unsubscribe = tutorSessionsStore.subscribe(userId, refreshFromCloud);
    tutorSessionsStore.hydrate(userId).then(refreshFromCloud).catch(refreshFromCloud);
    return () => { mounted = false; unsubscribe(); };
  }, [lecture?.id, userId]);

  const generateTutorCase = useCallback(async () => {
    if (!tutorSessionRef.current || tutorSessionRef.current.patientCase || tutorSessionRef.current.delayedReview || tutorCaseGenerationRef.current) return;
    const sessionId = tutorSessionRef.current.sessionId;
    const activeObjectiveId = tutorSessionRef.current.activeObjectiveId;
    tutorCaseGenerationRef.current = lecture?.id || "lecture";
    setTutorLoading(true);
    const objective = lectureObjectives.find((candidate) => String(candidate?.id || candidate?.code || candidate?.objective) === String(activeObjectiveId))
      || lectureObjectives[0];
    const objectiveText = objective?.objective || objective?.text || title;
    const pacing = tutorPacingContext(tutorSessionRef.current);
    const source = String(text || atoms.map((atom) => `${atom.term || ""}: ${atom.content || ""}`).join("\n")).slice(0, 9000);
    const knownAnchors = [
      ...(tutorSessionRef.current.learnerProfile?.confirmedAnchors || []),
      ...(tutorSessionRef.current.turns || []).filter((turn) => turn.stepResolved && turn.response),
    ]
      .slice(-4)
      .map((anchor) => anchor.response)
      .join("\n");
    try {
      const generated = await callAIJSON(
        "You are a warm, precise medical-school tutor. Assume a first-pass learner unless the learner has demonstrated mastery. Before testing, teach the smallest usable causal model needed for the case: deficiency or defect -> affected enzyme/transport step -> physiologic consequence -> clinical/lab finding. The openingModel must teach a case-relevant fact, not give generic encouragement. Then write one patient case with one answerable task that uses only the model just taught or facts explicitly present in the case. Do not test an unintroduced association. Keep caseTitle neutral (Patient 1); never place a diagnosis in a heading. Hide the target diagnosis until the learner attempts retrieval. For overlapping presentations, include the decisive separator. Stay grounded in the lecture; mark external facts as outside-scope in feedback. Use the supplied session pace to control case depth and length, but never rush the learner, claim uncovered objectives were taught, or weaken medical accuracy. Return valid JSON only.",
        `Lecture: ${title}\nSession pace and coverage (live state; follow it): ${JSON.stringify(pacing)}\nObjective: ${objectiveText}\nExisting lecture mental model (use this when available): ${mentalModel?.bigPicture || "none saved"}\nLearner's established anchors:\n${knownAnchors || "No stable anchors recorded yet."}\nLecture material:\n${source}\n\nReturn {"openingModel":"2-4 concise sentences that teach the specific mechanism/lab rule needed to reason through this case without naming its target diagnosis","caseTitle":"Patient 1","stem":"a clinically coherent 3-5 sentence vignette; do not state the diagnosis","task":"one question answerable using the openingModel and explicit case clues; begin with system/pattern or one causal consequence, not an unexplained fact-recall demand","keyClues":["2-4 private clues for feedback; do not display separately"],"diagnosisCategory":"private expected diagnosis family; never display before learner attempts","mechanismTarget":"private expected mechanism; never display before learner attempts","acceptedAnswers":["private acceptable diagnosis aliases grounded in lecture"]}.`,
        { openingModel: "Start with the lecture’s organizing model, then ask what clinical job breaks when a process is disrupted.", caseTitle: "Patient 1", stem: `A patient presents with findings relevant to ${objectiveText}. Use the lecture model to identify the syndrome before naming the disease.`, task: "What is the presenting syndrome or most likely diagnosis? Which clue points you there?", keyClues: [], diagnosisCategory: "", mechanismTarget: "" },
        2200,
        undefined,
        undefined,
        { throwOnError: true }
      );
      if (typeof generated?.openingModel !== "string" || generated.openingModel.trim().length < 30
        || typeof generated?.stem !== "string" || generated.stem.trim().length < 80
        || typeof generated?.task !== "string" || generated.task.trim().length < 10) {
        throw new Error("The tutor returned an incomplete case; retry to keep the walkthrough grounded in this lecture.");
      }
      const patientCase = {
        // Never trust model-generated headings to be reveal-safe.
        caseTitle: "Patient 1",
        stem: generated?.stem || "Start by identifying the presenting syndrome.",
        task: generated?.task || "What is the most likely diagnosis or disease family?",
        keyClues: Array.isArray(generated?.keyClues) ? generated.keyClues.slice(0, 4) : [],
        diagnosisCategory: generated?.diagnosisCategory || "",
        mechanismTarget: generated?.mechanismTarget || "",
        acceptedAnswers: Array.isArray(generated?.acceptedAnswers) ? generated.acceptedAnswers.slice(0, 6) : [],
      };
      if (tutorSessionRef.current?.sessionId === sessionId) {
        saveTutorSession(attachTutorCase(
          tutorSessionRef.current,
          patientCase,
          Date.now(),
          mentalModel?.bigPicture || generated?.openingModel || "Start with the lecture’s organizing model, then ask what clinical job breaks when a process is disrupted."
        ));
      }
    } catch (error) {
      setTutorNotice(`Case generation failed: ${error?.message || "use the objective scaffold below"}`);
    } finally {
      setTutorLoading(false);
      tutorCaseGenerationRef.current = null;
    }
  }, [atoms, lecture?.id, lectureObjectives, mentalModel?.bigPicture, saveTutorSession, text, title]);

  const startTutorSession = useCallback((budgetMinutes) => {
    const objectiveIds = lectureObjectives
      .map((objective) => objective?.id || objective?.code || objective?.objective)
      .filter(Boolean)
      .map(String);
    for (let index = objectiveIds.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [objectiveIds[index], objectiveIds[swapIndex]] = [objectiveIds[swapIndex], objectiveIds[index]];
    }
    const previous = tutorSessionsStore.get(userId, lecture?.id);
    const now = Date.now();
    const retrievalQueue = (previous?.retrievalQueue || []).map((review) => ({
      ...review,
      dueAt: review.dueAt || ((previous?.lastCheckpointAt || previous?.startedAt || now) + (24 * 60 * 60 * 1000)),
    }));
    const next = createTutorSession({
      lectureId: lecture?.id,
      budgetMinutes,
      objectiveIds,
      objectivePlan: lectureObjectives.map((objective) => ({
        id: String(objective?.id || objective?.code || objective?.objective || ""),
        label: objective?.objective || objective?.text || objective?.code || objective?.id || "Objective",
      })),
      learnerProfile: tutorSessionsStore.getLearnerProfile(userId),
      retrievalQueue,
      now,
    });
    setTutorResponse("");
    setTutorConfidence("");
    const dueReviewIndex = retrievalQueue.findIndex((review) => review.dueAt <= now && objectiveIds.includes(String(review.objectiveId)));
    if (dueReviewIndex >= 0) {
      const [delayedReview] = retrievalQueue.splice(dueReviewIndex, 1);
      next.activeObjectiveId = delayedReview.objectiveId;
      next.currentStep = "delayed_retrieval";
      next.delayedReview = delayedReview;
      next.resumeObjectiveId = objectiveIds.find((id) => id !== String(delayedReview.objectiveId)) || objectiveIds[0] || null;
      next.nextAction = "retrieve_earlier_case";
      next.status = "active";
    }
    next.retrievalQueue = retrievalQueue;
    saveTutorSession(next);
  }, [lecture?.id, lectureObjectives, saveTutorSession, userId]);

  useEffect(() => {
    if (tutorSession?.status !== "active" || tutorSession.patientCase || tutorSession.delayedReview || (!text && !atoms.length)) return;
    generateTutorCase();
  }, [atoms.length, generateTutorCase, text, tutorSession?.delayedReview, tutorSession?.patientCase, tutorSession?.status]);

  const pauseCurrentTutorSession = useCallback(() => {
    saveTutorSession(pauseTutorSession(tutorSessionRef.current));
  }, [saveTutorSession]);

  const resumeCurrentTutorSession = useCallback(() => {
    saveTutorSession(resumeTutorSession(tutorSessionRef.current));
  }, [saveTutorSession]);

  const finishCurrentTutorSession = useCallback(() => {
    saveTutorSession(finishTutorSession(tutorSessionRef.current));
  }, [saveTutorSession]);

  const activeTutorObjective = useMemo(() => {
    const activeId = tutorSession?.delayedReview?.objectiveId || tutorSession?.activeObjectiveId;
    return lectureObjectives.find((objective) => String(objective?.id || objective?.code || objective?.objective) === String(activeId))
      || lectureObjectives[0]
      || null;
  }, [lectureObjectives, tutorSession?.activeObjectiveId, tutorSession?.delayedReview?.objectiveId]);
  const activeTutorAtoms = useMemo(() => {
    const activeId = tutorSession?.delayedReview?.objectiveId || tutorSession?.activeObjectiveId;
    const matched = activeId
      ? atoms.filter((atom) => {
        const links = atom.objectiveIds || atom.objectives || [];
        const ids = Array.isArray(links) ? links : [links];
        return ids.map(String).includes(String(activeId));
      })
      : [];
    return (matched.length ? matched : atoms).slice(0, 4);
  }, [atoms, tutorSession?.activeObjectiveId, tutorSession?.delayedReview?.objectiveId]);
  const tutorPrompt = useMemo(() => tutorStepPrompt({
    step: tutorSession?.currentStep,
    objectiveText: activeTutorObjective?.objective || activeTutorObjective?.text || "this lecture objective",
    atomTerms: activeTutorAtoms.map((atom) => atom.term || atom.name || atom.label),
  }), [activeTutorAtoms, activeTutorObjective, tutorSession?.currentStep]);
  const tutorObjectiveIndex = Math.max(0, (tutorSession?.objectiveIds || []).indexOf(String(tutorSession?.activeObjectiveId)));
  const latestTutorTurn = tutorSession?.turns?.[tutorSession.turns.length - 1] || null;
  const displayedTutorCase = tutorSession?.delayedReview || tutorSession?.patientCase;
  const normalizedTutorStep = tutorSession?.currentStep === "patient_case" ? "diagnosis" : tutorSession?.currentStep;
  const latestTurnMatchesStep = latestTutorTurn
    && String(latestTutorTurn.objectiveId) === String(tutorSession?.activeObjectiveId)
    && latestTutorTurn.reviewedStep === normalizedTutorStep;
  const currentTutorQuestion = latestTurnMatchesStep && latestTutorTurn.followUp
    ? latestTutorTurn.followUp
    : (latestTutorTurn
      && String(latestTutorTurn.objectiveId) === String(tutorSession?.activeObjectiveId)
      && latestTutorTurn.stepResolved
      && latestTutorTurn.followUp
      ? latestTutorTurn.followUp
      : (normalizedTutorStep === "delayed_retrieval"
        ? tutorPrompt.prompt
        : (normalizedTutorStep === "diagnosis" ? tutorSession?.patientCase?.task : tutorPrompt.prompt)));
  const tutorHasCurrentCase = Boolean(tutorSession?.delayedReview || tutorSession?.patientCase);

  const submitTutorTurn = useCallback(async (kind = "response") => {
    const response = tutorResponse.trim();
    if (kind === "response" && response.length < 3) {
      setTutorNotice("Write a short explanation first, even if it is incomplete.");
      return;
    }
    const current = tutorSessionRef.current;
    if (!current || current.status !== "active" || tutorReviewing) return;
    const isBlocked = kind === "stuck";
    const reviewedStep = current.currentStep === "patient_case" ? "diagnosis" : current.currentStep;
    const reviewCase = current.delayedReview || current.patientCase;
    const reviewObjectiveId = current.delayedReview?.objectiveId || current.activeObjectiveId;
    const objectiveText = activeTutorObjective?.objective || activeTutorObjective?.text || "this lecture objective";
    const caseText = reviewCase?.stem || "No generated case is available.";
    const source = String(text || activeTutorAtoms.map((atom) => `${atom.term || ""}: ${atom.content || ""}`).join("\n")).slice(0, 6500);
    const knownAnchors = [
      ...(current.learnerProfile?.confirmedAnchors || []),
      ...(current.turns || []).filter((turn) => turn.stepResolved && turn.response),
    ]
      .slice(-4)
      .map((anchor) => anchor.response)
      .join("\n");
    const recentMisses = (current.learnerProfile?.recentMisses || [])
      .filter((miss) => miss.status !== "resolved")
      .slice(-4)
      .map((miss) => `${miss.missType}: ${miss.repairLink || miss.step}`)
      .join("\n");
    const stableReasoningSkills = current.learnerProfile?.stableReasoningSkills || [];
    const pacing = tutorPacingContext(current);
    const recentConfidence = (current.learnerProfile?.confidenceEvents || [])
      .slice(-4)
      .map((event) => `${event.confidence} confidence / ${event.assessment}${event.confidenceNote ? `: ${event.confidenceNote}` : ""}`)
      .join("\n");
    const fallback = {
      assessment: isBlocked ? "needs_repair" : "unreviewed",
      feedback: isBlocked
        ? "Start with the organ system, time course, and the finding that is hardest to explain."
        : "Your checkpoint was saved, but live tutor feedback was unavailable. Continue the reasoning chain and verify this step against the lecture.",
      followUp: isBlocked
        ? "Which single finding best localizes the process?"
        : "What downstream finding should follow if your reasoning is correct?",
      readyToAdvance: false,
    };
    setTutorReviewing(true);
    setTutorNotice(isBlocked ? "Building a focused hint…" : "Checking your reasoning against the lecture…");
    try {
      const review = await callAIJSON(
        "You are a Socratic medical-school tutor. Evaluate only the learner's current reasoning step. The lecture objective defines tested scope and the lecture material defines correctness. Do not dump the full solution when the learner is incomplete or stuck. Give one precise correction or confirmation, then one question that makes the learner perform the next reasoning move. Do not put questions in the feedback field; ask only one question in followUp. Set readyToAdvance true only when the learner independently completed this step. Respect the live time budget and coverage: adapt depth to the remaining time, avoid opening optional branches near the checkpoint, and explicitly preserve uncovered objectives for a later block. A clock checkpoint is not evidence of mastery. Return valid JSON only.",
        `Lecture: ${title}\nSession pace and coverage (live state; follow it): ${JSON.stringify(pacing)}\nOpening mental model: ${current.openingModel || mentalModel?.bigPicture || "none saved"}\nEstablished learner anchors:\n${knownAnchors || "None recorded yet."}\nRecent repair history:\n${recentMisses || "No repeated miss pattern recorded."}\nRecent confidence history:\n${recentConfidence || "None recorded yet."}\nStable reasoning skills demonstrated across topics: ${stableReasoningSkills.join(", ") || "none recorded"}\nObjective: ${objectiveText}\nPatient case: ${caseText}\nCurrent step: ${reviewedStep}\nPrivate expected answer (never reveal before evaluating): diagnosis=${current.patientCase?.diagnosisCategory || "not recorded"}; accepted aliases=${(current.patientCase?.acceptedAnswers || []).join(", ") || "none recorded"}; mechanism=${current.patientCase?.mechanismTarget || "not recorded"}.\nConfidence before feedback: ${tutorConfidence || "not recorded"}\n${reviewedStep === "delayed_retrieval" ? `Earlier-case answer anchors: diagnosis=${current.delayedReview?.expectedDiagnosis || "not recorded"}; mechanism=${current.delayedReview?.mechanismTarget || "not recorded"}.` : ""}\nLearner response: ${response || "The learner asked for a hint."}\nLecture material:\n${source}\n\nReturn {"assessment":"correct|partial|needs_repair","feedback":"1-3 concise sentences","followUp":"one Socratic question","missType":"recognition|mechanism|application|execution|null","repairLink":"the single missing or inaccurate link, or empty","reasoningSkill":"one concise skill label such as causal-chain, localization, discriminator, or pathway-link; empty if not demonstrated","confidenceNote":"brief coaching only if confidence and performance clearly mismatch; otherwise empty","readyToAdvance":boolean}. Grade against the private expected answer and lecture evidence, not a guessed alternative. Never call a high ferritin/high transferrin-saturation pattern iron deficiency; first preserve each correct proposition, then correct only the first wrong link. Do not invent a diagnosis that contradicts the expected answer or laboratory pattern. Let the learner commit before revealing the diagnosis. If incomplete, repair only the missing link using lecture evidence, define unfamiliar terms plainly, and ask one novel application question answerable from what has been taught. Do not immediately ask them to repeat a new association. If they ask for a hint, reveal one clue but not the answer and set readyToAdvance false. Keep feedback direct; do not narrate the study strategy or promise future review.`,
        fallback,
        1000
      );
      const latest = tutorSessionRef.current;
      if (!latest || latest.sessionId !== current.sessionId || latest.activeObjectiveId !== current.activeObjectiveId || latest.currentStep !== current.currentStep) return;
      const readyToAdvance = !isBlocked && review?.readyToAdvance === true;
      const delayedReviewComplete = reviewedStep === "delayed_retrieval" && readyToAdvance;
      const objectiveComplete = readyToAdvance && reviewedStep === "contrast";
      const next = recordTutorTurn(latest, {
        objectiveId: reviewObjectiveId,
        response: response || "Student requested a hint.",
        reviewedStep,
        assessment: review?.assessment || fallback.assessment,
        missType: review?.missType || null,
        repairLink: review?.repairLink || "",
        reasoningSkill: review?.reasoningSkill || "",
        confidence: tutorConfidence || "",
        confidenceNote: review?.confidenceNote || "",
        stepResolved: readyToAdvance,
        feedback: review?.feedback || fallback.feedback,
        followUp: review?.followUp || fallback.followUp,
        objectiveComplete,
        delayedReviewComplete,
        nextStep: readyToAdvance ? tutorPrompt.nextStep : latest.currentStep,
        nextAction: objectiveComplete ? "advance_objective" : (readyToAdvance ? "continue_reasoning" : "retry_reasoning"),
        blocker: !readyToAdvance && (isBlocked || (review?.missType && review.missType !== "execution"))
          ? { type: isBlocked ? reviewedStep : review.missType, step: reviewedStep, concept: review?.repairLink || objectiveText, status: "open" }
          : null,
      });
      const saved = saveTutorSession(next);
      setTutorResponse("");
      setTutorConfidence("");
      setTutorNotice(saved ? "" : "Your answer was checked, but browser storage is full. This progress remains in this tab; free local storage before leaving to ensure it persists.");
    } catch (error) {
      setTutorNotice(`Tutor review failed: ${error?.message || "save your response and retry"}`);
    } finally {
      setTutorReviewing(false);
    }
  }, [activeTutorAtoms, activeTutorObjective, saveTutorSession, text, title, tutorPrompt.nextStep, tutorResponse, tutorReviewing, mentalModel?.bigPicture, tutorConfidence]);

  // Advance the clock in a ref so typing does not rerender this large study view every second.
  // The isolated countdown renders seconds; session state is persisted every 30 seconds/boundary.
  useEffect(() => {
    if (tutorSession?.status !== "active" || (!tutorSession.patientCase && !tutorSession.delayedReview)) return undefined;
    let lastPersistedElapsed = tutorSessionRef.current?.elapsedSeconds || 0;
    const timer = window.setInterval(() => {
      const current = tutorSessionRef.current;
      const next = tickTutorSession(current, 1);
      if (next === current) return;
      tutorSessionRef.current = next;
      if (next.status === "checkpoint") {
        saveTutorSession(next);
      } else if (next.elapsedSeconds - lastPersistedElapsed >= 30) {
        lastPersistedElapsed = next.elapsedSeconds;
        const saving = tutorSessionsStore.save(userId, next);
        saving?.then?.((saved) => {
          if (!saved) setTutorNotice("Cloud save failed. Your timer checkpoint remains in this tab; keep RXTrack open and retry when connected.");
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tutorSession?.status, tutorSession?.patientCase, tutorSession?.delayedReview, saveTutorSession, userId]);

  // Persist the last checkpoint even if the learner navigates away between timer ticks.
  useEffect(() => () => {
    if (tutorSessionRef.current) tutorSessionsStore.save(userId, tutorSessionRef.current);
  }, [userId, lecture?.id]);

  // Start both cloud subscriptions as soon as Study opens. Previously the first generation
  // itself started hydration and immediately read an empty fallback, so uploaded Esoft examples
  // were often absent from precisely the first quiz where they were expected.
  const questionBanksRes = useQuestionBanks(userId);
  const questionBankMetaRes = useQuestionBankMeta(userId);
  const schoolExemplars = useMemo(
    () => selectExemplarsForBlock(questionBanksRes.data, questionBankMetaRes.data, blockId),
    [questionBanksRes.data, questionBankMetaRes.data, blockId]
  );
  const clinicalCorrelateLibrary = useMemo(
    () => buildClinicalCorrelateLibrary({
      atoms,
      examples: selectClinicalExamplesForBlock(schoolExemplars, blockId),
      analyses: readClinicalAnalysesForBlock(userId, blockId),
    }),
    [atoms, schoolExemplars, userId, blockId]
  );
  const schoolExamplesLoading = questionBanksRes.loading || questionBankMetaRes.loading;

  const checkpointLectureQuiz = useCallback((progress) => {
    const current = quizMetaRef.current;
    if (!current) return;
    const session = { ...current, progress };
    lectureQuizSessionsStore.save(userId, session);
    setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId, lecture?.id, blockId));
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
      progress: { i: 0, picked: null, confidence: null, records: [], crossed: [], errorReason: null, highlights: {} },
      isAdHoc: options.isAdHoc ?? true,
      roundIndex: options.roundIndex ?? round,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    quizMetaRef.current = session;
    lectureQuizSessionsStore.save(userId, session);
    setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId, lecture?.id, blockId));
    setQuestions(nextQuestions);
  }, [blockId, blockName, lecture?.id, renamedTitle, round, title, userId]);

  const resumeLectureQuiz = useCallback((session) => {
    if (!session?.questions?.length) return;
    quizMetaRef.current = session;
    setQuizResumeState(session.progress || null);
    setQuestions(session.questions);
    setAdHocQuiz(session.isAdHoc !== false);
    setRound(Number.isInteger(session.roundIndex) ? session.roundIndex : 0);
    const nextId = quizSessionCounter.current + 1;
    quizSessionCounter.current = nextId;
    setQuizSessionId(nextId);
    setCompletedQuizSessionId(null);
  }, []);

  // Atom key to scroll to + pulse-highlight once the atoms list is back on screen — set by a
  // "review this atom" click from a quiz Summary, cleared once the highlight has had its moment.
  const [reviewAtomKey, setReviewAtomKey] = useState(null);
  const atomsDetailsRef = useRef(null);

  // Study guide — auto-generated searchable topic list, one per lecture mount
  const [studyGuide, setStudyGuide] = useState(null);
  const [generatingGuide, setGeneratingGuide] = useState(false);
  const guideGenRef = useRef(false);

  // Mental model — the reasoning framework built from this lecture's atoms. Built on demand
  // (not auto, like the study guide) since it costs more tokens per call; cached per lecture.
  const [impactEntry, setImpactEntry] = useState(() => mentalModelImpactStore.read(userId)[lecture?.id] || null);

  useEffect(() => {
    setImpactEntry(mentalModelImpactStore.read(userId)[lecture?.id] || null);
    return mentalModelImpactStore.subscribe(() => {
      setImpactEntry(mentalModelImpactStore.read(userId)[lecture?.id] || null);
    });
  }, [userId, lecture?.id]);

  // Keep busy states useful without presenting elapsed time in two different places. The
  // preparation card owns progress; buttons should only say what is happening.
  const busyLabel = busy || "";

  // Runs once `questions` has cleared and the atoms list is actually in the DOM (a Summary
  // "review this atom" click sets reviewAtomKey the same tick it exits the quiz, so this has to
  // wait a render rather than act synchronously). Expands the collapsed <details>, scrolls to the
  // card, and leaves it highlighted for a few seconds — a highlight nobody has time to notice is
  // as useless as no highlight.
  useEffect(() => {
    if (!reviewAtomKey || questions) return;
    if (atomsDetailsRef.current) atomsDetailsRef.current.open = true;
    const el = document.getElementById(`atom-${reviewAtomKey}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setReviewAtomKey(null), 3000);
    return () => clearTimeout(t);
  }, [reviewAtomKey, questions]);

  const generateGuide = useCallback(async (currentAtoms, currentObjectives) => {
    setGeneratingGuide(true);
    const result = await generateStudyGuide(
      { objectives: currentObjectives, atoms: currentAtoms, subject: title },
      { callAIJSON }
    );
    setGeneratingGuide(false);
    if (!result.topics?.length) return;
    const guide = {
      topics: result.topics.map((text, i) => ({ id: `t${i}`, text, checked: false })),
      generated: Date.now(),
    };
    studyGuideStore.write(userId, lecture?.id, guide);
    setStudyGuide(guide);
  }, [title, userId, lecture?.id]);

  const generateModel = useCallback(async () => {
    setGeneratingModel(true); setError("");
    const result = await generateMentalModel({ atoms, objectives: lectureObjectives, examples: schoolExemplars, subject: title }, { callAIJSON });
    setGeneratingModel(false);
    if (result.error) { setError(result.error); return; }
    mentalModelStore.write(userId, lecture?.id, result.model);
    setMentalModel(result.model);
  }, [atoms, lectureObjectives, schoolExemplars, title, userId, lecture?.id]);

  const markModelReviewed = useCallback(() => {
    const next = mentalModelImpactStore.markReviewed(userId, lecture?.id, qStats);
    setImpactEntry(next);
  }, [userId, lecture?.id, qStats]);

  // Jump to an atom referenced by the framework — same target the quiz Summary's
  // "review this atom" link uses, so the highlight/scroll behavior is shared.
  const jumpToAtomTerm = useCallback((term) => {
    if (atomsDetailsRef.current) atomsDetailsRef.current.open = true;
    setReviewAtomKey(normAtomKey(term));
  }, []);

  // Auto-trigger: load cached guide or generate when atoms first populate
  useEffect(() => {
    if (!atoms.length || guideGenRef.current) return;
    guideGenRef.current = true;
    const stored = studyGuideStore.read(userId, lecture?.id);
    if (stored?.topics?.length) { setStudyGuide(stored); return; }
    generateGuide(atoms, lectureObjectives);
  }, [atoms]); // eslint-disable-line react-hooks/exhaustive-deps

  // atomMastery is computed against the CURRENT atom list, so it has to recompute whenever atoms
  // themselves load or change (initial async load, a re-extraction) — not just at round/quiz end.
  useEffect(() => { refreshAtomMastery(atoms); }, [atoms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shell keys this component by lecture id, so switching lectures remounts it
  // with fresh state instead of needing a synchronous reset in here.
  useEffect(() => {
    let alive = true;
    loadLecture(lecture, { fetchContent: fetchLectureContent, userId }).then((r) => {
      if (!alive) return;
      setAtoms(r.atoms); setText(r.text); setImages(r.images || []); setStage(r.stage);
      if (r.error) setError(r.error);
    });
    return () => { alive = false; };
  }, [lecture, userId]);

  const recoverObjectives = useCallback(async (sourceText) => {
    if (objectiveResource.loading) throw new Error("Objectives are still syncing. Try again in a moment.");
    const found = await extractObjectivesFromLecture(sourceText, { ...lecture, chunks: [] }, blockId);
    if (!found.length) throw new Error("No explicit objectives recovered from the stored text. The atoms have been preserved.");
    const commands = createObjectiveCommands({
      read: () => objectivesStore.read(userId) || {},
      write: (next) => objectivesStore.write(userId, next),
      notify: () => window.dispatchEvent(new CustomEvent("rxt-objectives-updated")),
    });
    commands.replaceLectureObjectives(blockId, lecture?.id, found);
    setObjectiveNotice(`${found.length} lecture objectives recovered and linked; cloud sync is queued.`);
    return found;
  }, [lecture, blockId, userId, objectiveResource.loading]);

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
      const r = await extractAtoms(lecture, sourceText, {
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
      try { await saveLectureAtoms(userId, lecture?.id, finalAtoms); }
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
  }, [lecture, userId, blockId, recoverObjectives, lectureObjectives.length]);

  const onFile = useCallback(async (file) => {
    if (!file) return;
    const uploaded = await file.text();
    setText(uploaded);
    if (uploaded.trim().length < 200) { setError("That file has almost no text in it."); return; }
    await runExtract(uploaded);
  }, [runExtract]);

  const objectiveById = useMemo(
    () => new Map(lectureObjectives.map((o) => [o.id, o])),
    [lectureObjectives]
  );

  const untagged = atoms.filter((a) => !a.objectiveIds?.length).length;

  // Annotate display atoms with cross-lecture recurrence from the term index
  const annotatedAtoms = useMemo(() => {
    const termIndex = atomTermIndex.read(userId, blockId) || {};
    return atoms.map((a) => {
      const entry = termIndex[normAtomKey(a.term)];
      const count = entry?.count ?? 1;
      return count >= 2 ? { ...a, isHighYield: true, crossCount: count } : a;
    });
  }, [atoms, userId, blockId]);

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
      await saveLectureAtoms(userId, lecture?.id, r.atoms);
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
  /** The round Study should open on — one value, so the button's label and its action agree. */
  const nextRound = resumeRound(done, rounds.length);

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
        "No questions came back. The local bridge was unreachable and the cloud provider returned " +
        "nothing — check that llm-bridge is running, or the console for the bridge reason."
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
  }, [lecture, images, rounds, userId, blockId, objectiveById, logActivity, startQuizSession, schoolExemplars, schoolExamplesLoading, clinicalCorrelateLibrary]);

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
    if (!focusObjectiveIds?.length) return lectureObjectives;
    const rank = (o) => {
      const i = focusObjectiveIds.indexOf(o.id || o.code);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return lectureObjectives
      .map((objective) => ({
        ...objective,
        _focusPriority: rank(objective) === Number.MAX_SAFE_INTEGER ? 1 : 0,
      }))
      .sort((a, b) => rank(a) - rank(b));
  }, [lectureObjectives, focusObjectiveIds]);

  const runQuiz = useCallback(async (count, difficulty) => {
    const generationVersion = "v2";
    if (schoolExamplesLoading) {
      setError("Your uploaded school examples are still loading. Try again in a moment.");
      return;
    }
    setBusy("Preparing quiz…"); setError(""); setObjectiveNotice(""); setQuestions(null);
    setQuizPreparation({ requested: count, ready: 0, attempt: 0, phase: "generating" });

    const priorQuestions = lecture?.id
      ? generatedQuestionsStore.questionsForLecture(userId, lecture.id)
      : [];
    const generatedHistory = generatedQuestionsStore.questionsForAllLectures(userId);

    const validReserve = new Set(locallyValidClinicalQuestions(priorQuestions));
    const adaptivePlan = buildAdaptiveObjectivePlan(orderedObjectives, count);
    const adaptiveRank = new Map(adaptivePlan.map((objective, index) => [objective.id || objective.code, index]));
    const reserve = priorQuestions
      .filter((question) => question.generationMode !== "grounded-fallback")
      .filter((question) => (question.generationVersion || "v2") === generationVersion)
      .filter((question) => validReserve.has(question))
      .filter((question) => (Number(question.timesAnswered) || 0) === 0)
      .filter((question) => !question.difficulty || String(question.difficulty).toLowerCase() === difficulty)
      .sort((a, b) => {
        const questionRank = (question) => Math.min(
          ...(question.objectiveIds || []).map((id) => adaptiveRank.get(id) ?? Number.MAX_SAFE_INTEGER),
          Number.MAX_SAFE_INTEGER
        );
        return questionRank(a) - questionRank(b)
          || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      })
      .slice(0, count);
    const missing = Math.max(0, count - reserve.length);
    if (!missing) {
      setBusy("");
      setAdHocQuiz(true);
      startQuizSession(reserve);
      setQuizPreparation(null);
      return;
    }

    // Keep the requested count as a hard contract. Generation progress is shown
    // in the preparation card, but the runner does not open until the complete
    // set is ready; otherwise a shortfall can look like a successful 6/15 quiz.
    let progressiveQuestions = [...reserve];
    const appendPrepared = (batch = []) => {
      const known = new Set(progressiveQuestions.map((question) => String(question?.stem || "").trim().toLowerCase()));
      for (const question of batch) {
        const key = String(question?.stem || "").trim().toLowerCase();
        if (!key || known.has(key)) continue;
        known.add(key);
        progressiveQuestions.push(question);
      }
      progressiveQuestions = progressiveQuestions.slice(0, count);
    };
    if (reserve.length) appendPrepared([]);

    const result = await prepareObjectiveQuiz(
      {
        objectives: orderedObjectives,
        lectureTitle: title,
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
        focusNotes: reasoningGuidance(learnerEvidence.data?.testTaking?.missTypes, missing),
      },
      {
        callAIJSON,
        onAccepted: (questions) => {
          if (lecture?.id) generatedQuestionsStore.addQuestions(userId, lecture.id, questions);
          appendPrepared(questions);
        },
      },
      (progress) => setQuizPreparation({ ...progress, requested: count, ready: reserve.length + progress.ready })
    );
    setBusy("");
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
    const launchPartialQuiz = (items, detail) => {
      const partial = attachObjectiveTexts(items);
      if (lecture?.id) generatedQuestionsStore.addQuestions(userId, lecture.id, partial);
      setObjectiveNotice(`Starting a ${partial.length}-question quiz; ${Math.max(0, count - partial.length)} of ${count} requested questions could not be prepared. ${detail || "You can retry later for more."}`);
      setAdHocQuiz(true);
      startQuizSession(partial);
      setQuizPreparation(null);
    };
    if (result.error) {
      setQuizPreparation(null);
      if (progressiveQuestions.length) {
        launchPartialQuiz(progressiveQuestions, result.error);
        return;
      }
      // Saved questions are an offline/error fallback, never the default path. Reusing them
      // before generation made a requested harder round repeat the exact prior quiz.
      const matching = priorQuestions.filter((q) =>
        q.generationMode !== "grounded-fallback" &&
        (q.generationVersion || "v2") === generationVersion &&
        (Number(q.timesAnswered) || 0) === 0 &&
        validReserve.has(q) &&
        String(q?.difficulty || "").toLowerCase() === difficulty &&
        (!orderedObjectives.length || q.objectiveIds?.length)
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
        "No questions came back. The local bridge was unreachable and the cloud provider returned " +
        "nothing — check that llm-bridge is running, or the console for the bridge reason."
      );
      return;
    }
    if (result.incomplete || progressiveQuestions.length < count) {
      if (progressiveQuestions.length) {
        launchPartialQuiz(progressiveQuestions, "Retry later to add questions for the missing objectives.");
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
  }, [orderedObjectives, title, blockId, atoms, userId, lecture?.id, logActivity, startQuizSession, schoolExemplars, schoolExamplesLoading, clinicalCorrelateLibrary, objectiveById, learnerEvidence.data?.testTaking?.missTypes]);

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
    setQuizPicker({ count: 15, difficulty: resolveDefaultDifficulty(qStats.accuracy) });
  }, [autoOpenQuiz, stage, atoms.length, qStats.accuracy]);


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
      <input type="file" multiple webkitdirectory="" directory="" className="hidden" disabled={!!busy}
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
    return (
      <div className="p-5">
        {objectiveNotice && <div role="status" className="mb-3 rounded-lg border border-accent bg-bg-elevated p-3 text-sm text-text-2">{objectiveNotice}</div>}
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            onClick={() => {
              // Answers already persisted per-question (AtomQuiz's recordAnswer/recordAtomAnswer)
              // even though this round wasn't finished — re-read so the bars reflect them instead
              // of sitting on whatever they were at round start.
              setQStats(questionStats.statsForLecture(userId, lecture?.id));
              refreshAtomMastery();
              setQuestions(null);
            }}
            className="font-mono text-xs text-text-3 hover:text-text-1"
          >
            ← back to atoms
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
        <AtomQuiz
          key={quizSessionId}
          questions={questions}
          initialState={quizResumeState}
          blockId={blockId}
          lectureId={lecture?.id ?? null}
          lectureTitle={renamedTitle || title}
          blockName={blockName}
          lectureNumber={lecture?.lectureNumber ?? lecture?.number ?? null}
          userId={userId}
          expectedCount={quizPreparation?.requested || questions.length}
          preparing={!!quizPreparation && quizPreparation.ready < quizPreparation.requested}
          onCheckpoint={checkpointLectureQuiz}
          onExit={() => { setQuestions(null); setQuizResumeState(null); }}
          onAnswer={() => {
            // Opening or abandoning a quiz is not study activity. Record the
            // lecture only after the learner actually submits an answer, once
            // per quiz session, so an immediate exit cannot mark it done today.
            if (loggedQuizActivityRef.current === quizSessionId) return;
            loggedQuizActivityRef.current = quizSessionId;
            logActivity?.({ lectureId: lecture?.id, activityType: "deep_learn", confidenceRating: null });
          }}
          onReviewAtom={(atomKey) => { setQuestions(null); setQuizResumeState(null); setReviewAtomKey(atomKey); }}
          onDone={({ correct = 0, total = 0, avgConfidence = 0, hasLandmines = false, records = [] } = {}) => {
            setCompletedQuizSessionId(quizSessionId);
            lectureQuizSessionsStore.remove(userId, quizMetaRef.current?.id);
            quizMetaRef.current = null;
            // An ad-hoc quiz doesn't advance the round-resume bookmark — there is no sequence
            // for it to be a position in — but it's always its own "last round" for the
            // objective-status update below, since there's no next one coming.
            const nextDone = adHocQuiz ? done : Math.max(done, round + 1);
            let isLastRound = true;
            if (!adHocQuiz) {
              saveRoundProgress(userId, lecture?.id, nextDone);
              setDone(nextDone);
              isLastRound = nextDone >= rounds.length;
            }
            setQStats(questionStats.statsForLecture(userId, lecture?.id));
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

            // A correctly-answered question earns its atom's matching study-guide topic a
            // check, same as ticking it by hand — a wrong answer never checks anything.
            if (studyGuide?.topics?.length) {
              const toCheck = topicsToAutoCheck(records, atoms, studyGuide.topics);
              if (toCheck.length) {
                let guide = studyGuide;
                for (const topicId of toCheck) {
                  guide = studyGuideStore.setTopicChecked(userId, lecture?.id, topicId, true);
                  masterGuideStore.syncFromLectureTopic(userId, blockId, lecture?.id, topicId, true);
                }
                setStudyGuide(guide);
              }
            }

            // Signal Today to auto-check once ≥60% of rounds are complete
            if (rounds.length > 0 && nextDone / rounds.length >= 0.6 && lecture?.id) {
              window.dispatchEvent(new CustomEvent("rxt-lecture-progress-60", {
                detail: { lectureId: lecture.id },
              }));
            }

            // Write session outcome to performance store after every completed round
            try {
              performanceStore.appendSession(userId, {
                lectureId: lecture?.id,
                blockId,
                score,
                avgConfidence,
                hasLandmines,
              });
            } catch { /* non-critical */ }

            // Only update objective status after the final round of a session
            if (!isLastRound) return;
            try {
              const perfStore = performanceStore.read(userId) || {};
              const perfKey = `${lecture?.id}__${blockId}`;
              const sessions = perfStore[perfKey]?.sessions || [];

              const blockExamDate = examDates?.[blockId] ?? null;
              const comprehensiveExamDate = examDates?.__comprehensive ?? null;

              const objStore = objectivesStore.read(userId) || {};
              let objs = selectBlockObjectives(objStore, blockId);
              let changed = false;

              for (const obj of lectureObjectives) {
                const target = resolveObjectiveTarget({
                  objective: obj,
                  atoms,
                  sessions,
                  avgConfidence,
                  hasLandmines,
                  blockExamDate,
                  comprehensiveExamDate,
                  masterySummary: (atomKeys) => atomProgressStore.masterySummary(userId, lecture?.id, atomKeys),
                });
                if (target && obj.status !== target) {
                  objs = setStatus(objs, obj.id, target, new Date());
                  changed = true;
                }
              }
              if (changed) {
                const storeKey = storageKeyFor(objStore, blockId);
                const nextEntry = toEntry(objStore[storeKey], objs);
                objectivesStore.write(userId, { ...objStore, [storeKey]: nextEntry });
              }
            } catch { /* non-critical */ }
          }}
        />
        {isActiveQuizComplete(completedQuizSessionId, quizSessionId) && (
        <div className="mt-4 flex items-center gap-3">
          {hasNext ? (
            <>
              <Button onClick={() => runRound(round + 1)} disabled={!!busy}>
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

  // Objective status counts
  const objMastered = objectivePractice.ready;
  const objDeveloping = objectivePractice.developing;
  const objStruggling = objectivePractice.struggling;
  const objWorked = objectivePractice.worked;
  const objUntested = objectivePractice.untested;
  const objWorkedPct = lectureObjectives.length > 0 ? Math.round((objWorked / lectureObjectives.length) * 100) : 0;
  const objMasteredPct = lectureObjectives.length > 0 ? Math.round((objMastered / lectureObjectives.length) * 100) : 0;
  const objUntestedPct = lectureObjectives.length > 0 ? Math.round((objUntested / lectureObjectives.length) * 100) : 0;
  // The real progress bar: atoms answered correctly at least once. Unlike the old rounds-done
  // counter, this can't go stale relative to itself — it's read straight from the same store
  // every answer writes to, not blended from a separate heuristic.
  const accuracyPct = qStats.accuracy == null ? 0 : Math.round(qStats.accuracy * 100);
  // Banded rather than a gradient: the only decision this drives is whether the lecture goes back
  // on the review pile, and 70% is where that answer changes.
  const accuracyColor = accuracyPct >= 85 ? "text-good" : accuracyPct >= 70 ? "text-accent" : "text-bad";
  // Same accuracy-based starting point runRound actually generates from — this used to always
  // read the round INDEX alone, so it could show "Easy" while the round it was about to hand you
  // was really Medium or Hard.
  const baseDifficulty = resolveDefaultDifficulty(qStats.accuracy);
  const currentDifficultyKey = roundDifficulty(baseDifficulty, round);
  const currentDifficulty = currentDifficultyKey[0].toUpperCase() + currentDifficultyKey.slice(1);
  const diffColor = {
    easy: "text-good", medium: "text-accent", hard: "text-warn", expert: "text-bad",
  }[currentDifficultyKey];

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:py-8">
      <header className="border-b border-border pb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button onClick={onClose} className="font-mono text-xs text-text-3 hover:text-text-1">← back</button>
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
      <p className="mb-1 font-condensed text-xs font-semibold uppercase tracking-[0.16em] text-accent">Lecture</p>
      <h2 className="max-w-4xl text-2xl font-bold leading-tight text-text-1 sm:text-3xl">{renamedTitle || title}</h2>
      {lecture?.sourceFiles?.length > 0 && (
        <details className="mt-3 max-w-4xl rounded-lg border border-border bg-panel px-3 py-2">
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
      {examRepairContext && (examRepairContext.weakObjectives?.length || examRepairContext.missedQuestions?.length) > 0 && (
        <section aria-label="Exam repair context" className="mt-4 rounded-lg border border-bad/30 bg-bad/5 p-3">
          <h3 className="font-semibold text-text-1">Continue from your exam misses</h3>
          {examRepairContext.weakObjectives?.length > 0 && <>
            <p className="mt-1 text-sm text-text-2">Weak objectives are moved to the front when you build a lecture quiz:</p>
            <ul className="mt-1 list-inside list-disc text-sm text-text-1">{examRepairContext.weakObjectives.slice(0, 6).map((objective) => <li key={objective.id}>{objective.label}{objective.attempts ? ` · ${objective.misses}/${objective.attempts} missed` : " · flagged struggling"}</li>)}</ul>
          </>}
          {examRepairContext.missedQuestions?.length > 0 && <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-accent">Review {examRepairContext.missedQuestions.length} recent missed question{examRepairContext.missedQuestions.length === 1 ? "" : "s"}</summary>
            <div className="mt-2 space-y-2">{examRepairContext.missedQuestions.map((miss) => <article key={miss.key} className="rounded border border-border bg-panel p-2 text-sm">
              <p className="font-medium text-text-1">{miss.stem}</p>
              <p className="mt-1 text-text-2"><span className="text-bad">Your answer:</span> {miss.selected} · <span className="text-good">Keyed answer:</span> {miss.correct}</p>
              <p className="mt-0.5 text-xs text-text-3">{miss.title}{miss.submittedAt ? ` · ${new Date(miss.submittedAt).toLocaleDateString()}` : ""}</p>
            </article>)}</div>
          </details>}
        </section>
      )}
      {savedLectureQuizzes.length > 0 && !questions && (
        <section aria-label="Unfinished lecture quizzes" className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <h3 className="font-semibold text-text-1">Continue an unfinished lecture quiz</h3>
          <p className="mt-1 text-xs text-text-3">Your question set, current question, selected answer, confidence, and completed responses are saved to your account.</p>
          <ul className="mt-2 space-y-2">{[...savedLectureQuizzes].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-panel p-2">
              <span className="text-sm text-text-2">{session.questions?.length || 0} questions · {session.progress?.records?.length || 0} completed · {new Date(session.updatedAt || session.createdAt || Date.now()).toLocaleString()}</span>
              <span className="flex gap-2">
                <Button onClick={() => resumeLectureQuiz(session)}>Resume quiz</Button>
                <button type="button" className="px-2 text-xs text-text-3 underline" onClick={() => { lectureQuizSessionsStore.remove(userId, session.id); setSavedLectureQuizzes(lectureQuizSessionsStore.read(userId, lecture?.id, blockId).filter((item) => item.id !== session.id)); }}>Discard</button>
              </span>
            </li>
          ))}</ul>
        </section>
      )}
      <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-1">Guided tutor</span>
            {tutorSession && <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">{tutorSession.status === "active" && !tutorSession.patientCase && !tutorSession.delayedReview ? "preparing" : tutorSession.status}</span>}
            {userId && <span className={`rounded border border-border px-1.5 py-0.5 font-mono text-[10px] ${tutorCloudStatus === "error" ? "text-bad" : "text-text-3"}`} role="status">{!tutorStoreHydrated ? "loading cloud history" : tutorCloudStatus === "syncing" ? "saving to cloud…" : tutorCloudStatus === "error" ? "cloud save needs retry" : "saved in cloud"}</span>}
          </div>
          {!tutorSession ? (
            <p className="mt-1 text-xs text-text-3">{!tutorStoreHydrated ? "Loading your saved tutor history from Firestore…" : "Choose a focused block. Your place, objectives, and blockers are saved by lecture."}</p>
          ) : (
            <p className="mt-1 text-xs text-text-3">
              {tutorSession.status === "active" && !tutorSession.patientCase && !tutorSession.delayedReview
                ? "Building your first patient case · study timer starts when it is ready"
                : `${tutorPacing.mode} · ${tutorSessionSummaryValue.objectivesCompleted}/${tutorSessionSummaryValue.objectivesTotal || lectureObjectives.length} complete · ${tutorPacing.objectivesInProgress} in progress · ${tutorPacing.objectivesNotYetReached} not reached · ${Math.floor(tutorSessionSummaryValue.elapsedSeconds / 60)}m elapsed · ${Math.floor(tutorSessionSummaryValue.remainingSeconds / 60)}m left`}
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
          {tutorSession && (
            <button
              type="button"
              aria-expanded={tutorWorkspaceOpen}
              aria-controls="guided-tutor-workspace"
              onClick={() => setTutorWorkspaceOpen((open) => !open)}
              className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-2 hover:border-accent"
            >{tutorWorkspaceOpen ? "Collapse case" : "Show patient case"}</button>
          )}
          {!tutorSession && [
            { minutes: 30, label: "Quick overview" },
            { minutes: 45, label: "Balanced walkthrough" },
            { minutes: 60, label: "Deep dive" },
          ].map(({ minutes, label }) => (
            <button key={minutes} disabled={!tutorStoreHydrated} onClick={() => startTutorSession(minutes)} className="rounded border border-accent/40 px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/10 disabled:cursor-wait disabled:opacity-50">
              {label} · {minutes}m
            </button>
          ))}
          {tutorSession && tutorSession.status === "active" && (tutorSession.patientCase || tutorSession.delayedReview) && (
            <>
              <TutorCountdown key={`${tutorSession.sessionId}:${tutorSession.remainingSeconds}`} remainingSeconds={tutorSession.remainingSeconds} active />
              <button onClick={pauseCurrentTutorSession} className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-2 hover:border-accent">Pause</button>
              <button onClick={finishCurrentTutorSession} className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-3 hover:border-bad hover:text-bad">End block</button>
            </>
          )}
          {tutorSession && tutorSession.status === "active" && !tutorSession.patientCase && !tutorSession.delayedReview && (
            <span className="font-mono text-[11px] text-text-3" role="status">{tutorLoading ? "Preparing case…" : "Case not ready · retry below"}</span>
          )}
          {tutorSession && tutorSession.status === "paused" && (
            <>
              <span className="font-mono text-[11px] text-text-3">{Math.floor(tutorSession.remainingSeconds / 60)}m left</span>
              <button onClick={resumeCurrentTutorSession} className="rounded bg-accent px-2 py-1 font-mono text-[11px] font-semibold text-white hover:bg-accent/90">Resume</button>
              <button onClick={finishCurrentTutorSession} className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-3 hover:border-bad hover:text-bad">End block</button>
            </>
          )}
          {tutorSession && tutorSession.status === "checkpoint" && (
            <>
              <span className="font-mono text-[11px] text-text-3">time block complete</span>
              <button onClick={() => saveTutorSession(extendTutorSession(tutorSessionRef.current, 10))} className="rounded bg-accent px-2 py-1 font-mono text-[11px] font-semibold text-white hover:bg-accent/90">Add 10 min &amp; continue</button>
              <button onClick={finishCurrentTutorSession} className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-3 hover:border-bad hover:text-bad">End block</button>
            </>
          )}
          {tutorSession && tutorSession.status === "finished" && (
            <button onClick={() => setTutorSession(null)} className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-3 hover:border-accent">Start another block</button>
          )}
          {tutorSession && tutorCloudStatus === "error" && (
            <button onClick={() => saveTutorSession(tutorSessionRef.current)} className="rounded border border-bad/40 px-2 py-1 font-mono text-[11px] text-bad hover:bg-bad/5">Retry cloud save</button>
          )}
        </div>
      </div>
      {tutorSession && (
        <section id="guided-tutor-workspace" hidden={!tutorWorkspaceOpen} className="mt-3 rounded-lg border border-good/30 bg-good/5 p-3" data-testid="guided-tutor-workspace">
          {tutorSession.status !== "active" && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-accent/30 bg-bg-elevated px-3 py-2">
              <p className="text-sm text-text-2">
                {tutorSession.status === "finished"
                  ? "Walkthrough finished. Your case and checkpoints are here to review."
                  : tutorSession.status === "checkpoint"
                    ? "Time block complete. Your place is saved; pause to process, add 10 minutes to continue, or end the block."
                    : "Tutor paused. Take your time with the case and feedback; your place is saved."}
              </p>
              {tutorSession.status === "paused" && (
                <button onClick={resumeCurrentTutorSession} className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90">Resume timer</button>
              )}
              {tutorSession.status === "checkpoint" && (
                <button onClick={() => saveTutorSession(extendTutorSession(tutorSessionRef.current, 10))} className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90">Add 10 min &amp; continue</button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-good">Guided case walkthrough · step {tutorSession.turns?.length + 1 || 1}</p>
              <h3 className="mt-1 font-semibold text-text-1">{tutorSession.delayedReview ? "Delayed retrieval" : `Objective ${tutorObjectiveIndex + 1} of ${lectureObjectives.length || 1}`}</h3>
            </div>
            <span className="rounded border border-good/30 px-2 py-1 font-mono text-[11px] text-good">Patient → diagnosis → mechanism → consequence</span>
          </div>
          <details className="mt-3 rounded border border-border bg-bg-elevated px-3 py-2 text-xs text-text-2" data-testid="tutor-coverage">
            <summary className="cursor-pointer font-semibold text-text-1">Coverage checkpoint · {tutorPacing.objectivesCompleted} complete · {tutorPacing.objectivesInProgress} in progress · {tutorPacing.objectivesNotYetReached} not yet reached</summary>
            <p className="mt-2 text-text-3">Time spent or an objective being reached is not mastery; only completed reasoning chains count as complete.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div><p className="font-semibold text-good">Complete</p>{tutorPacing.completed.map((label, index) => <p key={`done-${index}`} className="mt-1">{label}</p>)}</div>
              <div><p className="font-semibold text-accent">In progress</p>{tutorPacing.inProgress.map((label, index) => <p key={`progress-${index}`} className="mt-1">{label}</p>)}</div>
              <div><p className="font-semibold text-text-3">Not yet reached</p>{tutorPacing.notYetReached.map((label, index) => <p key={`pending-${index}`} className="mt-1">{label}</p>)}</div>
            </div>
            <p className="mt-2 border-t border-border pt-2">Pacing target: about {Math.max(1, Math.round(tutorPacing.targetSecondsPerRemainingObjective / 60))} min per unfinished objective. {tutorPacing.closingGuidance}</p>
          </details>
          <details className="mt-2 text-xs text-text-3">
            <summary className="cursor-pointer hover:text-text-1">Show lecture objective</summary>
            <p className="mt-1 leading-5">{activeTutorObjective?.objective || activeTutorObjective?.text || "Build the patient case from the lecture material."}</p>
          </details>
          {tutorSession.openingModel && !tutorSession.delayedReview && (
            <div className="mt-4 rounded border border-good/30 bg-bg-elevated p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-good">Start with the model</p>
              <p className="mt-2 text-sm leading-6 text-text-1">{tutorSession.openingModel}</p>
              <p className="mt-2 text-xs text-text-3">The case asks what clinical job breaks when the process is disrupted.</p>
            </div>
          )}
          {tutorSession.delayedReview ? (
            <div className="mt-4 rounded border border-accent/30 bg-bg-elevated p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Earlier patient · delayed retrieval</p>
              <p className="mt-2 text-sm leading-6 text-text-1">{tutorSession.delayedReview.stem}</p>
            </div>
          ) : tutorLoading && !tutorSession.patientCase ? (
            <div className="mt-4 rounded border border-border bg-bg-elevated px-3 py-4 text-sm text-text-2">Building a patient case from this lecture and its objectives…</div>
          ) : tutorSession.patientCase ? (
            <div className="mt-4 rounded border border-accent/30 bg-bg-elevated p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{displayedTutorCase.caseTitle || "Patient case"}</p>
              <p className="mt-2 text-sm leading-6 text-text-1">{displayedTutorCase.stem}</p>
            </div>
          ) : (
            <div className="mt-4 rounded border border-border bg-bg-elevated px-3 py-4 text-sm text-text-2">
              <p>No case was generated yet.</p>
              <button type="button" onClick={generateTutorCase} className="mt-2 rounded border border-accent/40 px-2 py-1 text-xs text-accent hover:bg-accent/10">Build patient case</button>
            </div>
          )}
          {latestTutorTurn && String(latestTutorTurn.objectiveId) === String(tutorSession.activeObjectiveId) && latestTutorTurn.feedback && (
            <div className={`mt-3 rounded border p-3 ${latestTutorTurn.assessment === "correct" ? "border-good/30 bg-good/5" : "border-warn/30 bg-warn/5"}`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3">Tutor feedback · {latestTutorTurn.assessment?.replace(/_/g, " ") || "review"}</p>
              <p className="mt-1 text-sm leading-6 text-text-1">{latestTutorTurn.feedback}</p>
              {latestTutorTurn.confidenceNote && <p className="mt-2 border-t border-border pt-2 text-xs leading-5 text-text-2">{latestTutorTurn.confidenceNote}</p>}
            </div>
          )}
          {tutorHasCurrentCase && (
            <>
              <p className="mt-4 text-sm font-semibold leading-6 text-text-1">{currentTutorQuestion || tutorPrompt.prompt}</p>
              <p className="mt-1 text-xs text-text-3">{tutorPrompt.scaffold}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Confidence before feedback">
                <span className="text-xs text-text-3">How sure are you?</span>
                {["low", "medium", "high"].map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={tutorConfidence === level}
                    disabled={tutorSession.status !== "active" || tutorReviewing || tutorLoading}
                    onClick={() => setTutorConfidence(level)}
                    className={`rounded border px-2 py-1 text-xs capitalize disabled:opacity-50 ${tutorConfidence === level ? "border-accent bg-accent/10 text-accent" : "border-border text-text-3 hover:text-text-1"}`}
                  >{level}</button>
                ))}
              </div>
              <textarea
                value={tutorResponse}
                onChange={(event) => { setTutorResponse(event.target.value); setTutorNotice(""); }}
                placeholder="First name the syndrome or disease family, then explain your reasoning…"
                disabled={tutorSession.status !== "active" || tutorLoading}
                rows={3}
                className="mt-3 w-full rounded border border-border bg-bg-elevated px-3 py-2 text-sm text-text-1 outline-none focus:border-accent disabled:opacity-70"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button disabled={tutorSession.status !== "active" || tutorReviewing || tutorLoading} onClick={() => submitTutorTurn("response")} className="rounded bg-good px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-50">{tutorReviewing ? "Tutor is reviewing…" : "Check my reasoning"}</button>
                <button disabled={tutorSession.status !== "active" || tutorReviewing || tutorLoading} onClick={() => submitTutorTurn("stuck")} className="rounded border border-border px-3 py-1.5 text-xs text-text-2 hover:border-accent disabled:cursor-wait disabled:opacity-50">Give me one hint</button>
                {tutorNotice && <span className="text-xs text-text-3" role="status">{tutorNotice}</span>}
              </div>
            </>
          )}
        </section>
      )}
      <details className="mt-2 w-fit text-sm text-text-3">
        <summary className="cursor-pointer py-1 hover:text-text-1">Lecture settings</summary>
        <div className="mt-2 min-w-72 rounded-lg border border-border bg-bg-elevated p-3"><RenameLecture userId={userId} lectureId={lecture?.id} title={renamedTitle || title} onRenamed={(name) => { setRenamedTitle(name); onLectureRenamed?.(name); }} /></div>
      </details>
      </header>

      <details className="mt-5 rounded-xl border border-border bg-bg-elevated">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <span><span className="block font-semibold text-text-1">Learning plan</span><span className="text-sm text-text-3">Mental-model setup, repairs, and objective links</span></span>
          <span className="font-mono text-[12px] text-text-3">{lectureObjectives.length} objectives · {atoms.length} facts</span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <LectureRetrievalEnrollment key={`${userId}:${blockId}:${lecture?.id}`} userId={userId} blockId={blockId} lectureId={lecture?.id} title={renamedTitle || title} reference={mentalModel?.bigPicture || ''} />
            <ModelRepairs userId={userId} lectureId={lecture?.id} title={renamedTitle || title} atoms={atoms} objectives={lectureObjectives} chunks={lecture?.chunks || []} />
          </div>
          <ObjectiveCoverage atoms={atoms} objectives={lectureObjectives} examples={schoolExemplars} />
          {clinicalCorrelateLibrary.length > 0 && (
            <details className="rounded-lg border border-border bg-bg-elevated p-3">
              <summary className="cursor-pointer text-sm font-semibold text-text-1">
                Recurring clinical correlates ({clinicalCorrelateLibrary.length})
              </summary>
              <p className="mt-2 text-xs text-text-3">Signals repeated in this lecture and/or its uploaded question sets. They are available as optional clue patterns during question generation.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {clinicalCorrelateLibrary.map((entry) => (
                  <div key={`${entry.label}-${entry.sourceKinds?.join("-")}`} className="rounded border border-border p-2 text-sm">
                    <div className="font-medium text-text-1">{entry.label}</div>
                    <div className="mt-1 text-xs text-text-3">{entry.sourceKinds?.join(" · ")} · {entry.frequency} references</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {onGoDeep && <Button variant="outline" onClick={() => onGoDeep(lecture?.id)}>Deep lecture study</Button>}
        </div>
      </details>
      {objectiveNotice && <p role="status" className="my-2 text-sm text-good">{objectiveNotice}</p>}
      {stage !== "loading" && !lectureObjectives.length && text.trim().length >= 200 && (
        <div className="my-3 flex flex-wrap items-center gap-3 rounded border border-warn/40 p-3">
          <span className="text-sm text-text-2">{objectiveResource.loading ? "Syncing lecture objectives…" : "No objectives linked yet. Recover them from the saved lecture without replacing your atoms."}</span>
          <Button variant="outline" disabled={!!busy || objectiveResource.loading} onClick={async () => {
            setBusy("Recovering lecture objectives…"); setError("");
            try { await recoverObjectives(text); }
            catch (e) { setError(e?.message || String(e)); }
            finally { setBusy(""); }
          }}>{busy || "Recover lecture objectives"}</Button>
        </div>
      )}
      {/* Status panel — shown once atoms are loaded */}
      {stage === "quiz" && atoms.length > 0 && (
        <section aria-label="Lecture progress" className="mt-5 overflow-hidden rounded-t-2xl border border-b-0 border-accent/40 bg-bg-elevated divide-y divide-border/50">
          <div className="flex items-center justify-between px-4 py-3">
            <div><p className="font-condensed text-xs font-semibold uppercase tracking-[0.16em] text-accent">Practice</p><h3 className="text-lg font-semibold text-text-1">Test this lecture</h3></div>
            <span className="font-mono text-[12px] text-text-3">Objective-first quiz</span>
          </div>
          {/* Primary progress: objectives determine quiz coverage and mastery. */}
          {lectureObjectives.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-accent flex-shrink-0">Objectives worked</span>
                <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                  <div className="h-full rounded-full bg-accent/60 transition-all" style={{ width: `${objWorkedPct}%` }} />
                </div>
                <span className="font-mono text-[11px] text-text-2 flex-shrink-0">{objWorked}/{lectureObjectives.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3 flex-shrink-0">Not yet seen</span>
                <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                  <div className="h-full rounded-full bg-text-3/35 transition-all" style={{ width: `${objUntestedPct}%` }} />
                </div>
                <span className="font-mono text-[11px] text-text-3 flex-shrink-0">{objUntested}/{lectureObjectives.length}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3">Level</span>
              <span className={`font-mono text-[11px] font-bold ${diffColor}`}>{currentDifficulty}</span>
            </div>
          </div>
          )}

          {/* Row 1b: questions answered — how much work this lecture has actually had. Accuracy is
              shown next to it because the count alone cannot tell drilled-and-solid from
              drilled-and-still-missing, which is the thing that decides what to review. */}
          {qStats.answered > 0 && (
            <div className="flex items-center gap-4 px-4 py-2.5">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3 flex-shrink-0">Questions</span>
              <span className="font-mono text-[11px] text-text-2 flex-1 min-w-0">
                {qStats.answered} answered
                <span className="text-text-3"> · {qStats.correct} correct</span>
              </span>
              <span className={`font-mono text-[11px] font-bold flex-shrink-0 ${accuracyColor}`}>{accuracyPct}%</span>
            </div>
          )}

          {/* Objective detail */}
          {lectureObjectives.length > 0 && (
            <div className="flex items-center gap-4 px-4 py-2.5">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3 flex-shrink-0">Objectives</span>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {objMastered > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-good">
                    <span className="h-2 w-2 rounded-full bg-good flex-shrink-0" />
                    {objMastered} ready
                  </span>
                )}
                {objDeveloping > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-accent">
                    <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                    {objDeveloping} developing
                  </span>
                )}
                {objStruggling > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-bad">
                    <span className="h-2 w-2 rounded-full bg-bad flex-shrink-0" />
                    {objStruggling} struggling
                  </span>
                )}
                {objUntested > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-text-3">
                    <span className="h-2 w-2 rounded-full bg-border flex-shrink-0" />
                    {objUntested} untested
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-text-2 flex-shrink-0">{objMasteredPct}% ready</span>
            </div>
          )}
          {lectureObjectives.length > 0 && (
            <details className="px-4 py-2.5 text-sm">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-text-2">
                <span className="font-semibold">Questions to finish each objective</span>
                <span className="font-mono text-[11px] text-text-3">
                  {objectivePractice.minimumRemaining === 0
                    ? "readiness floor met"
                    : `${objectivePractice.minimumRemaining} minimum remaining`}
                </span>
              </summary>
              <p className="mt-1 text-[12px] leading-relaxed text-text-3">
                Minimum assumes the next answers are correct and varied. Lecture quizzes and submitted generated Exam Mode questions both count when linked to an objective.
              </p>
              <ol className="mt-2 divide-y divide-border/60">
                {objectivePractice.rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] font-semibold text-accent-text">{row.code}</div>
                      {row.text && <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-text-2">{row.text}</div>}
                      <div className="mt-1 font-mono text-[11px] text-text-3">
                        {row.attempts} answered · {row.correct} correct
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 font-mono text-[11px] ${row.ready ? "border-good/40 text-good" : row.state === "struggling" ? "border-bad/40 text-bad" : "border-border text-text-2"}`}>
                      {row.ready ? "ready" : `${row.remaining} more if correct`}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {/* Supporting evidence stays visible, but deliberately secondary to objective progress. */}
          <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-3">
            <span>Supporting lecture facts</span>
            <span className="font-mono">{atomMastery.masteredCount}/{atomMastery.totalCount} reviewed · {atoms.length} available</span>
          </div>
        </section>
      )}
      {stage === "quiz" && atoms.length > 0 && (
        <details className="border-x border-accent/40 bg-bg-elevated px-4 pb-2 text-[12px] text-text-3">
          <summary className="cursor-pointer py-2">How progress is counted</summary>
          Questions answered here, in Study, Quiz, or submitted generated Exam Mode count when they carry this lecture's objective link. Readiness needs at least 3 attempts, 80% accuracy, a correct latest answer, 2 sessions, and 2 question types.
        </details>
      )}

      {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}

      {stage === "upload" && (
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">
            No stored text for this lecture — choose its .md {busy ? "" : "(from pdf2md)"}
          </span>
          <span className="font-mono text-[12px] text-text-3">{busy || "browse"}</span>
          <input type="file" accept=".md,.markdown,.txt" className="hidden" disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
        </label>
      )}

      {stage === "extract" && (
        <div className="mb-4 flex items-center gap-3">
          <Button onClick={() => runExtract(text)} disabled={!!busy}>
            {busyLabel || "▸ Extract the signal"}
          </Button>
          <span className="text-[12px] text-text-3">definitions, mechanisms, relationships, results — fluff dropped</span>
        </div>
      )}

      {stage === "quiz" && atoms.length > 0 && (
        <section aria-label="Lecture quiz" className="mb-6 flex flex-col gap-3 rounded-b-2xl border border-t-0 border-accent/40 bg-accent-soft/40 p-4 sm:p-5">
          {/* Unified generate button — opens inline picker. This IS the Quiz feature (same
              exemplar-backed generator as the Lectures list's QUIZ button), labeled Quiz so it
              reads as one instead of a generic "make some questions" action. */}
          {!quizPicker ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => { setQuizPreparation(null); setQuizPicker({ count: 15, difficulty: resolveDefaultDifficulty(qStats.accuracy) }); }}
                disabled={!!busy}
              >
                {busyLabel || "▸ Quiz this lecture"}
              </Button>
              <span className="text-[12px] text-text-3">
                {lecture?.id ? `${generatedQuestionsStore.countForLecture(userId, lecture.id)} reviewed questions saved` : "Questions are saved for reuse"}
                {schoolExamplesLoading
                  ? " · loading school examples…"
                  : schoolExemplars.length
                    ? ` · ${schoolExemplars.length} school-style examples`
                    : " · no school examples loaded"}
              </span>
              {done > 0 && (
                <button
                  onClick={() => { clearRoundProgress(userId, lecture?.id); setDone(0); setRound(0); }}
                  /* Resets only the in-session round bookmark (where the next Study pass picks
                     up) — atom mastery and question counts are the lecture's real history and
                     deliberately survive "start over", same as they always have. */
                  disabled={!!busy}
                  className="font-mono text-[12px] text-text-3 underline decoration-dotted hover:text-text-1"
                >
                  reset progress
                </button>
              )}
            </div>
          ) : (
            /* Inline count + difficulty picker */
            <div className="rounded-sm border border-border bg-bg-elevated p-4 flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <span className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-text-3 w-20">Questions</span>
                <div className="flex gap-1.5">
                  {[5, 10, 15, 25, 50, 100].map((n) => (
                    <button
                      key={n}
                      onClick={() => setQuizPicker((p) => ({ ...p, count: n }))}
                      className={[
                        "rounded-sm border px-2.5 py-1 font-mono text-[12px] transition-colors",
                        quizPicker.count === n
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-text-2 hover:border-border-strong",
                      ].join(" ")}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm text-text-2">
                Covers lecture objectives first, using atoms as supporting facts. Difficulty advances automatically from your performance; this quiz starts at <strong className="capitalize text-text-1">{quizPicker.difficulty}</strong>.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-text-3">Generator</span>
                {[["v2", "SGU / ExamSoft v2"]].map(([value, label]) => (
                  <span key={value} className="rounded-sm border border-accent bg-accent-soft px-2.5 py-1 font-mono text-[12px] text-accent">
                    {label}
                  </span>
                ))}
                <span className="text-[12px] text-text-3">V2 is the active generator for every new quiz.</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => {
                    const { count, difficulty } = quizPicker;
                    setQuizPicker(null);
                    runQuiz(count, difficulty);
                  }}
                  disabled={!!busy}
                >
                  {busyLabel || `Start adaptive ${quizPicker.count}-question quiz`}
                </Button>
                <button onClick={() => setQuizPicker(null)} className="font-mono text-[12px] text-text-3 hover:text-text-1">
                  cancel
                </button>
                <span className="font-mono text-[12px] text-text-3">
                  {lectureObjectives.length > 0
                    ? `Unseen questions first · struggling, then developing objectives · atoms supply the supporting facts`
                    : `Grounded in ${atoms.length} key facts`}
                </span>
              </div>
              {reviewableQuizQuestions.length > 0 && (
                <details className="border-t border-border pt-3">
                  <summary className="cursor-pointer text-sm text-text-2 hover:text-text-1">
                    Review previous questions ({reviewableQuizQuestions.length} due)
                  </summary>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => {
                        const count = quizPicker.count;
                        setQuizPicker(null);
                        runSavedQuiz(count);
                      }}
                    >
                      Review {Math.min(quizPicker.count, reviewableQuizQuestions.length)} due question{Math.min(quizPicker.count, reviewableQuizQuestions.length) === 1 ? "" : "s"}
                    </Button>
                    <span className="text-[12px] text-text-3">Missed items return now; correct items return after 3, 7, then 14 days.</span>
                  </div>
                </details>
              )}
            </div>
          )}

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
              <p className="mt-2 text-xs text-text-3">Accepted questions stay saved while only missing slots are refilled. Replacement rounds generate a few spare candidates to reduce waiting.</p>
            </div>
          )}

          {/* Tagging */}
          {lectureObjectives.length > 0 && untagged > 0 && (
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={runTagging} disabled={!!busy}>
                ◇ Tag atoms to objectives
              </Button>
              <span className="text-[12px] text-text-3">
                {untagged} of {atoms.length} untagged · {lectureObjectives.length} objectives
              </span>
            </div>
          )}
          {images.length > 0 && (
            <span className="text-[12px] text-text-3">{images.length} figures attached</span>
          )}
        </section>
      )}

      {figuresPrompt}

      {stage === "quiz" && atoms.length > 0 && (
        <div className="mt-7 mb-2">
          <p className="font-condensed text-xs font-semibold uppercase tracking-[0.16em] text-text-3">Review &amp; reference</p>
          <p className="text-sm text-text-3">Open only what you need after practice.</p>
        </div>
      )}

      {/* Mental model — the reasoning framework this lecture's atoms attach to. Not a summary:
          big picture -> components -> relationships -> mechanisms -> cause/effect -> clinical
          application, each node linked back to the atoms that support it. */}
      {stage === "quiz" && atoms.length > 0 && (
        <details className="mt-0 w-full rounded-t-xl border border-b-0 border-border bg-bg-elevated p-4">
          <summary className="min-h-11 cursor-pointer rounded py-2 text-base font-semibold text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            Mental model <span className="text-sm font-normal text-text-2">· {generatingModel ? "building…" : mentalModel ? "saved framework" : "not built yet"}</span>
          </summary>
          {!mentalModel && !generatingModel && (
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={generateModel} disabled={!!busy}>
                ◇ Build mental model
              </Button>
              <span className="text-[12px] text-text-3">
                a big-picture paragraph, with optional reference details
              </span>
            </div>
          )}
          {generatingModel && (
            <span className="font-mono text-[12px] text-text-3">reasoning through the atoms…</span>
          )}
          {mentalModel && !generatingModel && (
            <MentalModelOverview model={mentalModel} onAtomClick={jumpToAtomTerm}>
              <ModelSection title="Model impact & review tracking">
                <MentalModelImpact entry={impactEntry} onMarkReviewed={markModelReviewed} />
              </ModelSection>
              <button onClick={generateModel} disabled={!!busy} className="mt-3 min-h-11 text-sm text-text-2 underline decoration-dotted">
                Regenerate reference model
              </button>
            </MentalModelOverview>
          )}
        </details>
      )}

      {/* The atom list is reference, not the session. Reading it is the passive habit this
          screen used to force; it stays one click away for when you actually want it. */}
      {/* Study guide — auto-generated searchable topics, checkable */}
      {(studyGuide || generatingGuide) && (
        <details className="mt-0 w-full rounded-none border border-b-0 border-border bg-bg-elevated p-4">
          <summary className="min-h-11 cursor-pointer rounded py-2 text-base font-semibold text-text-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              Study guide
              {studyGuide && !generatingGuide && (
                <span className="ml-1.5 text-sm text-text-2 font-normal">
                  · {studyGuide.topics.filter((t) => t.checked).length}/{studyGuide.topics.length} complete
                </span>
              )}
              {generatingGuide && <span role="status" className="ml-1.5 text-sm font-normal text-text-2">· building…</span>}
          </summary>
          <div className="mt-2">
            {!generatingGuide && studyGuide && (
              <button
                onClick={() => { guideGenRef.current = false; generateGuide(atoms, lectureObjectives); }}
                className="font-mono text-[11px] text-text-3 underline decoration-dotted hover:text-text-1"
              >
                regenerate
              </button>
            )}
          </div>
          {generatingGuide && (
            <span className="font-mono text-[12px] text-text-3">building study guide…</span>
          )}
          {studyGuide && (
            <div className="flex flex-col gap-1.5">
              {studyGuide.topics.map((t) => (
                <label key={t.id} className="flex w-fit max-w-full cursor-pointer items-start gap-2.5 rounded py-2 group">
                  <input
                    type="checkbox"
                    checked={t.checked || false}
                    className="mt-0.5 accent-accent shrink-0"
                    onChange={(e) => {
                      const next = studyGuideStore.setTopicChecked(userId, lecture?.id, t.id, e.target.checked);
                      setStudyGuide(next);
                      masterGuideStore.syncFromLectureTopic(userId, blockId, lecture?.id, t.id, e.target.checked);
                    }}
                  />
                  <span className={[
                    "text-sm leading-snug",
                    t.checked ? "text-text-3 line-through" : "text-text-1",
                  ].join(" ")}>
                    {t.text}
                  </span>
                </label>
              ))}
            </div>
          )}
        </details>
      )}

      {atoms.length > 0 && (
        <details ref={atomsDetailsRef} className="group mt-0 rounded-b-xl border border-border bg-bg-elevated p-4">
          <summary className="min-h-11 cursor-pointer list-none py-2 text-base font-semibold text-text-1 hover:text-accent">
            Reference atoms <span className="text-sm font-normal text-text-3">· {atoms.length} supporting facts</span>
          </summary>
          <div className="mt-3 space-y-4">
          {HY_TYPES.map((type) => {
            const list = annotatedAtoms.filter((a) => a.type === type);
            if (!list.length) return null;
            const meta = TYPE_META[type];
            return (
              <div key={type}>
                <div className="mb-1.5 text-sm font-semibold text-text-1">
                  {meta.label} <span className="font-normal text-text-3">· {meta.hint} · {list.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {list.map((a, i) => {
                    const atomKey = normAtomKey(a.term);
                    const isTarget = reviewAtomKey === atomKey;
                    return (
                    <div
                      key={i}
                      id={`atom-${atomKey}`}
                      className={
                        "rounded-lg border-l-2 bg-bg-elevated px-3 py-2 text-xs transition-colors duration-500 " +
                        meta.accent +
                        (isTarget ? " ring-2 ring-accent bg-accent-soft" : "")
                      }
                    >
                      <span className="font-semibold text-text-1">{a.term}</span>
                      {a.importanceTier && TIER_META[a.importanceTier] && (
                        <span className={`ml-1.5 rounded border px-1 py-0.5 text-[10px] font-semibold ${TIER_META[a.importanceTier].className}`} title={a.parentTerm ? `Parent: ${a.parentTerm}` : ""}>
                          {TIER_META[a.importanceTier].label}
                        </span>
                      )}
                      {a.parentTerm && (
                        <span className="ml-1.5 text-[10px] text-text-3">↳ {a.parentTerm}</span>
                      )}
                      {a.isHighYield && (
                        <span className="ml-1.5 rounded bg-accent/15 px-1 font-mono text-[13px] text-accent" title={`Appears in ${a.crossCount} lectures`}>
                          ⭐ ×{a.crossCount}
                        </span>
                      )}
                      <span className="text-text-2"> — {a.content}</span>
                      {(a.clinicalCorrelate || a.clinicalCues?.length || a.buzzwords?.length || a.inheritancePattern) && (
                        <div className="mt-2 rounded border border-accent/30 bg-accent/5 px-2 py-1.5 text-[11px] text-text-2">
                          <div className="font-semibold text-accent-text">Clinical recognition</div>
                          {a.clinicalCorrelate && <div>{a.clinicalCorrelate}</div>}
                          {a.clinicalCues?.length > 0 && <div className="text-text-3">Cues: {a.clinicalCues.join(" · ")}</div>}
                          {a.buzzwords?.length > 0 && <div className="text-text-3">Lecture buzzwords: {a.buzzwords.join(" · ")}</div>}
                          {a.inheritancePattern && <div className="text-text-3">Inheritance: {a.inheritancePattern}</div>}
                        </div>
                      )}
                      {a.objectiveIds?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {objectiveChips(a.objectiveIds, objectiveById).map((chip) => (
                            <span
                              key={chip.key}
                              title={chip.title}
                              className="rounded border border-border px-1.5 py-0.5 font-mono text-[13px] text-text-3"
                            >
                              {chip.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </details>
      )}
    </main>
  );
}

export default LectureStudyFlow;

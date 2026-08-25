import "../theme/tokens.css";
import "../theme/tailwind.css";
import "../theme/readability.css";
import { lazy, Suspense, useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useTheme } from "./useTheme";
import * as lecturesStore from "../stores/lectures.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { useExamDates } from "./hooks/useExamDates.js";
import { touchBlock } from "../stores/blockObjectives.js";
import { defaultBlockId, readCollapsedTerms, readLastView, writeLastView } from "./navPrefs.js";

const VALID_TABS = ["today", "lectures", "objectives", "exam", "guide", "more"];
const VALID_MORE_VIEWS = ["weak", "deeplearn", "struggle"];
import { Sidebar } from "./Sidebar.jsx";
import { Header } from "./Header.jsx";
import { TabBar } from "./TabBar.jsx";
import { BlockHome } from "./BlockHome.jsx";
import { CommandPalette } from "../ui/CommandPalette.jsx";
import { EngineSession } from "../engine/EngineSession.jsx";
import { CalibrationSession } from "../engine/CalibrationSession.jsx";
import { Button } from "../ui/Button.jsx";
import { signInWithGoogle, signOut, onAuthChange, completeRedirectSignIn, pullAllDataFromSupabase } from "../supabase.js";
import AnkiSyncModal from "../AnkiSyncModal.jsx";
import { ScheduleImportModal } from "./ScheduleImportModal.jsx";
import { ObjectivesContainer } from "./features/objectives/ObjectivesContainer.jsx";
import { ImportObjectivesPdfModal } from "./features/objectives/ImportObjectivesPdfModal.jsx";
import { ReExtractAllModal } from "./features/objectives/ReExtractAllModal.jsx";
import { AddLectureModal } from "./features/lectures/AddLectureModal.jsx";
import { BulkImportModal } from "./features/lectures/BulkImportModal.jsx";
import { Today } from "./features/today/Today.jsx";
import { DailyPlanSettingsModal } from "./features/today/DailyPlanSettingsModal.jsx";
import { FocusHudLinkModal } from "./FocusHudLinkModal.jsx";
import { UserApiKeyModal } from "./UserApiKeyModal.jsx";
import StudyRoutineModal, { MissNoteToast } from "../StudyRoutineModal.jsx";
import { LectureList } from "./features/tracker/LectureList.jsx";
import { WeakConcepts } from "./features/tracker/WeakConcepts.jsx";
import { StruggleTasks } from "./features/tracker/StruggleTasks.jsx";
import { ExamDateModal } from "./ExamDateModal.jsx";
import { setStoreHookUserId } from "./hooks/currentUser.js";
import { useToday } from "./features/today/useToday.js";
import { themes } from "../theme.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import * as lectureRoundsStore from "../stores/lectureRounds.js";
import { selectBlockObjectives, setStatus } from "./logic/objectives.js";
import { useLectures } from "./hooks/useLectures.js";
import { useObjectives } from "./hooks/useObjectives.js";

const RecognitionContainer = lazy(() => import("./features/recognition/RecognitionContainer.jsx").then((m) => ({ default: m.RecognitionContainer })));
const LectureStudyFlow = lazy(() => import("./features/lectures/LectureStudyFlow.jsx").then((m) => ({ default: m.LectureStudyFlow })));
const QuestionBankModal = lazy(() => import("./features/lectures/QuestionBankModal.jsx").then((m) => ({ default: m.QuestionBankModal })));
const MasterGuide = lazy(() => import("./features/guide/MasterGuide.jsx").then((m) => ({ default: m.MasterGuide })));
const DeepLearnContainer = lazy(() => import("./features/deeplearn/DeepLearnContainer.jsx").then((m) => ({ default: m.DeepLearnContainer })));
const ExamContainer = lazy(() => import("./features/exam/ExamContainer.jsx").then((m) => ({ default: m.ExamContainer })));

/**
 * Auth (Firebase) + cloud-load gate. localStorage is per-origin, so the shell
 * pulls the user's data from the cloud on sign-in — it works on any origin,
 * not just the one where data was first created.
 */
// Dev bypass: VITE_DEV_USER_ID in .env lets the MCP/headless browser skip
// Google OAuth. Set to your Firebase UID. Ignored in production builds.
const DEV_UID = import.meta.env.DEV ? (import.meta.env.VITE_DEV_USER_ID || null) : null;

export default function Shell() {
  const { theme, toggle } = useTheme();
  const [phase, setPhase] = useState("checking"); // checking | signedout | loading | ready
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let alive = true;

    // Dev bypass: skip Firebase auth. No Firestore pull (no auth token = rules reject).
    // MCP browser will show empty state; real browser still uses full auth flow.
    if (DEV_UID) {
      setUserId(DEV_UID);
      setPhase("ready");
      return () => { alive = false; };
    }

    let booted = false;
    let shellUnsub = null;
    async function boot(uid) {
      if (booted) return; // run once; sign-out reloads the page
      booted = true;
      if (!uid) { if (alive) { setUserId(null); setPhase("signedout"); } return; }
      if (alive) { setUserId(uid); setPhase("loading"); }
      // Never hang on a slow/stuck cloud query — proceed after 8s with whatever loaded.
      const timeout = new Promise((res) => setTimeout(res, 8000));
      try { await Promise.race([pullAllDataFromSupabase(uid), timeout]); }
      catch (e) { console.warn("cloud pull failed", e?.message); }
      if (alive) setPhase("ready");
    }
    // Resolve a pending Google redirect sign-in before the auth gate settles.
    completeRedirectSignIn().finally(() => {
      // Defer the boot call to avoid running synchronously inside the auth callback.
      const unsub = onAuthChange((user) => {
        setTimeout(() => boot(user?.id ?? null), 0);
      });
      if (alive) shellUnsub = unsub;
      else unsub();
    });
    return () => { alive = false; shellUnsub?.(); };
  }, []);

  const wrap = (children) => (
    <div className={`theme-${theme} flex h-screen items-center justify-center bg-bg text-text-1 font-sans`}>{children}</div>
  );

  if (phase === "checking") return wrap(<div className="text-sm text-text-3">Loading…</div>);
  if (phase === "loading") return wrap(
    <div className="flex flex-col items-center gap-3">
      <div className="text-sm text-text-3">Loading your data…</div>
      <button onClick={() => setPhase("ready")} className="text-xs text-text-3 underline hover:text-text-1">Skip</button>
    </div>
  );
  if (phase === "signedout") {
    return wrap(
      <div className="flex flex-col items-center gap-4">
        <div className="font-display text-2xl">RXTrack</div>
        <div className="text-sm text-text-3">Sign in to load your terms, blocks, and bank.</div>
        <Button onClick={() => signInWithGoogle().catch((e) => alert(e?.message || "Sign-in failed"))}>
          Sign in with Google
        </Button>
      </div>
    );
  }
  return (
    <Suspense fallback={wrap(<div className="text-sm text-text-3">Loading workspace…</div>)}>
      <ShellMain theme={theme} toggle={toggle} userId={userId} />
    </Suspense>
  );
}

function ShellMain({ theme, toggle, userId }) {
  // Reactive via the store hooks — no longer a one-shot read that goes stale
  // the moment a schedule is imported or a lecture uploaded.
  const blocks = useBlocks(userId);
  // Derived, not synced in an effect: the selection is what the user picked,
  // and it falls back to the first block until they pick — or if the block they
  // were on disappears (a deleted term used to leave the shell pointing at
  // nothing).
  const [selectedBlockId, setSelectedBlockId] = useState(() => readLastView().selectedBlockId || null);
  // Exam dates decide where an unselected shell lands: the block whose exam is
  // next is the one being studied.
  const examDates = useExamDates(userId);
  const activeBlockId =
    selectedBlockId && blocks.some((b) => b.id === selectedBlockId)
      ? selectedBlockId
      : defaultBlockId(blocks, readCollapsedTerms(), examDates.data);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sessionMode, setSessionMode] = useState(null); // null | 'engine' | 'calibrate'
  const [showAnki, setShowAnki] = useState(false);
  const [showRecognize, setShowRecognize] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAddLecture, setShowAddLecture] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showQuestionBanks, setShowQuestionBanks] = useState(false);
  const [showRoutine, setShowRoutine] = useState(false);
  const [showDailyPlanSettings, setShowDailyPlanSettings] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showFocusHudModal, setShowFocusHudModal] = useState(false);
  const [showImportObjectives, setShowImportObjectives] = useState(false);
  const [showReExtractAll, setShowReExtractAll] = useState(false);
  const [showExamDate, setShowExamDate] = useState(false);
  const [tab, setTab] = useState(() => {
    const last = readLastView().tab;
    return VALID_TABS.includes(last) ? last : "today";
  }); // today | lectures | objectives | more
  const [moreView, setMoreView] = useState(() => {
    const last = readLastView().moreView;
    return VALID_MORE_VIEWS.includes(last) ? last : null;
  }); // null | "weak" | "deeplearn"
  useEffect(() => {
    writeLastView({ tab, selectedBlockId: activeBlockId, moreView });
  }, [tab, activeBlockId, moreView]);
  const [deepLearnPreselectId, setDeepLearnPreselectId] = useState(null);
  const [examFocusLectureId, setExamFocusLectureId] = useState(null);
  // Per-lecture study flow (T2.1) — the lecture whose atoms we are working on.
  const [studyLecture, setStudyLecture] = useState(null);
  // Set alongside studyLecture by a "Quiz" click from Today/Lectures/ObjectiveTracker — Study
  // itself owns quiz generation now (one runner, see docs/plans/2026-08-23-unify-quiz-study-rounds.md),
  // this just tells it to open its picker immediately instead of waiting for an in-page click.
  const [pendingAutoQuiz, setPendingAutoQuiz] = useState(null); // null | { focusObjectiveIds }
  // LectureList unmounts every time a lecture is opened (or the tab is left)
  // and remounts fresh on return, dropping scroll position. `main` itself
  // never unmounts, so its scrollTop is saved here and restored once the
  // list is back on screen.
  const mainRef = useRef(null);
  const lectureListScrollRef = useRef(0);
  const onMainScroll = useCallback(() => {
    if (tab === "lectures" && !studyLecture && mainRef.current) {
      lectureListScrollRef.current = mainRef.current.scrollTop;
    }
  }, [tab, studyLecture]);
  useLayoutEffect(() => {
    if (tab === "lectures" && !studyLecture && mainRef.current) {
      mainRef.current.scrollTop = lectureListScrollRef.current;
    }
  }, [tab, studyLecture]);
  const active = blocks.find((b) => b.id === activeBlockId) || null;
  const { logActivity } = useToday(activeBlockId, userId);
  const allLectures = useLectures(null, userId);
  const allObjectives = useObjectives(null, userId);

  // The block on screen is the one App must still find in localStorage: the
  // objectives store keeps only recently-worked blocks mirrored there.
  useEffect(() => {
    if (activeBlockId) touchBlock(activeBlockId);
  }, [activeBlockId]);
  const legacyTheme = themes[theme] || themes.dark;

  // Store hooks read this when no explicit userId is passed.
  useEffect(() => { setStoreHookUserId(userId ?? null); }, [userId]);

  // One-time backfill: any lecture with round progress > 0 should have its
  // untested objectives promoted to "developing". Runs once per session when
  // both data sets are loaded.
  useEffect(() => {
    if (!userId) return;
    if (!allLectures.data?.length || !allObjectives.data) return;
    const sessionKey = `rxt-backfill-done-${userId}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");
    try {
      const rounds = lectureRoundsStore.read(userId) || {};
      const studiedIds = Object.entries(rounds)
        .filter(([, v]) => Number.isInteger(v?.round) && v.round > 0)
        .map(([id]) => id);
      if (!studiedIds.length) return;
      let store = allObjectives.data;
      let changed = false;
      for (const lecId of studiedIds) {
        const lec = allLectures.data.find((l) => l.id === lecId);
        if (!lec) continue;
        const blockId = lec.blockId;
        if (!blockId) continue;
        const blockObjs = selectBlockObjectives(store, blockId);
        const lecObjs = blockObjs.filter((o) => o?.linkedLecId === lecId && o.status === "untested");
        for (const obj of lecObjs) {
          store = setStatus(store, obj.id, "developing", new Date());
          changed = true;
        }
      }
      if (changed) objectivesStore.write(userId, store);
    } catch { /* non-critical */ }
  }, [userId, allLectures.data, allObjectives.data]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(
    () => blocks.map((b) => ({ id: b.id, label: b.name, hint: b.termName })),
    [blocks]
  );

  const onContinue = useCallback(() => setSessionMode("engine"), []);
  const onCalibrate = useCallback(() => setSessionMode("calibrate"), []);

  const switchTab = useCallback((t) => { setTab(t); setMoreView(null); }, []);

  // "Study →" on a lecture row: resolve the id to the stored lecture, then hand
  // it to the flow, which sources its text (locally or from Firestore) itself.
  // `opts.autoQuiz` (a "Quiz" click, not "Study →") opens Study's own picker immediately;
  // `opts.focusObjectiveIds` carries a pre-read's gap ordering through to it.
  const onStudyLecture = useCallback((lectureId, opts = {}) => {
    const lecture = (lecturesStore.read(userId) || []).find((l) => l?.id === lectureId);
    if (!lecture) return;
    setStudyLecture(lecture);
    setPendingAutoQuiz(opts.autoQuiz ? { focusObjectiveIds: opts.focusObjectiveIds || null } : null);
  }, [userId]);

  // Every "Quiz" button used to call this directly (objectives, lectureTitle, blockId, extraMeta)
  // to launch Shell's OWN generation + a separate top-level AtomQuiz overlay — a second runner
  // with its own duplicate objective-status update, no atom tracking, no atoms-list, no
  // jump-back. Callers now go through onStudyLecture instead; this stays only as the shape
  // ObjectiveTracker/Today/LectureList's existing call sites still pass, translated to it.
  const onStartObjectiveQuiz = useCallback(
    (objectives, lectureTitle, optionalBlockId, extraMeta = {}) => {
      const lectureId =
        extraMeta?.lectureId ?? (objectives || []).map((o) => o?.linkedLecId).find(Boolean) ?? null;
      if (lectureId) onStudyLecture(lectureId, { autoQuiz: true, focusObjectiveIds: extraMeta?.focusObjectiveIds });
    },
    [onStudyLecture]
  );

  return (
    <div className={`theme-${theme} flex h-screen overflow-hidden bg-bg text-text-1 font-sans`}>
      <Sidebar
        userId={userId}
        activeBlockId={activeBlockId}
        onSelectBlock={(id) => {
          setSelectedBlockId(id);
          setSessionMode(null);
          setTab("today");
          setMoreView(null);
          setStudyLecture(null);
          setPendingAutoQuiz(null);
        }}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          termName={active?.termName}
          blockName={active?.name}
          theme={theme}
          onToggleTheme={toggle}
          onAnki={() => setShowAnki(true)}
          onRecognize={() => setShowRecognize(true)}
          onExamDate={activeBlockId ? () => setShowExamDate(true) : null}
          onImportSchedule={() => setShowImport(true)}
          onAddLecture={activeBlockId ? () => setShowAddLecture(true) : null}
          onBulkImport={activeBlockId ? () => setShowBulkImport(true) : null}
          onQuestionBanks={() => setShowQuestionBanks(true)}
          onRoutine={() => setShowRoutine(true)}
          onDailyPlanSettings={activeBlockId ? () => setShowDailyPlanSettings(true) : null}
          onApiKeySettings={() => setShowApiKeyModal(true)}
          onFocusHudLink={() => setShowFocusHudModal(true)}
          onSignOut={() => signOut().then(() => window.location.reload())}
        />
        {/* Tab bar — hidden while a full-screen overlay is active */}
        {blocks.length > 0 && !sessionMode && !studyLecture && (
          <TabBar active={tab} onChange={switchTab} />
        )}
        <main ref={mainRef} onScroll={onMainScroll} className="flex-1 overflow-y-auto">
          {blocks.length === 0 ? (
            <div className="p-8 text-sm text-text-3">
              No terms yet. Import a term schedule via ⋯ → Import schedule.
            </div>
          ) : sessionMode && activeBlockId ? (
            sessionMode === "calibrate" ? (
              <CalibrationSession
                userId={userId}
                blockId={activeBlockId}
                blockName={active?.name}
                newPool={[]}
                onExit={() => setSessionMode(null)}
              />
            ) : (
              <EngineSession
                userId={userId}
                blockId={activeBlockId}
                blockName={active?.name}
                newPool={[]}
                onExit={() => setSessionMode(null)}
              />
            )
          ) : studyLecture ? (
            <div className="relative flex-1">
              <LectureStudyFlow
                key={studyLecture.id}
                lecture={studyLecture}
                blockId={activeBlockId}
                userId={userId}
                logActivity={logActivity}
                examDates={examDates.data}
                onClose={() => { setStudyLecture(null); setPendingAutoQuiz(null); }}
                autoOpenQuiz={!!pendingAutoQuiz}
                focusObjectiveIds={pendingAutoQuiz?.focusObjectiveIds}
                onGoDeep={(lecId) => {
                  setStudyLecture(null);
                  setPendingAutoQuiz(null);
                  setDeepLearnPreselectId(lecId);
                  switchTab("more");
                  setMoreView("deeplearn");
                }}
              />
            </div>
          ) : tab === "lectures" && activeBlockId ? (
            <LectureList
              blockId={activeBlockId}
              userId={userId}
              onStudyLecture={onStudyLecture}
              onStartObjectiveQuiz={onStartObjectiveQuiz}
              focusLectureId={examFocusLectureId}
              onBack={() => { switchTab("today"); setExamFocusLectureId(null); }}
            />
          ) : tab === "exam" && activeBlockId ? (
            <ExamContainer
              blockId={activeBlockId}
              blockName={active?.name}
              userId={userId}
              onNavigateToLecture={(lectureId) => {
                setExamFocusLectureId(lectureId);
                switchTab("lectures");
              }}
            />
          ) : tab === "guide" && activeBlockId ? (
            <MasterGuide
              blockId={activeBlockId}
              userId={userId}
              lectures={(allLectures.data || []).filter((l) => l.blockId === activeBlockId)}
            />
          ) : tab === "objectives" && activeBlockId ? (
            <ObjectivesView
              blockId={activeBlockId}
              userId={userId}
              termColor={active?.termColor}
              T={legacyTheme}
              onBack={() => switchTab("today")}
              onStartObjectiveQuiz={onStartObjectiveQuiz}
              onStudyLecture={onStudyLecture}
              onImportObjectives={() => setShowImportObjectives(true)}
              onReExtractAll={() => setShowReExtractAll(true)}
            />
          ) : tab === "more" && activeBlockId ? (
            moreView === "weak" ? (
              <WeakConcepts blockId={activeBlockId} userId={userId} onBack={() => setMoreView(null)} />
            ) : moreView === "struggle" ? (
              <StruggleTasks
                userId={userId}
                lectures={(allLectures.data || []).filter((l) => l.blockId === activeBlockId)}
                onBack={() => setMoreView(null)}
              />
            ) : moreView === "deeplearn" ? (
              <DeepLearnContainer
                blockId={activeBlockId}
                userId={userId}
                termColor={active?.termColor}
                preselectLecId={deepLearnPreselectId}
                onBack={() => { setMoreView(null); setDeepLearnPreselectId(null); }}
              />
            ) : (
              <MoreTab
                onContinue={onContinue}
                onCalibrate={onCalibrate}
                onWeak={() => setMoreView("weak")}
                onDeepLearn={() => setMoreView("deeplearn")}
                onStruggle={() => setMoreView("struggle")}
              />
            )
          ) : (
            // Default: Today tab (also shown when tab === "today" or no block-specific tab)
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-0">
              <div className="p-4 pb-3 sm:p-5 sm:pb-3">
                <Today
                  blockId={activeBlockId}
                  userId={userId}
                  onStudyLecture={onStudyLecture}
                  onStartObjectiveQuiz={onStartObjectiveQuiz}
                />
              </div>
              <BlockHome
                blockId={activeBlockId}
                userId={userId}
                statsOnly
              />
            </div>
          )}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onPick={(it) => { setSelectedBlockId(it.id); setSessionMode(null); setTab("today"); setMoreView(null); setStudyLecture(null); setPendingAutoQuiz(null); }}
      />
      {showImportObjectives && activeBlockId && (
        <ImportObjectivesPdfModal
          blockId={activeBlockId}
          userId={userId}
          onClose={() => setShowImportObjectives(false)}
          onImported={(count) => {
            setShowImportObjectives(false);
          }}
        />
      )}
      {showReExtractAll && activeBlockId && (
        <ReExtractAllModal
          blockId={activeBlockId}
          userId={userId}
          onClose={() => setShowReExtractAll(false)}
          onDone={() => setShowReExtractAll(false)}
        />
      )}
      {showExamDate && activeBlockId && (
        <ExamDateModal
          blockId={activeBlockId}
          blockName={active?.name}
          termId={active?.termId}
          currentStartDate={active?.startDate}
          userId={userId}
          onClose={() => setShowExamDate(false)}
        />
      )}
      {showAnki && <AnkiSyncModal T={legacyTheme} onClose={() => setShowAnki(false)} />}
      {showRecognize && (
        <RecognitionContainer
          T={legacyTheme}
          userId={userId}
          blockId={activeBlockId}
          onClose={() => setShowRecognize(false)}
        />
      )}
      {showImport && <ScheduleImportModal userId={userId} onClose={() => setShowImport(false)} />}
      {showAddLecture && activeBlockId && (
        <AddLectureModal
          blockId={activeBlockId}
          termId={active?.termId ?? null}
          userId={userId}
          onClose={() => setShowAddLecture(false)}
        />
      )}
      {showBulkImport && activeBlockId && (
        <BulkImportModal
          blockId={activeBlockId}
          termId={active?.termId ?? null}
          userId={userId}
          onClose={() => setShowBulkImport(false)}
        />
      )}
      {showQuestionBanks && (
        <QuestionBankModal
          blockId={activeBlockId}
          blockName={active?.name}
          lectures={(allLectures.data || []).filter((l) => l.blockId === activeBlockId)}
          userId={userId}
          onClose={() => setShowQuestionBanks(false)}
        />
      )}
      <StudyRoutineModal
        open={showRoutine}
        onClose={() => setShowRoutine(false)}
        onOpenWeakConcepts={() => { setShowRoutine(false); setTab("more"); setMoreView("weak"); }}
      />
      {showApiKeyModal && <UserApiKeyModal onClose={() => setShowApiKeyModal(false)} />}
      {showFocusHudModal && <FocusHudLinkModal onClose={() => setShowFocusHudModal(false)} />}
      {showDailyPlanSettings && activeBlockId && (
        <DailyPlanSettingsModal
          blockId={activeBlockId}
          onClose={() => setShowDailyPlanSettings(false)}
        />
      )}
      <MissNoteToast />
    </div>
  );
}

function MoreTab({ onContinue, onCalibrate, onWeak, onDeepLearn, onStruggle }) {
  const items = [
    { label: "▸ Continue learning", desc: "adaptive session — teaches, shows a case, then checks you", action: onContinue },
    { label: "◎ Calibrate", desc: "rate confidence before each answer — surfaces sure-but-wrong gaps", action: onCalibrate },
    { label: "🧬 Deep Learn", desc: "teach-then-test on one lecture with drills and rapid fire", action: onDeepLearn },
    { label: "⚠ Weak concepts", desc: "what you keep missing, landmines first", action: onWeak },
    { label: "🔴 Struggle Tracker", desc: "deep/persistent + buried cards synced in from Anki", action: onStruggle },
  ];
  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.action}
          className="flex min-h-24 flex-col items-start justify-center rounded-lg border border-border bg-bg-elevated px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-panel"
        >
          <span className="font-condensed text-sm font-semibold uppercase tracking-wide text-text-1">{item.label}</span>
          <span className="mt-0.5 font-mono text-[12px] normal-case tracking-normal text-text-3">{item.desc}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Objectives surface: the ported tracker. A "Quiz" click now navigates straight into Study
 * (one runner — see docs/plans/2026-08-23-unify-quiz-study-rounds.md), which shows its own
 * generation/error state on its own screen, so there's nothing to render here anymore.
 */
function ObjectivesView({ blockId, userId, termColor, T, onBack, onStartObjectiveQuiz, onStudyLecture, onImportObjectives, onReExtractAll }) {
  return (
    <div className="mx-auto w-full max-w-6xl p-3 sm:p-4">
      <ObjectivesContainer
        blockId={blockId}
        userId={userId}
        termColor={termColor}
        T={T}
        onStartObjectiveQuiz={onStartObjectiveQuiz}
        onStudyLecture={onStudyLecture}
        headerActions={
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="font-mono text-xs text-text-3 hover:text-text-1">
              ← block
            </button>
            <button onClick={onReExtractAll} className="font-mono text-xs text-text-3 hover:text-text-1">
              ↺ Re-extract all
            </button>
            <button onClick={onImportObjectives} className="font-mono text-xs text-accent hover:text-accent-text">
              + Import objectives PDF
            </button>
          </div>
        }
      />
    </div>
  );
}

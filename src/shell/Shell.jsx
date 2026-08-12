import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTheme } from "./useTheme";
import * as lecturesStore from "../stores/lectures.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { useExamDates } from "./hooks/useExamDates.js";
import { touchBlock } from "../stores/blockObjectives.js";
import { defaultBlockId, readCollapsedTerms } from "./navPrefs.js";
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
import { RecognitionContainer } from "./features/recognition/RecognitionContainer.jsx";
import { ScheduleImportModal } from "./ScheduleImportModal.jsx";
import { AtomQuiz } from "./AtomQuiz.jsx";
import { ObjectivesContainer } from "./features/objectives/ObjectivesContainer.jsx";
import { ImportObjectivesPdfModal } from "./features/objectives/ImportObjectivesPdfModal.jsx";
import { LectureStudyFlow } from "./features/lectures/LectureStudyFlow.jsx";
import { AddLectureModal } from "./features/lectures/AddLectureModal.jsx";
import { BulkImportModal } from "./features/lectures/BulkImportModal.jsx";
import { QuestionBankModal } from "./features/lectures/QuestionBankModal.jsx";
import { Today } from "./features/today/Today.jsx";
import StudyRoutineModal, { MissNoteToast } from "../StudyRoutineModal.jsx";
import { LectureList } from "./features/tracker/LectureList.jsx";
import { WeakConcepts } from "./features/tracker/WeakConcepts.jsx";
import { ExamDateModal } from "./ExamDateModal.jsx";
import { DeepLearnContainer } from "./features/deeplearn/DeepLearnContainer.jsx";
import { startObjectiveQuiz, readExemplars } from "./features/objectives/quizLaunch.js";
import { callAIJSON } from "../aiClient.js";
import { setStoreHookUserId } from "./hooks/currentUser.js";
import { useToday } from "./features/today/useToday.js";
import { themes } from "../theme.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import * as lectureRoundsStore from "../stores/lectureRounds.js";
import { selectBlockObjectives, setStatus } from "./logic/objectives.js";
import { useLectures } from "./hooks/useLectures.js";
import { useObjectives } from "./hooks/useObjectives.js";

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
  return <ShellMain theme={theme} toggle={toggle} userId={userId} />;
}

function ShellMain({ theme, toggle, userId }) {
  // Reactive via the store hooks — no longer a one-shot read that goes stale
  // the moment a schedule is imported or a lecture uploaded.
  const blocks = useBlocks(userId);
  // Derived, not synced in an effect: the selection is what the user picked,
  // and it falls back to the first block until they pick — or if the block they
  // were on disappears (a deleted term used to leave the shell pointing at
  // nothing).
  const [selectedBlockId, setSelectedBlockId] = useState(null);
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
  const [showImportObjectives, setShowImportObjectives] = useState(false);
  const [showExamDate, setShowExamDate] = useState(false);
  const [tab, setTab] = useState("today"); // today | lectures | objectives | more
  const [moreView, setMoreView] = useState(null); // null | "weak" | "deeplearn"
  // Objective quiz: { lectureId, loading, error, questions, title }
  const [quiz, setQuiz] = useState(null);
  // Per-lecture study flow (T2.1) — the lecture whose atoms we are working on.
  const [studyLecture, setStudyLecture] = useState(null);
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

  const switchTab = useCallback((t) => { setTab(t); setMoreView(null); setQuiz(null); }, []);

  // "Study →" on a lecture row: resolve the id to the stored lecture, then hand
  // it to the flow, which sources its text (locally or from Firestore) itself.
  const onStudyLecture = useCallback((lectureId) => {
    const lecture = (lecturesStore.read(userId) || []).find((l) => l?.id === lectureId);
    if (lecture) setStudyLecture(lecture);
  }, [userId]);

  // The real objective-quiz launch: ObjectiveTracker's callback → MCQ engine →
  // the calibrated AtomQuiz runner, logging confidence against this block.
  const onStartObjectiveQuiz = useCallback(
    async (objectives, lectureTitle, optionalBlockId, extraMeta = {}) => {
      const bid = optionalBlockId ?? activeBlockId;
      const lectureId =
        extraMeta?.lectureId ?? (objectives || []).map((o) => o?.linkedLecId).find(Boolean) ?? null;
      setQuiz({ lectureId, loading: true, title: lectureTitle });
      const result = await startObjectiveQuiz(
        {
          objectives,
          lectureTitle,
          blockId: bid,
          lectures: lecturesStore.read(userId) || [],
          exemplars: readExemplars(userId),
          questionCount: extraMeta?.questionCount,
          difficulty: extraMeta?.difficulty ?? "medium",
        },
        { callAIJSON }
      );
      if (result.error || !result.questions?.length) {
        setQuiz({ lectureId, error: result.error || "No questions came back.", title: lectureTitle });
        return;
      }
      setQuiz({ lectureId, questions: result.questions, title: lectureTitle });
    },
    [activeBlockId, userId]
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
          setQuiz(null);
          setStudyLecture(null);
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
          onSignOut={() => signOut().then(() => window.location.reload())}
        />
        {/* Tab bar — hidden while a full-screen overlay is active */}
        {blocks.length > 0 && !sessionMode && !quiz?.questions?.length && !studyLecture && (
          <TabBar active={tab} onChange={switchTab} />
        )}
        <main className="flex-1 overflow-y-auto">
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
          ) : quiz?.questions?.length ? (
            <div className="p-5">
              <button onClick={() => setQuiz(null)} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">
                ← back
              </button>
              <AtomQuiz
                questions={quiz.questions}
                blockId={activeBlockId}
                userId={userId}
                onDone={({ correct = 0, total = 0 } = {}) => {
                  if (!quiz.lectureId) return;
                  const passedQuiz = total > 0 && correct / total >= 0.8;
                  try {
                    const store = objectivesStore.read(userId) || {};
                    const blockObjs = selectBlockObjectives(store, activeBlockId);
                    const lecObjs = blockObjs.filter(
                      (o) => o?.linkedLecId === quiz.lectureId &&
                        (o.status === "untested" || (passedQuiz && o.status === "developing"))
                    );
                    if (!lecObjs.length) return;
                    let updated = store;
                    for (const obj of lecObjs) {
                      const next = passedQuiz && obj.status === "developing" ? "mastered" : "developing";
                      updated = setStatus(updated, obj.id, next, new Date());
                    }
                    objectivesStore.write(userId, updated);
                  } catch { /* non-critical */ }
                }}
              />
            </div>
          ) : studyLecture ? (
            <LectureStudyFlow
              key={studyLecture.id}
              lecture={studyLecture}
              blockId={activeBlockId}
              userId={userId}
              logActivity={logActivity}
              onClose={() => setStudyLecture(null)}
            />
          ) : tab === "lectures" && activeBlockId ? (
            <LectureList
              blockId={activeBlockId}
              userId={userId}
              quizBusyLectureId={quiz?.loading ? quiz.lectureId : null}
              onStudyLecture={onStudyLecture}
              onStartObjectiveQuiz={onStartObjectiveQuiz}
              onBack={() => switchTab("today")}
            />
          ) : tab === "objectives" && activeBlockId ? (
            <ObjectivesView
              blockId={activeBlockId}
              userId={userId}
              termColor={active?.termColor}
              T={legacyTheme}
              quiz={quiz}
              onBack={() => { switchTab("today"); setQuiz(null); }}
              onCloseQuiz={() => setQuiz(null)}
              onStartObjectiveQuiz={onStartObjectiveQuiz}
              onStudyLecture={onStudyLecture}
              onImportObjectives={() => setShowImportObjectives(true)}
            />
          ) : tab === "more" && activeBlockId ? (
            moreView === "weak" ? (
              <WeakConcepts blockId={activeBlockId} userId={userId} onBack={() => setMoreView(null)} />
            ) : moreView === "deeplearn" ? (
              <DeepLearnContainer
                blockId={activeBlockId}
                userId={userId}
                termColor={active?.termColor}
                onBack={() => setMoreView(null)}
              />
            ) : (
              <MoreTab
                onContinue={onContinue}
                onCalibrate={onCalibrate}
                onWeak={() => setMoreView("weak")}
                onDeepLearn={() => setMoreView("deeplearn")}
              />
            )
          ) : (
            // Default: Today tab (also shown when tab === "today" or no block-specific tab)
            <div className="flex flex-col gap-0">
              <div className="p-5 pb-3">
                <Today
                  blockId={activeBlockId}
                  userId={userId}
                  quizBusyLectureId={quiz?.loading ? quiz.lectureId : null}
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
        onPick={(it) => { setSelectedBlockId(it.id); setSessionMode(null); setTab("today"); setMoreView(null); setQuiz(null); setStudyLecture(null); }}
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
      {showExamDate && activeBlockId && (
        <ExamDateModal
          blockId={activeBlockId}
          blockName={active?.name}
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
          userId={userId}
          onClose={() => setShowQuestionBanks(false)}
        />
      )}
      <StudyRoutineModal
        open={showRoutine}
        onClose={() => setShowRoutine(false)}
        onOpenWeakConcepts={() => { setShowRoutine(false); setTab("more"); setMoreView("weak"); }}
      />
      <MissNoteToast />
    </div>
  );
}

function MoreTab({ onContinue, onCalibrate, onWeak, onDeepLearn }) {
  const items = [
    { label: "▸ Continue learning", desc: "adaptive session — teaches, shows a case, then checks you", action: onContinue },
    { label: "◎ Calibrate", desc: "rate confidence before each answer — surfaces sure-but-wrong gaps", action: onCalibrate },
    { label: "🧬 Deep Learn", desc: "teach-then-test on one lecture with drills and rapid fire", action: onDeepLearn },
    { label: "⚠ Weak concepts", desc: "what you keep missing, landmines first", action: onWeak },
  ];
  return (
    <div className="flex flex-col gap-3 p-5">
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.action}
          className="flex flex-col items-start rounded-lg border border-border bg-bg-elevated px-4 py-3 text-left hover:border-accent/40 hover:bg-panel transition-colors"
        >
          <span className="text-sm text-text-1">{item.label}</span>
          <span className="mt-0.5 font-mono text-[10px] text-text-3">{item.desc}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Objectives surface: the ported tracker. A generated quiz renders one level up
 * (ShellMain) so it behaves the same whether it was launched from here or from
 * Today.
 */
function ObjectivesView({ blockId, userId, termColor, T, quiz, onBack, onStartObjectiveQuiz, onStudyLecture, onImportObjectives }) {
  return (
    <div className="p-2">
      <ObjectivesContainer
        blockId={blockId}
        userId={userId}
        termColor={termColor}
        T={T}
        quizLoadingId={quiz?.loading ? quiz.lectureId : null}
        quizErrorId={quiz?.error ? quiz.lectureId : null}
        onStartObjectiveQuiz={onStartObjectiveQuiz}
        onStudyLecture={onStudyLecture}
        headerActions={
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="font-mono text-xs text-text-3 hover:text-text-1">
              ← block
            </button>
            <button onClick={onImportObjectives} className="font-mono text-xs text-accent hover:text-accent-text">
              + Import objectives PDF
            </button>
          </div>
        }
      />
      {quiz?.error && (
        <div className="mx-3 mt-2 rounded border border-border px-3 py-2 text-xs text-bad">
          Quiz failed: {quiz.error}
        </div>
      )}
    </div>
  );
}

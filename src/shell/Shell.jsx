import "../theme/tokens.css";
import "../theme/tailwind.css";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTheme } from "./useTheme";
import { readLectures } from "./data.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { Sidebar } from "./Sidebar.jsx";
import { Header } from "./Header.jsx";
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
import { LectureStudyFlow } from "./features/lectures/LectureStudyFlow.jsx";
import { Today } from "./features/today/Today.jsx";
import { LectureList } from "./features/tracker/LectureList.jsx";
import { WeakConcepts } from "./features/tracker/WeakConcepts.jsx";
import { startObjectiveQuiz, readExemplars } from "./features/objectives/quizLaunch.js";
import { callAIJSON } from "../aiClient.js";
import { setStoreHookUserId } from "./hooks/currentUser.js";
import { themes } from "../theme.js";

/**
 * Auth (Firebase) + cloud-load gate. localStorage is per-origin, so the shell
 * pulls the user's data from the cloud on sign-in — it works on any origin,
 * not just the one where data was first created.
 */
export default function Shell() {
  const { theme, toggle } = useTheme();
  const [phase, setPhase] = useState("checking"); // checking | signedout | loading | ready
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let alive = true;
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
  const activeBlockId =
    selectedBlockId && blocks.some((b) => b.id === selectedBlockId)
      ? selectedBlockId
      : blocks[0]?.id ?? null;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sessionMode, setSessionMode] = useState(null); // null | 'engine' | 'calibrate'
  const [showAnki, setShowAnki] = useState(false);
  const [showRecognize, setShowRecognize] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState("home"); // home | objectives
  // Objective quiz: { lectureId, loading, error, questions, title }
  const [quiz, setQuiz] = useState(null);
  // Per-lecture study flow (T2.1) — the lecture whose atoms we are working on.
  const [studyLecture, setStudyLecture] = useState(null);
  const active = blocks.find((b) => b.id === activeBlockId) || null;
  const legacyTheme = themes[theme] || themes.dark;

  // Store hooks read this when no explicit userId is passed.
  useEffect(() => { setStoreHookUserId(userId ?? null); }, [userId]);

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

  // "Study →" on a lecture row: resolve the id to the stored lecture, then hand
  // it to the flow, which sources its text (locally or from Firestore) itself.
  const onStudyLecture = useCallback((lectureId) => {
    const lecture = readLectures().find((l) => l?.id === lectureId);
    if (lecture) setStudyLecture(lecture);
  }, []);

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
          lectures: readLectures(),
          exemplars: readExemplars(),
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
    [activeBlockId]
  );

  return (
    <div className={`theme-${theme} flex h-screen overflow-hidden bg-bg text-text-1 font-sans`}>
      <Sidebar
        userId={userId}
        activeBlockId={activeBlockId}
        onSelectBlock={(id) => {
          setSelectedBlockId(id);
          setSessionMode(null);
          setView("home");
          setQuiz(null);
          setStudyLecture(null); // a lecture from the old block must not survive the switch
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
          onImportSchedule={() => setShowImport(true)}
          onSignOut={() => signOut().then(() => window.location.reload())}
        />
        <main className="flex-1 overflow-y-auto">
          {blocks.length === 0 ? (
            <div className="p-8 text-sm text-text-3">No terms found in your account yet. Add them in the current app (?shell=old), then reload.</div>
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
            // Hoisted above the views: a quiz can be launched from Today or from
            // the objectives tracker, and it takes over the pane either way.
            <div className="p-5">
              <button onClick={() => setQuiz(null)} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">
                ← back
              </button>
              <AtomQuiz questions={quiz.questions} blockId={activeBlockId} />
            </div>
          ) : studyLecture ? (
            <LectureStudyFlow
              key={studyLecture.id}
              lecture={studyLecture}
              blockId={activeBlockId}
              userId={userId}
              onClose={() => setStudyLecture(null)}
            />
          ) : view === "lectures" && activeBlockId ? (
            <LectureList
              blockId={activeBlockId}
              userId={userId}
              quizBusyLectureId={quiz?.loading ? quiz.lectureId : null}
              onStudyLecture={onStudyLecture}
              onStartObjectiveQuiz={onStartObjectiveQuiz}
              onBack={() => setView("home")}
            />
          ) : view === "weak" && activeBlockId ? (
            <WeakConcepts blockId={activeBlockId} userId={userId} onBack={() => setView("home")} />
          ) : view === "objectives" && activeBlockId ? (
            <ObjectivesView
              blockId={activeBlockId}
              userId={userId}
              termColor={active?.termColor}
              T={legacyTheme}
              quiz={quiz}
              onBack={() => { setView("home"); setQuiz(null); }}
              onCloseQuiz={() => setQuiz(null)}
              onStartObjectiveQuiz={onStartObjectiveQuiz}
              onStudyLecture={onStudyLecture}
            />
          ) : (
            <BlockHome
              blockId={activeBlockId}
              onContinue={onContinue}
              onCalibrate={onCalibrate}
              onObjectives={() => setView("objectives")}
              onLectures={() => setView("lectures")}
              onWeakConcepts={() => setView("weak")}
              today={
                <Today
                  blockId={activeBlockId}
                  userId={userId}
                  quizBusyLectureId={quiz?.loading ? quiz.lectureId : null}
                  onStudyLecture={onStudyLecture}
                  onStartObjectiveQuiz={onStartObjectiveQuiz}
                />
              }
            />
          )}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onPick={(it) => { setSelectedBlockId(it.id); setSessionMode(null); setView("home"); setQuiz(null); setStudyLecture(null); }}
      />
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
    </div>
  );
}

/**
 * Objectives surface: the ported tracker. A generated quiz renders one level up
 * (ShellMain) so it behaves the same whether it was launched from here or from
 * Today.
 */
function ObjectivesView({ blockId, userId, termColor, T, quiz, onBack, onStartObjectiveQuiz, onStudyLecture }) {
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
          <button onClick={onBack} className="font-mono text-xs text-text-3 hover:text-text-1">
            ← block
          </button>
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

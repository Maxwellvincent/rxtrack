// Lecture extraction and question generation moved onto the lecture rows in the
// objectives view (SP1 T2.1) — they act on a real lecture there, not an upload.
export function Header({ termName, blockName, theme, onToggleTheme, onAnki, onRecognize, onImportSchedule, onAddLecture, onBulkImport, onQuestionBanks, onRoutine, onSignOut }) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-bg px-4 text-sm">
      <span className="font-mono text-xs text-text-3">
        {termName ? <>{termName} / <span className="text-text-1">{blockName}</span></> : "RXTrack"}
      </span>
      <div className="flex items-center gap-3 text-xs">
        {onAnki && (
          <button onClick={onAnki} className="text-text-2 hover:text-text-1" title="Anki Sync — build the bank">🃏 Sync</button>
        )}
        {onRecognize && (
          <button onClick={onRecognize} className="text-text-2 hover:text-text-1" title="Patient Recognition">🩺 Recognize</button>
        )}
        {onImportSchedule && (
          <button onClick={onImportSchedule} className="text-text-2 hover:text-text-1" title="Import term schedule (.md)">📅 Schedule</button>
        )}
        {onAddLecture && (
          <button onClick={onAddLecture} className="text-text-2 hover:text-text-1" title="Add one lecture (.pdf, or .md from pdf2md)">＋ Lecture</button>
        )}
        {onBulkImport && (
          <button onClick={onBulkImport} className="text-text-2 hover:text-text-1" title="Import a whole folder of lectures at once">⇉ Folder</button>
        )}
        {onQuestionBanks && (
          <button onClick={onQuestionBanks} className="text-text-2 hover:text-text-1" title="Past exam PDFs — style exemplars for generated questions">🗂 Banks</button>
        )}
        {onRoutine && (
          <button onClick={onRoutine} className="text-text-2 hover:text-text-1" title="Daily study routine">📋 Routine</button>
        )}
        <button onClick={onToggleTheme} className="text-text-2 hover:text-text-1" aria-label="Toggle theme">
          {theme === "dark" ? "◑ light" : "◐ dark"}
        </button>
        {onSignOut && (
          <button onClick={onSignOut} className="text-text-3 hover:text-text-1" title="Sign out">⎋</button>
        )}
      </div>
    </header>
  );
}

import { useMemo } from "react";

const DEFAULT_MONO = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * Fixed upload queue UI (extracted from App for clarity).
 */
export default function UploadQueuePanel({
  uploadQueue,
  t,
  tc,
  monoFont = DEFAULT_MONO,
  isProcessingQueue,
  collapsed,
  onToggleCollapsed,
  dismissUploadPanel,
  setTab,
  onOpenLecture,
  retryQueueItem,
  forceReuploadQueuedFile,
  forceOcrQueuedFile,
  uploadResolveCollisionRef,
  onSkipQueued,
}) {
  const busy = useMemo(
    () =>
      uploadQueue.some((i) =>
        ["queued", "processing", "pending", "extracting", "parsing", "saving", "linking"].includes(i.status)
      ),
    [uploadQueue]
  );
  const hasCollisionPending = useMemo(() => uploadQueue.some((i) => i.status === "collision"), [uploadQueue]);
  const queuedWhileCollision = useMemo(
    () => hasCollisionPending && uploadQueue.some((i) => i.status === "queued"),
    [uploadQueue, hasCollisionPending]
  );
  const allTerminal = useMemo(
    () =>
      uploadQueue.every((i) => i.status === "done" || i.status === "error") && !hasCollisionPending,
    [uploadQueue, hasCollisionPending]
  );
  const anyErr = useMemo(() => uploadQueue.some((i) => i.status === "error"), [uploadQueue]);
  const okCount = useMemo(() => uploadQueue.filter((i) => i.status === "done").length, [uploadQueue]);
  const errCount = useMemo(() => uploadQueue.filter((i) => i.status === "error").length, [uploadQueue]);
  const totalObj = useMemo(() => uploadQueue.reduce((s, i) => s + (i.result?.objectiveCount || 0), 0), [uploadQueue]);
  const showDismiss = allTerminal && !busy;

  const statusLabel = (item) => {
    switch (item.status) {
      case "queued":
        return { text: item.statusLabel || "Queued", color: t.text3 };
      case "processing":
        return { text: item.statusLabel || "Processing…", color: "#2563eb" };
      case "pending":
        return { text: "Waiting...", color: t.text3 };
      case "saving":
        return { text: item.statusLabel || "Saving…", color: "#185FA5" };
      case "extracting":
        return { text: "Extracting text...", color: "#0891b2" };
      case "parsing":
        return { text: "Parsing objectives...", color: "#BA7517" };
      case "linking":
        return { text: "Linking objectives...", color: "#185FA5" };
      case "collision":
        return {
          text:
            "⚠ " + (item.collisionLabel || "Lecture") + " already exists — choose an action below",
          color: "#BA7517",
        };
      case "done":
        if (item.result?.skipped) {
          return {
            text: item.result?.resultSummary || "Already uploaded — skipped",
            color: t.text3,
          };
        }
        if (item.result?.mergedPartB) {
          return {
            text: item.result?.resultSummary || "Merged with Part A",
            color: "#185FA5",
          };
        }
        return {
          text: item.result?.resultSummary || `${item.result?.objectiveCount ?? 0} objectives`,
          color: item.result?.resultSummaryColor || "#27500A",
        };
      case "error":
        return { text: item.error || "Upload failed", color: "#E24B4A" };
      default:
        return { text: item.statusLabel || "", color: t.text3 };
    }
  };

  const progPct = (item) => {
    if (item.status === "queued" || item.status === "pending") return 0;
    if (item.status === "error") return 100;
    if (item.status === "done") return 100;
    if (item.status === "collision") return 0;
    return typeof item.progress === "number" ? item.progress : 0;
  };

  const progBg = (item) => {
    if (item.status === "error") return "#E24B4A";
    if (item.status === "done" && item.result?.mergedPartB) return "#185FA5";
    if (item.status === "done") return "#639922";
    if (item.status === "collision") return "#BA7517";
    return tc;
  };

  const shellStyle = {
    position: "fixed",
    bottom: 20,
    right: 20,
    width: 360,
    maxWidth: "calc(100vw - 40px)",
    background: t.cardBg,
    borderRadius: 12,
    border: "1px solid " + t.border1,
    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
    zIndex: 1000,
    overflow: "hidden",
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        style={{
          ...shellStyle,
          width: "auto",
          minWidth: 200,
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: monoFont,
            fontSize: 12,
            color: t.text1,
          }}
        >
          {isProcessingQueue && (
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                border: "2px solid " + t.border1,
                borderTopColor: tc,
                borderRadius: "50%",
                animation: "rxtUploadSpin 0.7s linear infinite",
              }}
            />
          )}
          <span style={{ fontWeight: 600 }}>Uploads ({uploadQueue.length})</span>
          <span style={{ marginLeft: "auto", color: t.text2, fontSize: 11 }}>Expand ▲</span>
        </div>
      </button>
    );
  }

  return (
    <div style={shellStyle}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid " + t.border1,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, color: t.text1, minWidth: 0 }}>
          {isProcessingQueue ? (
            <span>
              ⏳ Processing {uploadQueue.filter((i) => i.status === "done").length}/{uploadQueue.length} lectures
            </span>
          ) : uploadQueue.length > 0 && uploadQueue.every((i) => i.status === "done") ? (
            <span style={{ color: "#16a34a" }}>✓ All {uploadQueue.length} lectures uploaded</span>
          ) : (
            <span>Upload queue</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            title="Minimize"
            onClick={onToggleCollapsed}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: t.text2,
              fontSize: 16,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            −
          </button>
          {!isProcessingQueue && (
            <button
              type="button"
              onClick={dismissUploadPanel}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: t.text2,
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {uploadQueue.some((i) => i.restoredFromSession) && (
        <div
          style={{
            padding: "8px 16px",
            fontSize: 11,
            color: t.text2,
            fontFamily: monoFont,
            background: t.inputBg,
            borderBottom: "1px solid " + t.border1,
            lineHeight: 1.45,
          }}
        >
          Restoring PDFs from this browser (IndexedDB). If a row fails, the file was cleared or storage is full —
          re-upload that PDF.
        </div>
      )}

      {queuedWhileCollision && (
        <div
          style={{
            padding: "8px 16px",
            fontSize: 11,
            color: "#633806",
            fontFamily: monoFont,
            background: "#FAEEDA",
            borderBottom: "1px solid " + t.border1,
            lineHeight: 1.4,
          }}
        >
          Another file is waiting on a name collision — resolve the ⚠ row below. Other queued PDFs will continue
          afterward.
        </div>
      )}

      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {!busy && allTerminal && !anyErr && (
          <div style={{ fontSize: 13, fontWeight: 500, color: "#27500A", marginBottom: 6, padding: "0 8px" }}>
            ✓ {okCount} uploaded · {totalObj} objectives extracted
          </div>
        )}
        {!busy && allTerminal && okCount > 0 && (
          <button
            type="button"
            onClick={() => setTab("lectures")}
            style={{
              background: "none",
              border: "none",
              padding: "0 8px",
              marginBottom: 10,
              fontSize: 12,
              color: "var(--color-text-info, " + t.blue + ")",
              cursor: "pointer",
              fontFamily: monoFont,
              textDecoration: "underline",
            }}
          >
            Go to Lectures tab
          </button>
        )}

        {uploadQueue.map((item, idx) => {
          const sl = statusLabel(item);
          const isLast = idx === uploadQueue.length - 1;
          const displayName = (item.filename || item.name || "")
            .replace(/\.pdf$/i, "")
            .replace(/_/g, " ");
          return (
            <div key={item.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 8px",
                  borderBottom:
                    isLast && !item.result?.typeWarning
                      ? "none"
                      : "0.5px solid var(--color-border-tertiary, " + t.border2 + ")",
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {(item.status === "pending" || item.status === "queued") && (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        border: "1.5px solid " + t.border1,
                        display: "block",
                      }}
                    />
                  )}
                  {(item.status === "processing" ||
                    item.status === "extracting" ||
                    item.status === "parsing" ||
                    item.status === "saving" ||
                    item.status === "linking") && (
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        border: "2px solid " + t.border1,
                        borderTopColor: tc,
                        borderRadius: "50%",
                        animation: "rxtUploadSpin 0.7s linear infinite",
                      }}
                    />
                  )}
                  {item.status === "done" && !item.result?.skipped && (
                    <span style={{ color: "#639922", fontSize: 14 }}>✓</span>
                  )}
                  {item.status === "done" && item.result?.skipped && (
                    <span style={{ color: t.text3, fontSize: 12 }}>○</span>
                  )}
                  {item.status === "error" && <span style={{ color: "#E24B4A", fontSize: 14 }}>⚠</span>}
                  {item.status === "collision" && <span style={{ color: "#BA7517", fontSize: 14 }}>⚠</span>}
                </div>
                <div
                  title={item.filename}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    fontFamily: monoFont,
                    color: t.text1,
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    flexShrink: 0,
                    maxWidth: 160,
                    fontSize: 11,
                    color: sl.color,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: monoFont,
                  }}
                >
                  {sl.text}
                </div>
                <div
                  style={{
                    width: 64,
                    flexShrink: 0,
                    height: 3,
                    borderRadius: 2,
                    background: "var(--color-background-tertiary, " + t.border1 + ")",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: progPct(item) + "%",
                      height: "100%",
                      borderRadius: 2,
                      background: progBg(item),
                      transition: "width 1.2s ease",
                    }}
                  />
                </div>
                {item.status === "queued" && (
                  <button
                    type="button"
                    onClick={() => onSkipQueued(item.id)}
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontFamily: monoFont,
                      padding: "3px 6px",
                      borderRadius: 4,
                      border: "1px solid " + t.border1,
                      background: t.inputBg,
                      color: t.text2,
                      cursor: "pointer",
                    }}
                  >
                    Skip
                  </button>
                )}
                {item.status === "error" && (
                  <button
                    type="button"
                    onClick={() => retryQueueItem(item.id)}
                    style={{
                      flexShrink: 0,
                      fontSize: 11,
                      fontFamily: monoFont,
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: "1px solid " + t.border1,
                      background: t.inputBg,
                      color: t.text2,
                      cursor: "pointer",
                    }}
                  >
                    Retry
                  </button>
                )}
                {item.status === "done" && !item.result?.skipped && item.result?.lectureId && (
                  <button
                    type="button"
                    onClick={() => onOpenLecture(item.result.lectureId)}
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontFamily: monoFont,
                      padding: "3px 6px",
                      borderRadius: 4,
                      border: "none",
                      background: "transparent",
                      color: t.blue || "#185FA5",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Open
                  </button>
                )}
                {item.status === "done" && item.result?.skipped && (
                  <button
                    type="button"
                    onClick={() => forceReuploadQueuedFile(item.id)}
                    style={{
                      flexShrink: 0,
                      fontSize: 11,
                      fontFamily: monoFont,
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: "none",
                      background: "transparent",
                      color: t.blue || "#185FA5",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Re-upload
                  </button>
                )}
              </div>
              {item.status === "done" && item.result?.textQualityWarning && (
                <div
                  style={{
                    padding: "4px 0 8px 34px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "center",
                    borderBottom:
                      isLast ? "none" : "0.5px solid var(--color-border-tertiary, " + t.border2 + ")",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#BA7517",
                      fontFamily: monoFont,
                      lineHeight: 1.4,
                    }}
                  >
                    {item.result.textQualityWarning}
                  </span>
                  {item.result?.showEnableOcr && (
                    <button
                      type="button"
                      onClick={() => forceOcrQueuedFile(item.id)}
                      style={{
                        fontSize: 11,
                        fontFamily: monoFont,
                        padding: "4px 10px",
                        borderRadius: 4,
                        border: "1px solid #BA7517",
                        background: "#FAEEDA",
                        color: "#633806",
                        cursor: "pointer",
                      }}
                    >
                      Enable OCR
                    </button>
                  )}
                </div>
              )}
              {item.status === "collision" && item.collisionExisting && (
                <div
                  style={{
                    padding: "4px 0 10px 34px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    alignItems: "center",
                    borderBottom: isLast ? "none" : "0.5px solid var(--color-border-tertiary, " + t.border2 + ")",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#633806",
                      width: "100%",
                      fontFamily: monoFont,
                      lineHeight: 1.4,
                    }}
                  >
                    ⚠ {item.collisionLabel} already exists — what would you like to do?
                  </span>
                  <button
                    type="button"
                    onClick={() => uploadResolveCollisionRef.current?.(item.id, "keep")}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "1px solid " + t.border1,
                      background: t.inputBg,
                      color: t.text2,
                      cursor: "pointer",
                      fontFamily: monoFont,
                    }}
                  >
                    Keep existing
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadResolveCollisionRef.current?.(item.id, "replace")}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "1px solid " + t.border1,
                      background: t.inputBg,
                      color: t.text2,
                      cursor: "pointer",
                      fontFamily: monoFont,
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadResolveCollisionRef.current?.(item.id, "new")}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "1px solid " + t.border1,
                      background: t.inputBg,
                      color: t.text2,
                      cursor: "pointer",
                      fontFamily: monoFont,
                    }}
                  >
                    Upload as new ({item.uniqueNumberHint ?? "…"})
                  </button>
                  {item.showMergeOption && (
                    <button
                      type="button"
                      onClick={() => uploadResolveCollisionRef.current?.(item.id, "merge")}
                      style={{
                        fontSize: 11,
                        padding: "4px 10px",
                        borderRadius: 4,
                        border: "1px solid #AFA9EC",
                        background: "#EEEDFE",
                        color: "#3C3489",
                        cursor: "pointer",
                        fontFamily: monoFont,
                        fontWeight: 600,
                      }}
                    >
                      Merge with Part 1
                    </button>
                  )}
                </div>
              )}
              {item.status === "done" && item.result?.typeWarning && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#633806",
                    padding: "4px 0 8px 34px",
                    borderBottom: isLast ? "none" : "0.5px solid var(--color-border-tertiary, " + t.border2 + ")",
                  }}
                >
                  △ Lecture type not detected — rename file to include DLA, LEC, SG, or TBL and re-upload for best
                  results
                </div>
              )}
            </div>
          );
        })}

        {anyErr && allTerminal && (
          <div style={{ fontSize: 11, color: "#BA7517", marginTop: 8, padding: "0 8px" }}>
            ⚠ {errCount} file(s) failed — check filenames include lecture type and number (e.g. &apos;LEC 5 - Title.pdf
            &apos;)
          </div>
        )}
      </div>

      {!isProcessingQueue && uploadQueue.length > 0 && (
        <div
          style={{
            padding: "10px 16px",
            background: t.surfaceAlt || t.inputBg,
            fontSize: 11,
            color: t.text2,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            borderTop: "1px solid " + t.border1,
          }}
        >
          <span>
            ✓ {uploadQueue.filter((i) => i.status === "done").length} done
            {uploadQueue.filter((i) => i.status === "error").length > 0 && (
              <span style={{ color: "#dc2626", marginLeft: 8 }}>
                ✗ {uploadQueue.filter((i) => i.status === "error").length} failed
              </span>
            )}
          </span>
          <span style={{ textAlign: "right" }}>
            {uploadQueue
              .filter((i) => i.status === "done")
              .reduce((sum, i) => sum + (i.result?.objectiveCount ?? i.objectiveCount ?? 0), 0)}{" "}
            objectives extracted
          </span>
        </div>
      )}

      {showDismiss && isProcessingQueue && (
        <div style={{ padding: "0 12px 8px", textAlign: "right" }}>
          <button
            type="button"
            onClick={dismissUploadPanel}
            style={{
              background: "none",
              border: "none",
              color: t.text3,
              fontSize: 11,
              cursor: "pointer",
              fontFamily: monoFont,
            }}
          >
            ✕ Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

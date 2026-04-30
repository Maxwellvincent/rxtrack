import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useTheme, getObjStatusColor } from "./theme";
import { LEVEL_COLORS, LEVEL_BG } from "./bloomsTaxonomy";

const MONO = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const BLOOM_SHORT = {
  1: "Recall",
  2: "Understand",
  3: "Apply",
  4: "Analyze",
  5: "Eval",
  6: "Create",
};

const DOW_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sortLecturesForObjectives(a, b) {
  const wa = Number(a.weekNumber) || 9999;
  const wb = Number(b.weekNumber) || 9999;
  if (wa !== wb) return wa - wb;
  const da = DOW_ORDER.indexOf(a.dayOfWeek ?? "");
  const db = DOW_ORDER.indexOf(b.dayOfWeek ?? "");
  if (da >= 0 && db >= 0 && da !== db) return da - db;
  const ta = String(a.lectureType || "LEC").toUpperCase();
  const tb = String(b.lectureType || "LEC").toUpperCase();
  if (ta !== tb) return ta.localeCompare(tb);
  return (parseInt(a.lectureNumber, 10) || 0) - (parseInt(b.lectureNumber, 10) || 0);
}

/** Sort for manual assignment dropdowns: type then number */
function sortLecturesForSelect(a, b) {
  const ta = String(a.lectureType || "LEC").toUpperCase();
  const tb = String(b.lectureType || "LEC").toUpperCase();
  if (ta !== tb) return ta.localeCompare(tb);
  return (parseInt(a.lectureNumber, 10) || 0) - (parseInt(b.lectureNumber, 10) || 0);
}

/** Dot color for By Lecture row from objectives linked to a lecture (or fallback list). */
function getLecObjDotColor(lecId, blockObjs, T) {
  const objs = lecId
    ? (blockObjs || []).filter((o) => o.linkedLecId === lecId)
    : blockObjs || [];
  if (objs.length === 0) return T.statusNeutral ?? T.text3;
  const hasStruggling = objs.some((o) => o.status === "struggling");
  const hasInprogress = objs.some((o) => o.status === "inprogress");
  const allMastered = objs.every((o) => o.status === "mastered");
  if (hasStruggling) return "#E24B4A";
  if (allMastered) return "#639922";
  if (hasInprogress) return "#BA7517";
  return T.statusNeutral ?? T.text3;
}

function countByStatus(objs) {
  let m = 0,
    ip = 0,
    st = 0,
    ut = 0;
  for (const o of objs || []) {
    const s = o.status;
    if (s === "mastered") m++;
    else if (s === "inprogress") ip++;
    else if (s === "struggling") st++;
    else ut++;
  }
  return { m, ip, st, ut, t: (objs || []).length };
}

/** Inline width % segments — avoids flex rounding showing all gray */
function SegmentedPctBar({ masteredPct, inprogressPct, strugglingPct, untestedPct, width = 120, height = 6 }) {
  const bg = "var(--color-background-tertiary, #e5e5e5)";
  return (
    <div
      style={{
        display: "flex",
        width,
        height,
        borderRadius: 3,
        overflow: "hidden",
        background: bg,
        flexShrink: 0,
      }}
    >
      {masteredPct > 0 && (
        <div style={{ width: masteredPct + "%", flexShrink: 0, background: "#639922", height: "100%" }} />
      )}
      {inprogressPct > 0 && (
        <div style={{ width: inprogressPct + "%", flexShrink: 0, background: "#BA7517", height: "100%" }} />
      )}
      {strugglingPct > 0 && (
        <div style={{ width: strugglingPct + "%", flexShrink: 0, background: "#E24B4A", height: "100%" }} />
      )}
      {untestedPct > 0 && (
        <div style={{ width: untestedPct + "%", flexShrink: 0, background: "#c4c4c4", height: "100%" }} />
      )}
    </div>
  );
}

function sortGroupObjectives(filter, objs) {
  const arr = [...objs];
  if (filter === "mastered") {
    arr.sort((a, b) => String(a.objective || "").localeCompare(String(b.objective || "")));
    return arr;
  }
  arr.sort((a, b) => (b.bloom_level ?? 2) - (a.bloom_level ?? 2));
  return arr;
}

function defaultGroupExpanded(filter, objs) {
  const nStr = objs.filter((o) => o.status === "struggling").length;
  if (filter === "struggling") return nStr >= 3;
  if (filter === "inprogress") return true;
  if (filter === "untested") return false;
  if (filter === "mastered") return false;
  if (filter === "all") return objs.length <= 8;
  return false;
}

function LecObjectiveGroup({
  group,
  objectives,
  allObjectives,
  onSelfRate,
  onQuiz,
  color,
  T,
  blockId,
  weakCountByObjectiveId = {},
  quizLoadingId,
  quizErrorId,
  quizFlashLectureId,
  getLecPerf,
  onReExtractObjectives,
  reExtractingLectureId,
  editingLecId = null,
  setEditingLecId = null,
  editingTitle = "",
  setEditingTitle = null,
  onRenameLecture = null,
  smartTruncateTitle = null,
}) {
  const [open, setOpen] = useState(false);
  const renameEscapeRef = useRef(false);

  const fullTitle = String(group.lectureTitle || "").trim();
  const useTwoLines = fullTitle.length > 40;

  const lectureId =
    objectives.map((o) => o.linkedLecId).find(Boolean) ?? group.lectureId ?? null;
  const dotObjsForDisplay =
    lectureId && allObjectives
      ? allObjectives.filter((o) => o.linkedLecId === lectureId)
      : objectives;
  const aggDotColor = getLecObjDotColor(lectureId, dotObjsForDisplay, T);
  const perf =
    lectureId && getLecPerf && blockId
      ? getLecPerf({ id: lectureId }, blockId)
      : null;
  const perfScore =
    perf?.lastScore ??
    perf?.lastQuizScore ??
    perf?.sessions?.slice(-1)[0]?.score ??
    null;
  const hasQuizHistory =
    (perf?.sessions?.length || 0) > 0 || (perfScore != null && perfScore > 0);
  const barFill =
    perfScore != null && perfScore > 0
      ? Math.min(100, Math.max(0, perfScore))
      : 0;
  const barColor =
    barFill >= 70 ? "#639922" : barFill >= 50 ? "#BA7517" : barFill > 0 ? "#E24B4A" : T.border1;
  const scoreLabelColor =
    perfScore != null && perfScore > 0
      ? perfScore >= 70
        ? "#639922"
        : perfScore >= 50
          ? "#BA7517"
          : "#E24B4A"
      : T.text3;
  const isQuizLoading = lectureId != null && quizLoadingId === lectureId;
  const isQuizError = lectureId != null && quizErrorId === lectureId;
  const isFlash = lectureId != null && quizFlashLectureId === lectureId;

  return (
    <div
      style={{
        border: isFlash ? "1.5px solid #639922" : "1px solid " + T.border1,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 8,
        transition: "border-color 0.5s ease",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          background: T.cardBg,
          minHeight: useTwoLines ? 68 : 56,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = T.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = T.cardBg)}
      >
        <span style={{ fontFamily: MONO, color, fontSize: 13, fontWeight: 700, minWidth: 44 }}>
          {group.activity}
        </span>
        <span
          style={{
            fontFamily: MONO,
            color: T.text3,
            fontSize: 11,
            background: T.pillBg,
            padding: "3px 8px",
            borderRadius: 3,
          }}
        >
          {group.discipline}
        </span>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {lectureId &&
          onRenameLecture &&
          setEditingLecId &&
          setEditingTitle &&
          editingLecId === lectureId ? (
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={() => {
                if (renameEscapeRef.current) {
                  renameEscapeRef.current = false;
                  return;
                }
                onRenameLecture(lectureId, editingTitle);
                setEditingLecId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onRenameLecture(lectureId, editingTitle);
                  setEditingLecId(null);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  renameEscapeRef.current = true;
                  setEditingLecId(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontFamily: MONO,
                fontSize: 15,
                fontWeight: 500,
                flex: 1,
                minWidth: 0,
                padding: "2px 6px",
                border: "1.5px solid #2563eb",
                borderRadius: 4,
                background: "var(--color-background-primary)",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            />
          ) : (
            <span
              title={fullTitle || undefined}
              onDoubleClick={(e) => {
                if (!lectureId || !onRenameLecture || !setEditingLecId || !setEditingTitle) return;
                e.stopPropagation();
                e.preventDefault();
                setEditingLecId(lectureId);
                setEditingTitle(fullTitle);
              }}
              style={{
                fontFamily: MONO,
                color: T.text1,
                fontSize: 15,
                fontWeight: 500,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: useTwoLines ? 2 : 1,
                WebkitBoxOrient: "vertical",
                lineHeight: 1.25,
                maxHeight: useTwoLines ? "2.6em" : "1.3em",
                cursor: onRenameLecture ? "text" : "default",
              }}
            >
              {smartTruncateTitle ? smartTruncateTitle(fullTitle) : group.lectureTitle}
            </span>
          )}
          {lectureId && onRenameLecture && setEditingLecId && setEditingTitle && editingLecId !== lectureId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingLecId(lectureId);
                setEditingTitle(fullTitle);
              }}
              style={{
                fontSize: 11,
                padding: "2px 6px",
                background: "transparent",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: 4,
                cursor: "pointer",
                color: "var(--color-text-tertiary)",
                flexShrink: 0,
              }}
              title="Rename lecture"
            >
              ✎
            </button>
          )}
        </div>
        {dotObjsForDisplay.length > 0 && (
          <span style={{ fontFamily: MONO, color: aggDotColor, fontSize: 16, flexShrink: 0 }} title="Objectives in this lecture">
            ●{dotObjsForDisplay.length}
          </span>
        )}
        {reExtractingLectureId === lectureId && (
          <span
            style={{
              fontFamily: MONO,
              color: T.text3,
              fontSize: 11,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                border: "2px solid " + T.border1,
                borderTopColor: color,
                borderRadius: "50%",
                animation: "rxtObjSpin 0.7s linear infinite",
              }}
            />
            Re-extracting...
          </span>
        )}
        {onReExtractObjectives &&
          blockId &&
          lectureId &&
          dotObjsForDisplay.length < 3 &&
          reExtractingLectureId !== lectureId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReExtractObjectives(lectureId, blockId);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: MONO,
                fontSize: 11,
                color: "#BA7517",
                cursor: "pointer",
                textDecoration: "underline",
                flexShrink: 0,
              }}
            >
              ↻ Re-extract
            </button>
          )}
        <div
          style={{
            width: 80,
            height: 8,
            background: T.border1,
            borderRadius: 2,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: barFill + "%",
              height: "100%",
              background: barColor,
              borderRadius: 2,
              transition: "width 0.4s",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: MONO,
            color: scoreLabelColor,
            fontSize: 12,
            minWidth: 36,
            textAlign: "right",
          }}
        >
          {perfScore != null && perfScore > 0 ? perfScore + "%" : "0%"}
        </span>
        <button
          disabled={isQuizLoading}
          onClick={(e) => {
            e.stopPropagation();
            onQuiz(objectives, group.lectureTitle, blockId, { lectureId });
          }}
          style={{
            background: isQuizLoading ? T.inputBg : isQuizError ? T.statusWarnBg || "#FAEEDA" : color,
            border: isQuizLoading ? "1px solid " + T.border1 : isQuizError ? "1px solid " + (T.statusWarnBorder || "#D4A574") : "none",
            color: isQuizLoading ? T.text3 : isQuizError ? T.statusWarn || "#633806" : "#fff",
            padding: "12px 20px",
            borderRadius: 6,
            cursor: isQuizLoading ? "not-allowed" : "pointer",
            fontFamily: MONO,
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            opacity: isQuizLoading ? 0.85 : 1,
          }}
        >
          {isQuizLoading ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  border: "2px solid " + T.border1,
                  borderTopColor: color,
                  borderRadius: "50%",
                  animation: "rxtObjSpin 0.7s linear infinite",
                }}
              />
              Generating...
            </>
          ) : isQuizError ? (
            "Retry →"
          ) : hasQuizHistory ? (
            "Quiz again →"
          ) : (
            "Quiz →"
          )}
        </button>
        <span
          style={{
            color: T.text3,
            fontSize: 13,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.18s",
          }}
        >
          ▾
        </span>
      </div>
      {open && (
        <div style={{ background: T.inputBg, borderTop: "1px solid " + T.border1 }}>
          {objectives.map((obj, i) => (
            <ObjectiveRow
              key={obj.id}
              obj={obj}
              index={i}
              onSelfRate={onSelfRate}
              T={T}
              color={color}
              hasLecture={obj.hasLecture}
              lectureType={objectives[0]?.lectureType || "LEC"}
              weakMissCount={weakCountByObjectiveId[obj.id] || 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function objectiveActivityBadgeVisible(obj, lectureType) {
  const act = String(obj?.activity || "").trim();
  if (!act) return false;
  if (/^[A-Za-z]{2,4}\d+$/i.test(act.replace(/\s/g, ""))) return false;
  const lt = String(lectureType || "LEC").trim();
  return act.toUpperCase() !== lt.toUpperCase();
}

function ObjectiveRow({ obj, index, onSelfRate, T, color, hasLecture, lectureType = "LEC", weakMissCount = 0 }) {
  const statusColorToken =
    getObjStatusColor(T, obj.status) ??
    T.text3;
  const statusIcon = {
    mastered: "✓",
    struggling: "⚠",
    inprogress: "◐",
    untested: "○",
  }[obj.status] ?? "○";

  return (
    <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid " + T.border2,
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}
    >
      <span
        style={{
          fontFamily: MONO,
          color: T.text3,
          fontSize: 11,
          minWidth: 18,
          paddingTop: 2,
        }}
      >
        {index + 1}
      </span>
      <span
        style={{
          color: statusColorToken,
          fontSize: 16,
          minWidth: 16,
          paddingTop: 1,
          flexShrink: 0,
        }}
      >
        {statusIcon}
      </span>
      <div style={{ flex: 1 }}>
        <p
          style={{
            fontFamily: MONO,
            color: T.text1,
            fontSize: 13,
            lineHeight: 1.6,
            margin: 0,
            display: "flex",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>{obj.objective || obj.text || ""}</span>
          {objectiveActivityBadgeVisible(obj, lectureType) && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
                background: T.surfaceAlt || T.inputBg,
                color: T.textSecondary || T.text3,
                border: `1px solid ${T.border}`,
                flexShrink: 0,
              }}
            >
              {obj.activity}
            </span>
          )}
        </p>
        {obj.code ? (
          <span
            style={{
              fontFamily: MONO,
              color: T.text3,
              fontSize: 10,
              marginTop: 2,
              display: "block",
            }}
          >
            {obj.code}
          </span>
        ) : (
          <span
            style={{
              fontFamily: MONO,
              color: T.text3,
              fontSize: 9,
              marginTop: 2,
              display: "block",
            }}
          >
            {obj.id}
          </span>
        )}
        {hasLecture != null && (
          hasLecture ? (
            <span title="Lecture uploaded" style={{ fontFamily: MONO, color: T.statusGood, fontSize: 10, background: T.statusGoodBg || (T.statusGood + "22"), padding: "1px 5px", borderRadius: 3, marginTop: 4, display: "inline-block" }}>
              📖 linked
            </span>
          ) : (
            <span title="No lecture uploaded yet" style={{ fontFamily: MONO, color: T.text3, fontSize: 10, background: T.pillBg, padding: "1px 5px", borderRadius: 3, marginTop: 4, display: "inline-block" }}>
              📭 no lecture
            </span>
          )
        )}
        {weakMissCount > 0 && (
          <span
            title={`${weakMissCount} recorded miss${weakMissCount === 1 ? "" : "es"} on this objective — see Weak Concepts`}
            style={{
              fontFamily: MONO,
              color: "#A32D2D",
              fontSize: 10,
              background: "#F8D7D6",
              padding: "1px 6px",
              borderRadius: 3,
              marginTop: 4,
              marginLeft: 6,
              display: "inline-block",
              fontWeight: 700,
            }}
          >
            ⚠ {weakMissCount} miss{weakMissCount === 1 ? "" : "es"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {[
          { s: "struggling", label: "⚠", title: "Still struggling" },
          { s: "inprogress", label: "◐", title: "In progress" },
          { s: "mastered", label: "✓", title: "I've got this" },
        ].map((btn) => (
          <button
            key={btn.s}
            onClick={() => onSelfRate(obj.id, btn.s)}
            title={btn.title}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "1px solid " + (obj.status === btn.s ? statusColorToken : T.border1),
              background: obj.status === btn.s ? statusColorToken + "22" : "transparent",
              color: obj.status === btn.s ? statusColorToken : T.text3,
              cursor: "pointer",
              fontSize: 16,
              transition: "all 0.15s",
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ObjectiveTracker({
  blockId,
  blockLectures = [],
  objectives,
  coverageObjectives,
  onSelfRate,
  onUpdateObjectiveStatus,
  onStartObjectiveQuiz,
  quizLoadingId = null,
  quizErrorId = null,
  quizFlashLectureId = null,
  getLecPerf = null,
  termColor,
  T: TProp,
  headerActions = null,
  focusUnlinkedTabKey = 0,
  onAssignObjectiveToLecture = null,
  onAssignAllVisibleObjectives = null,
  onRemoveObjectiveLink = null,
  onDeleteUnlinkedObjectives = null,
  onDeleteSingleObjective = null,
  onDeleteMultipleObjectives = null,
  onAssignMultipleToLecture = null,
  onReExtractObjectives = null,
  reExtractingLectureId = null,
  editingLecId = null,
  setEditingLecId = null,
  editingTitle = "",
  setEditingTitle = null,
  onRenameLecture = null,
  smartTruncateTitle = null,
}) {
  const theme = useTheme();
  const T = TProp ?? theme.T;
  const color = termColor ?? T.red;

  const [subView, setSubView] = useState("lecture");

  const weakCountByObjectiveId = useMemo(() => {
    if (!blockId) return {};
    try {
      const stored = JSON.parse(localStorage.getItem("rxt-weak-concepts") || "{}");
      const arr = Array.isArray(stored[blockId]) ? stored[blockId] : [];
      const map = {};
      arr.forEach((c) => {
        if (c.masteryLevel === "mastered") return;
        const ids = Array.isArray(c.objectiveIds) ? c.objectiveIds : [];
        ids.forEach((id) => {
          if (!id) return;
          map[id] = (map[id] || 0) + (c.missCount || 1);
        });
      });
      return map;
    } catch {
      return {};
    }
  }, [blockId, objectives]);

  const validLecIds = useMemo(() => new Set((blockLectures || []).map((l) => l.id)), [blockLectures]);

  /** Only objectives with linkedLecId pointing at a real lecture in this block (no Unknown / fake SG rows). */
  const linkedObjectives = useMemo(() => {
    const raw = objectives || [];
    const filtered = raw.filter((obj) => {
      const lid = obj?.linkedLecId;
      if (!lid || lid === "imported" || lid === "unknown") return false;
      return validLecIds.has(lid);
    });
    return filtered.map((obj) => {
      const matchedLec = blockLectures.find((l) => l.id === obj.linkedLecId);
      const resolvedActivity = matchedLec
        ? `${matchedLec.lectureType || "LEC"} ${matchedLec.lectureNumber ?? ""}`.trim()
        : (obj.activity || "Other");
      return {
        ...obj,
        linkedLecId: matchedLec?.id ?? obj.linkedLecId ?? null,
        hasLecture: !!matchedLec,
        resolvedActivity,
      };
    });
  }, [objectives, blockLectures, validLecIds]);

  const unlinkedObjectives = useMemo(() => {
    const raw = objectives || [];
    return raw.filter((obj) => {
      const lid = obj?.linkedLecId;
      if (!lid || lid === "imported" || lid === "unknown") return true;
      return !validLecIds.has(lid);
    });
  }, [objectives, validLecIds]);

  const unlinkedCount = unlinkedObjectives.length;

  const byLecture = useMemo(() => {
    const map = new Map();
    for (const o of linkedObjectives) {
      const lecId = o.linkedLecId;
      const matchedLec = blockLectures.find((l) => l.id === lecId);
      if (!matchedLec) continue;
      const activity = `${matchedLec.lectureType || "LEC"} ${matchedLec.lectureNumber ?? ""}`.trim();
      if (!map.has(lecId)) {
        map.set(lecId, {
          lectureId: lecId,
          activity,
          discipline: o.discipline || "",
          lectureTitle: matchedLec.lectureTitle || matchedLec.title || o.lectureTitle || activity,
          objectives: [],
        });
      }
      map.get(lecId).objectives.push(o);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.activity).localeCompare(String(b.activity), undefined, { numeric: true })
    );
  }, [linkedObjectives, blockLectures]);

  const countStruggling = linkedObjectives.filter((o) => o.status === "struggling").length;
  const countInprogress = linkedObjectives.filter((o) => o.status === "inprogress").length;
  const countUntested = linkedObjectives.filter((o) => !o.status || o.status === "untested").length;
  const countMastered = linkedObjectives.filter((o) => o.status === "mastered").length;
  const totalAll = linkedObjectives.length;

  const [statusFilter, setStatusFilter] = useState("untested");
  const [coverageSort, setCoverageSort] = useState("struggling");
  const [openGroups, setOpenGroups] = useState({});
  const [untestedShowAll, setUntestedShowAll] = useState({});
  const [covDetailOpen, setCovDetailOpen] = useState({});
  const [hoverObjId, setHoverObjId] = useState(null);
  const [unlinkedFilter, setUnlinkedFilter] = useState("all");
  const [unlinkedSearch, setUnlinkedSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [bulkAssignLecId, setBulkAssignLecId] = useState("");
  const [selectedObjIds, setSelectedObjIds] = useState(() => new Set());
  const [bulkMultiAssign, setBulkMultiAssign] = useState("");

  const covSrc = coverageObjectives ?? objectives ?? [];

  const lecturesSortedForSelect = useMemo(
    () => [...(blockLectures || [])].sort(sortLecturesForSelect),
    [blockLectures]
  );

  useEffect(() => {
    if (focusUnlinkedTabKey > 0) setSubView("unlinked");
  }, [focusUnlinkedTabKey]);

  useEffect(() => {
    if (unlinkedCount === 0 && subView === "unlinked") setSubView("lecture");
  }, [unlinkedCount, subView]);

  useEffect(() => {
    setSelectedObjIds(new Set());
    setBulkMultiAssign("");
  }, [unlinkedFilter, unlinkedSearch]);

  useEffect(() => {
    if (selectedObjIds.size === 0) setBulkMultiAssign("");
  }, [selectedObjIds.size]);

  useEffect(() => {
    setOpenGroups({});
    setUntestedShowAll({});
    setCovDetailOpen({});
    setCoverageSort("struggling");
    setDeleteConfirm(false);
    setUnlinkedSearch("");
    setUnlinkedFilter("all");
    setBulkAssignLecId("");
    const str = linkedObjectives.filter((o) => o.status === "struggling").length;
    const ip = linkedObjectives.filter((o) => o.status === "inprogress").length;
    setStatusFilter(str > 0 ? "struggling" : ip > 0 ? "inprogress" : "untested");
    // Intentionally block only: do not reset filter when objectives update (e.g. after quiz).
  }, [blockId]);

  const applyObjStatus = useCallback(
    (id, s) => {
      if (onUpdateObjectiveStatus) onUpdateObjectiveStatus(id, s);
      else {
        onSelfRate(id, s);
        try {
          window.dispatchEvent(new CustomEvent("rxt-objectives-updated"));
        } catch (_) {}
      }
    },
    [onSelfRate, onUpdateObjectiveStatus]
  );

  const filteredByStatus = useMemo(() => {
    if (statusFilter === "all") return linkedObjectives;
    if (statusFilter === "struggling")
      return linkedObjectives.filter((o) => o.status === "struggling");
    if (statusFilter === "inprogress")
      return linkedObjectives.filter((o) => o.status === "inprogress");
    if (statusFilter === "mastered")
      return linkedObjectives.filter((o) => o.status === "mastered");
    return linkedObjectives.filter((o) => !o.status || o.status === "untested");
  }, [linkedObjectives, statusFilter]);

  const visibleUnlinked = useMemo(() => {
    let list = unlinkedObjectives;
    if (unlinkedFilter === "unmatched") {
      list = list.filter(
        (o) => !o.linkedLecId || o.linkedLecId === "imported" || o.linkedLecId === "unknown"
      );
    } else if (unlinkedFilter === "aiSuggested") {
      list = list.filter((o) => o.aiAligned === true);
    }
    const q = unlinkedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => (o.objective || o.text || "").toLowerCase().includes(q));
    }
    return list;
  }, [unlinkedObjectives, unlinkedFilter, unlinkedSearch]);

  const statusGroups = useMemo(() => {
    const m = new Map();
    for (const o of filteredByStatus) {
      const id = o.linkedLecId || "__unassigned";
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(o);
    }
    const rows = [];
    for (const [lecId, objs] of m) {
      const lec = blockLectures.find((l) => l.id === lecId) || null;
      rows.push({ lecId, lec, objs });
    }
    rows.sort((a, b) => {
      if (!a.lec && !b.lec) return String(a.lecId).localeCompare(String(b.lecId));
      if (!a.lec) return 1;
      if (!b.lec) return -1;
      return sortLecturesForObjectives(a.lec, b.lec);
    });
    return rows;
  }, [filteredByStatus, blockLectures]);

  const globalCounts = useMemo(() => countByStatus(covSrc), [covSrc]);

  const coverageRows = useMemo(() => {
    const lecs = [...blockLectures].sort(sortLecturesForObjectives);
    return lecs.map((lec) => {
      const lecObjs = covSrc.filter((o) => o.linkedLecId === lec.id);
      const total = lecObjs.length;
      const mastered = lecObjs.filter((o) => o.status === "mastered").length;
      const inprogress = lecObjs.filter((o) => o.status === "inprogress").length;
      const struggling = lecObjs.filter((o) => o.status === "struggling").length;
      const untested = Math.max(0, total - mastered - inprogress - struggling);
      const coverage = total ? Math.round(((mastered + inprogress) / total) * 100) : 0;
      const masteredPct = total ? (mastered / total) * 100 : 0;
      const inprogressPct = total ? (inprogress / total) * 100 : 0;
      const strugglingPct = total ? (struggling / total) * 100 : 0;
      const untestedPct = total ? (untested / total) * 100 : 0;
      return {
        lec,
        total,
        m: mastered,
        ip: inprogress,
        st: struggling,
        ut: untested,
        coverage,
        masteredPct,
        inprogressPct,
        strugglingPct,
        untestedPct,
      };
    });
  }, [covSrc, blockLectures]);

  const sortedCoverageRows = useMemo(() => {
    const rows = [...coverageRows];
    if (coverageSort === "lecture_order") {
      rows.sort((a, b) => sortLecturesForObjectives(a.lec, b.lec));
    } else if (coverageSort === "coverage_asc") {
      rows.sort((a, b) => a.coverage - b.coverage);
    } else if (coverageSort === "coverage_desc") {
      rows.sort((a, b) => b.coverage - a.coverage);
    } else if (coverageSort === "untested") {
      rows.sort((a, b) => b.ut - a.ut);
    } else {
      rows.sort((a, b) => b.st - a.st || b.ut - a.ut);
    }
    return rows;
  }, [coverageRows, coverageSort]);

  const pills = [
    { key: "lecture", label: "📋 By Lecture" },
    { key: "status", label: "🎯 By Status" },
    { key: "coverage", label: "📊 Coverage" },
    ...(unlinkedCount > 0 ? [{ key: "unlinked", label: `🔗 Unlinked (${unlinkedCount})`, amber: true }] : []),
  ];

  const lectureOptionLabel = (l) => {
    const raw = (l.lectureTitle || l.title || "").trim();
    const title = smartTruncateTitle ? smartTruncateTitle(raw, 42) : raw.length > 42 ? raw.slice(0, 40) + "…" : raw;
    return `${l.lectureType || "LEC"} ${l.lectureNumber ?? ""} — ${title || "No title"}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 4px 24px" }}>
      <style>{`@keyframes rxtObjSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {pills.map((p) => {
          const active = subView === p.key;
          const isUn = p.key === "unlinked" && p.amber;
          const style = isUn
            ? {
                background: "#FAEEDA",
                border: "1px solid #EF9F27",
                color: "#633806",
                boxShadow: active ? "0 0 0 1px #EF9F27" : "none",
              }
            : {
                background: active ? color + "22" : T.inputBg,
                border: "1px solid " + (active ? color : T.border1),
                color: active ? color : T.text3,
              };
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setSubView(p.key)}
              style={{
                ...style,
                padding: "8px 14px",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {p.label}
            </button>
          );
        })}
        {headerActions}
      </div>

      {subView === "lecture" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {byLecture.map((group) => (
            <LecObjectiveGroup
              key={group.lectureId || group.activity}
              group={group}
              objectives={group.objectives}
              allObjectives={objectives}
              onSelfRate={onSelfRate}
              onQuiz={onStartObjectiveQuiz}
              color={color}
              T={T}
              blockId={blockId}
              weakCountByObjectiveId={weakCountByObjectiveId}
              quizLoadingId={quizLoadingId}
              quizErrorId={quizErrorId}
              quizFlashLectureId={quizFlashLectureId}
              getLecPerf={getLecPerf}
              onReExtractObjectives={onReExtractObjectives}
              reExtractingLectureId={reExtractingLectureId}
              editingLecId={editingLecId}
              setEditingLecId={setEditingLecId}
              editingTitle={editingTitle}
              setEditingTitle={setEditingTitle}
              onRenameLecture={onRenameLecture}
              smartTruncateTitle={smartTruncateTitle}
            />
          ))}
          {byLecture.length === 0 && (
            <p style={{ fontFamily: MONO, color: T.text3, fontSize: 16 }}>
              No objectives loaded. Seed data in ftm2Objectives.json or load from storage.
            </p>
          )}
        </div>
      )}

      {subView === "unlinked" && unlinkedCount > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                fontFamily: MONO,
                color: T.text1,
                marginBottom: 4,
              }}
            >
              {unlinkedCount} objectives need a lecture assigned
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--color-text-secondary, " + T.text2 + ")",
                fontFamily: MONO,
                lineHeight: 1.45,
              }}
            >
              These were imported but couldn&apos;t be automatically matched to a lecture.
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {[
              { k: "all", label: "Show all" },
              { k: "unmatched", label: "Only unmatched" },
              { k: "aiSuggested", label: "AI suggested" },
            ].map((b) => (
              <button
                key={b.k}
                type="button"
                onClick={() => setUnlinkedFilter(b.k)}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  padding: "5px 10px",
                  borderRadius: "var(--border-radius-md, 8px)",
                  border: "1px solid " + (unlinkedFilter === b.k ? "#EF9F27" : T.border1),
                  background: unlinkedFilter === b.k ? "#FAEEDA" : T.inputBg,
                  color: unlinkedFilter === b.k ? "#633806" : T.text3,
                  cursor: "pointer",
                  fontWeight: unlinkedFilter === b.k ? 700 : 500,
                }}
              >
                {b.label}
              </button>
            ))}
            <input
              type="search"
              value={unlinkedSearch}
              onChange={(e) => setUnlinkedSearch(e.target.value)}
              placeholder="Search objectives…"
              style={{
                flex: 1,
                minWidth: 160,
                maxWidth: 320,
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: "var(--border-radius-md, 8px)",
                border: "0.5px solid var(--color-border-tertiary, " + T.border1 + ")",
                background: "var(--color-background-primary, " + T.cardBg + ")",
                color: T.text1,
                fontFamily: MONO,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              padding: "10px 12px",
              border: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
              borderRadius: "var(--border-radius-md, 8px)",
              background: T.inputBg,
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 12, color: T.text2 }}>Assign all to lecture →</span>
            <select
              value={bulkAssignLecId}
              onChange={(e) => setBulkAssignLecId(e.target.value)}
              style={{
                width: 220,
                fontSize: 12,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid " + T.border1,
                fontFamily: MONO,
                background: T.cardBg,
                color: T.text1,
              }}
            >
              <option value="">— assign lecture —</option>
              {lecturesSortedForSelect.map((l) => (
                <option key={l.id} value={l.id}>
                  {lectureOptionLabel(l)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkAssignLecId || !visibleUnlinked.length || !onAssignAllVisibleObjectives}
              onClick={() => {
                if (!bulkAssignLecId || !onAssignAllVisibleObjectives) return;
                onAssignAllVisibleObjectives(
                  bulkAssignLecId,
                  visibleUnlinked.map((o) => o.id)
                );
              }}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid " + T.border1,
                background: T.cardBg,
                color: T.text2,
                cursor: bulkAssignLecId && visibleUnlinked.length ? "pointer" : "not-allowed",
                opacity: bulkAssignLecId && visibleUnlinked.length ? 1 : 0.5,
              }}
            >
              Apply to all {visibleUnlinked.length} visible
            </button>
          </div>

          {!deleteConfirm ? (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              style={{
                alignSelf: "flex-start",
                fontFamily: MONO,
                fontSize: 11,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #F09595",
                background: "transparent",
                color: "#A32D2D",
                cursor: "pointer",
              }}
            >
              Delete all unlinked
            </button>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
                padding: "10px 12px",
                border: "1px solid #F09595",
                borderRadius: 8,
                background: "#FCEBEB",
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 12, color: "#A32D2D" }}>
                Delete {unlinkedCount} unlinked objectives?
              </span>
              <button
                type="button"
                onClick={() => {
                  onDeleteUnlinkedObjectives?.();
                  setDeleteConfirm(false);
                }}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "#A32D2D",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid " + T.border1,
                  background: T.cardBg,
                  color: T.text2,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {visibleUnlinked.length > 0 && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--color-text-secondary, " + T.text2 + ")",
                cursor: "pointer",
                marginBottom: 6,
                fontFamily: MONO,
              }}
            >
              <input
                type="checkbox"
                checked={
                  selectedObjIds.size === visibleUnlinked.length && visibleUnlinked.length > 0
                }
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedObjIds(new Set(visibleUnlinked.map((o) => o.id)));
                  } else {
                    setSelectedObjIds(new Set());
                  }
                }}
              />
              Select all {visibleUnlinked.length} visible
            </label>
          )}

          {selectedObjIds.size > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "#FAEEDA",
                border: "0.5px solid #EF9F27",
                borderRadius: "var(--border-radius-md, 8px)",
                marginBottom: 8,
                fontSize: 13,
                flexWrap: "wrap",
                fontFamily: MONO,
              }}
            >
              <span style={{ flex: 1, color: "#633806", minWidth: 120 }}>
                {selectedObjIds.size} selected
              </span>
              <select
                value={bulkMultiAssign}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  onAssignMultipleToLecture?.([...selectedObjIds], v);
                  setSelectedObjIds(new Set());
                  setBulkMultiAssign("");
                }}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid " + T.border1,
                  fontFamily: MONO,
                  background: T.cardBg,
                  color: T.text1,
                  maxWidth: 260,
                }}
              >
                <option value="">Assign selected to...</option>
                {lecturesSortedForSelect.map((l) => {
                  const raw = (l.lectureTitle || l.title || "").trim();
                  const shown = smartTruncateTitle ? smartTruncateTitle(raw, 40) : raw.slice(0, 40) + (raw.length > 40 ? "…" : "");
                  return (
                    <option key={l.id} value={l.id} title={raw || undefined}>
                      {l.lectureType} {l.lectureNumber} — {shown || "No title"}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => {
                  onDeleteMultipleObjectives?.([...selectedObjIds]);
                  setSelectedObjIds(new Set());
                }}
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  background: "#FCEBEB",
                  color: "#A32D2D",
                  border: "0.5px solid #F09595",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontFamily: MONO,
                }}
              >
                Delete {selectedObjIds.size}
              </button>
              <button
                type="button"
                onClick={() => setSelectedObjIds(new Set())}
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  background: "transparent",
                  color: "var(--color-text-secondary, " + T.text2 + ")",
                  border: "0.5px solid var(--color-border-secondary, " + T.border1 + ")",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontFamily: MONO,
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {visibleUnlinked.map((obj) => {
              const text = obj.objective || obj.text || "";
              const selVal =
                obj.linkedLecId && validLecIds.has(obj.linkedLecId) ? obj.linkedLecId : "";
              const showGreen = validLecIds.has(obj.linkedLecId);
              const hasAssignment =
                obj.linkedLecId && obj.linkedLecId !== "imported" && obj.linkedLecId !== "unknown";
              return (
                <div
                  key={obj.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    border: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                    borderLeft: showGreen ? "3px solid #639922" : undefined,
                    borderRadius: "var(--border-radius-md, 8px)",
                    marginBottom: 6,
                    background: "var(--color-background-primary, " + T.cardBg + ")",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedObjIds.has(obj.id)}
                    onChange={() => {
                      setSelectedObjIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(obj.id)) next.delete(obj.id);
                        else next.add(obj.id);
                        return next;
                      });
                    }}
                    style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }}
                  />
                  <div
                    style={{
                      fontSize: 13,
                      flex: 1,
                      lineHeight: 1.5,
                      color: "var(--color-text-primary, " + T.text1 + ")",
                      fontFamily: MONO,
                      minWidth: 0,
                    }}
                  >
                    <div>{text}</div>
                    {obj.code ? (
                      <div
                        style={{
                          fontFamily: MONO,
                          color: "var(--color-text-tertiary, " + T.text3 + ")",
                          fontSize: 10,
                          marginTop: 4,
                        }}
                      >
                        {obj.code}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <select
                      value={selVal}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) onAssignObjectiveToLecture?.(obj.id, v);
                      }}
                      style={{
                        width: 220,
                        fontSize: 12,
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid " + T.border1,
                        fontFamily: MONO,
                        background: T.cardBg,
                        color: T.text1,
                      }}
                    >
                      <option value="">— assign lecture —</option>
                      {lecturesSortedForSelect.map((l) => (
                        <option key={l.id} value={l.id}>
                          {lectureOptionLabel(l)}
                        </option>
                      ))}
                    </select>
                    {hasAssignment && onRemoveObjectiveLink && (
                      <button
                        type="button"
                        onClick={() => onRemoveObjectiveLink(obj.id)}
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-tertiary, " + T.text3 + ")",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: MONO,
                          textDecoration: "underline",
                        }}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                  {onDeleteSingleObjective && (
                    <button
                      type="button"
                      title="Delete objective"
                      onClick={() => onDeleteSingleObjective(obj.id)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#FCEBEB";
                        e.currentTarget.style.color = "#A32D2D";
                        e.currentTarget.style.borderColor = "#F09595";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--color-text-tertiary, " + T.text3 + ")";
                        e.currentTarget.style.borderColor =
                          "var(--color-border-tertiary, " + T.border2 + ")";
                      }}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "var(--border-radius-md, 8px)",
                        border: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                        background: "transparent",
                        color: "var(--color-text-tertiary, " + T.text3 + ")",
                        cursor: "pointer",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.15s",
                        fontFamily: MONO,
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {visibleUnlinked.length === 0 && (
              <p style={{ fontFamily: MONO, color: T.text3, fontSize: 13 }}>
                No objectives match this filter.
              </p>
            )}
          </div>
        </div>
      )}

      {subView === "status" && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[
              { key: "struggling", label: "⚠ Struggling", n: countStruggling, a: { bg: "#FCEBEB", color: "#A32D2D", border: "#F09595" } },
              { key: "inprogress", label: "△ In progress", n: countInprogress, a: { bg: "#FAEEDA", color: "#633806", border: "#EF9F27" } },
              {
                key: "untested",
                label: "○ Untested",
                n: countUntested,
                a: { bg: "var(--color-background-secondary, " + T.inputBg + ")", color: T.text2, border: T.border1 },
              },
              { key: "mastered", label: "✓ Mastered", n: countMastered, a: { bg: "#EAF3DE", color: "#27500A", border: "#97C459" } },
              {
                key: "all",
                label: "All",
                n: totalAll,
                a: { bg: "var(--color-background-secondary, " + T.inputBg + ")", color: T.text2, border: T.border1 },
              },
            ].map((p) => {
              const active = statusFilter === p.key;
              const st = active ? p.a : { bg: T.inputBg, color: T.text3, border: T.border1 };
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setStatusFilter(p.key)}
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: "var(--border-radius-md, 8px)",
                    border: "1px solid " + st.border,
                    background: st.bg,
                    color: st.color,
                    cursor: "pointer",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {p.label} ({p.n})
                </button>
              );
            })}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary, " + T.text3 + ")",
              marginBottom: 8,
              fontFamily: MONO,
              lineHeight: 1.45,
            }}
          >
            {statusFilter === "struggling" &&
              `Showing ${countStruggling} struggling objectives across ${statusGroups.length} lectures — these need the most attention`}
            {statusFilter === "inprogress" &&
              `Showing ${countInprogress} in progress objectives — reinforce these`}
            {statusFilter === "untested" &&
              `Showing ${countUntested} untested objectives — not yet covered`}
            {statusFilter === "mastered" &&
              `Showing ${countMastered} mastered objectives — looking good`}
            {statusFilter === "all" &&
              `Showing ${totalAll} objectives across ${statusGroups.length} lectures`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "70vh", overflow: "auto" }}>
            {statusGroups.map(({ lecId, lec, objs }) => {
              const n = objs.length;
              const expanded =
                openGroups[lecId] !== undefined ? openGroups[lecId] : defaultGroupExpanded(statusFilter, objs);
              const fullTitle = (lec?.lectureTitle || lec?.fileName || objs[0]?.lectureTitle || "Other").trim();
              let typeKey = (lec?.lectureType || "LEC").toUpperCase();
              if (typeKey === "LECTURE" || typeKey.startsWith("LECT")) typeKey = "LEC";
              else typeKey = typeKey.slice(0, 4);
              const sortedObjs = sortGroupObjectives(statusFilter, objs);
              const untestedLimited =
                statusFilter === "untested" && !untestedShowAll[lecId] && sortedObjs.length > 5;
              const displayObjs = untestedLimited ? sortedObjs.slice(0, 5) : sortedObjs;
              const moreUntested = sortedObjs.length - 5;
              const countChip =
                statusFilter === "struggling"
                  ? { text: `${n} struggling`, bg: "#FCEBEB", color: "#A32D2D" }
                  : statusFilter === "inprogress"
                    ? { text: `${n} in progress`, bg: "#FAEEDA", color: "#633806" }
                    : statusFilter === "untested"
                      ? {
                          text: `${n} untested`,
                          bg: "var(--color-background-secondary, " + T.inputBg + ")",
                          color: T.text3,
                        }
                      : statusFilter === "mastered"
                        ? { text: `${n} mastered`, bg: "#EAF3DE", color: "#27500A" }
                        : { text: `${n} objectives`, bg: T.pillBg, color: T.text2 };
              const rowFs = statusFilter === "mastered" ? 11 : 12;
              const renderQuick = (o) => {
                const qBtn = (sym, title, ns, bg, border, col) => (
                  <button
                    key={title + sym}
                    type="button"
                    title={title}
                    onClick={() => applyObjStatus(o.id, ns)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 3,
                      border: "1px solid " + border,
                      background: bg,
                      color: col,
                      cursor: "pointer",
                      fontSize: 11,
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    {sym}
                  </button>
                );
                const st = o.status;
                const wrap = (children) => (
                  <div
                    style={{
                      display: "flex",
                      gap: 3,
                      flexShrink: 0,
                      opacity: hoverObjId === o.id ? 1 : 0,
                      transition: "opacity 0.15s",
                    }}
                  >
                    {children}
                  </div>
                );
                if (st === "mastered") {
                  return wrap(
                    qBtn("↺", "Reset to untested", "untested", "var(--color-background-secondary, " + T.inputBg + ")", T.border1, T.text3)
                  );
                }
                if (st === "struggling") {
                  return wrap([
                    qBtn("△", "Mark in progress", "inprogress", "#FAEEDA", "#EF9F27", "#633806"),
                    qBtn("✓", "Mark mastered", "mastered", "#EAF3DE", "#97C459", "#27500A"),
                  ]);
                }
                if (st === "inprogress") {
                  return wrap([
                    qBtn("△", "Mark in progress", "inprogress", "#FAEEDA", "#EF9F27", "#633806"),
                    qBtn("✓", "Mark mastered", "mastered", "#EAF3DE", "#97C459", "#27500A"),
                  ]);
                }
                return wrap([
                  qBtn("⚠", "Mark struggling", "struggling", "#FCEBEB", "#F09595", "#A32D2D"),
                  qBtn("△", "Mark in progress", "inprogress", "#FAEEDA", "#EF9F27", "#633806"),
                  qBtn("✓", "Mark mastered", "mastered", "#EAF3DE", "#97C459", "#27500A"),
                ]);
              };
              return (
                <div key={lecId} style={{ marginBottom: 6 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenGroups((g) => ({ ...g, [lecId]: !expanded }))}
                    onKeyDown={(e) => e.key === "Enter" && setOpenGroups((g) => ({ ...g, [lecId]: !expanded }))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      background: "var(--color-background-secondary, " + T.inputBg + ")",
                      borderRadius: expanded
                        ? "var(--border-radius-md, 8px) var(--border-radius-md, 8px) 0 0"
                        : "var(--border-radius-md, 8px)",
                      cursor: "pointer",
                      border: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                      borderBottom: expanded ? "none" : "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                    }}
                  >
                    <span style={{ fontFamily: MONO, color: T.text3, fontSize: 10 }}>{expanded ? "▾" : "▸"}</span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 4,
                        flexShrink: 0,
                        minWidth: 40,
                        textAlign: "center",
                        background: T.pillBg,
                        color: T.text2,
                      }}
                    >
                      {typeKey}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3, width: 28, flexShrink: 0 }}>
                      {lec?.lectureNumber ?? "—"}
                    </span>
                    <span
                      title={fullTitle}
                      style={{
                        fontFamily: MONO,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--color-text-primary, " + T.text1 + ")",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {fullTitle}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: countChip.bg,
                        border: "0.5px solid " + (statusFilter === "untested" ? T.border1 : "transparent"),
                        color: countChip.color,
                        flexShrink: 0,
                      }}
                    >
                      {countChip.text}
                    </span>
                  </div>
                  {expanded && (
                    <div
                      style={{
                        background: "var(--color-background-primary, " + T.cardBg + ")",
                        border: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                        borderTop: "none",
                        borderRadius: "0 0 var(--border-radius-md, 8px) var(--border-radius-md, 8px)",
                        marginBottom: 6,
                      }}
                    >
                      {displayObjs.map((obj, li) => {
                        const isUt = !obj.status || obj.status === "untested";
                        const dotStyle =
                          obj.status === "mastered"
                            ? { background: "#639922", border: "none" }
                            : obj.status === "inprogress"
                              ? { background: "#BA7517", border: "none" }
                              : obj.status === "struggling"
                                ? { background: "#E24B4A", border: "none" }
                                : {
                                    background: "transparent",
                                    border: "1px solid var(--color-border-secondary, " + T.border1 + ")",
                                  };
                        const bl = obj.bloom_level ?? 2;
                        const bloomLabel = `L${bl} ${BLOOM_SHORT[bl] || "Understand"}`;
                        const bCol = LEVEL_COLORS[bl] || LEVEL_COLORS[2];
                        const bBg = (LEVEL_BG && LEVEL_BG[bl]) || bCol + "18";
                        const lastRow = li === displayObjs.length - 1 && !(untestedLimited && moreUntested > 0);
                        return (
                          <div
                            key={obj.id}
                            onMouseEnter={() => setHoverObjId(obj.id)}
                            onMouseLeave={() => setHoverObjId(null)}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                              padding: "7px 10px 7px 28px",
                              borderBottom: lastRow
                                ? "none"
                                : "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                              position: "relative",
                            }}
                          >
                            <span
                              title="Status"
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                marginTop: 5,
                                flexShrink: 0,
                                boxSizing: "border-box",
                                ...dotStyle,
                              }}
                            />
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 9,
                                padding: "2px 5px",
                                borderRadius: 3,
                                background: bBg,
                                color: bCol,
                                flexShrink: 0,
                                marginTop: 3,
                                maxWidth: 96,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {bloomLabel}
                            </span>
                            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: rowFs,
                                  lineHeight: 1.5,
                                  color: "var(--color-text-primary, " + T.text1 + ")",
                                  fontFamily: MONO,
                                  display: "flex",
                                  alignItems: "flex-start",
                                  flexWrap: "wrap",
                                  gap: 6,
                                }}
                              >
                                <span style={{ flex: "1 1 auto", minWidth: 0 }}>{obj.objective || obj.text || ""}</span>
                                {objectiveActivityBadgeVisible(obj, lec?.lectureType) && (
                                  <span
                                    style={{
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      background: T.surfaceAlt || T.inputBg,
                                      color: T.textSecondary || T.text3,
                                      border: `1px solid ${T.border}`,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {obj.activity}
                                  </span>
                                )}
                              </p>
                              {obj.code ? (
                                <span
                                  style={{
                                    fontFamily: MONO,
                                    color: "var(--color-text-tertiary, " + T.text3 + ")",
                                    fontSize: Math.max(9, rowFs - 3),
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {obj.code}
                                </span>
                              ) : null}
                              {obj.status === "struggling" && obj.reasoningLog?.length > 0 && (
                                <div
                                  style={{
                                    marginTop: 2,
                                    paddingTop: 6,
                                    borderTop: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 10,
                                      color: "#A32D2D",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.06em",
                                      marginBottom: 4,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    Your past reasoning
                                  </div>
                                  {obj.reasoningLog.slice(0, 2).map((entry, ri) => (
                                    <div
                                      key={ri}
                                      style={{
                                        fontSize: 11,
                                        color: "var(--color-text-secondary, " + T.text2 + ")",
                                        marginBottom: 4,
                                        lineHeight: 1.4,
                                        fontFamily: MONO,
                                      }}
                                    >
                                      <span style={{ color: "var(--color-text-tertiary, " + T.text3 + ")" }}>
                                        {entry.date ? new Date(entry.date).toLocaleDateString() : ""}
                                      </span>
                                      {" — "}
                                      {entry.reasoning}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {renderQuick(obj)}
                          </div>
                        );
                      })}
                      {untestedLimited && moreUntested > 0 && (
                        <button
                          type="button"
                          onClick={() => setUntestedShowAll((s) => ({ ...s, [lecId]: true }))}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px 8px 28px",
                            background: "none",
                            border: "none",
                            borderTop: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                            color: T.text3,
                            fontFamily: MONO,
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          + {moreUntested} more objectives in this lecture
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {statusGroups.length === 0 && (
              <p style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}>No objectives in this filter.</p>
            )}
          </div>
        </div>
      )}

      {subView === "coverage" && (
        <div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#639922" }}>
              ✓ {globalCounts.m} mastered
              {totalAll > 0 ? " — " + Math.round((globalCounts.m / totalAll) * 100) + "%" : ""}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#BA7517" }}>
              △ {globalCounts.ip} in progress
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#E24B4A" }}>
              ⚠ {globalCounts.st} struggling
            </span>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: T.text3 }}>
              ○ {globalCounts.ut} untested
            </span>
          </div>
          <div
            style={{
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 16,
              width: "100%",
              maxWidth: 560,
            }}
          >
            {globalCounts.t > 0 &&
              [
                { n: globalCounts.m, bg: "#639922" },
                { n: globalCounts.ip, bg: "#BA7517" },
                { n: globalCounts.st, bg: "#E24B4A" },
                { n: globalCounts.ut, bg: "#d1d5db" },
              ]
                .filter((x) => x.n > 0)
                .map((x, i, arr) => (
                  <div
                    key={i}
                    style={{
                      flex: x.n,
                      minWidth: 2,
                      background: x.bg,
                      borderTopLeftRadius: i === 0 ? 4 : 0,
                      borderBottomLeftRadius: i === 0 ? 4 : 0,
                      borderTopRightRadius: i === arr.length - 1 ? 4 : 0,
                      borderBottomRightRadius: i === arr.length - 1 ? 4 : 0,
                    }}
                  />
                ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[
              { k: "struggling", label: "Most struggling" },
              { k: "coverage_asc", label: "Coverage ↑" },
              { k: "coverage_desc", label: "Coverage ↓" },
              { k: "lecture_order", label: "Lecture order" },
              { k: "untested", label: "Most untested" },
            ].map((b) => (
              <button
                key={b.k}
                type="button"
                onClick={() => setCoverageSort(b.k)}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid " + (coverageSort === b.k ? color : T.border1),
                  background: coverageSort === b.k ? color + "18" : T.inputBg,
                  color: coverageSort === b.k ? color : T.text3,
                  cursor: "pointer",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sortedCoverageRows.map((row) => {
              const lec = row.lec;
              const lid = lec.id;
              const isOpen = !!covDetailOpen[lid];
              let typeKey = (lec?.lectureType || "LEC").toUpperCase();
              if (typeKey === "LECTURE" || typeKey.startsWith("LECT")) typeKey = "LEC";
              else typeKey = typeKey.slice(0, 4);
              const title = (lec?.lectureTitle || "").slice(0, 48);
              const cov = row.coverage;
              const showCoveragePct = row.total > 0 && cov > 0;
              const covColor = showCoveragePct
                ? cov >= 70
                  ? "#639922"
                  : cov >= 40
                    ? "#BA7517"
                    : "#E24B4A"
                : T.text3;
              const numer = row.m + row.ip;
              return (
                <div key={String(lid)}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderBottom: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                      cursor: "pointer",
                    }}
                    onClick={() => setCovDetailOpen((d) => ({ ...d, [lid]: !isOpen }))}
                  >
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        width: 40,
                        flexShrink: 0,
                        textAlign: "center",
                        padding: "2px 4px",
                        borderRadius: 4,
                        background: T.pillBg,
                        color: T.text2,
                      }}
                    >
                      {typeKey}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: T.text3, width: 28, flexShrink: 0 }}>
                      {lec?.lectureNumber ?? "—"}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: T.text1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                        fontFamily: MONO,
                      }}
                    >
                      {title}
                    </span>
                    <SegmentedPctBar
                      masteredPct={row.masteredPct}
                      inprogressPct={row.inprogressPct}
                      strugglingPct={row.strugglingPct}
                      untestedPct={row.untestedPct}
                      width={120}
                      height={6}
                    />
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: T.text3,
                        width: 44,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {row.total > 0 ? `${numer}/${row.total}` : "—"}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        width: 40,
                        textAlign: "right",
                        flexShrink: 0,
                        color: covColor,
                      }}
                    >
                      {showCoveragePct ? cov + "%" : "—"}
                    </span>
                  </div>
                  {isOpen && (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        padding: "8px 10px 10px 48px",
                        borderBottom: "0.5px solid var(--color-border-tertiary, " + T.border2 + ")",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#63992222",
                          color: "#639922",
                        }}
                      >
                        ✓ {row.m} mastered
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#BA751722",
                          color: "#633806",
                        }}
                      >
                        △ {row.ip} in progress
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#E24B4A22",
                          color: "#E24B4A",
                        }}
                      >
                        ⚠ {row.st} struggling
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: T.pillBg,
                          color: T.text3,
                        }}
                      >
                        ○ {row.ut} untested
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {byLecture.length === 0 && (
            <p style={{ fontFamily: MONO, color: T.text3, fontSize: 14 }}>No objectives to display.</p>
          )}
        </div>
      )}
    </div>
  );
}

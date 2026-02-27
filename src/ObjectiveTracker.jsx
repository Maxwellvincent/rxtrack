import { useState, useMemo } from "react";
import { useTheme } from "./theme";

const MONO = "'DM Mono','Courier New',monospace";

function LecObjectiveGroup({ group, objectives, onSelfRate, onQuiz, color, T }) {
  const [open, setOpen] = useState(false);

  const mastered = objectives.filter((o) => o.status === "mastered").length;
  const struggling = objectives.filter((o) => o.status === "struggling").length;
  const untested = objectives.filter((o) => o.status === "untested").length;
  const pct = objectives.length ? Math.round((mastered / objectives.length) * 100) : 0;

  return (
    <div
      style={{
        border: "1px solid " + T.border1,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 8,
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
        <span style={{ fontFamily: MONO, color: T.text1, fontSize: 16, fontWeight: 500, flex: 1 }}>
          {group.lectureTitle}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {mastered > 0 && (
            <span style={{ fontFamily: MONO, color: T.green, fontSize: 16 }}>✓{mastered}</span>
          )}
          {struggling > 0 && (
            <span style={{ fontFamily: MONO, color: T.red, fontSize: 16 }}>⚠{struggling}</span>
          )}
          {untested > 0 && (
            <span style={{ fontFamily: MONO, color: T.text3, fontSize: 16 }}>○{untested}</span>
          )}
        </div>
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
              width: pct + "%",
              height: "100%",
              background: pct === 100 ? T.green : pct > 50 ? T.amber : color,
              borderRadius: 2,
              transition: "width 0.4s",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: MONO,
            color: pct === 100 ? T.green : T.text3,
            fontSize: 12,
            minWidth: 30,
            textAlign: "right",
          }}
        >
          {pct}%
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onQuiz(objectives, group.lectureTitle);
          }}
          style={{
            background: color,
            border: "none",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          Quiz →
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectiveRow({ obj, index, onSelfRate, T, color, hasLecture }) {
  const statusColorToken =
    { mastered: T.green, struggling: T.red, inprogress: T.amber, untested: T.text3 }[obj.status] ??
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
          }}
        >
          {obj.objective}
        </p>
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
        {hasLecture != null && (
          hasLecture ? (
            <span title="Lecture uploaded" style={{ fontFamily: MONO, color: T.green, fontSize: 10, background: T.greenBg || (T.green + "22"), padding: "1px 5px", borderRadius: 3, marginTop: 4, display: "inline-block" }}>
              📖 linked
            </span>
          ) : (
            <span title="No lecture uploaded yet" style={{ fontFamily: MONO, color: T.text3, fontSize: 10, background: T.pillBg, padding: "1px 5px", borderRadius: 3, marginTop: 4, display: "inline-block" }}>
              📭 no lecture
            </span>
          )
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
  onSelfRate,
  onStartObjectiveQuiz,
  termColor,
  T: TProp,
}) {
  const theme = useTheme();
  const T = TProp ?? theme.T;
  const color = termColor ?? T.red;

  const [subView, setSubView] = useState("lecture");

  const linkedObjectives = useMemo(() => {
    return (objectives || []).map((obj) => {
      const matchedLec = blockLectures.find(
        (lec) =>
          lec.lectureNumber === obj.lectureNumber ||
          (lec.lectureTitle &&
            obj.lectureTitle &&
            lec.lectureTitle.toLowerCase().includes((obj.lectureTitle || "").toLowerCase().slice(0, 20))) ||
          (obj.activity &&
            lec.lectureNumber &&
            (obj.activity.replace(/\D/g, "") === String(lec.lectureNumber)))
      );
      return { ...obj, linkedLecId: matchedLec?.id || null, hasLecture: !!matchedLec };
    });
  }, [objectives, blockLectures]);

  const byLecture = useMemo(() => {
    const map = new Map();
    for (const o of linkedObjectives) {
      const key = o.activity || o.lectureTitle || "Other";
      if (!map.has(key)) {
        map.set(key, {
          activity: o.activity || key,
          discipline: o.discipline || "",
          lectureTitle: o.lectureTitle || key,
          objectives: [],
        });
      }
      map.get(key).objectives.push(o);
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.activity).localeCompare(String(b.activity), undefined, { numeric: true })
    );
  }, [linkedObjectives]);

  const untested = linkedObjectives.filter((o) => o.status === "untested");
  const needsWork = linkedObjectives.filter(
    (o) => o.status === "struggling" || o.status === "inprogress"
  );
  const mastered = linkedObjectives.filter((o) => o.status === "mastered");

  const pills = [
    { key: "lecture", label: "📋 By Lecture" },
    { key: "status", label: "🎯 By Status" },
    { key: "coverage", label: "📊 Coverage" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 4px 24px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {pills.map((p) => (
          <button
            key={p.key}
            onClick={() => setSubView(p.key)}
            style={{
              background: subView === p.key ? color + "22" : T.inputBg,
              border: "1px solid " + (subView === p.key ? color : T.border1),
              color: subView === p.key ? color : T.text3,
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
        ))}
      </div>

      {subView === "lecture" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {byLecture.map((group) => (
            <LecObjectiveGroup
              key={group.activity}
              group={group}
              objectives={group.objectives}
              onSelfRate={onSelfRate}
              onQuiz={onStartObjectiveQuiz}
              color={color}
              T={T}
            />
          ))}
          {byLecture.length === 0 && (
            <p style={{ fontFamily: MONO, color: T.text3, fontSize: 16 }}>
              No objectives loaded. Seed data in ftm2Objectives.json or load from storage.
            </p>
          )}
        </div>
      )}

      {subView === "status" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
            alignItems: "stretch",
            minHeight: 200,
          }}
        >
          <Column
            title="Untested"
            count={untested.length}
            objectives={untested}
            onSelfRate={onSelfRate}
            T={T}
            color={color}
          />
          <Column
            title="In Progress / Struggling"
            count={needsWork.length}
            objectives={needsWork}
            onSelfRate={onSelfRate}
            T={T}
            color={color}
          />
          <Column
            title="Mastered"
            count={mastered.length}
            objectives={mastered}
            onSelfRate={onSelfRate}
            T={T}
            color={color}
          />
        </div>
      )}

      {subView === "coverage" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {byLecture.map((group) => (
            <div
              key={group.activity}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  color: T.text3,
                  fontSize: 12,
                  minWidth: 50,
                }}
              >
                {group.activity}
              </span>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {group.objectives.map((obj) => (
                  <div
                    key={obj.id}
                    title={(obj.objective || "").slice(0, 100) + (obj.objective?.length > 100 ? "..." : "")}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      cursor: "default",
                      background:
                        obj.status === "mastered"
                          ? T.green
                          : obj.status === "struggling"
                            ? T.red
                            : obj.status === "inprogress"
                              ? T.amber
                              : T.border1,
                      transition: "transform 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.6)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                  />
                ))}
              </div>
              <span style={{ fontFamily: MONO, color: T.text3, fontSize: 11 }}>
                {group.objectives.filter((o) => o.status === "mastered").length}/
                {group.objectives.length}
              </span>
            </div>
          ))}
          {byLecture.length === 0 && (
            <p style={{ fontFamily: MONO, color: T.text3, fontSize: 16 }}>No objectives to display.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Column({ title, count, objectives, onSelfRate, T, color }) {
  return (
    <div
      style={{
        background: T.cardBg,
        border: "1px solid " + T.border1,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid " + T.border1,
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 700,
          color: T.text1,
        }}
      >
        {title} ({count})
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          maxHeight: 360,
        }}
      >
        {objectives.map((obj) => (
          <div
            key={obj.id}
            style={{
              padding: "8px 14px",
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
                fontSize: 10,
                background: T.pillBg,
                padding: "2px 5px",
                borderRadius: 3,
                flexShrink: 0,
              }}
            >
              {obj.activity}
            </span>
            <p
              style={{
                fontFamily: MONO,
                color: T.text1,
                fontSize: 12,
                lineHeight: 1.5,
                margin: 0,
                flex: 1,
              }}
            >
              {(obj.objective || "").slice(0, 120)}
              {(obj.objective || "").length > 120 ? "…" : ""}
            </p>
            <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
              {["struggling", "inprogress", "mastered"].map((s) => (
                <button
                  key={s}
                  onClick={() => onSelfRate(obj.id, s)}
                  title={s}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: "1px solid " + T.border1,
                    background: obj.status === s ? (s === "mastered" ? T.green : s === "struggling" ? T.red : T.amber) + "22" : "transparent",
                    color: obj.status === s ? (s === "mastered" ? T.green : s === "struggling" ? T.red : T.amber) : T.text3,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {s === "mastered" ? "✓" : s === "struggling" ? "⚠" : "◐"}
                </button>
              ))}
            </div>
          </div>
        ))}
        {objectives.length === 0 && (
          <p style={{ fontFamily: MONO, color: T.text3, fontSize: 12, padding: 12 }}>
            None
          </p>
        )}
      </div>
    </div>
  );
}

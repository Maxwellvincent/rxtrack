// mergeSchedule.js — pure merge of block descriptors into RXTrack's stores.
// Returns NEW {terms, examDates, lectures} + a change summary; performs no I/O.
// Non-destructive: reuses existing blocks/lectures by identity, never clobbers
// uploaded lectures. The UI writes the result back + pushes to the cloud.

const defaultId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "b" + Math.random().toString(36).slice(2));

const norm = (s) => String(s || "").trim().toLowerCase();

// Firestore rejects `undefined`. Coerce undefined → null on shallow object fields
// so both our new stubs and any pre-existing lectures push cleanly.
const noUndef = (obj) => {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = obj[k] === undefined ? null : obj[k];
  return out;
};

export function mergeScheduleIntoStores(blocks, existing, opts = {}) {
  const { termName = "Term 2", idgen = defaultId, color = "#2563eb" } = opts;
  const terms = structuredClone(existing.terms || []);
  const examDates = { ...(existing.examDates || {}) };
  const lectures = [...(existing.lectures || [])];
  // blockId → [{activity, number, date, start, end, location}]. Replaced per
  // block on re-import: the schedule .md is the source of truth for them.
  const assessments = { ...(existing.assessments || {}) };
  const summary = { blocksAdded: 0, blocksUpdated: 0, examDatesSet: 0, lecturesAdded: 0, assessmentsSet: 0 };

  let term = terms.find((t) => norm(t.name) === norm(termName));
  if (!term) { term = { id: idgen(), name: termName, color, blocks: [] }; terms.push(term); }
  term.blocks = term.blocks || [];

  // Index existing lectures by blockId+number so we never re-add or clobber one.
  const lecKey = (blockId, number) => `${blockId}::${number}`;
  const haveLec = new Set(lectures.map((l) => lecKey(l.blockId, l.lectureNumber)));

  for (const desc of blocks) {
    let block = term.blocks.find((b) => norm(b.name) === norm(desc.name));
    if (block) {
      block.startDate = desc.startDate || block.startDate;
      summary.blocksUpdated += 1;
    } else {
      block = { id: idgen(), name: desc.name, type: "standard", status: "upcoming",
        startDate: desc.startDate || null, createdAt: new Date().toISOString() };
      term.blocks.push(block);
      summary.blocksAdded += 1;
    }

    if (desc.examDate) { examDates[block.id] = desc.examDate; summary.examDatesSet += 1; }

    if (desc.assessments?.length) {
      assessments[block.id] = desc.assessments.map((a) => noUndef({ ...a, blockId: block.id }));
      summary.assessmentsSet += desc.assessments.length;
    }

    for (const lec of desc.lectures || []) {
      const k = lecKey(block.id, lec.number);
      if (haveLec.has(k)) continue;
      haveLec.add(k);
      lectures.push({
        id: idgen(), blockId: block.id, termId: term.id, lectureType: "LEC", lectureNumber: lec.number,
        filename: `${desc.system} LEC ${String(lec.number).padStart(2, "0")}`,
        // `lectureDate` is the field every consumer reads (App's getAvailableDate,
        // shell/logic/schedule.js, Tracker). This used to write only `date`, which
        // nothing reads — so imported lectures looked undated and the day planner
        // silently placed nothing. `date` stays for the records already written.
        lectureDate: lec.date || null,
        date: lec.date || null,
        createdAt: new Date().toISOString(),
      });
      summary.lecturesAdded += 1;
    }
  }

  // Backfill termId on pre-existing lectures whose block lives in this term, then
  // Firestore-sanitize every lecture (no undefined fields).
  const blockIdsInTerm = new Set(term.blocks.map((b) => b.id));
  const cleanLectures = lectures.map((l) => {
    const termId = l.termId ?? (blockIdsInTerm.has(l.blockId) ? term.id : null);
    return noUndef({ ...l, termId });
  });

  return { terms, examDates, lectures: cleanLectures, assessments, summary };
}

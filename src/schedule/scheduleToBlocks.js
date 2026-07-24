// scheduleToBlocks.js — map parsed schedule events → RXTrack block descriptors.
// One block per system (ER/DM/NB), each with a start date (first event), an exam
// date (earliest matching-system Exam), and its lecture list. Pure — the UI decides
// how to merge these into the live rxt-terms / rxt-lec-meta / rxt-exam-dates stores.

const SYSTEM_NAMES = {
  ER: "Endocrine & Reproductive",
  DM: "Diabetes & Metabolism",
  NB: "Nervous System & Behavior",
};

export function scheduleToBlocks(events = []) {
  const order = [];
  const bySystem = new Map();
  for (const e of events) {
    if (!e.system || !e.date) continue;
    if (!bySystem.has(e.system)) { bySystem.set(e.system, []); order.push(e.system); }
    bySystem.get(e.system).push(e);
  }

  // Cumulative exams ("BPM2 Exam NN", no system tag) are numbered by block order:
  // Exam 01 → 1st block, 02 → 2nd, … So an exam matches a block if it is
  // system-tagged for it OR its number equals the block's 1-based ordinal.
  const allExams = events.filter((e) => /exam/i.test(e.activity) && e.date && !/completion/i.test(e.location || ""));

  return order.map((system, idx) => {
    const ordinal = idx + 1;
    const evs = bySystem.get(system);
    const dates = evs.map((e) => e.date).filter(Boolean).sort();
    const startDate = dates[0] || null;

    const examDate = allExams
      .filter((e) => e.system === system || e.number === ordinal)
      .map((e) => e.date)
      .sort()[0] || null;

    const seen = new Set();
    const lectures = evs
      .filter((e) => e.activity === "lecture" && e.number != null)
      .filter((e) => (seen.has(e.number) ? false : seen.add(e.number)))
      .sort((a, b) => a.number - b.number)
      .map((e) => ({ number: e.number, date: e.date }));

    return { system, name: SYSTEM_NAMES[system] || system, startDate, examDate, lectures };
  });
}

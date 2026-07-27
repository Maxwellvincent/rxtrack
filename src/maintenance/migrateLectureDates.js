/**
 * One-shot: copy imported lecture dates onto the field the app actually reads.
 *
 *   const m = await import("/src/maintenance/migrateLectureDates.js");
 *   await m.runLectureDateMigration({ userId, dryRun: true });
 *   await m.runLectureDateMigration({ userId });
 *
 * The schedule importer wrote the parsed date as `date`; every consumer reads
 * `lectureDate`. So 139 lectures across Term 2 carried a real timetable date
 * that nothing could see, the day planner placed nothing, and Today fell back
 * to ranking by urgency. The importer is fixed; this repairs what it already
 * wrote.
 */
import * as lecturesStore from "../stores/lectures.js";
import { pushAllLocalDataToSupabase } from "../supabase.js";

/** Pure: returns the repaired list plus what changed. */
export function migrateLectureDates(lectures) {
  const changed = [];
  const next = (lectures || []).map((lecture) => {
    if (!lecture || lecture.lectureDate || !lecture.date) return lecture;
    changed.push({ id: lecture.id, blockId: lecture.blockId, date: lecture.date });
    return { ...lecture, lectureDate: lecture.date };
  });
  return { lectures: next, changed };
}

export async function runLectureDateMigration({ userId, dryRun = false } = {}) {
  const lectures = lecturesStore.read(userId) || [];
  const { lectures: next, changed } = migrateLectureDates(lectures);

  const byBlock = changed.reduce((acc, c) => {
    acc[c.blockId] = (acc[c.blockId] || 0) + 1;
    return acc;
  }, {});
  const report = { dryRun, total: lectures.length, repaired: changed.length, byBlock, pushed: false };

  if (dryRun || !changed.length) return report;

  lecturesStore.write(userId, next);
  // Lecture docs merge field-wise in the cloud, so a normal push is enough —
  // this only ADDS a field, it never has to remove one.
  if (userId) {
    await pushAllLocalDataToSupabase(userId);
    report.pushed = true;
  }
  return report;
}

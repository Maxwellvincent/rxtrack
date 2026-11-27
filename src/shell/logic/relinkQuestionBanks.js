// Re-link every saved school question bank to its lectures. For each bank:
// find its home block and focus week(s) from the questions themselves
// (bankMappingScope.js), then run the checkpointed two-pass mapping against
// that block, then the no-AI week rescue. Banks run one at a time; a failure
// pauses that bank (completed links stay saved) and the run moves on.

import * as banksStore from "../../stores/questionBanks.js";
import * as metaStore from "../../stores/questionBankMeta.js";
import * as lecturesStore from "../../stores/lectures.js";
import * as objectivesStore from "../../stores/blockObjectives.js";
import { bankMappingScope } from "./bankMappingScope.js";
import { resumeQuestionBankMapping, questionKey } from "./resumeQuestionBankMapping.js";
import { rankLectureContent } from "./lectureContentMatch.js";

const NON_TEACHING_BLOCKS = new Set(["cbse-prep"]);

/** Banks worth linking: keyed questions, in a block with lectures or CBSE Prep. */
export function relinkCandidates(meta = {}, banks = {}) {
  return Object.values(meta || {})
    .filter(entry => entry?.filename && Array.isArray(banks?.[entry.filename]) && banks[entry.filename].some(question => question?.correct))
    .map(entry => ({ filename: entry.filename, blockId: entry.blockId, sourceKind: entry.sourceKind || null, questions: banks[entry.filename] }));
}

/** Blocks a bank may be homed in: its own term's teaching blocks. */
export function candidateBlocks(lectures = [], bankBlockId) {
  const teaching = [...new Set(lectures.map(lecture => lecture?.blockId).filter(id => id && !NON_TEACHING_BLOCKS.has(id)))];
  const termOf = Object.fromEntries(lectures.filter(lecture => lecture?.blockId && lecture.termId).map(lecture => [lecture.blockId, lecture.termId]));
  // A bank filed outside a teaching block (CBSE Prep) belongs to the current
  // term: the term of the most recently taught lecture.
  const latest = [...lectures].filter(lecture => lecture?.termId && (lecture.lectureDate || lecture.date))
    .sort((a, b) => String(b.lectureDate || b.date).localeCompare(String(a.lectureDate || a.date)))[0];
  const term = termOf[bankBlockId] || latest?.termId;
  return term ? teaching.filter(id => termOf[id] === term) : teaching;
}

/**
 * Cumulative quizzes (ESoft, IMCQ) test several blocks, but a bank has one
 * home block. Route each unlinked, keyed question to the block whose lecture
 * text matches it best, so it is checked there first instead of spending AI
 * calls in a block that never taught it. Questions with no clear match stay
 * with the home block. Returns Map(blockId -> Set(questionKey)).
 */
export function routeUnlinkedQuestions({ questions = [], lectures = [], homeBlockId, filename = "" }) {
  const routes = new Map();
  questions.forEach((question, index) => {
    if (!question?.stem || !question.correct || question.lectureId) return;
    if (["user-confirmed", "evidence-verified"].includes(question.curriculumLinkStatus)) return;
    const [top] = rankLectureContent({ ...question, sourceTitle: filename }, lectures, null).filter(row => row.contentScore > 0);
    const blockId = top && top.bodyEvidence.length >= 2 ? top.lecture.blockId : homeBlockId;
    if (!routes.has(blockId)) routes.set(blockId, new Set());
    routes.get(blockId).add(questionKey(question, index));
  });
  return routes;
}

export async function relinkAllQuestionBanks({ userId, filenames = null, aiMapping = true, onProgress = () => {} } = {}, deps = {}) {
  const readBanks = deps.readBanks || banksStore.read;
  const readMeta = deps.readMeta || metaStore.read;
  const readLectures = deps.readLectures || lecturesStore.read;
  const readObjectives = deps.readObjectives || objectivesStore.read;
  const fetchContent = deps.fetchLectureContent || (await import("../../firebaseData.js")).fetchLectureContent;
  const resume = deps.resume || resumeQuestionBankMapping;

  const allLectures = (readLectures(userId) || []).filter(lecture => lecture?.id && !lecture.mergedInto);
  const objectivesByBlock = readObjectives(userId) || {};
  let jobs = relinkCandidates(readMeta(userId), readBanks(userId));
  if (filenames) jobs = jobs.filter(job => filenames.includes(job.filename));

  const content = new Map();
  const withText = async lectures => {
    const out = [];
    for (const lecture of lectures) {
      if (!content.has(lecture.id)) {
        const loaded = await fetchContent(userId, lecture.id).catch(() => null);
        content.set(lecture.id, { ...lecture, chunks: loaded?.chunks || lecture.chunks || [], atoms: loaded?.atoms || lecture.atoms || [] });
      }
      out.push(content.get(lecture.id));
    }
    return out;
  };

  const results = [];
  for (const [index, job] of jobs.entries()) {
    onProgress({ phase: "scope", index, total: jobs.length, filename: job.filename });
    const blocks = candidateBlocks(allLectures, job.blockId);
    const lectures = await withText(allLectures.filter(lecture => blocks.includes(lecture.blockId) || lecture.blockId === job.blockId));
    const scope = bankMappingScope({ filename: job.filename, sourceKind: job.sourceKind, bankBlockId: job.blockId, questions: job.questions, lectures, candidateBlockIds: blocks });
    if (!scope.homeBlockId) { results.push({ filename: job.filename, status: "skipped", reason: "No teaching block matched" }); continue; }
    try {
      // Questions whose text clearly belongs to another teaching block are
      // checked there; the home pass takes the rest (and the week rescue).
      const pool = lectures.filter(lecture => lecture.blockId && !NON_TEACHING_BLOCKS.has(lecture.blockId));
      const routes = aiMapping ? routeUnlinkedQuestions({ questions: readBanks(userId)?.[job.filename] || job.questions, lectures: pool, homeBlockId: scope.homeBlockId, filename: job.filename }) : new Map();
      const away = new Set([...routes].filter(([blockId]) => blockId !== scope.homeBlockId).flatMap(([, keys]) => [...keys]));
      const state = await resume({
        userId, blockId: job.blockId, filename: job.filename, recheck: true, aiMapping, scope,
        ...(away.size ? { onlyKeys: new Set((readBanks(userId)?.[job.filename] || job.questions).map((question, i) => questionKey(question, i)).filter(key => !away.has(key))) } : {}),
        lectures: lectures.filter(lecture => lecture.blockId === scope.homeBlockId),
        objectives: objectivesByBlock[scope.homeBlockId] || [],
        onProgress: status => onProgress({ phase: "mapping", index, total: jobs.length, filename: job.filename, evaluated: status.evaluated || 0, of: status.total || 0 }),
      });
      let final = state;
      const crossBlock = {};
      for (const [routedBlockId, keys] of routes) {
        if (routedBlockId === scope.homeBlockId || final.status !== "complete") continue;
        const before = final.lectureLinked || 0;
        final = await resume({
          userId, blockId: job.blockId, filename: job.filename, recheck: true, aiMapping, onlyKeys: keys, crossBlock: true,
          scope: { homeBlockId: routedBlockId, focusLectureIds: [], focusWeeks: [] },
          lectures: lectures.filter(lecture => lecture.blockId === routedBlockId),
          objectives: objectivesByBlock[routedBlockId] || [],
          onProgress: status => onProgress({ phase: "mapping", index, total: jobs.length, filename: job.filename, blockId: routedBlockId, evaluated: status.evaluated || 0, of: keys.size }),
        });
        crossBlock[routedBlockId] = { tried: keys.size, linked: Math.max(0, (final.lectureLinked || 0) - before) };
      }
      results.push({ filename: job.filename, scope, status: final.status, linked: final.linked, lectureLinked: final.lectureLinked, weekRescued: state.weekRescued || 0, crossBlock, error: final.error || null });
    } catch (error) {
      results.push({ filename: job.filename, scope, status: "paused", error: error.message });
    }
  }
  onProgress({ phase: "done", total: jobs.length });
  return results;
}

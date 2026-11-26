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
import { resumeQuestionBankMapping } from "./resumeQuestionBankMapping.js";

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
      const state = await resume({
        userId, blockId: job.blockId, filename: job.filename, recheck: true, aiMapping, scope,
        lectures: lectures.filter(lecture => lecture.blockId === scope.homeBlockId),
        objectives: objectivesByBlock[scope.homeBlockId] || [],
        onProgress: status => onProgress({ phase: "mapping", index, total: jobs.length, filename: job.filename, evaluated: status.evaluated || 0, of: status.total || 0 }),
      });
      results.push({ filename: job.filename, scope, status: state.status, linked: state.linked, lectureLinked: state.lectureLinked, weekRescued: state.weekRescued || 0, error: state.error || null });
    } catch (error) {
      results.push({ filename: job.filename, scope, status: "paused", error: error.message });
    }
  }
  onProgress({ phase: "done", total: jobs.length });
  return results;
}

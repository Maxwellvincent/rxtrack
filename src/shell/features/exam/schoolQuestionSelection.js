import { readSlot, objectiveSubject, bpmObjective } from "./bpmBlueprint.js";
import { cleanSchoolQuestion } from "../../../engine/schoolSourceText.js";
import { prepareQuestionBankQuestions, validBankQuestion } from "./launchQuestionBank.js";
import { questionEvidenceKey } from "../../../stores/learnerEvidence.js";

const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
export function schoolQuestionIdentity(question) {
  question = cleanSchoolQuestion(question);
  return questionEvidenceKey(JSON.stringify([normalize(question.stem), Object.values(question.choices || {}).map(normalize).sort(), normalize(question.choices?.[question.correct])]));
}

// Preserve the original key and verified curriculum links. An uncertain match
// must never fill another lecture's allocated slot or claim objective credit.
export function selectSchoolQuestions({ banks = [], lectures = [], blockId, allocation = {}, objectivesByLecture = {}, history = [], includeSeen = false }) {
  const seen = new Set(history.map(schoolQuestionIdentity));
  const stems = history.map(q => normalize(q.stem)).filter(Boolean);
  const selected = [], identities = new Set(), remaining = { ...allocation };
  for (const bank of banks) {
    if (bank.blockId !== blockId && !Object.keys(allocation).some(key=>readSlot(key).subject)) continue;
    for (const original of bank.questions || []) {
      const [question] = prepareQuestionBankQuestions([original], { filename: bank.filename, blockId: bank.blockId || blockId, lectures, analysis: bank.analysis });
      if (!validBankQuestion(question)) continue;
      const allocationId = Object.keys(remaining).find(key => {
        const {lectureId,subject}=readSlot(key);
        if(!remaining[key] || lectureId!==question.lectureId)return false;
        return !subject || (objectivesByLecture[lectureId]||[]).some(o=>bpmObjective(o)&&objectiveSubject(o)===subject&&(question.objectiveIds||[]).some(id=>id===o.id||id===o.code));
      });
      if(!allocationId)continue;
      const key = schoolQuestionIdentity(question);
      const stem = normalize(question.stem);
      const previouslySeen = seen.has(key) || stems.some(old => old === stem || (old.length >= 80 && stem.startsWith(old)));
      if (identities.has(key) || (!includeSeen && previouslySeen)) continue;
      identities.add(key); remaining[allocationId]--;
      selected.push({ ...question, ...(readSlot(allocationId).subject ? {blueprintSlot:allocationId,blueprintSubject:readSlot(allocationId).subject,sourceBlockId:bank.blockId || blockId} : {}), questionId: `school:${key}`, exposure: previouslySeen ? "review" : "unseen" });
    }
  }
  return { questions: selected, allocation: Object.fromEntries(Object.entries(remaining).filter(([, count]) => count > 0)) };
}

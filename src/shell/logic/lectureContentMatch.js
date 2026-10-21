import { cleanLectureTitle } from "../../lectureTitle.js";
// Local curriculum attribution. This does not validate a source key or certify
// objective mastery; only distinctive, unambiguous lecture matches activate.
const GENERIC = new Set('the and with from that this which most likely patient physician year old history following describe explain identify function functions anatomy general introduction overview updated lecture lectures cranial nerve nerves system systems clinical basic principles medicine structures structure physiology development'.split(' '));
const canonical = word => ({ laryngeal: 'larynx', larynges: 'larynx', pharyngeal: 'pharynx', pharynges: 'pharynx' }[word] || word.replace(/s$/, ''));
const terms = value => (String(value || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter(word => !GENERIC.has(word)).map(canonical).filter(word => !GENERIC.has(word));
const titleOf = lecture => lecture.lectureTitle || lecture.title || lecture.fileName || lecture.filename || '';

const documentCache = new WeakMap();

export function rankLectureContent(question, lectures = [], blockId) {
  const query = terms([question.stem, question.topic, question.sourceSectionTitle, question.choices?.[question.correct], question.schoolQuestionTopic, question.schoolLearningOutcomes].filter(Boolean).join(' '));
  const frequency = new Map();
  for (const word of query) frequency.set(word, (frequency.get(word) || 0) + 1);
  const documents = lectures.filter(l => (!blockId || !l.blockId || l.blockId === blockId) && !/^(?:DLA|SG|TBL)$/i.test(l.lectureType || '')).map(lecture => {
    const cached = documentCache.get(lecture);
    if (cached) return cached;
    const map = lecture.teachingMap || {};
    const body = [map.summary, map.clinicalHook, ...(lecture.chunks || []).flatMap(c => [c.markdown, c.content, c.text]), ...(lecture.atoms || []).flatMap(a => [a.term, a.content])].join(' ');
    const document = { lecture, title: new Set(terms([titleOf(lecture), lecture.fileName, lecture.filename, ...(lecture.sourceFiles || []).map(file => cleanLectureTitle(file.filename))].filter(Boolean).join(" "))), body: new Set(terms(body)) };
    documentCache.set(lecture, document);
    return document;
  });
  const documentFrequency = word => documents.filter(d => d.title.has(word) || d.body.has(word)).length;
  const weight = word => 1 + Math.log((documents.length + 1) / (1 + documentFrequency(word)));
  return documents.map(({ lecture, title, body }) => {
    const titleEvidence = [...title].filter(word => frequency.has(word));
    const bodyEvidence = [...frequency.keys()].filter(word => body.has(word));
    const score = titleEvidence.reduce((sum, word) => sum + 30 * weight(word) * Math.min(2, frequency.get(word)), 0)
      + Math.min(20, bodyEvidence.reduce((sum, word) => sum + weight(word), 0));
    const distinctive = titleEvidence.length >= 2 || titleEvidence.some(word => frequency.get(word) >= 2);
    return { lecture, score, titleEvidence, bodyEvidence, distinctive };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
}

export function automaticLectureContentMatch(question, lectures, blockId) {
  const [best, runnerUp] = rankLectureContent(question, lectures, blockId);
  if (!best?.distinctive || best.score < 60) return null;
  if (runnerUp && (best.score - runnerUp.score < 20 || best.score < runnerUp.score * 1.35)) return null;
  return best;
}

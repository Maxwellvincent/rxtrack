import { curriculumSourceContext } from "../../engine/curriculumMappingContext.js";
import { cleanLectureTitle } from "../../lectureTitle.js";
// Local curriculum attribution. This does not validate a source key or certify
// objective mastery; only distinctive, unambiguous lecture matches activate.
const GENERIC = new Set('the and with from that this which most likely patient physician year old history following describe explain identify function functions anatomy general introduction overview updated lecture lectures cranial nerve nerves system systems clinical basic principles medicine structures structure physiology development'.split(' '));
const canonical = word => ({ ocular: 'eye', orbital: 'eye', orbit: 'eye', ophthalmic: 'eye', eyes: 'eye', laryngeal: 'larynx', larynges: 'larynx', pharyngeal: 'pharynx', pharynges: 'pharynx' }[word] || word.replace(/s$/, ''));
const terms = value => (String(value || '').toLowerCase().match(/\b(?:eye|[a-z]{4,})\b/g) || []).filter(word => !GENERIC.has(word)).map(canonical).filter(word => !GENERIC.has(word));
const titleOf = lecture => lecture.lectureTitle || lecture.title || lecture.fileName || lecture.filename || '';

const documentCache = new WeakMap();

export function rankLectureContent(question, lectures = [], blockId) {
  const query = terms([question.stem, question.topic, question.choices?.[question.correct], question.schoolQuestionTopic, question.schoolLearningOutcomes].filter(Boolean).join(' '));
  const sourceContext = curriculumSourceContext(question);
  const headingTerms = new Set(terms([question.sourceSectionTitle, question.sourceSection, question.sourceTitle, question.sourceFile, question.sourceFilename].filter(Boolean).join(' ')));
  // Recognize the clinical teaching domain from findings, never from distractors
  // or the keyed opening alone. Two independent ocular findings are required.
  const stem = String(question.stem || '').toLowerCase();
  const ocularFindings = [/\b(?:eye|eyes|ocular|orbital)\b/, /double vision|diplopia/, /adduct|abduct|extraocular|oculomotor/, /corneal reflex|pupillary reflex/].filter(pattern => pattern.test(stem)).length;
  const frequency = new Map();
  for (const word of query) frequency.set(word, (frequency.get(word) || 0) + 1);
  const documents = lectures.filter(l => (!blockId || !l.blockId || l.blockId === blockId) && !/^(?:DLA|SG|TBL)$/i.test(l.lectureType || '')).map(lecture => {
    const cached = documentCache.get(lecture);
    if (cached) return cached;
    const map = lecture.teachingMap || {};
    const body = [map.summary, map.clinicalHook, ...(lecture.chunks || []).flatMap(c => [c.markdown, c.content, c.text]), lecture.extractedText, lecture.fullText, lecture.content, ...(lecture.atoms || []).flatMap(a => [a.term, a.content])].join(' ');
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
    const contentSupported = bodyEvidence.length >= 2;
    const headingEvidence = [...title].filter(word => headingTerms.has(word));
    const clinicalEvidence = [...new Set(terms(question.stem))].filter(word => word !== 'eye' && body.has(word));
    const clinicalDomain = ocularFindings >= 2 && title.has('eye') && clinicalEvidence.length >= 2;
    const distinctive = (!(ocularFindings >= 2 && title.has('eye')) || clinicalDomain) && (titleEvidence.length >= 2 || titleEvidence.some(word => frequency.get(word) >= 2) || clinicalDomain || (headingEvidence.length > 0 && contentSupported));
    const contextualEvidence = [];
    let contextScore = 0;
    if (clinicalDomain) { contextScore += 85; contextualEvidence.push('ocular-findings-and-lecture-content'); }
    if (distinctive && headingEvidence.length) { contextScore += 45; contextualEvidence.push('source-heading'); }
    if (distinctive && !sourceContext.conflictingWeeks) {
      if (sourceContext.lectureDate && String(lecture.lectureDate || '').slice(0,10) === sourceContext.lectureDate) { contextScore += 40; contextualEvidence.push('source-date'); }
      else if (!sourceContext.lectureDate && sourceContext.weekNumber != null && Number(lecture.weekNumber) === sourceContext.weekNumber) { contextScore += 30; contextualEvidence.push('source-week'); }
    }
    return { lecture, score: score + contextScore, contentScore: score, titleEvidence, bodyEvidence, contextualEvidence, distinctive };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
}

export function automaticLectureContentMatch(question, lectures, blockId) {
  const [best, runnerUp] = rankLectureContent(question, lectures, blockId);
  if (!best?.distinctive || best.score < 60) return null;
  const scheduleBreaksContentTie = runnerUp && best.contentScore === runnerUp.contentScore
    && best.contextualEvidence.some(e => e === 'source-week' || e === 'source-date')
    && !runnerUp.contextualEvidence.some(e => e === 'source-week' || e === 'source-date');
  if (runnerUp && (best.score - runnerUp.score < 20 || (!scheduleBreaksContentTie && best.score < runnerUp.score * 1.35))) return null;
  return best;
}

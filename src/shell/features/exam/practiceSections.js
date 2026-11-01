/** Source sections are navigation groups, never new curriculum/coverage evidence. */
export function practiceSection(question, labels = {}) {
  const section = String(question.sourceSection || '').trim();
  if (section) return { key: `source:${section.toUpperCase().replace(/\s+/g, '')}`, label: section, title: String(question.sourceSectionTitle || '').trim() };
  if (question.lectureId) return { key: `lecture:${question.lectureId}`, label: labels[question.lectureId] || question.lectureLabel || question.lectureTitle || 'Linked lecture', title: '' };
  return { key: 'unassigned', label: 'Section not identified', title: '' };
}

export function practiceSections(questions = [], answers = [], labels = {}, { scoringExcludedQuestionIds = [] } = {}) {
  const excluded = new Set(scoringExcludedQuestionIds);
  const answerMap = new Map(answers.filter(a => a.value != null).map(a => [a.questionId, a]));
  const answered = new Set(answers.filter(a => a.value != null).map(a => a.questionId));
  const groups = new Map();
  questions.forEach((q, index) => {
    const section = practiceSection(q, labels);
    const row = groups.get(section.key) || { ...section, indices: [], answered: 0, scored: 0, correct: 0, pending: 0 };
    row.indices.push(index);
    if (answered.has(q.questionId)) row.answered++;
    const answer = answerMap.get(q.questionId);
    if (answer && answer.revealed === false) row.pending++;
    if (answer && answer.revealed !== false && q.correct && !excluded.has(q.questionId)) {
      row.scored++;
      if (answer.value === q.correct) row.correct++;
    }
    row.accuracy = row.scored ? Math.round(100 * row.correct / row.scored) : null;
    groups.set(section.key, row);
  });
  return [...groups.values()];
}

export function sectionQuestionIndices(sections, selectedKeys = []) {
  return sections.filter(s => !selectedKeys.length || selectedKeys.includes(s.key)).flatMap(s => s.indices).sort((a,b) => a-b);
}

export function firstSectionQuestion(indices, questions, answers = []) {
  const answered = new Set(answers.filter(a => a.value != null).map(a => a.questionId));
  return indices.find(i => !answered.has(questions[i]?.questionId)) ?? indices[0] ?? 0;
}

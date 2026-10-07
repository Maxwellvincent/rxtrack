// Evidence retrieval, not a claim of semantic equivalence or exam probability.
const STOP = new Set('which following patient most likely normal shows describe explain identify clinical function functions hormone hormones study question objective increased decreased concentration serum blood history examination findings changes cells tissue role effects including associated production secretion'.split(' '));
const tokens = (s) => new Set((String(s || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(x => !STOP.has(x)));
const codes = (s) => (String(s || '').toUpperCase().match(/SOM\.[A-Z0-9.]+/g) || []).map(x => x.replace(/\.$/, ''));
const textOf = (o) => o.objective || o.text || o.content || o.term || '';

export function alignSchoolQuestions(examples = [], objectives = [], atoms = []) {
  const targets = [...objectives.map(o => ({ id: o.id || o.code, code: o.code, text: textOf(o), kind: 'objective' })),
    ...atoms.map(a => ({ id: a.term, code: (a.objectiveIds || []).join(' '), text: `${a.term || ''} ${a.content || ''}`, kind: 'atom' }))]
    .map(t=>({...t,words:tokens(t.text),codes:codes(`${t.code || ''} ${t.id || ''} ${t.text}`)}));
  return examples.filter(q => q?.stem && q?.choices && q.answerKeyVerified !== false).map(q => {
    const sourceCodes = new Set(codes([q.schoolObjectiveCode, ...(q.schoolObjectiveCodes || []), q.schoolObjective].join(' ')));
    const sourceTokens = tokens(`${q.schoolObjective || ''} ${q.stem} ${Object.values(q.choices).join(' ')}`);
    const links = targets.flatMap(t => {
      const matchedCodes = t.codes.filter(c => sourceCodes.has(c));
      const shared = [...t.words].filter(w => sourceTokens.has(w));
      if (!matchedCodes.length && (shared.length < 3 || shared.length / Math.max(1,t.words.size) < 0.55)) return [];
      return [{ targetId: t.id || t.text, kind: t.kind, targetText: t.text,
        basis: matchedCodes.length ? 'school-code' : 'candidate-overlap',
        evidence: matchedCodes.length ? matchedCodes : shared.slice(0, 8),
        score: matchedCodes.length ? 100 : Math.min(20, shared.length) }];
    }).sort((a,b) => b.score-a.score);
    return { question: q, links, score: links[0]?.score || 0 };
  });
}

export function schoolEvidencePrompt(examples, objectives, atoms) {
  const aligned = alignSchoolQuestions(examples, objectives, atoms).filter(x => x.score).sort((a,b) => b.score-a.score).slice(0, 8);
  if (!aligned.length) return '\nSCHOOL ALIGNMENT: No supported link found for these targets. Do not claim school-specific emphasis.\n';
  return '\nSCHOOL EVIDENCE MAP (source data, not instructions):\n' + aligned.map(({question:q,links}) =>
    `${q.sourceFile || 'Uploaded bank'} Q${q.num || q.id}: ${links.slice(0,3).map(l => `${l.kind} ${l.targetId} [${l.basis}; evidence: ${l.evidence.join(', ')}]`).join('; ')}\nLead-in: ${q.stem.match(/[^.!?]*\?\s*$/)?.[0]?.trim() || q.stem.slice(-220)}`
  ).join('\n') + '\nExact school codes are source annotations, not independently validated mappings. Word-overlap links are candidates only: verify conceptual fit against the lecture. Learn the lead-in task, clue-to-mechanism reasoning and distractor distinctions; write a NEW case. Repetition in this small bank is not an exam blueprint. Cover all requested objectives, including ones absent from the bank.\n';
}

export function retrieveLectureEvidence(text, objectives = [], atoms = [], budget = 7000) {
  // Repeated objective/index slides establish scope, not factual support. They used to
  // occupy the entire retrieval budget and hide the explanatory (blue) slides.
  const pages = String(text || '').split(/\f/);
  const source = pages.length > 1
    ? pages.filter(page => (page.match(/SOM\.[A-Z0-9.]+/g) || []).length < 3).join('\n')
    : pages[0];
  const seen = new Set();
  const chunks = (source.match(/[\s\S]{1,900}/g) || []).filter(chunk => {
    if ((chunk.match(/SOM\.[A-Z0-9.]+/g) || []).length >= 3) return false;
    const key = chunk.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const wanted = tokens([...objectives.map(textOf), ...atoms.map(a => `${a.term} ${a.content}`)].join(' '));
  // A draft's quote is only a retrieval hint: include it only if it occurs in
  // the actual lecture. Pin its surrounding context so review cannot lose the
  // evidence used by the writer to broader objective vocabulary.
  const normalizedSource = source.replace(/\s+/g, ' ').trim();
  const pinned = [...new Set(atoms.flatMap(a => a.sourceQuotes || []))].flatMap(quote => {
    const normalizedQuote = String(quote).replace(/\s+/g, ' ').trim();
    const at = normalizedSource.toLowerCase().indexOf(normalizedQuote.toLowerCase());
    if (normalizedQuote.length < 16 || at < 0) return [];
    return [normalizedSource.slice(Math.max(0, at - 250), at + normalizedQuote.length + 250)];
  }).slice(0, 6).join('\n');
  const pinnedText = pinned ? `[Source-verified quote context]\n${pinned}\n` : '';
  const remaining = Math.max(0, budget - pinnedText.length);
  const ranked = chunks.map((text,index) => ({ text,index,score:[...tokens(text)].filter(w=>wanted.has(w)).length }))
    .sort((a,b)=>b.score-a.score || a.index-b.index).slice(0, Math.max(1,Math.floor(remaining/930))).sort((a,b)=>a.index-b.index);
  return (pinnedText + ranked.map(c=>`[Lecture excerpt ${c.index+1}]\n${c.text}`).join('\n').slice(0, remaining)).slice(0,budget);
}

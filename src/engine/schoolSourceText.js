/** Page running heads can be joined to the last option during PDF extraction.
 * Strip only an explicit trailing question-range header, never clinical numbers.
 * Keep the extracted choices available for source comparison. */
export function cleanSchoolQuestion(question) {
  if (!question?.choices || typeof question.choices !== "object") return question;
  let changed = false;
  let recoveredLabels = false;
  const choices = Object.fromEntries(Object.entries(question.choices).map(([letter, value]) => {
    if (typeof value !== "string") return [letter, value];
    const cleaned = value.replace(/\s+Questions\s+\d{1,4}\s*[.:–—-]\s*\d{1,4}\s*$/i, "").trim();
    changed ||= cleaned !== value;
    return [letter, cleaned];
  }));
  // Older imports appended the next explicitly printed letter to the last option.
  // Only split a sequential uppercase label, never synthesize missing content.
  let last = Object.keys(choices).filter(key => /^[A-Z]$/.test(key)).sort().at(-1);
  while (last && last !== 'Z' && typeof choices[last] === 'string') {
    const next = String.fromCharCode(last.charCodeAt(0) + 1);
    const match = choices[last].match(new RegExp(`\\s+${next}[.)]\\s+(\\S[\\s\\S]*)$`));
    if (!match || choices[next]) break;
    const prefix = choices[last].slice(0, match.index).trim();
    if (!prefix) break;
    choices[last] = prefix;
    choices[next] = match[1].trim();
    changed = true;
    recoveredLabels = true;
    last = next;
  }
  return changed ? { ...question, choices, ...(recoveredLabels ? {sourceChoiceRecoveryVersion:1} : {}), sourceChoiceText: question.sourceChoiceText || question.choices } : question;
}

export function normalizeSessionSchoolChoices(session) {
 if (!session?.questions) return session;
 return {...session,questions:session.questions.map(q => q.sourceType === 'question-bank' || session.sourceType === 'question-bank' ? cleanSchoolQuestion(q) : q)};
}

/** Clean only prompt examples; do not rewrite saved originals or infer a key. */
export function cleanSchoolExemplar(question){
 const source=cleanSchoolQuestion(question);if(!source?.choices)return source;
 let changed=false;const choices=Object.fromEntries(Object.entries(source.choices).map(([k,v])=>{
  if(typeof v!=='string')return [k,v];
  const text=v.replace(/\s+SOM\.[A-Z0-9]+(?:\.[A-Z0-9]+){3,}[\s\S]*$/i,'').trim();changed ||=text!==v;return [k,text];
 }));
 let stem=String(source.stem||'');const repeat=stem.match(/^([\s\S]+?\?)\s+\d{1,4}\.\s+([\s\S]+)$/);
 const normalize=s=>s.toLowerCase().replace(/\s+/g,' ').trim();
 if(repeat&&normalize(repeat[1])===normalize(repeat[2]))stem=repeat[1].trim();
 if(!changed&&stem===source.stem)return source;
 return {...source,stem,choices,...(stem!==source.stem?{sourceStemText:source.sourceStemText||source.stem}:{}),...(changed?{sourceChoiceText:source.sourceChoiceText||source.choices}:{})};
}

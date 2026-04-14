/** Shared MCQ stem tokenization + React nodes for drill / Deep Learn. */

const STEM_LAB_PATTERN = /^(\d+\.?\d*)\s*(mg\/dL|mmol\/L|g\/dL|%|mEq\/L|U\/L|IU\/L|ng\/mL|pg\/mL|mmHg)/i;

const STEM_CLINICAL_TERMS = [
  "eruptive xanthomas",
  "milky plasma",
  "hepatomegaly",
  "splenomegaly",
  "triglycerides",
  "tachycardia",
  "bradycardia",
  "diaphoresis",
  "hypertension",
  "pancreatitis",
  "cholesterol",
  "xanthomas",
  "chylomicrons",
  "cyanosis",
  "clubbing",
  "jaundice",
  "VLDL",
  "HDL",
  "LDL",
  "edema",
  "pallor",
].sort((a, b) => b.length - a.length);

function mergeStemPlainTokens(tokens) {
  const out = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && last.kind === "plain" && t.kind === "plain") last.text += t.text;
    else out.push({ ...t });
  }
  return out;
}

function tokenizeStemSegment(s) {
  if (!s) return [{ kind: "plain", text: "" }];
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const sub = s.slice(i);
    const labM = sub.match(STEM_LAB_PATTERN);
    if (labM) {
      tokens.push({ kind: "lab", text: labM[0] });
      i += labM[0].length;
      continue;
    }
    let matchedTerm = null;
    const lowSlice = s.toLowerCase().slice(i);
    for (const term of STEM_CLINICAL_TERMS) {
      if (!lowSlice.startsWith(term.toLowerCase())) continue;
      const prev = i > 0 ? s[i - 1] : " ";
      const next = i + term.length < s.length ? s[i + term.length] : " ";
      if (/[a-z0-9]/i.test(prev) || /[a-z0-9]/i.test(next)) continue;
      matchedTerm = s.slice(i, i + term.length);
      break;
    }
    if (matchedTerm) {
      tokens.push({ kind: "term", text: matchedTerm });
      i += matchedTerm.length;
      continue;
    }
    tokens.push({ kind: "plain", text: s[i] });
    i += 1;
  }
  return mergeStemPlainTokens(tokens);
}

export function annotateQuestionStem(text) {
  const raw = String(text || "");
  const pieces = [];
  const re = /\*\*(.+?)\*\*/gs;
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) pieces.push({ bold: false, inner: raw.slice(last, m.index) });
    pieces.push({ bold: true, inner: m[1] });
    last = m.lastIndex;
  }
  if (last < raw.length) pieces.push({ bold: false, inner: raw.slice(last) });
  if (pieces.length === 0) pieces.push({ bold: false, inner: raw });
  return pieces.map((p) => ({
    bold: p.bold,
    tokens: tokenizeStemSegment(p.inner),
  }));
}

export function renderAnnotatableStemNodes(text) {
  const segments = annotateQuestionStem(text);
  return segments.map((seg, si) => {
    const inner = seg.tokens.map((tok, ti) => {
      const k = `${si}-${ti}`;
      if (tok.kind === "lab") {
        return (
          <span
            key={k}
            style={{
              borderBottom: "2px solid #fbbf44",
              cursor: "text",
            }}
          >
            {tok.text}
          </span>
        );
      }
      if (tok.kind === "term") {
        return (
          <span
            key={k}
            style={{
              borderBottom: "1px dotted #6366f1",
              cursor: "text",
            }}
          >
            {tok.text}
          </span>
        );
      }
      return (
        <span key={k} style={{ cursor: "text" }}>
          {tok.text}
        </span>
      );
    });
    return seg.bold ? (
      <strong key={si} style={{ fontWeight: 700 }}>
        {inner}
      </strong>
    ) : (
      <span key={si}>{inner}</span>
    );
  });
}

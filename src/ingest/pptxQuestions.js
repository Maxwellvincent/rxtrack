import { unzipSync, strFromU8 } from 'fflate';
import { loadPDFJS } from '../examParser.js';
import { bridgePresentationPdf } from '../llmBridge.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const nodes = (node, ns, name) => [...node.getElementsByTagNameNS(ns, name)];
const text = node => nodes(node, A, 't').map(t => t.textContent).join('').replace(/\s+/g, ' ').trim();

/** Read real list numbering and visible answer highlights; never solve an item. */
export function parseClassQuestionSlides(slides) {
  const parsed = slides.map(({ xml, page }) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`Unreadable PowerPoint slide ${page}.`);
    const paragraphs = nodes(doc, P, 'sp').flatMap(sp => nodes(sp, A, 'p')).map(p => ({ text: text(p),
      numbered: nodes(p, A, 'buAutoNum').some(n => /^alphaUc/.test(n.getAttribute('type') || '')),
      highlighted: nodes(p, A, 'highlight').length > 0,
    })).filter(p => p.text);
    const heading = paragraphs.find(p => /^Question\s+\d+\s*[-–—]\s*Lecture\s+\d+/i.test(p.text));
    if (!heading) return null;
    const [, num, lecture] = heading.text.match(/^Question\s+(\d+)\s*[-–—]\s*Lecture\s+(\d+)/i);
    let options = paragraphs.filter(p => p.numbered);
    const tableRows = nodes(doc, A, 'tr').map(row => ({ row, cells: nodes(row, A, 'tc').map(text) }))
      .filter(({ cells }) => /^[A-Z]$/.test(cells[0]) && cells.length > 1);
    if (!options.length && tableRows.length > 1) {
      if (tableRows.some(({ cells }, i) => cells[0] !== String.fromCharCode(65 + i))) throw new Error(`Slide ${page}: table answer labels are not contiguous.`);
      options = tableRows.map(({ row, cells }) => ({ text: cells.slice(1).join(' | '),
        highlighted: nodes(row, A, 'highlight').length > 0 || nodes(row, A, 'tc').every(cell =>
          nodes(cell, A, 'tcPr').some(pr => nodes(pr, A, 'solidFill').some(fill =>
            nodes(fill, A, 'srgbClr').some(color => color.getAttribute('val')?.toUpperCase() === 'FFFF00')))),
      }));
    }
    if (options.length < 2 || options.length > 26) throw new Error(`Slide ${page}: could not read every answer choice. Export this deck as PDF instead.`);
    const stem = paragraphs.slice(paragraphs.indexOf(heading) + 1).filter(p => !p.numbered).map(p => p.text).join(' ');
    return { page, num: Number(num), lecture: Number(lecture), stem, options, hasImage: nodes(doc, P, 'pic').length > 0 || tableRows.length > 0 };
  }).filter(Boolean);
  const questions = [];
  for (let i = 0; i < parsed.length; i++) {
    const q = parsed[i];
    const next = parsed[i + 1];
    const answer = next?.num === q.num && next.lecture === q.lecture && next.page === q.page + 1 ? next : null;
    if (answer) i++;
    const marked = (answer?.options || []).map((p, index) => p.highlighted ? index : -1).filter(n => n >= 0);
    const sameOptions = answer?.options.length === q.options.length && q.options.every((option, n) => {
      const annotated = answer.options[n].text;
      return annotated === option.text || annotated.startsWith(`${option.text} →`) || annotated.startsWith(`${option.text} ➔`);
    });
    const key = marked.length === 1 && sameOptions ? String.fromCharCode(65 + marked[0]) : null;
    questions.push({ id: `class-nb${q.lecture}-q${q.num}`, num: questions.length + 1,
      sourceQuestionNumber: q.num, sourceSection: `NB ${q.lecture}`, sourceLectureNumbers: [q.lecture],
      sourcePage: q.page, sourceAnswerPage: answer?.page || null, stem: q.stem,
      choices: Object.fromEntries(q.options.map((p, n) => [String.fromCharCode(65 + n), p.text])),
      correct: key, answerKeyVerified: !!key, sourceKeyStatus: key ? 'present' : 'missing',
      answerKeyEvidence: key ? `Choice ${key} is highlighted on source slide ${answer.page}.` : '',
      explanation: null, hasImage: q.hasImage, sourceKind: 'clicker', difficulty: 'medium',
    });
  }
  if (!questions.length) throw new Error('No numbered class questions were found in this PowerPoint. Export it as PDF and import that version.');
  if (new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('Repeated lecture/question numbers need review before this deck can be imported.');
  return questions;
}

export async function parseQuestionPptx(file, onProgress) {
  onProgress?.('Reading PowerPoint questions and visible answer highlights locally…');
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  // Presentation order can differ from slide file numbering after daily edits.
  const doc = new DOMParser().parseFromString(strFromU8(zip['ppt/presentation.xml']), 'application/xml');
  const rels = new DOMParser().parseFromString(strFromU8(zip['ppt/_rels/presentation.xml.rels']), 'application/xml');
  const targets = new Map([...rels.getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const slides = nodes(doc, P, 'sldId').map((s, index) => {
    const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(id) || '';
    const path = target.startsWith('/') ? target.slice(1) : `ppt/${target}`;
    if (!zip[path]) throw new Error(`Missing PowerPoint slide ${index + 1}.`);
    return { xml: strFromU8(zip[path]), page: index + 1 };
  });
  const questions = parseClassQuestionSlides(slides);
  onProgress?.('Rendering the original question slides locally; keeping answer slides hidden…');
  const pdfFile = await bridgePresentationPdf(file);
  await loadPDFJS();
  const pdf = await window.pdfjsLib.getDocument({ data: await pdfFile.arrayBuffer(), verbosity: 0 }).promise;
  try {
    if (pdf.numPages !== slides.length) throw new Error('PowerPoint conversion changed the slide count; the source figures were not imported.');
    for (const q of questions) {
      if (!q.hasImage) continue;
      const page = await pdf.getPage(q.sourcePage);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      q.sourceImageDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    }
  } finally { await pdf.destroy(); }
  return { questions, expectedQuestions: questions.length, fullText: questions.map(q => q.stem).join('\n'), format: 'class-pptx', sourcePdfFile: pdfFile };
}

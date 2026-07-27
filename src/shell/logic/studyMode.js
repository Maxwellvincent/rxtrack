/**
 * SP1 T4.3 — how a lecture should be studied, ported from App's detectStudyMode.
 *
 * ScheduleContext carries `studyModeByLecture` as data, so the shell has to be
 * able to compute it without App. Keyword rules are reproduced verbatim: they
 * decide the icon and the recommended activities on every Today card, and the
 * fixtures pin their output.
 */
import { getChunkBody } from "../../lectureText.js";

const ANATOMY =
  /\banat|anatomy|muscle|bone|nerve|artery|vein|ligament|joint|vertebr|spinal|plexus|foramen|fossa|groove|insertion|origin|landmark|imaging|radiol|x.ray|mri|ct scan|ultrasound/i;
const HISTOLOGY = /\bhisto|histol|microscop|stain|cell type|tissue|epithelial|connective|gland|slide/i;
const PHARMACOLOGY =
  /\bphar|drug|pharmac|receptor|agonist|antagonist|inhibit|mechanism|dose|toxicity|side effect|contraindic/i;
const BIOCHEMISTRY =
  /\bbchm|biochem|metabol|pathway|enzyme|substrate|cofactor|atp|nadh|glycol|krebs|oxidat|synthesis|protein|dna|rna|gene|transcri|translat/i;
const PHYSIOLOGY =
  /\bphys|physiol|homeosta|pressure|volume|flow|cardiac|respirat|renal|filtrat|hormonal|feedback|regulation/i;
const PATHOLOGY = /\bpath|disease|disorder|syndrome|lesion|tumor|inflam|necrosis|infarct|diagnosis/i;

/** Enough extracted text to actually study from. */
export function hasUploadedContent(lecture) {
  return (
    (lecture?.chunks || []).map(getChunkBody).join("").trim().length > 200
  );
}

export function detectStudyMode(lecture, objectives = []) {
  const title = (lecture?.lectureTitle || lecture?.fileName || "").toLowerCase();
  const discipline = (lecture?.subject || lecture?.discipline || "").toLowerCase();
  const objText = (objectives || []).map((o) => o.objective).join(" ").toLowerCase();
  const allText = `${title} ${discipline} ${objText}`;

  const isAnatomy = ANATOMY.test(allText);
  const isHistology = HISTOLOGY.test(allText);

  if (isAnatomy || isHistology) {
    // Histology wins when both match — the original checked it first here.
    return {
      mode: isHistology ? "histology" : "anatomy",
      label: isHistology ? "Histology" : "Anatomy & Structure",
      icon: isHistology ? "🔬" : "🦴",
      recommended: ["anki", "deepLearn"],
      avoid: [],
      hasUploadedContent: hasUploadedContent(lecture),
      reason: `${isHistology ? "Histology" : "Anatomy"} is best studied with Anki image cards. Log your Anki sessions here to track progress.`,
      color: isHistology ? "#a78bfa" : "#6366f1",
    };
  }

  if (PHARMACOLOGY.test(allText)) {
    return {
      mode: "pharmacology",
      label: "Pharmacology",
      icon: "💊",
      recommended: ["deepLearn", "flashcards", "mcq"],
      avoid: [],
      reason:
        "Pharmacology requires understanding mechanisms and drug class patterns — Deep Learn + flashcards work well together.",
      color: "#10b981",
    };
  }
  if (BIOCHEMISTRY.test(allText)) {
    return {
      mode: "biochemistry",
      label: "Biochemistry & Pathways",
      icon: "⚗️",
      recommended: ["deepLearn", "flashcards", "mcq"],
      avoid: [],
      reason: "Biochemistry pathways benefit from Deep Learn, spaced recall, and application questions.",
      color: "#f59e0b",
    };
  }
  if (PHYSIOLOGY.test(allText)) {
    return {
      mode: "physiology",
      label: "Physiology",
      icon: "❤️",
      recommended: ["deepLearn", "mcq"],
      avoid: [],
      reason: "Physiology needs clinical reasoning and mechanism-based deep learning.",
      color: "#ef4444",
    };
  }
  if (PATHOLOGY.test(allText)) {
    return {
      mode: "pathology",
      label: "Pathology",
      icon: "🧬",
      recommended: ["deepLearn", "mcq", "flashcards"],
      avoid: [],
      reason: "Pathology combines mechanisms with clinical presentations — Deep Learn is ideal.",
      color: "#f97316",
    };
  }
  return {
    mode: "clinical",
    label: "Clinical Sciences",
    icon: "🏥",
    recommended: ["deepLearn", "mcq"],
    avoid: [],
    reason: "Mixed clinical content works well with Deep Learn and MCQ practice.",
    color: "#60a5fa",
  };
}

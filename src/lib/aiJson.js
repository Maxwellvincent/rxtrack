/**
 * Parsing JSON out of a model response, salvage and all.
 *
 * Two parsers, both lifted out of App.jsx unchanged, because they fail
 * differently on purpose:
 *   safeJSON     — throws when nothing can be salvaged. For callers that must
 *                  distinguish "the model returned nothing usable" from "the
 *                  model returned an empty result".
 *   tryParseJSON — returns null instead. For callers with a fallback ready.
 */

/** Robust JSON parse for Gemini / markdown-wrapped model output (shared by analyzeLecture, drill MCQ, etc.) */
export function tryParseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text.trim());
  } catch (e) { void e; }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (e) { void e; }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) { void e; }
  }
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1));
    } catch (e) { void e; }
  }
  return null;
}

export const safeJSON = (raw) => {
  if (!raw) throw new Error("Empty response");

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  try {
    // Strip ASCII control chars (invalid in JSON); avoid control-class regex (eslint no-control-regex).
    let stripped = "";
    for (let i = 0; i < cleaned.length; i++) {
      const code = cleaned.charCodeAt(i);
      if ((code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13) stripped += cleaned[i];
      else stripped += " ";
    }
    return JSON.parse(stripped.replace(/,\s*([}\]])/g, "$1"));
  } catch {
    /* ignore */
  }

  const arrayStart = cleaned.indexOf('"questions"');
  if (arrayStart !== -1) {
    const bracketOpen = cleaned.indexOf("[", arrayStart);
    if (bracketOpen !== -1) {
      const arraySection = cleaned.slice(bracketOpen);
      const questions = [];
      let depth = 0;
      let objStart = -1;

      for (let i = 0; i < arraySection.length; i++) {
        const ch = arraySection[i];
        if (ch === '"') {
          i++;
          while (i < arraySection.length) {
            if (arraySection[i] === "\\") {
              i += 2;
              continue;
            }
            if (arraySection[i] === '"') break;
            i++;
          }
          continue;
        }
        if (ch === "{") {
          if (depth === 0) objStart = i;
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0 && objStart !== -1) {
            try {
              const obj = JSON.parse(arraySection.slice(objStart, i + 1));
              if (obj.stem) questions.push(obj);
            } catch {}
            objStart = -1;
          }
        }
      }

      if (questions.length > 0) {
        console.warn(`safeJSON: salvaged ${questions.length} complete questions from truncated response`);
        return { questions };
      }
    }
  }

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1).replace(/,\s*([}\]])/g, "$1"));
    } catch {}
  }

  // Salvage truncated top-level JSON array (last complete object before cutoff)
  const lastComplete = cleaned.lastIndexOf("},");
  if (lastComplete > -1 && cleaned.includes("[")) {
    const salvaged = cleaned.slice(cleaned.indexOf("["), lastComplete + 1) + "]";
    try {
      const partial = JSON.parse(salvaged.replace(/,\s*([}\]])/g, "$1"));
      if (Array.isArray(partial) && partial.length > 0) {
        console.log(`Salvaged ${partial.length} questions from truncated response`);
        return partial;
      }
    } catch (e) {
      void e;
    }
  }

  throw new Error(`Invalid JSON from Claude: ${cleaned.slice(0, 100)}`);
};

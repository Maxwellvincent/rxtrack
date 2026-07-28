/**
 * Parsing JSON out of a model response, salvage and all.
 *
 * Lifted out of App.jsx unchanged so the ingest pipeline can use the same
 * forgiving parser App has always used: fenced-block stripping, control-char
 * scrubbing, trailing-comma repair, and salvage passes for a response that was
 * cut off mid-array.
 */
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

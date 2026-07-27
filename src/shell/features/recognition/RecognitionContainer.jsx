/**
 * SP1 T3.1 — shell entry point for Patient Recognition.
 *
 * The tree used to read `rxt-block-objectives`, `rxt-weak-concepts` and
 * `rxt-current-block` out of localStorage itself. It now gets all three from the
 * store hooks through here, which also means the vignette pool follows the block
 * you are actually looking at instead of every objective you have ever imported.
 */
import { useMemo } from "react";
import { useObjectives } from "../../hooks/useObjectives.js";
import { useWeakConcepts } from "../../hooks/useWeakConcepts.js";
import { objectivePoolFrom, weakConceptNames } from "./recognition.js";
import PatientRecognition from "./PatientRecognition.jsx";

export function RecognitionContainer({ T, onClose, blockId = null, userId = null }) {
  const objectives = useObjectives(null, userId);
  // Weak concepts are weighted across everything: a landmine from another block
  // is still a landmine.
  const weak = useWeakConcepts(null, userId);

  const pool = useMemo(
    () => objectivePoolFrom(objectives.data, blockId),
    [objectives.data, blockId]
  );
  const weakConcepts = useMemo(() => weakConceptNames(weak.data), [weak.data]);

  return (
    <PatientRecognition
      T={T}
      onClose={onClose}
      pool={pool}
      weakConcepts={weakConcepts}
      userId={userId}
      blockId={blockId}
    />
  );
}

export default RecognitionContainer;

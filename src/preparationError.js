// Provider responses can carry nested error objects. Never stringify the object
// itself or dump a whole provider payload into the learner's preparation notice.
export function preparationErrorMessage(error, fallback = "Question preparation could not finish. Reviewed questions are saved.") {
  if (typeof error === "string") return error.trim() && error !== "[object Object]" ? error : fallback;
  if (!error || typeof error !== "object") return fallback;
  for (const value of [error.message, error.error, error.reason]) {
    if (value && value !== error) {
      const message = preparationErrorMessage(value, "");
      if (message) return message;
    }
  }
  return fallback;
}

// Surface why a refill made no progress instead of presenting the retry ceiling
// as the root cause. Counts describe review outcomes, not distinct questions.
export function preparationReviewSummary(rejections = {}) {
  const labels = {
    unverified_objective_alignment: "objective mapping not fully verified",
    objective_mismatch: "question tested a different objective",
    ambiguous_choices: "answer choices were ambiguous",
    unverifiable_reasoning: "lecture support could not be verified",
    unverified_answer_route: "reasoning route not verified",
    answer_choice_shortcut: "answer could be guessed from the options",
    incorrect_key: "answer key failed review",
    writer_reported_shortfall: "writer could not support the requested task",
    repeated_answer_concept: "repeated answer concept",
    draft_response_unusable: "writer returned no usable question",
    generation_or_review_failure: "generation or review could not finish",
  };
  const reasons=Object.entries(rejections).filter(([key,count])=>labels[key] && Number(count)>0)
    .sort((a,b)=>b[1]-a[1]).slice(0,3).map(([key,count])=>`${labels[key]} (${count})`);
  return reasons.length ? `Review outcomes: ${reasons.join("; ")}.` : "";
}

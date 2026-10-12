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

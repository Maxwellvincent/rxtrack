/**
 * Lightweight structured client logs for the upload pipeline (search devtools for [rxt-upload]).
 * @param {string} [phase]
 * @param {string | Record<string, unknown>} [detail]
 * @param {number} [durationMs]
 */
export function logUploadPhase(queueId, phase, detail, durationMs) {
  const id = typeof queueId === "string" ? queueId.slice(0, 8) : "?";
  const ms = durationMs != null ? ` ${Math.round(durationMs)}ms` : "";
  let extra = "";
  if (detail != null) {
    if (typeof detail === "string") extra = ` ${detail}`;
    else
      try {
        extra = ` ${JSON.stringify(detail)}`;
      } catch {
        extra = " [detail]";
      }
  }
  console.info(`[rxt-upload] ${id} ${phase}${ms}${extra}`);
}

import { useEffect, useRef } from "react";
import { trackFocusHudActivity } from "../../focusHudSignal.js";

/**
 * Reports an in-progress study activity to focus-hud for as long as the
 * component is mounted.
 *
 * `detail` is read through a ref, so a session that moves from one lecture to
 * the next keeps reporting the current one without tearing the signal down and
 * restarting its clock.
 *
 * @param {"questions"|"lecture"|"review"} kind
 * @param {string|null} detail
 * @param {{enabled?: boolean, externalRef?: string|null}} [options]
 */
export function useFocusHudSignal(kind, detail, options = {}) {
  const { enabled = true, externalRef = null } = options;
  const detailRef = useRef(detail);
  detailRef.current = detail;

  useEffect(() => {
    if (!enabled) return undefined;

    return trackFocusHudActivity(kind, {
      detail: () => detailRef.current ?? null,
      externalRef,
    });
  }, [kind, enabled, externalRef]);
}

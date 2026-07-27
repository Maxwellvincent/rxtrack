/**
 * SP1 T5.1 — the shell's block list, reactive.
 *
 * Sidebar and ShellMain each computed this once with `useMemo(…, [])` off a raw
 * localStorage read, so importing a schedule or uploading a lecture left the nav
 * stale until a reload. Both now share this, and it re-renders when the terms or
 * lectures stores change.
 */
import { useMemo } from "react";
import { flattenBlocks } from "../data.js";
import { useLectures } from "./useLectures.js";
import { useTerms } from "./useTerms.js";

export function useBlocks(userId) {
  const terms = useTerms(userId);
  const lectures = useLectures(null, userId);

  return useMemo(
    () => flattenBlocks(terms.data, lectures.data),
    [terms.data, lectures.data]
  );
}

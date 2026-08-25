/**
 * Background pre-generation for Work Ahead.
 *
 * Runs one lecture at a time, only for what Work Ahead is actually offering,
 * and only when the browser is idle — a pre-read is a nice-to-have that must
 * never compete with the study session you are in the middle of.
 *
 * The queue deliberately does NOT depend on the cache it fills. An earlier
 * version did, and writing the first lecture's result re-ran the effect, whose
 * cleanup cancelled the loop before the second lecture was ever generated: the
 * prefetch silently stopped after one. The effect keys on the lecture list
 * alone, and freshness comes from re-reading the store inside the loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { callAIJSON } from "../../../aiClient.js";
import * as preReadCacheStore from "../../../stores/preReadCache.js";
import { cacheEntry, preReadsToGenerate, readCached } from "../../logic/preReadCache.js";
import { generatePreRead } from "./preRead.js";
import { fetchLectureContent } from "../../../supabase.js";

const whenIdle = (fn) =>
  typeof requestIdleCallback === "function"
    ? requestIdleCallback(fn, { timeout: 5000 })
    : setTimeout(fn, 1500);

export function usePreReadPrefetch(lectures, { objectivesFor, userId, enabled = true }) {
  const [cache, setCache] = useState(() => preReadCacheStore.read(userId) || {});
  const running = useRef(false);

  // Held in a ref, never a dependency. `objectivesFor` is rebuilt whenever
  // Today's context changes, and any such change used to cancel a queue that
  // was mid-generation — the second lecture was never reached.
  const objectivesRef = useRef(objectivesFor);
  objectivesRef.current = objectivesFor;
  const lecturesRef = useRef(lectures);
  lecturesRef.current = lectures;

  // The identity of the offered lectures, so re-renders that hand over an
  // equivalent array do not restart the queue.
  const lectureKey = (lectures || []).map((ls) => ls?.lec?.id ?? ls?.id).join(",");

  useEffect(() => {
    if (!enabled || running.current) return;

    let cancelled = false;
    const handle = whenIdle(async () => {
      running.current = true;
      try {
        const todo = preReadsToGenerate(lecturesRef.current, preReadCacheStore.read(userId) || {}, {
          objectivesFor: objectivesRef.current,
        });
        for (const lec of todo) {
          if (cancelled) return;
          const objectives = objectivesRef.current(lec.id);
          let fullLecture = lec;
          if (userId) {
            try {
              const cloud = await fetchLectureContent(userId, lec.id);
              if (cloud) fullLecture = { ...lec, ...(cloud.meta || {}), chunks: cloud.chunks || lec.chunks, atoms: cloud.atoms || lec.atoms };
            } catch { /* generate from objectives/title if cloud hydration is unavailable */ }
          }
          const result = await generatePreRead({ lecture: fullLecture, objectives }, { callAIJSON });
          // A failed generation is not cached — the modal retries on open, by
          // which point the provider may well be reachable again.
          if (cancelled || result.error || !result.questions?.length) continue;
          const next = {
            ...(preReadCacheStore.read(userId) || {}),
            [lec.id]: cacheEntry(lec, objectives, result),
          };
          preReadCacheStore.write(userId, next);
          setCache(next);
        }
      } finally {
        running.current = false;
      }
    });

    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function" && typeof handle === "number") {
        try { cancelIdleCallback(handle); } catch { /* fell back to setTimeout */ }
      }
    };
    // `cache`, `lectures` and `objectivesFor` are intentionally absent — the
    // queue keys on WHICH lectures are offered, nothing else. See the module comment.
  }, [lectureKey, userId, enabled]);

  const cachedFor = useCallback(
    (lecture, objectives) => readCached(cache, lecture, objectives),
    [cache]
  );

  return { cache, cachedFor };
}

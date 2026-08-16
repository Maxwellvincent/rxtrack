import * as store from "../../stores/lectureQuestionStats.js";
import { useStoreResource } from "./useStoreResource.js";

/** `{ [lectureId]: { answered, correct, at } }`, live across devices. */
export function useLectureQuestionStats(userId) {
  return useStoreResource(store, userId);
}

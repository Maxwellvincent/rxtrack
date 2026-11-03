import * as store from "../../stores/lectureQuestionStats.js";
import { useStoreResource } from "./useStoreResource.js";

/** `{ [lectureId]: { answered, correct, at } }`, live across devices. */
export function useLectureQuestionStats(userId) {
  return useStoreResource(store, userId);
}

/** One projection for every lecture surface, reactive to hydration, checkpoints and exclusions. */
export function useLectureStats(userId,lectureId){
 const resource=useLectureQuestionStats(userId);
 return {...resource,...store.selectLectureStats(resource.data,lectureId)};
}

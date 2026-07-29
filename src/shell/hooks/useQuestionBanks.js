import * as questionBanks from "../../stores/questionBanks.js";
import { useStoreResource } from "./useStoreResource.js";

/** `{ [filename]: question[] }` — uploaded exam banks, Firestore-backed. */
export function useQuestionBanks(userId) {
  return useStoreResource(questionBanks, userId, (data) => data || {});
}

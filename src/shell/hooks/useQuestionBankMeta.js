import * as questionBankMeta from "../../stores/questionBankMeta.js";
import { useStoreResource } from "./useStoreResource.js";

/** Block ownership metadata for uploaded school-question banks. */
export function useQuestionBankMeta(userId) {
  return useStoreResource(questionBankMeta, userId, (data) => data || {});
}

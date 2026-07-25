import * as store from "../../stores/examDates.js";
import { useStoreResource } from "./useStoreResource.js";

export function useExamDates(userId) {
  return useStoreResource(store, userId);
}

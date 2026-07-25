import * as store from "../../stores/completion.js";
import { useStoreResource } from "./useStoreResource.js";

export function useCompletion(userId) {
  return useStoreResource(store, userId);
}

import * as store from "../../stores/terms.js";
import { useStoreResource } from "./useStoreResource.js";

export function useTerms(userId) {
  return useStoreResource(store, userId);
}

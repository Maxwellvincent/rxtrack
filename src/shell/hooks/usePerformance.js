import * as store from "../../stores/performance.js";
import { useStoreResource } from "./useStoreResource.js";

export function usePerformance(userId) {
  return useStoreResource(store, userId);
}

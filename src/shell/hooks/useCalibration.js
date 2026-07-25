import * as store from "../../stores/calibration.js";
import { useStoreResource } from "./useStoreResource.js";

export function useCalibration(userId) {
  return useStoreResource(store, userId);
}

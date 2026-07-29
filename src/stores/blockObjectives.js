/**
 * rxt-block-objectives — Firestore-first, a document per block.
 *
 * The implementation lives in blockObjectivesCloud.js because this key is a
 * COLLECTION, not the single document cloudBase.js serves: users/{uid}/objectives/{blockId}.
 * It is the largest store in the app — 1.5MB of a ~5MB budget across seven
 * blocks — which is why it holds everything in memory and mirrors only the
 * blocks recently worked in back to localStorage for App.jsx.
 *
 * The old per-block merge policy (imported union by id preferring drill
 * evidence, extracted union by id) reconciled two full copies. With one source
 * of truth there is nothing to reconcile, so a write is a write.
 */
export {
  key,
  read,
  write,
  merge,
  subscribe,
  isHydrated,
  readError,
  touchBlock,
  hotBlocks,
  resetObjectivesStore,
  HOT_BLOCK_LIMIT,
} from "./blockObjectivesCloud.js";

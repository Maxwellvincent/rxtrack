import { BPM2_DM_BENCHMARK } from "../engine/examReadiness.js";
import { readCloud, subscribeToCloudStore, writeCloudAwait, isHydrated as hydrated, readError as error } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

export const key = "rxt-exam-benchmarks-v1";
const fallback = { version: 1, records: [BPM2_DM_BENCHMARK] };

export function withBaseline(value) {
  const current = value && typeof value === "object" ? value : {};
  const records = Array.isArray(current.records) ? current.records : [];
  const byId = new Map(records.filter(Boolean).map((record) => [record.id, record]));
  if (!byId.has(BPM2_DM_BENCHMARK.id)) byId.set(BPM2_DM_BENCHMARK.id, BPM2_DM_BENCHMARK);
  return { ...current, version: 1, records: [...byId.values()] };
}

export function read(userId) {
  const value = userId ? readCloud(userId, key, fallback) : readJson(userId, key, fallback);
  return withBaseline(value);
}

export async function ensureSeeded(userId) {
  const current = read(userId);
  if (userId) await writeCloudAwait(userId, key, current);
  else writeJson(userId, key, current);
  return current;
}

export async function write(userId, value) {
  const next = withBaseline(value);
  if (userId) await writeCloudAwait(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export const subscribe = (callback) => subscribeToCloudStore(key, callback);
export const isHydrated = (userId) => hydrated(userId, key);
export const readError = (userId) => error(userId, key);

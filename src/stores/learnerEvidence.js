import {isIndependentAttempt} from '../engine/practiceAssistance.js';
import { excludedEvidenceKeys } from "../engine/questionScoringPolicy.js";
import { readCloud, subscribeToCloudStore, writeCloud, writeCloudAwait, updateCloudGroupAwait, isHydrated as cloudIsHydrated, readError as cloudReadError } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

import * as questionRatings from "./questionRatings.js";

export const key = "rxt-learner-evidence-v1";
const SHARD_PREFIX = `${key}-shard-`;
const MAIN_TARGET_BYTES = 700_000;
const SHARD_TARGET_BYTES = 600_000;
const ACTIVE_EVENT_TARGET = 200;
const fallback = { version: 1, total: 0, correct: 0, objectives: {}, atoms: {}, lectures: {}, sources: {}, taskTypes: {}, orderLevels: {}, testTaking: { reasons: {}, missTypes: {}, diagnosticKeys: [], positionStats: {}, timedAnswers: 0, totalResponseMs: 0, answerChanges: 0 } };

const projectionCache=new WeakMap();
const combinedStorageCache=new WeakMap();
const optimisticEvidence=new Map();
const emptyRatings={};

const shardKeys = stored => (stored?.evidenceShards || []).map(shard => shard.key).filter(Boolean);
const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
function readStoredEvidence(userId) {
  const main = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
  if (!userId || !main.evidenceShards?.length) return main;
  const shards = shardKeys(main).map(shardKey => readCloud(userId, shardKey, {version:1,evidenceJournal:[]}));
  const cached = combinedStorageCache.get(main);
  if (cached && cached.shards.length === shards.length && cached.shards.every((value, index) => value === shards[index])) return cached.value;
  const value = {...main,evidenceJournal:[...shards.flatMap(shard => shard?.evidenceJournal || []),...(main.evidenceJournal || [])]};
  combinedStorageCache.set(main,{shards,value});
  return value;
}

export function read(userId) {
  const stored = (userId && optimisticEvidence.get(userId)?.value) || readStoredEvidence(userId);
  if (!stored.evidenceJournal && !stored.missTypeJournal && !stored.reflectionJournal && !stored.learningNotes) return stored;
  const ratings = questionRatings.read(userId).ratings || emptyRatings;
  const cached=projectionCache.get(stored);
  if(cached?.ratings===ratings)return cached.value;
  const contested = excludedEvidenceKeys(ratings);
  const objectiveContested = excludedEvidenceKeys(ratings, "objective");
  let projected = stored.evidenceBaseline || (stored.evidenceJournal ? fallback : stored);
  for (const event of stored.evidenceJournal || []) {
    if (!contested.has(questionEvidenceKey(event.questionKey))) projected = applyEvidence(projected, { ...event, ...(objectiveContested.has(questionEvidenceKey(event.questionKey)) ? {objectiveIds:[]} : {}), at:Number.isFinite(event.at)?event.at:0 });
  }
  // An excluded-only objective still has an authoritative zero entry. Otherwise
  // UI fallback to legacy counters would revive the contested attempt.
  const objectives = { ...(projected.objectives || {}) };
  for (const event of stored.evidenceJournal || []) {
    for (const id of event.objectiveIds || []) {
      if (!objectives[id]) objectives[id] = { attempts: 0, correct: 0, recent: [], sessions: [], taskTypes: {}, orderLevels: {} };
    }
  }
  const result = { ...stored, ...projected, objectives, assistedJournal:(stored.evidenceJournal || []).filter(event=>!isIndependentAttempt(event)&&!contested.has(questionEvidenceKey(event.questionKey))&&!objectiveContested.has(questionEvidenceKey(event.questionKey))), learningJournal: (stored.evidenceJournal || []).filter(event => isIndependentAttempt(event) && !contested.has(questionEvidenceKey(event.questionKey)) && !objectiveContested.has(questionEvidenceKey(event.questionKey))), learningNotes: (stored.learningNotes || []).filter(note => !contested.has(questionEvidenceKey(note.questionKey)) && !objectiveContested.has(questionEvidenceKey(note.questionKey))), evidenceBaseline: stored.evidenceBaseline, evidenceJournal: stored.evidenceJournal,
    testTaking: { ...projected.testTaking, reasons: projectReflections(stored, userId), missTypes: projectMissTypes(stored, userId), diagnosticKeys: stored.testTaking?.diagnosticKeys || [] } };
  projectionCache.set(stored,{ratings,value:result});
  return result;

}

/** Compact, stable identity used to keep exact-item history durable without storing full stems. */
export function questionEvidenceKey(value) {
  const input = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!input) return "";
  if (/^e_[a-z0-9]+$/.test(input)) return input;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `e_${(hash >>> 0).toString(36)}`;
}

function bump(bucket, id, event) {
  if (!id) return bucket;
  const prev = bucket[id] || {};
  return {
    ...bucket,
    [id]: {
      attempts: (prev.attempts || 0) + 1,
      correct: (prev.correct || 0) + (event.correct ? 1 : 0),
      landmines: (prev.landmines || 0) + (event.misconception === "landmine" ? 1 : 0),
      lastSeen: event.at,
      lastDifficulty: event.difficulty || prev.lastDifficulty || null,
      recent: [...(prev.recent || []), !!event.correct].slice(-8),
    },
  };
}

function bumpObjective(bucket, id, event) {
  if (!id) return bucket;
  const previous = bucket[id] || {};
  const questionKey = questionEvidenceKey(event.questionKey);
  const questionKeys = previous.questionKeys || [];
  const repeatedQuestion = !!questionKey && (questionKeys.includes(questionKey)||(previous.assistedQuestionKeys||[]).includes(questionKey));
  if (repeatedQuestion) {
    const recent = event.correct
      ? previous.recent || []
      : [...(previous.recent || []), false].slice(-8);
    return {
      ...bucket,
      [id]: {
        ...previous,
        lastSeen: event.at,
        lastReinforcedAt: event.at,
        reinforcements: (previous.reinforcements || 0) + 1,
        reinforcementCorrect: (previous.reinforcementCorrect || 0) + (event.correct ? 1 : 0),
        recent,
      },
    };
  }
  const next = bump(bucket, id, event);
  const entry = next[id];
  const sessions = event.sessionKey
    ? [...new Set([...(previous.sessions || []), event.sessionKey])].slice(-12)
    : previous.sessions || [];
  const taskTypes = { ...(previous.taskTypes || {}) };
  if (event.taskType) taskTypes[event.taskType] = (taskTypes[event.taskType] || 0) + 1;
  const sources = { ...(previous.sources || {}) };
  const source = event.source || "quiz";
  sources[source] = (sources[source] || 0) + 1;
  const nextQuestionKeys = questionKey
    ? [...new Set([...questionKeys, questionKey])].slice(-200)
    : questionKeys;
  const orderLevels = { ...(previous.orderLevels || {}) };
  if (event.reasoningVerified && ["first-order", "second-order", "third-order"].includes(event.orderLevel)) {
    const prior = orderLevels[event.orderLevel] || { attempts: 0, correct: 0 };
    orderLevels[event.orderLevel] = { attempts: prior.attempts + 1, correct: prior.correct + (event.correct ? 1 : 0) };
  }
  return { ...next, [id]: { ...entry, sessions, taskTypes, sources, questionKeys: nextQuestionKeys, orderLevels, recentFreshAnswers: questionKey ? [...(previous.recentFreshAnswers || []), {
    questionKey, correct:event.correct, at:event.at, sessionKey:event.sessionKey || null, taskType:event.taskType || null,
    orderLevel:event.orderLevel || null, reasoningVerified:event.reasoningVerified === true,
  }].slice(-8) : previous.recentFreshAnswers || [], lastFreshAnswer: {correct:event.correct,confidence:event.confidence ?? null,orderLevel:event.orderLevel ?? null,reasoningVerified:event.reasoningVerified === true} } };
}

export function applyEvidence(model, rawEvent) {
  const current = model || fallback;
  const event = { ...rawEvent, at: Number.isFinite(rawEvent?.at) ? rawEvent.at : Date.now() };
  if(!isIndependentAttempt(event)){
    const objectives={...(current.objectives||{})},key=questionEvidenceKey(event.questionKey);
    for(const id of event.objectiveIds||[]){const previous=objectives[id]||{attempts:0,correct:0,recent:[]};objectives[id]={...previous,assistedQuestionKeys:[...new Set([...(previous.assistedQuestionKeys||[]),key].filter(Boolean))].slice(-200)};}
    return {...current,objectives,updatedAt:event.at,assisted:{attempts:(current.assisted?.attempts||0)+1,correct:(current.assisted?.correct||0)+(event.correct?1:0)}};
  }
  let objectives = current.objectives || {};
  for (const id of [...new Set(event.objectiveIds || [])]) objectives = bumpObjective(objectives, id, event);
  const process = current.testTaking || fallback.testTaking;
  const responseMs = Number.isFinite(event.responseMs) ? Math.max(0, event.responseMs) : null;
  return {
    ...current,
    version: 1,
    total: (current.total || 0) + 1,
    correct: (current.correct || 0) + (event.correct ? 1 : 0),
    updatedAt: event.at,
    objectives,
    atoms: bump(current.atoms || {}, event.atomKey, event),
    lectures: bump(current.lectures || {}, event.lectureId, event),
    sources: bump(current.sources || {}, event.source || "quiz", event),
    taskTypes: bump(current.taskTypes || {}, event.taskType, event),
      orderLevels: bump(current.orderLevels || {}, event.orderLevel, event),
      testTaking: {
      ...process,
      reasons: process.reasons || {},
      missTypes: process.missTypes || {},
      diagnosticKeys: process.diagnosticKeys || [],
      positionStats: (() => {
        const position = Number(event.questionNumber);
        if (!Number.isInteger(position) || position < 1) return process.positionStats || {};
        const band = position <= 8 ? "first-eight" : "after-eight";
        const prior = process.positionStats?.[band] || { attempts: 0, correct: 0, totalResponseMs: 0, timedAnswers: 0 };
        const response = Number.isFinite(event.responseMs) ? Math.max(0, event.responseMs) : null;
        return { ...(process.positionStats || {}), [band]: {
          attempts: prior.attempts + 1,
          correct: prior.correct + (event.correct ? 1 : 0),
          totalResponseMs: prior.totalResponseMs + (response || 0),
          timedAnswers: prior.timedAnswers + (response == null ? 0 : 1),
        } };
      })(),
      reasoningDepths: event.reasoningDepth ? {
        ...(process.reasoningDepths || {}),
        [event.reasoningDepth]: (() => {
          const previous = process.reasoningDepths?.[event.reasoningDepth] || { attempts: 0, correct: 0 };
          return { attempts: previous.attempts + 1, correct: previous.correct + (event.correct ? 1 : 0) };
        })(),
      } : (process.reasoningDepths || {}),
      timedAnswers: (process.timedAnswers || 0) + (responseMs == null ? 0 : 1),
      totalResponseMs: (process.totalResponseMs || 0) + (responseMs || 0),
      answerChanges: (process.answerChanges || 0) + (event.answerChanges || 0),
    },
  };
}

export function applyMissType(model, missType, diagnosticKey, at = Date.now()) {
  if (!missType) return model || fallback;
  const current = model || fallback;
  const process = current.testTaking || fallback.testTaking;
  const key = questionEvidenceKey(diagnosticKey);
  const keys = process.diagnosticKeys || [];
  if (key && keys.includes(key)) return current;
  const previous = process.missTypes?.[missType] || { count: 0 };
  return {
    ...current,
    updatedAt: at,
    testTaking: {
      ...process,
      missTypes: { ...(process.missTypes || {}), [missType]: { count: (previous.count || 0) + 1, lastAt: at } },
      diagnosticKeys: key ? [...keys, key].slice(-500) : keys,
    },
  };
}

export function applyReflection(model, reason, previousReason = null) {
  const current = model || fallback;
  if (!reason || reason === previousReason) return current;
  const process = current.testTaking || fallback.testTaking;
  const reasons = { ...(process.reasons || {}) };
  if (previousReason) reasons[previousReason] = Math.max(0, (reasons[previousReason] || 0) - 1);
  reasons[reason] = (reasons[reason] || 0) + 1;
  return {
    ...current,
    updatedAt: Date.now(),
    testTaking: {
      ...process,
      reasons,
    },
  };
}

function projectReflections(stored, userId) {
 let model = { testTaking: { reasons: stored.reflectionBaseline || stored.testTaking?.reasons || {} } };
 for (const event of stored.reflectionJournal || []) {
  if (!questionRatings.isExcluded(userId, { questionKey: event.questionKey })) model = applyReflection(model, event.reason, event.previousReason);
 }
 return model.testTaking.reasons;
}
export function recordReflection(userId, reason, previousReason = null, questionKey = null) {
  if (!reason) return read(userId);
  const stored = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
  const next = { ...applyReflection(stored, reason, previousReason),
    reflectionBaseline: stored.reflectionBaseline || stored.testTaking?.reasons || {},
    reflectionJournal: [...(stored.reflectionJournal || []), { reason, previousReason, questionKey, at: Date.now() }] };
  const optimistic=optimisticEvidence.get(userId);
  if(optimistic){const current=optimistic.value;optimistic.value={...applyReflection(current,reason,previousReason),reflectionBaseline:current.reflectionBaseline||current.testTaking?.reasons||{},reflectionJournal:[...(current.reflectionJournal||[]),{reason,previousReason,questionKey,at:Date.now()}]};}
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export function recordEvidence(userId, event) {
  const stored = userId ? read(userId) : readJson(userId, key, fallback) || fallback;
  const baseline = stored.evidenceBaseline || stored;
  const journal = [...(stored.evidenceJournal || []), { ...event, at: event.at || Date.now() }];
  const next = { ...applyEvidence(stored, event), evidenceBaseline: baseline, evidenceJournal: journal };
  if (userId) {
    const pending=(optimisticEvidence.get(userId)?.pending||0)+1;
    optimisticEvidence.set(userId,{value:next,pending});
    recordEvidenceBatchAwait(userId,[event]).catch(error=>console.warn(`store ${key}: evidence write failed`,error?.message||error)).finally(()=>{
      const current=optimisticEvidence.get(userId);if(!current)return;
      current.pending-=1;if(current.pending<=0)optimisticEvidence.delete(userId);
    });
  }
  else writeJson(userId, key, next);
  return next;
}

export async function recordEvidenceBatchAwait(userId, events, { removeEventIds = [] } = {}) {
  if (userId) {
    readStoredEvidence(userId); // Start hydration before replacing any history.
    if (!isHydrated(userId)) await new Promise((resolve, reject) => {
      let off = () => {};
      const timer = setTimeout(() => { off(); reject(new Error("Practice history is still syncing. Please retry Save & exit.")); }, 15000);
      const check = () => {
        readStoredEvidence(userId);
        if (!isHydrated(userId)) return;
        clearTimeout(timer); off();
        const error = readError(userId);
        if (error) reject(error); else resolve();
      };
      off = subscribeToCloudStore(key, check); check();
    });
    const error = readError(userId);
    if (error) throw error;
  }
  const rebuild = (storedValue, children = {}) => {
  const stored=storedValue||fallback;
  const baseline = stored.evidenceBaseline || stored;
  const archived = shardKeys(stored).flatMap(shardKey => children[shardKey]?.evidenceJournal || []);
  const journal = mergeEvidenceJournal([...archived,...(stored.evidenceJournal || [])].filter(event => !removeEventIds.includes(event.eventId)), events);
  journal.sort((a, b) => (a.at || 0) - (b.at || 0));
  // Rebuild once per checkpoint and write once, even for a long school bank.
  // The same event identity updates an outcome without another attempt.
  const projected = journal.reduce((model, item) => applyEvidence(model, item), baseline);
  const unsharded = { ...stored, ...projected,
    testTaking: { ...projected.testTaking, reasons: stored.testTaking?.reasons || {}, missTypes: stored.testTaking?.missTypes || {}, diagnosticKeys: stored.testTaking?.diagnosticKeys || [] },
    evidenceBaseline: baseline, evidenceJournal: journal };
  const storedValueForSize = (() => { const value={...unsharded}; for(const field of ['objectives','atoms','lectures','sources','taskTypes','orderLevels','total','correct'])delete value[field]; return value; })();
  if (byteSize(storedValueForSize) <= MAIN_TARGET_BYTES && !stored.evidenceShards?.length) return {value:unsharded,writes:[]};

  let activeCount=Math.min(ACTIVE_EVENT_TARGET,journal.length);
  let active=journal.slice(-activeCount);
  const mainFor = (activeJournal, manifests=[]) => ({...unsharded,evidenceJournal:activeJournal,evidenceShards:manifests});
  while(activeCount>0 && byteSize((()=>{const value={...mainFor(active)};for(const field of ['objectives','atoms','lectures','sources','taskTypes','orderLevels','total','correct'])delete value[field];return value;})())>MAIN_TARGET_BYTES){activeCount=Math.floor(activeCount/2);active=journal.slice(-activeCount);}
  const archive=activeCount?journal.slice(0,-activeCount):journal;
  const chunks=[];let chunk=[];
  for(const event of archive){const candidate=[...chunk,event];if(chunk.length&&byteSize({version:1,evidenceJournal:candidate})>SHARD_TARGET_BYTES){chunks.push(chunk);chunk=[event];}else chunk=candidate;}
  if(chunk.length)chunks.push(chunk);
  const manifests=chunks.map((items,index)=>({key:`${SHARD_PREFIX}${String(index+1).padStart(4,'0')}`,count:items.length,firstAt:items[0]?.at||0,lastAt:items.at(-1)?.at||0}));
  const writes=chunks.map((items,index)=>({logicalKey:manifests[index].key,value:{version:1,evidenceJournal:items}}));
  const used=new Set(manifests.map(item=>item.key));
  for(const oldKey of shardKeys(stored))if(!used.has(oldKey))writes.push({logicalKey:oldKey,value:{version:1,evidenceJournal:[]}});
  return {value:mainFor(active,manifests),writes};
  };
  if(userId)return updateCloudGroupAwait(userId,key,shardKeys,rebuild);
  const prepared=rebuild(readJson(userId,key,fallback));writeJson(userId,key,prepared.value);return prepared.value;
}

export function recordEvidenceAwait(userId, event) {
  return recordEvidenceBatchAwait(userId, [event]);
}

function projectMissTypes(stored, userId) {
 let model = { testTaking: { missTypes: stored.missTypeBaseline || stored.testTaking?.missTypes || {}, diagnosticKeys: [] } };
 for (const event of stored.missTypeJournal || []) {
  if (!questionRatings.isDiagnosticExcluded(userId, event.diagnosticKey)) model = applyMissType(model, event.missType, event.diagnosticKey, event.at);
 }
 return model.testTaking.missTypes;
}
function withMissJournal(stored,missType,diagnosticKey) {
 const journal = stored.missTypeJournal || [];
 if (journal.some(event => event.diagnosticKey === diagnosticKey)) return stored;
 return { ...applyMissType(stored, missType, diagnosticKey), missTypeBaseline: stored.missTypeBaseline || stored.testTaking?.missTypes || {}, missTypeJournal: [...journal, { missType, diagnosticKey, at: Date.now() }] };
}
function recordMissJournal(userId, missType, diagnosticKey) {
 const stored = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
 return withMissJournal(stored,missType,diagnosticKey);
}
export function recordMissType(userId, missType, diagnosticKey) {
  const next = recordMissJournal(userId, missType, diagnosticKey);
  const optimistic=optimisticEvidence.get(userId);if(optimistic)optimistic.value=withMissJournal(optimistic.value,missType,diagnosticKey);
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export async function recordMissTypeAwait(userId, missType, diagnosticKey) {
  const next = recordMissJournal(userId, missType, diagnosticKey);
  const optimistic=optimisticEvidence.get(userId);if(optimistic)optimistic.value=withMissJournal(optimistic.value,missType,diagnosticKey);
  if (userId) await writeCloudAwait(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export function subscribe(cb) {
  const unsubEvidence = subscribeToCloudStore(key, cb);
  const unsubRatings = questionRatings.subscribe(cb);
  return () => { unsubEvidence(); unsubRatings(); };
}

/** Save a learner-authored sticking point without creating a graded answer. */
export function recordLearningNote(userId, note, {persistAwait=false}={}) {
 const stored = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
 const text=String(note.note || "").trim().slice(0,600);
 if(!text || !(note.objectiveIds || []).length) return stored;
 const entry={...note,note:text,at:Date.now()};
 const notes=(stored.learningNotes || []).filter(item=>item.questionKey!==entry.questionKey || item.blockId!==entry.blockId);
 const next={...stored,learningNotes:[...notes,entry].slice(-300)};
 const optimistic=optimisticEvidence.get(userId);if(optimistic){const currentNotes=(optimistic.value.learningNotes||[]).filter(item=>item.questionKey!==entry.questionKey||item.blockId!==entry.blockId);optimistic.value={...optimistic.value,learningNotes:[...currentNotes,entry].slice(-300)};}
 if(userId && persistAwait)return writeCloudAwait(userId,key,next).then(()=>next);
 if(userId) writeCloud(userId,key,next); else writeJson(userId,key,next);
 return next;
}

export function isHydrated(userId) {
 if(!userId)return true;
 if(!cloudIsHydrated(userId,key))return false;
 const main=readCloud(userId,key,fallback)||fallback;
 return shardKeys(main).every(shardKey=>cloudIsHydrated(userId,shardKey));
}
export function readError(userId) {
 if(!userId)return null;
 const main=readCloud(userId,key,fallback)||fallback;
 return cloudReadError(userId,key)||shardKeys(main).map(shardKey=>cloudReadError(userId,shardKey)).find(Boolean)||null;
}

/** Replace an identified legacy event as its key migrates, including an earlier duplicate repair. */
export function mergeEvidenceJournal(current=[], events=[]) {
 let journal=[...current];
 for(const event of events){
  const previous=event.historyPreviousQuestionKey || event.questionKey;
  if(event.historyReconciled)journal=journal.filter(item=>!(!item.eventId && item.blockId===event.blockId && questionEvidenceKey(item.questionKey)===questionEvidenceKey(previous) && item.at===event.at && (!event.sessionKey || item.sessionKey===event.sessionKey)));
  const index=event.eventId?journal.findIndex(item=>item.eventId===event.eventId):-1;
  const next={...event,at:event.at || Date.now()};
  if(index>=0)journal[index]=next;else journal.push(next);
 }
 return journal;
}

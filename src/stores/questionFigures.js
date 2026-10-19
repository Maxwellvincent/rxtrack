import { readCloud, writeCloudAwait, isHydrated, readError, subscribeToCloudStore } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { cleanLectureTitle } from "../lectureTitle.js";
import { evidenceIdentity } from "../engine/questionScoringPolicy.js";

const sourceKey = filename => `rxt-question-figures:${cleanLectureTitle(filename || "source").toLowerCase()}`;
export function figureIdentity(question = {}) {
  const stem = String(question.stem || "").toLowerCase().replace(/\s+/g," ").trim();
  return evidenceIdentity(stem || String(question.sourceQuestionNumber || question.num || question.id || question.questionId || question.sourcePage || "unknown"));
}
export function read(userId, filename) { return userId ? readCloud(userId, sourceKey(filename), {}) || {} : readJson(userId, sourceKey(filename), {}) || {}; }
export function subscribe(filename, cb) { return subscribeToCloudStore(sourceKey(filename), cb); }
export async function load(userId, filename) {
  read(userId, filename);
  if (!userId) return read(userId, filename);
  const key = sourceKey(filename);
  if (!isHydrated(userId,key)) await new Promise((resolve,reject) => {
    let off=()=>{};
    const timer=setTimeout(()=>{off();reject(new Error("Saved figures are still syncing. Please retry."));},15000);
    const check=()=>{if(!isHydrated(userId,key))return;clearTimeout(timer);off();const error=readError(userId,key);if(error)reject(error);else resolve();};
    off=subscribeToCloudStore(key,check);check();
  });
  if(readError(userId,key))throw readError(userId,key);
  return read(userId,filename);
}
export async function save(userId, question, entry) {
  const previous=await load(userId,question.sourceFile);
  const next={...previous,[figureIdentity(question)]:{...entry,at:Date.now()}};
  if(userId)await writeCloudAwait(userId,sourceKey(question.sourceFile),next);
  else writeJson(userId,sourceKey(question.sourceFile),next);
  return entry;
}
export function apply(question, records = {}) {
  const saved=records[figureIdentity(question)];
  if(!saved?.url)return question;
  return {...question,originalSourceImageUrl:question.originalSourceImageUrl || question.sourceImageUrl || question.sourceImageDataUrl || null,
    sourceImageUrl:saved.url,sourceVisualPage:saved.page,sourceFigureCropped:true,hasImage:true,imageDependent:true};
}

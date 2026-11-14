import { readCloud, writeCloudAwait, isHydrated, readError, subscribeToCloudStore } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { cleanLectureTitle } from "../lectureTitle.js";
import { evidenceIdentity } from "../engine/questionScoringPolicy.js";

const sourceKey = filename => `rxt-question-figures:${cleanLectureTitle(filename || "source").toLowerCase()}`;
export function figureIdentities(question = {}) {
  const stem = String(question.stem || "").toLowerCase().replace(/\s+/g," ").trim();
  const number = question.sourceQuestionNumber ?? question.num;
  const section = String(question.sourceSection || question.sourceSectionTitle || "").toLowerCase().replace(/\s+/g, " ").trim();
  const page = Number(question.sourcePage) || null;
  const stable = number != null ? `source:${section || "bank"}:q${number}${page ? `:p${page}` : ""}` : "";
  const fallback = stem || String(question.id || question.questionId || question.sourcePage || "unknown");
  return [...new Set([stable, fallback].filter(Boolean).map(evidenceIdentity))];
}
export function figureIdentity(question = {}) { return figureIdentities(question)[0]; }
export function find(records = {}, question = {}) { return figureIdentities(question).map(identity => records[identity]).find(Boolean) || null; }
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
  const identity=figureIdentity(question);
  const next={...previous,[identity]:{...find(previous,question),...entry,at:Date.now()}};
  if(userId)await writeCloudAwait(userId,sourceKey(question.sourceFile),next);
  else writeJson(userId,sourceKey(question.sourceFile),next);
  return entry;
}
export function apply(question, records = {}) {
  const saved=find(records,question);
  if(!saved)return question;
  const last=String(saved.visualLastLabel||'');
  const labels=/^[B-Z]$/.test(last)&&Object.entries(question.choices||{}).every(([letter,value])=>value===`Visual option ${letter}`&&letter<=last);
  if(!saved.url&&!labels)return question;
  return {...question,...(saved.url?{originalSourceImageUrl:question.originalSourceImageUrl || question.sourceImageUrl || question.sourceImageDataUrl || null,
    sourceImageUrl:saved.url,sourceVisualPage:saved.page,sourceFigureCropped:true,hasImage:true,imageDependent:true}:{}),
    ...(labels?{choices:Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0,last.charCodeAt(0)-64).split('').map(letter=>[letter,`Visual option ${letter}`])),sourceVisualLabelsConfirmed:true}:{})};
}

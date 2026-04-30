import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

let _supabaseInstance = null;

function getSupabase() {
  if (_supabaseInstance) return _supabaseInstance;
  _supabaseInstance = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
  return _supabaseInstance;
}

export const supabase = getSupabase();

// ─── AUTH ────────────────────────────────────────────

export async function signInWithGoogle() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** True if cloud has a terms row or any objectives row (matches pull “has data” semantics). */
export async function checkCloudHasData(userId) {
  try {
    const [termsRes, objRes] = await Promise.all([
      supabase.from("terms").select("user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("objectives").select("block_id").eq("user_id", userId).limit(1),
    ]);

    if (termsRes.data) return true;
    if (objRes.error) return false;
    return !!(objRes.data && objRes.data.length > 0);
  } catch {
    return false;
  }
}

// ─── MERGE HELPERS ───────────────────────────────────
// Every push is read-merge-write: fetch cloud first, merge local ON TOP additively,
// then write back. Cloud data is never silently deleted or overwritten.

/** Dedup sessions within 90s of each other (same type + lecture = same session). */
function mergeSessions(cloud = [], local = []) {
  const all = [...(cloud || []), ...(local || [])];
  const seen = new Set();
  return all
    .filter((s) => {
      const bucket = Math.floor(new Date(s.date || s.startedAt || 0).getTime() / 90000);
      const key = `${s.sessionType || ""}__${s.lectureId || s.topicKey || ""}__${bucket}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date || a.startedAt || 0) - new Date(b.date || b.startedAt || 0));
}

/** Merge rxt-performance: union sessions per lecture key, never lose entries. */
function mergePerformance(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [key, localEntry] of Object.entries(local || {})) {
    if (!result[key]) {
      result[key] = localEntry;
    } else {
      const mergedSessions = mergeSessions(result[key].sessions, localEntry.sessions);
      const scores = mergedSessions.map((s) => s.score).filter((s) => typeof s === "number");
      result[key] = {
        ...result[key],
        ...localEntry,
        sessions: mergedSessions.slice(-50),
        score: scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : result[key].score ?? localEntry.score,
      };
    }
  }
  return result;
}

/** Merge rxt-completion: take max completionLevel; trust the newer side's reviewDates
 *  (since reviewDates is recomputed from the latest activity each time, unioning re-introduces
 *  dates the user already cleared by reviewing locally). activityLog is unioned by id. */
function mergeCompletion(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [key, localEntry] of Object.entries(local || {})) {
    if (!result[key]) {
      result[key] = localEntry;
    } else {
      const cloudEntry = result[key];
      const cloudTs = cloudEntry.lastActivityDate ? new Date(cloudEntry.lastActivityDate).getTime() : 0;
      const localTs = localEntry.lastActivityDate ? new Date(localEntry.lastActivityDate).getTime() : 0;
      const newer = localTs >= cloudTs ? localEntry : cloudEntry;
      // Union activityLog by id; sort newest first.
      const aLog = Array.isArray(cloudEntry.activityLog) ? cloudEntry.activityLog : [];
      const bLog = Array.isArray(localEntry.activityLog) ? localEntry.activityLog : [];
      const logMap = new Map();
      [...aLog, ...bLog].forEach((e) => {
        if (!e) return;
        const id = e.id || `${e.date || ""}|${e.activityType || ""}|${e.confidenceRating || ""}`;
        const existingLog = logMap.get(id);
        if (!existingLog || new Date(e.date || 0) >= new Date(existingLog.date || 0)) {
          logMap.set(id, e);
        }
      });
      const mergedLog = Array.from(logMap.values()).sort(
        (x, y) => new Date(y.date || 0) - new Date(x.date || 0)
      );
      result[key] = {
        ...cloudEntry,
        ...localEntry,
        completionLevel: Math.max(cloudEntry.completionLevel || 0, localEntry.completionLevel || 0),
        reviewDates: Array.isArray(newer.reviewDates)
          ? newer.reviewDates
          : (cloudEntry.reviewDates || localEntry.reviewDates || []),
        lastActivityDate: newer.lastActivityDate || cloudEntry.lastActivityDate || localEntry.lastActivityDate,
        lastConfidence: newer.lastConfidence || cloudEntry.lastConfidence || localEntry.lastConfidence,
        firstCompletedDate:
          cloudEntry.firstCompletedDate || localEntry.firstCompletedDate || newer.firstCompletedDate,
        activityLog: mergedLog,
      };
    }
  }
  return result;
}

/** Merge objectives for a single block: union by id, trust the entry with more drill evidence. */
function mergeBlockObjectives(cloud, local) {
  if (!cloud) return local;
  if (!local) return cloud;
  const cloudById = {};
  (cloud.imported || []).forEach((o) => { if (o.id) cloudById[o.id] = o; });
  const localById = {};
  (local.imported || []).forEach((o) => { if (o.id) localById[o.id] = o; });
  const allIds = new Set([...Object.keys(cloudById), ...Object.keys(localById)]);
  const merged = [];
  for (const id of allIds) {
    const c = cloudById[id];
    const l = localById[id];
    if (!c) { merged.push(l); continue; }
    if (!l) { merged.push(c); continue; }
    const cDrills = c.drillCount || 0;
    const lDrills = l.drillCount || 0;
    // Prefer whichever has more drill evidence; ties go to local (more recent)
    merged.push(lDrills >= cDrills ? { ...c, ...l } : { ...l, ...c });
  }
  // Union extracted arrays too
  const extractedIds = new Set([...(cloud.extracted || []).map((e) => e.id || e), ...(local.extracted || []).map((e) => e.id || e)]);
  const allExtracted = [...(cloud.extracted || []), ...(local.extracted || [])].filter((e) => {
    const id = e.id || e;
    if (!extractedIds.has(id)) return false;
    extractedIds.delete(id);
    return true;
  });
  return { ...cloud, ...local, imported: merged, extracted: allExtracted };
}

/** Merge rxt-weak-concepts: union concepts per block by id, keep highest missCount. */
function mergeWeakConcepts(cloud = {}, local = {}) {
  const result = {};
  const allBlocks = new Set([...Object.keys(cloud || {}), ...Object.keys(local || {})]);
  for (const blockId of allBlocks) {
    const byId = {};
    [...(cloud[blockId] || []), ...(local[blockId] || [])].forEach((c) => {
      if (!c.id) return;
      if (!byId[c.id] || (c.missCount || 0) > (byId[c.id].missCount || 0)) byId[c.id] = c;
    });
    result[blockId] = Object.values(byId);
  }
  return result;
}

/** Merge rxt-terms: union term/block arrays by id. */
function mergeTerms(cloud, local) {
  if (!cloud) return local;
  if (!local) return cloud;
  if (!Array.isArray(cloud) || !Array.isArray(local)) return local ?? cloud;
  const byId = {};
  [...cloud, ...local].forEach((t) => {
    if (!t.id) return;
    if (!byId[t.id]) { byId[t.id] = t; return; }
    const existingBlocks = byId[t.id].blocks || [];
    const newBlocks = t.blocks || [];
    const blockIds = new Set(existingBlocks.map((b) => b.id));
    byId[t.id] = {
      ...byId[t.id],
      ...t,
      blocks: [...existingBlocks, ...newBlocks.filter((b) => !blockIds.has(b.id))],
    };
  });
  return Object.values(byId);
}

/** Generic additive merge for user_kv values: arrays → union, objects → deep merge, primitives → local wins. */
function mergeKvValue(cloud, local) {
  if (cloud == null) return local;
  if (local == null) return cloud;
  if (Array.isArray(cloud) && Array.isArray(local)) {
    // Try to union by id; fall back to concat+dedup by JSON fingerprint
    const hasIds = local.every((x) => x && typeof x === "object" && x.id);
    if (hasIds) {
      const cloudById = {};
      cloud.forEach((x) => { if (x?.id) cloudById[x.id] = x; });
      const result = [...cloud];
      local.forEach((x) => {
        if (!x?.id || cloudById[x.id]) return; // already in cloud
        result.push(x);
      });
      return result;
    }
    // No ids — union by JSON fingerprint
    const seen = new Set(cloud.map((x) => JSON.stringify(x)));
    return [...cloud, ...local.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  if (typeof cloud === "object" && typeof local === "object") {
    const result = { ...cloud };
    for (const [k, v] of Object.entries(local)) {
      result[k] = k in result ? mergeKvValue(result[k], v) : v;
    }
    return result;
  }
  return local; // primitives: local (most recent) wins
}

// ─── PUSH LOCAL DATA TO SUPABASE ─────────────────────

export async function pushAllLocalDataToSupabase(userId) {
  if (!userId) return [];
  console.log("Starting merge-push for user:", userId);
  const errors = [];
  let networkDown = false;
  const now = new Date().toISOString();

  // Helper: upsert a single row, tracking network failures
  const upsert = async (table, data, conflictCol = "user_id") => {
    if (networkDown) {
      errors.push({ table, error: { message: "Skipped — network unavailable", code: "NETWORK_ERROR" } });
      return false;
    }
    try {
      const { error } = await supabase.from(table).upsert(data, { onConflict: conflictCol });
      if (error) {
        if (!error.code || error.message?.includes("Failed to fetch")) {
          networkDown = true;
          console.warn(`Supabase unreachable on ${table}. Aborting remaining pushes.`);
        } else {
          console.error(`${table} push failed:`, error);
        }
        errors.push({ table, error });
        return false;
      }
      return true;
    } catch (e) {
      networkDown = true;
      const err = { message: e?.message || String(e), code: "NETWORK_ERROR" };
      console.warn(`${table} push exception:`, err.message);
      errors.push({ table, error: err });
      return false;
    }
  };

  // Helper: fetch current cloud value for a single-row table
  const fetchCloud = async (table, select = "data") => {
    try {
      const { data } = await supabase.from(table).select(select).eq("user_id", userId).maybeSingle();
      return data?.data ?? null;
    } catch { return null; }
  };

  // ── 1. TERMS ──────────────────────────────────────────
  const localTerms = localStorage.getItem("rxt-terms");
  if (localTerms && !networkDown) {
    const cloudTerms = await fetchCloud("terms");
    const merged = mergeTerms(cloudTerms, JSON.parse(localTerms));
    // Write merged back to localStorage so local is always the union
    localStorage.setItem("rxt-terms", JSON.stringify(merged));
    await upsert("terms", { user_id: userId, data: merged, updated_at: now });
  }

  // ── 2. LECTURES (per-record upsert — additive by nature) ──────────────────
  // We only push local lectures; cloud-only lectures are preserved because
  // we never DELETE from the lectures table.
  const localLecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
  if (localLecs.length > 0 && !networkDown) {
    try {
      const { error } = await supabase.from("lectures").upsert(
        localLecs.map((l) => {
          const { chunks, ...lecWithoutChunks } = l;
          return {
            user_id: userId,
            lecture_id: l.id,
            block_id: l.blockId,
            term_id: l.termId,
            data: lecWithoutChunks,
            chunks: chunks || [],
            updated_at: now,
          };
        }),
        { onConflict: "user_id,lecture_id" }
      );
      if (error) {
        if (!error.code || error.message?.includes("Failed to fetch")) networkDown = true;
        console.error("lectures push failed:", error);
        errors.push({ table: "lectures", error });
      }
    } catch (e) {
      networkDown = true;
      errors.push({ table: "lectures", error: { message: e?.message || String(e), code: "NETWORK_ERROR" } });
    }
  }

  // ── 3. OBJECTIVES (merge per block) ───────────────────
  const localObjStore = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
  for (const [blockId, localBlockData] of Object.entries(localObjStore)) {
    if (networkDown) {
      errors.push({ table: `objectives:${blockId}`, error: { message: "Skipped — network unavailable", code: "NETWORK_ERROR" } });
      continue;
    }
    try {
      // Fetch cloud version of this block
      const { data: cloudRow } = await supabase
        .from("objectives")
        .select("data")
        .eq("user_id", userId)
        .eq("block_id", blockId)
        .maybeSingle();
      const merged = mergeBlockObjectives(cloudRow?.data ?? null, localBlockData);
      // Write merged back locally so local is always the union
      localObjStore[blockId] = merged;
      const { error } = await supabase.from("objectives").upsert(
        { user_id: userId, block_id: blockId, data: merged, updated_at: now },
        { onConflict: "user_id,block_id" }
      );
      if (error) {
        if (!error.code || error.message?.includes("Failed to fetch")) networkDown = true;
        console.error(`objectives:${blockId} push failed:`, error);
        errors.push({ table: `objectives:${blockId}`, error });
      }
    } catch (e) {
      networkDown = true;
      errors.push({ table: `objectives:${blockId}`, error: { message: e?.message || String(e), code: "NETWORK_ERROR" } });
    }
  }
  // Persist any locally-updated merged objectives
  if (!networkDown) {
    try { localStorage.setItem("rxt-block-objectives", JSON.stringify(localObjStore)); } catch {}
  }

  // ── 4. PERFORMANCE ────────────────────────────────────
  const localPerf = localStorage.getItem("rxt-performance");
  if (localPerf && !networkDown) {
    const cloudPerf = await fetchCloud("performance");
    const merged = mergePerformance(cloudPerf, JSON.parse(localPerf));
    localStorage.setItem("rxt-performance", JSON.stringify(merged));
    await upsert("performance", { user_id: userId, data: merged, updated_at: now });
  }

  // ── 5. COMPLETION ─────────────────────────────────────
  const localComp = localStorage.getItem("rxt-completion");
  if (localComp && !networkDown) {
    const cloudComp = await fetchCloud("completion");
    const merged = mergeCompletion(cloudComp, JSON.parse(localComp));
    localStorage.setItem("rxt-completion", JSON.stringify(merged));
    await upsert("completion", { user_id: userId, data: merged, updated_at: now });
  }

  // ── 6. WEAK CONCEPTS ──────────────────────────────────
  const localWeak = localStorage.getItem("rxt-weak-concepts");
  if (localWeak && !networkDown) {
    const cloudWeak = await fetchCloud("weak_concepts");
    const merged = mergeWeakConcepts(cloudWeak, JSON.parse(localWeak));
    localStorage.setItem("rxt-weak-concepts", JSON.stringify(merged));
    await upsert("weak_concepts", { user_id: userId, data: merged, updated_at: now });
  }

  // ── 7. TRACKER ────────────────────────────────────────
  const localTracker = localStorage.getItem("rxt-tracker-v2");
  if (localTracker && !networkDown) {
    // Tracker is an array; cloud is authoritative for old rows, local adds new ones
    const cloudTracker = await fetchCloud("tracker");
    const merged = mergeKvValue(cloudTracker, JSON.parse(localTracker));
    localStorage.setItem("rxt-tracker-v2", JSON.stringify(merged));
    await upsert("tracker", { user_id: userId, data: merged, updated_at: now });
  }

  // ── 8. USER_KV (all remaining keys) ───────────────────
  const KV_KEYS = [
    "rxt-question-banks",
    "rxt-exam-results",
    "rxt-exam-dates",
    "rxt-learning-profile",
    "rxt-sessions",
    "rxt-analyses",
    "rxt-weak-areas",
    "rxt-dl-sessions",
    "rxt-missed-questions",
    "rxt-supplemental-resources",
    "rxt-reviewed-lecs",
    "rxt-style-prefs",
    "rxt-question-notes",
    "rxt-calibration-log",
  ];
  if (!networkDown) {
    // Fetch all existing cloud kv rows in one query
    try {
      const { data: cloudKvRows } = await supabase
        .from("user_kv")
        .select("key, data")
        .eq("user_id", userId)
        .in("key", KV_KEYS);
      const cloudKvMap = {};
      (cloudKvRows || []).forEach((r) => { cloudKvMap[r.key] = r.data; });

      const kvRows = KV_KEYS
        .map((key) => {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          try {
            const localVal = JSON.parse(raw);
            const merged = mergeKvValue(cloudKvMap[key] ?? null, localVal);
            // Write merged back locally
            try { localStorage.setItem(key, JSON.stringify(merged)); } catch {}
            return { user_id: userId, key, data: merged, updated_at: now };
          } catch { return null; }
        })
        .filter(Boolean);

      if (kvRows.length > 0) {
        const { error } = await supabase.from("user_kv").upsert(kvRows, { onConflict: "user_id,key" });
        if (error) {
          if (!error.code || error.message?.includes("Failed to fetch")) networkDown = true;
          console.error("user_kv push failed:", error);
          errors.push({ table: "user_kv", error });
        }
      }
    } catch (e) {
      networkDown = true;
      errors.push({ table: "user_kv", error: { message: e?.message || String(e), code: "NETWORK_ERROR" } });
    }
  }

  // ── 9. MCQ BANK (fire and forget — per-record, additive) ──────────────────
  if (!networkDown) {
    pushMcqBankToSupabase(userId).catch(() => {});
  }

  if (errors.length > 0) {
    const networkErrors = errors.filter((e) => e.error?.code === "NETWORK_ERROR").length;
    const realErrors = errors.length - networkErrors;
    if (networkDown) {
      console.warn(`Push aborted — Supabase unreachable. ${realErrors} API error(s), ${networkErrors} skipped.`);
    } else {
      console.warn(`Push completed with ${errors.length} error(s):`, errors);
    }
  } else {
    console.log("Merge-push complete — all data additive, nothing overwritten");
  }

  return errors;
}

// ─── PULL SUPABASE DATA TO LOCAL ─────────────────────

export async function pullAllDataFromSupabase(userId) {
  if (!userId) return {};

  console.log("Pulling data for user:", userId);

  const { data: terms, error: termsErr } = await supabase
    .from("terms")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  if (termsErr) {
    console.error("terms pull failed:", termsErr);
    throw termsErr;
  }

  if (!terms?.data) {
    console.log("No cloud data found — skipping pull");
    return { empty: true };
  }

  // Terms: merge cloud into local (union blocks)
  const localTermsRaw = localStorage.getItem("rxt-terms");
  const mergedTerms = mergeTerms(localTermsRaw ? JSON.parse(localTermsRaw) : null, terms.data);
  localStorage.setItem("rxt-terms", JSON.stringify(mergedTerms));

  // Lectures: cloud adds to local, local stubs preserved
  const { data: lecs, error: lecsErr } = await supabase
    .from("lectures")
    .select("data, chunks, lecture_id")
    .eq("user_id", userId);

  if (lecsErr) {
    console.error("lectures pull failed:", lecsErr);
  } else if (lecs?.length > 0) {
    const fromCloud = lecs.map((l) => ({
      ...l.data,
      chunks: l.chunks || [],
      id: l.lecture_id,
    }));
    const local = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
    const cloudIds = new Set(fromCloud.map((l) => l.id));
    const localOnly = local.filter((l) => !cloudIds.has(l.id));
    localStorage.setItem("rxt-lec-meta", JSON.stringify([...fromCloud, ...localOnly]));
  }

  // Objectives: merge per block using same merge function as push
  const { data: objs, error: objsErr } = await supabase
    .from("objectives")
    .select("block_id, data")
    .eq("user_id", userId);

  if (objsErr) {
    console.error("objectives pull failed:", objsErr);
  } else if (objs?.length > 0) {
    const local = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
    const objMap = { ...local };
    objs.forEach((o) => {
      objMap[o.block_id] = mergeBlockObjectives(local[o.block_id] ?? null, o.data);
    });
    localStorage.setItem("rxt-block-objectives", JSON.stringify(objMap));
  }

  // Performance: merge sessions — never lose local sessions
  const { data: perf } = await supabase.from("performance").select("data").eq("user_id", userId).maybeSingle();
  if (perf?.data) {
    const localPerf = localStorage.getItem("rxt-performance");
    const merged = mergePerformance(perf.data, localPerf ? JSON.parse(localPerf) : {});
    localStorage.setItem("rxt-performance", JSON.stringify(merged));
  }

  // Completion: merge, take max completionLevel
  const { data: comp } = await supabase.from("completion").select("data").eq("user_id", userId).maybeSingle();
  if (comp?.data) {
    const localComp = localStorage.getItem("rxt-completion");
    const merged = mergeCompletion(comp.data, localComp ? JSON.parse(localComp) : {});
    localStorage.setItem("rxt-completion", JSON.stringify(merged));
  }

  // Weak concepts: union
  const { data: weak } = await supabase.from("weak_concepts").select("data").eq("user_id", userId).maybeSingle();
  if (weak?.data) {
    const localWeak = localStorage.getItem("rxt-weak-concepts");
    const merged = mergeWeakConcepts(weak.data, localWeak ? JSON.parse(localWeak) : {});
    localStorage.setItem("rxt-weak-concepts", JSON.stringify(merged));
  }

  // Tracker: additive merge
  const { data: tracker } = await supabase.from("tracker").select("data").eq("user_id", userId).maybeSingle();
  if (tracker?.data) {
    const localTracker = localStorage.getItem("rxt-tracker-v2");
    const merged = mergeKvValue(tracker.data, localTracker ? JSON.parse(localTracker) : null);
    localStorage.setItem("rxt-tracker-v2", JSON.stringify(merged));
  }

  // Pull user_kv in background — non-blocking
  pullUserKvFromSupabase(userId).catch(() => {});

  // Pull MCQ bank in background — non-blocking
  pullMcqBankFromSupabase(userId).catch(() => {});

  console.log("Pull complete");
  return true;
}

/**
 * Pull all user_kv rows from Supabase into localStorage.
 * Called once on sign-in alongside pullAllDataFromSupabase.
 */
export async function pullUserKvFromSupabase(userId) {
  if (!userId) return;
  try {
    const { data, error } = await supabase
      .from("user_kv")
      .select("key, data")
      .eq("user_id", userId);
    if (error) { console.warn("user_kv pull failed:", error); return; }
    if (!data?.length) return;
    data.forEach(({ key, data: val }) => {
      if (val == null) return;
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        console.warn("user_kv restore failed for", key, e?.message);
      }
    });
    console.log(`user_kv: pulled ${data.length} keys from Supabase`);
  } catch (e) {
    console.warn("user_kv pull exception:", e?.message);
  }
}

// ─── MCQ BANK ─────────────────────────────────────────

/**
 * Upsert a single question into Supabase mcq_bank.
 * Also writes to localStorage as a fast local cache.
 */
export async function saveMcqBankEntry(userId, objectiveId, round, data) {
  if (!userId || !objectiveId) return;
  // Always keep localStorage in sync as the fast read cache
  try {
    const bank = JSON.parse(localStorage.getItem("rxt-mcq-bank") || "{}");
    bank[`${objectiveId}_r${round ?? 0}`] = { ...data, _savedAt: Date.now() };
    localStorage.setItem("rxt-mcq-bank", JSON.stringify(bank));
  } catch { /* storage full — ignore */ }

  try {
    await supabase.from("mcq_bank").upsert(
      { user_id: userId, objective_id: objectiveId, round: round ?? 0, data, updated_at: new Date().toISOString() },
      { onConflict: "user_id,objective_id,round" }
    );
  } catch (e) {
    console.warn("mcq_bank save failed:", e?.message);
  }
}

/**
 * Pull all mcq_bank rows for this user from Supabase into localStorage.
 * Called once on sign-in alongside pullAllDataFromSupabase.
 */
export async function pullMcqBankFromSupabase(userId) {
  if (!userId) return;
  try {
    const { data, error } = await supabase
      .from("mcq_bank")
      .select("objective_id, round, data")
      .eq("user_id", userId);
    if (error) { console.warn("mcq_bank pull failed:", error); return; }
    if (!data?.length) return;
    const bank = {};
    data.forEach(({ objective_id, round, data: qData }) => {
      bank[`${objective_id}_r${round ?? 0}`] = qData;
    });
    localStorage.setItem("rxt-mcq-bank", JSON.stringify(bank));
    console.log(`mcq_bank: pulled ${data.length} questions from Supabase`);
  } catch (e) {
    console.warn("mcq_bank pull exception:", e?.message);
  }
}

/**
 * Push the entire local mcq_bank to Supabase.
 * Used in the full data push cycle.
 */
export async function pushMcqBankToSupabase(userId) {
  if (!userId) return;
  try {
    const bank = JSON.parse(localStorage.getItem("rxt-mcq-bank") || "{}");
    const entries = Object.entries(bank);
    if (!entries.length) return;
    const rows = entries.map(([key, data]) => {
      const [objId, roundStr] = key.split("_r");
      return {
        user_id: userId,
        objective_id: objId,
        round: parseInt(roundStr ?? "0", 10) || 0,
        data,
        updated_at: new Date().toISOString(),
      };
    });
    // Batch in groups of 100 to stay within Supabase payload limits
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from("mcq_bank")
        .upsert(batch, { onConflict: "user_id,objective_id,round" });
      if (error) console.warn("mcq_bank batch push failed:", error);
    }
    console.log(`mcq_bank: pushed ${rows.length} questions to Supabase`);
  } catch (e) {
    console.warn("mcq_bank push exception:", e?.message);
  }
}

// ─── QUESTION IMAGES ─────────────────────────────────

/**
 * Upload a single image file (File or Blob) attached to a drill question.
 * Stores the file in Storage and records metadata in question_images table.
 * Returns the storage path on success, null on failure.
 */
export async function uploadQuestionImage(userId, objectiveId, round, file) {
  if (!userId || !objectiveId || !file) return null;
  const ext = file.name.split(".").pop() || "jpg";
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const path = `${userId}/${objectiveId}_r${round ?? 0}/${safeName}`;
  try {
    const { error: uploadErr } = await supabase.storage
      .from("question-images")
      .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (uploadErr) { console.warn("question image upload failed:", uploadErr.message); return null; }

    const { error: metaErr } = await supabase.from("question_images").insert({
      user_id: userId,
      objective_id: objectiveId,
      round: round ?? 0,
      storage_path: path,
      filename: file.name,
      mime_type: file.type || null,
    });
    if (metaErr) console.warn("question_images meta insert failed:", metaErr.message);
    return path;
  } catch (e) {
    console.warn("uploadQuestionImage exception:", e?.message);
    return null;
  }
}

/**
 * Fetch all image metadata for a question, with signed URLs for display.
 * Returns [{storagePath, filename, mimeType, url, addedAt}]
 */
export async function fetchQuestionImages(userId, objectiveId, round) {
  if (!userId || !objectiveId) return [];
  try {
    const { data, error } = await supabase
      .from("question_images")
      .select("storage_path, filename, mime_type, added_at")
      .eq("user_id", userId)
      .eq("objective_id", objectiveId)
      .eq("round", round ?? 0)
      .order("added_at", { ascending: true });
    if (error || !data?.length) return [];

    const signed = await Promise.all(
      data.map(async (row) => {
        const { data: urlData } = await supabase.storage
          .from("question-images")
          .createSignedUrl(row.storage_path, 3600); // 1h TTL
        return {
          storagePath: row.storage_path,
          filename: row.filename,
          mimeType: row.mime_type,
          url: urlData?.signedUrl || null,
          addedAt: row.added_at,
        };
      })
    );
    return signed.filter((s) => s.url);
  } catch (e) {
    console.warn("fetchQuestionImages exception:", e?.message);
    return [];
  }
}

/**
 * Delete a single question image by its storage path.
 */
export async function deleteQuestionImage(userId, storagePath) {
  if (!userId || !storagePath) return;
  try {
    await supabase.storage.from("question-images").remove([storagePath]);
    await supabase.from("question_images").delete()
      .eq("user_id", userId)
      .eq("storage_path", storagePath);
  } catch (e) {
    console.warn("deleteQuestionImage exception:", e?.message);
  }
}

// ─── AUTO SYNC (call after key data changes) ──────────

let syncTimeout = null;

export function scheduleSyncToSupabase(userId) {
  if (!userId) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      await pushAllLocalDataToSupabase(userId);
      console.log("Auto-sync complete");
    } catch (e) {
      console.error("Auto-sync failed:", e);
    }
  }, 30000);
}

// Short debounce for session / local edits — use immediate push for sign-in and manual "Save to cloud".

const DEBOUNCED_PUSH_MS = 3000;
let debouncedPushTimer = null;

export function clearDebouncedCloudPush() {
  if (debouncedPushTimer) {
    clearTimeout(debouncedPushTimer);
    debouncedPushTimer = null;
  }
}

export function scheduleDebouncedCloudPush(userId) {
  if (!userId) return;
  clearTimeout(debouncedPushTimer);
  debouncedPushTimer = setTimeout(async () => {
    debouncedPushTimer = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.id !== userId) return;
      await pushAllLocalDataToSupabase(userId);
      console.log("Background cloud push complete");
    } catch (e) {
      console.warn("Background cloud push failed:", e?.message || e);
    }
  }, DEBOUNCED_PUSH_MS);
}

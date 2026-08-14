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

// ─── PUSH LOCAL DATA TO SUPABASE ─────────────────────

export async function pushAllLocalDataToSupabase(userId) {
  if (!userId) return [];
  console.log("Starting full data push for user:", userId);
  const errors = [];

  const upsert = async (table, data) => {
    const { error } = await supabase.from(table).upsert(data, { onConflict: "user_id" });
    if (error) {
      console.error(`${table} push failed:`, error);
      errors.push({ table, error });
    }
  };

  const terms = localStorage.getItem("rxt-terms");
  if (terms) {
    await upsert("terms", {
      user_id: userId,
      data: JSON.parse(terms),
      updated_at: new Date().toISOString(),
    });
  }

  const lecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
  if (lecs.length > 0) {
    const { error } = await supabase.from("lectures").upsert(
      lecs.map((l) => {
        const { chunks, ...lecWithoutChunks } = l;
        return {
          user_id: userId,
          lecture_id: l.id,
          block_id: l.blockId,
          term_id: l.termId,
          data: lecWithoutChunks,
          chunks: chunks || [],
          updated_at: new Date().toISOString(),
        };
      }),
      { onConflict: "user_id,lecture_id" }
    );
    if (error) {
      console.error("lectures push failed:", error);
      errors.push({ table: "lectures", error });
    }
  }

  const objStored = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
  for (const [blockId, data] of Object.entries(objStored)) {
    const { error } = await supabase.from("objectives").upsert(
      {
        user_id: userId,
        block_id: blockId,
        data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,block_id" }
    );
    if (error) {
      console.error("objectives push failed:", error);
      errors.push({ table: "objectives", error });
    }
  }

  const perf = localStorage.getItem("rxt-performance");
  if (perf) {
    await upsert("performance", {
      user_id: userId,
      data: JSON.parse(perf),
      updated_at: new Date().toISOString(),
    });
  }

  const comp = localStorage.getItem("rxt-completion");
  if (comp) {
    await upsert("completion", {
      user_id: userId,
      data: JSON.parse(comp),
      updated_at: new Date().toISOString(),
    });
  }

  const weak = localStorage.getItem("rxt-weak-concepts");
  if (weak) {
    await upsert("weak_concepts", {
      user_id: userId,
      data: JSON.parse(weak),
      updated_at: new Date().toISOString(),
    });
  }

  const tracker = localStorage.getItem("rxt-tracker-v2");
  if (tracker) {
    await upsert("tracker", {
      user_id: userId,
      data: JSON.parse(tracker),
      updated_at: new Date().toISOString(),
    });
  }

  if (errors.length > 0) {
    console.warn(`Push completed with ${errors.length} errors:`, errors);
  } else {
    console.log("Full push successful");
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

  localStorage.setItem("rxt-terms", JSON.stringify(terms.data));

  const { data: lecs, error: lecsErr } = await supabase
    .from("lectures")
    .select("data, chunks, lecture_id")
    .eq("user_id", userId);

  if (lecsErr) {
    console.error("lectures pull failed:", lecsErr);
  } else if (lecs?.length > 0) {
    const merged = lecs.map((l) => ({
      ...l.data,
      chunks: l.chunks || [],
      id: l.lecture_id,
    }));
    localStorage.setItem("rxt-lec-meta", JSON.stringify(merged));
  }

  const { data: objs, error: objsErr } = await supabase
    .from("objectives")
    .select("block_id, data")
    .eq("user_id", userId);

  if (objsErr) {
    console.error("objectives pull failed:", objsErr);
  } else if (objs?.length > 0) {
    const objMap = {};
    objs.forEach((o) => {
      objMap[o.block_id] = o.data;
    });
    localStorage.setItem("rxt-block-objectives", JSON.stringify(objMap));
  }

  const { data: perf } = await supabase.from("performance").select("data").eq("user_id", userId).maybeSingle();
  if (perf?.data) localStorage.setItem("rxt-performance", JSON.stringify(perf.data));

  const { data: comp } = await supabase.from("completion").select("data").eq("user_id", userId).maybeSingle();
  if (comp?.data) localStorage.setItem("rxt-completion", JSON.stringify(comp.data));

  const { data: weak } = await supabase.from("weak_concepts").select("data").eq("user_id", userId).maybeSingle();
  if (weak?.data) localStorage.setItem("rxt-weak-concepts", JSON.stringify(weak.data));

  const { data: tracker } = await supabase.from("tracker").select("data").eq("user_id", userId).maybeSingle();
  if (tracker?.data) localStorage.setItem("rxt-tracker-v2", JSON.stringify(tracker.data));

  console.log("Pull complete");
  return true;
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

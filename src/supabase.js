import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

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

// ─── PUSH LOCAL DATA TO SUPABASE ─────────────────────

export async function pushAllLocalDataToSupabase(userId) {
  if (!userId) return {};
  console.log("Starting full data push for user:", userId);

  const results = {};

  // 1. Terms/blocks structure
  try {
    const terms = localStorage.getItem("rxt-terms");
    if (terms) {
      const { error } = await supabase.from("terms").upsert(
        {
          user_id: userId,
          data: JSON.parse(terms),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      results.terms = error ? "error: " + error.message : "ok";
    }
  } catch (e) {
    results.terms = "error: " + e.message;
  }

  // 2. Lectures (split chunks to avoid row size limits)
  try {
    const lecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
    for (const lec of lecs) {
      const { chunks, ...lecWithoutChunks } = lec;
      const { error } = await supabase.from("lectures").upsert(
        {
          user_id: userId,
          lecture_id: lec.id,
          block_id: lec.blockId,
          term_id: lec.termId,
          data: lecWithoutChunks,
          chunks: chunks || [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,lecture_id" }
      );
      if (error) throw error;
    }
    results.lectures = `ok (${lecs.length} lectures)`;
  } catch (e) {
    results.lectures = "error: " + e.message;
  }

  // 3. Objectives
  try {
    const objs = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
    for (const [blockId, data] of Object.entries(objs)) {
      const { error } = await supabase.from("objectives").upsert(
        {
          user_id: userId,
          block_id: blockId,
          data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,block_id" }
      );
      if (error) throw error;
    }
    results.objectives = "ok";
  } catch (e) {
    results.objectives = "error: " + e.message;
  }

  // 4. Performance
  try {
    const perf = localStorage.getItem("rxt-performance");
    if (perf) {
      const { error } = await supabase.from("performance").upsert(
        {
          user_id: userId,
          data: JSON.parse(perf),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      results.performance = error ? "error: " + error.message : "ok";
    }
  } catch (e) {
    results.performance = "error: " + e.message;
  }

  // 5. Completion
  try {
    const completion = localStorage.getItem("rxt-completion");
    if (completion) {
      const { error } = await supabase.from("completion").upsert(
        {
          user_id: userId,
          data: JSON.parse(completion),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      results.completion = error ? "error: " + error.message : "ok";
    }
  } catch (e) {
    results.completion = "error: " + e.message;
  }

  // 6. Weak concepts
  try {
    const wc = localStorage.getItem("rxt-weak-concepts");
    if (wc) {
      const { error } = await supabase.from("weak_concepts").upsert(
        {
          user_id: userId,
          data: JSON.parse(wc),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      results.weak_concepts = error ? "error: " + error.message : "ok";
    }
  } catch (e) {
    results.weak_concepts = "error: " + e.message;
  }

  // 7. Tracker
  try {
    const tracker = localStorage.getItem("rxt-tracker-v2");
    if (tracker) {
      const { error } = await supabase.from("tracker").upsert(
        {
          user_id: userId,
          data: JSON.parse(tracker),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      results.tracker = error ? "error: " + error.message : "ok";
    }
  } catch (e) {
    results.tracker = "error: " + e.message;
  }

  console.log("Push complete:", results);
  return results;
}

// ─── PULL SUPABASE DATA TO LOCAL ─────────────────────

export async function pullAllDataFromSupabase(userId) {
  if (!userId) return {};
  console.log("Pulling data for user:", userId);

  const results = {};

  // 1. Terms
  try {
    const { data, error } = await supabase.from("terms").select("data").eq("user_id", userId).maybeSingle();
    if (!error && data?.data) {
      localStorage.setItem("rxt-terms", JSON.stringify(data.data));
      results.terms = "ok";
    } else {
      results.terms = error ? "error: " + error.message : "not found";
    }
  } catch (e) {
    results.terms = "error: " + e.message;
  }

  // 2. Lectures
  try {
    const { data, error } = await supabase.from("lectures").select("data, chunks, lecture_id").eq("user_id", userId);
    if (error) throw error;
    if (data?.length) {
      const lecs = data.map((row) => ({
        ...row.data,
        chunks: row.chunks || [],
        id: row.lecture_id,
      }));
      localStorage.setItem("rxt-lec-meta", JSON.stringify(lecs));
      results.lectures = `ok (${lecs.length})`;
    }
  } catch (e) {
    results.lectures = "error: " + e.message;
  }

  // 3. Objectives
  try {
    const { data, error } = await supabase.from("objectives").select("block_id, data").eq("user_id", userId);
    if (error) throw error;
    if (data?.length) {
      const objs = {};
      data.forEach((row) => {
        objs[row.block_id] = row.data;
      });
      localStorage.setItem("rxt-block-objectives", JSON.stringify(objs));
      results.objectives = "ok";
    }
  } catch (e) {
    results.objectives = "error: " + e.message;
  }

  // 4. Performance
  try {
    const { data, error } = await supabase.from("performance").select("data").eq("user_id", userId).maybeSingle();
    if (!error && data?.data) {
      localStorage.setItem("rxt-performance", JSON.stringify(data.data));
      results.performance = "ok";
    } else {
      results.performance = error ? "error: " + error.message : "not found";
    }
  } catch (e) {
    results.performance = "error: " + e.message;
  }

  // 5. Completion
  try {
    const { data, error } = await supabase.from("completion").select("data").eq("user_id", userId).maybeSingle();
    if (!error && data?.data) {
      localStorage.setItem("rxt-completion", JSON.stringify(data.data));
      results.completion = "ok";
    } else {
      results.completion = error ? "error: " + error.message : "not found";
    }
  } catch (e) {
    results.completion = "error: " + e.message;
  }

  // 6. Weak concepts
  try {
    const { data, error } = await supabase.from("weak_concepts").select("data").eq("user_id", userId).maybeSingle();
    if (!error && data?.data) {
      localStorage.setItem("rxt-weak-concepts", JSON.stringify(data.data));
      results.weak_concepts = "ok";
    } else {
      results.weak_concepts = error ? "error: " + error.message : "not found";
    }
  } catch (e) {
    results.weak_concepts = "error: " + e.message;
  }

  // 7. Tracker
  try {
    const { data, error } = await supabase.from("tracker").select("data").eq("user_id", userId).maybeSingle();
    if (!error && data?.data) {
      localStorage.setItem("rxt-tracker-v2", JSON.stringify(data.data));
      results.tracker = "ok";
    } else {
      results.tracker = error ? "error: " + error.message : "not found";
    }
  } catch (e) {
    results.tracker = "error: " + e.message;
  }

  console.log("Pull complete:", results);
  return results;
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

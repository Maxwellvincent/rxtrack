// Local LLM bridge — optional, free, subscription-powered.
//
// `llm-bridge` (C:/Users/Itachi91/Projects/llm-bridge) runs on loopback and proxies to the
// CLIs already paid for (Claude Code, Codex, Gemini) plus ollama offline. Subscriptions
// license those clients, not the API, so a Cloud Function can never use them — but the
// browser on this machine can.
//
// Every call here is best-effort: if the bridge is not running, or fails for any reason,
// callers fall through to the normal `aiComplete` Cloud Function path. Nothing breaks when
// the bridge is absent, which is the common case (phone, other machines, other people).

const BRIDGE_URL =
  (typeof localStorage !== "undefined" && localStorage.getItem("rxt_bridge_url")) ||
  "http://127.0.0.1:4319";

// A positive probe is cheap to trust for a while. A negative one is not: the bridge spends
// most of its life mid-generation (a five-atom quiz is ~40s of `claude`), and a 1.2s health
// check that blips during one of those used to blackball the bridge for a full 30 seconds —
// long enough to push a whole study round onto the cloud path, which has no credit. So
// failures expire fast and successes last.
const PROBE_OK_TTL_MS = 30_000;
const PROBE_FAIL_TTL_MS = 3_000;
const PROBE_TIMEOUT_MS = 4_000;
let probe = { at: 0, ok: false };

/** True while the cached probe result is still worth reusing. */
export function probeIsFresh(p, now = Date.now()) {
  const age = now - (p?.at || 0);
  return p?.ok ? age < PROBE_OK_TTL_MS : age < PROBE_FAIL_TTL_MS;
}

/** Test seam: reset the cached probe between cases. */
export function resetBridgeProbe() {
  probe = { at: 0, ok: false };
}

/** Off by default is wrong here — the point is zero-cost when available. Explicit opt-out only. */
export function bridgeEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("rxt_bridge") !== "off";
}

export function setBridgeEnabled(on) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("rxt_bridge", on ? "on" : "off");
  probe = { at: 0, ok: false };
}

/** Cached reachability check so we never add a round trip per call. */
export async function bridgeAvailable() {
  if (!bridgeEnabled()) return false;
  const now = Date.now();
  if (probeIsFresh(probe, now)) return probe.ok;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    const r = await fetch(`${BRIDGE_URL}/health`, { signal: ctl.signal });
    clearTimeout(t);
    probe = { at: now, ok: r.ok };
  } catch {
    probe = { at: now, ok: false };
  }
  return probe.ok;
}

/**
 * Returns the model's raw text, or null when the bridge is unavailable/failed —
 * null means "caller should use the cloud path", it is not an error.
 *
 * @param {{system?:string, prompt:string, images?:Array<{mimeType:string,data:string}>, json?:boolean}} req
 */
export async function bridgeComplete(req) {
  if (!(await bridgeAvailable())) return null;
  try {
    const r = await fetch(`${BRIDGE_URL}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system: req.system || "",
        prompt: req.prompt || "",
        images: req.images || [],
        json: !!req.json,
      }),
    });
    if (!r.ok) throw new Error(`bridge ${r.status}`);
    const data = await r.json();
    if (!data.text) throw new Error("bridge returned no text");
    // A completed call is far better evidence of health than a health check, and it costs
    // nothing to record — the next call in a round skips probing entirely.
    probe = { at: Date.now(), ok: true };
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("rxt-bridge-used", { detail: { backend: data.backend } })
      );
    }
    return data.text;
  } catch (err) {
    console.warn("llm-bridge unavailable, using cloud:", err.message);
    probe = { at: Date.now(), ok: false };
    return null;
  }
}

/** Bridge backends are told to emit bare JSON, but CLIs still like to wrap it in chatter. */
export function parseBridgeJSON(text) {
  const cleaned = String(text || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new Error("bridge reply was not JSON");
  }
}

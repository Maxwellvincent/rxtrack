// supabase/functions/generate-recognition-items/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SYSTEM = `You are a USMLE Step 1 item writer. Given a fact from a medical
flashcard, produce diverse patient-recognition items. Return STRICT JSON:
{"vignettes":[{"vignette":"...","leadIn":"What is the most likely diagnosis?",
"correctDiagnosis":"...","mechanism":"...","keyDifferentiator":"...",
"options":[{"letter":"A","text":"...","isCorrect":true,"whyWrong":""},
{"letter":"B","text":"...","isCorrect":false,"whyWrong":"..."}]}]}.
Produce {{N}} distinct vignettes varying age/sex/presentation. Mechanism-first
teaching. No markdown, JSON only.`;

/** Defensive JSON parse — tolerate code fences / stray prose. */
function parseVignettes(txt: string): any[] {
  let s = (txt || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start > 0 || end < s.length - 1) s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed.vignettes) ? parsed.vignettes : [];
  } catch {
    return [];
  }
}

async function genWithGemini(prompt: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return parseVignettes(json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

async function genWithClaude(system: string, prompt: string, apiKey: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return parseVignettes(json?.content?.[0]?.text || "{}");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { blockId = null, perCard = 3, batch = 6, weakSubjects = [] } = await req.json();

    // Derive the user from the JWT (verify_jwt is on) — never trust a body userId.
    // This prevents a caller from generating rows / spending the AI budget under
    // another user's id.
    const authHeader = req.headers.get("Authorization") || "";
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
    }
    const userId = user.id;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!anthropicKey && !geminiKey) {
      return new Response(
        JSON.stringify({ error: "No AI key set — set ANTHROPIC_API_KEY or GEMINI_API_KEY as an Edge Function secret" }),
        { status: 500, headers: jsonHeaders }
      );
    }
    const provider = anthropicKey ? "claude" : "gemini";
    const system = SYSTEM.replace("{{N}}", String(perCard));

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Next un-generated cards (server-side anti-join — advances every call).
    const { data: cards, error: rpcErr } = await supabase.rpc("ungenerated_cards", {
      p_user: userId, p_block: blockId, p_limit: Math.min(batch, 12),
    });
    if (rpcErr) throw rpcErr;

    // Weak-area subjects first.
    const weak = new Set(weakSubjects || []);
    const ordered = (cards || []).slice().sort((a: any, b: any) =>
      (weak.has(b.subject) ? 1 : 0) - (weak.has(a.subject) ? 1 : 0)
    );

    let generated = 0;
    let processed = 0;
    for (const card of ordered) {
      const prompt = `FACT (block ${card.block_id}, subject ${card.subject || "—"}):\n${card.text}`;
      let vignettes: any[] = [];
      try {
        vignettes = provider === "claude"
          ? await genWithClaude(system, prompt, anthropicKey!)
          : await genWithGemini(`${system}\n\n${prompt}`, geminiKey!);
      } catch (e) {
        console.error("gen failed", card.card_id, String(e));
        continue;
      }
      processed++;
      const rows = vignettes.map((v) => ({
        user_id: userId, block_id: card.block_id, subject: card.subject,
        source_card_id: card.card_id, kind: "vignette", data: v,
        weak_for: weak.has(card.subject) ? [card.subject] : [],
      }));
      if (rows.length) {
        const { error } = await supabase.from("recognition_items").insert(rows);
        if (!error) generated += rows.length;
      }
    }

    const { data: remaining } = await supabase.rpc("ungenerated_count", { p_user: userId, p_block: blockId });

    return new Response(
      JSON.stringify({ generated, processed, remaining: remaining ?? null, provider }),
      { headers: jsonHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders });
  }
});

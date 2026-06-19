// supabase/functions/generate-recognition-items/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";

const SYSTEM = `You are a USMLE Step 1 item writer. Given a fact from a medical
flashcard, produce diverse patient-recognition items. Return STRICT JSON:
{"vignettes":[{"vignette":"...","leadIn":"What is the most likely diagnosis?",
"correctDiagnosis":"...","mechanism":"...","keyDifferentiator":"...",
"options":[{"letter":"A","text":"...","isCorrect":true,"whyWrong":""},
{"letter":"B","text":"...","isCorrect":false,"whyWrong":"..."}]}]}.
Produce {{N}} distinct vignettes varying age/sex/presentation. Mechanism-first
teaching. No markdown, JSON only.`;

async function genForCard(card: any, perCard: number, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const prompt = `${SYSTEM.replace("{{N}}", String(perCard))}\n\nFACT (block ${card.block_id}, subject ${card.subject || "—"}):\n${card.text}`;
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
  const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(txt);
  return Array.isArray(parsed.vignettes) ? parsed.vignettes : [];
}

Deno.serve(async (req) => {
  try {
    const { userId, blockId, perCard = 3, weakSubjects = [] } = await req.json();
    if (!userId) return new Response(JSON.stringify({ error: "userId required" }), { status: 400 });
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not set as an Edge Function secret" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Cards for this user/block that have no items yet (idempotent).
    let q = supabase.from("anki_cards").select("card_id, block_id, subject, text").eq("user_id", userId);
    if (blockId) q = q.eq("block_id", blockId);
    const { data: cards, error: cardsErr } = await q.limit(50);
    if (cardsErr) throw cardsErr;

    const { data: existing } = await supabase
      .from("recognition_items").select("source_card_id").eq("user_id", userId);
    const done = new Set((existing || []).map((r) => r.source_card_id));
    const todo = (cards || []).filter((c) => !done.has(c.card_id));

    let generated = 0;
    for (const card of todo) {
      let vignettes: any[] = [];
      try { vignettes = await genForCard(card, perCard, apiKey!); }
      catch (e) { console.error("gen failed", card.card_id, String(e)); continue; }
      const rows = vignettes.map((v) => ({
        user_id: userId, block_id: card.block_id, subject: card.subject,
        source_card_id: card.card_id, kind: "vignette", data: v,
        weak_for: weakSubjects.includes(card.subject) ? [card.subject] : [],
      }));
      if (rows.length) {
        const { error } = await supabase.from("recognition_items").insert(rows);
        if (!error) generated += rows.length;
      }
    }
    return new Response(JSON.stringify({ generated, cards: todo.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});

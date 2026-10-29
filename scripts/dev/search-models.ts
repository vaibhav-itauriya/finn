// Which models on this key can do Google-grounded search right now? npx tsx scripts/dev/search-models.ts
import { readFileSync } from "node:fs";
const key = process.env.GEMINI_API_KEY!;
const models = (JSON.parse(readFileSync("data/models.json", "utf8")) as { name: string }[]).map((m) => m.name).filter((n) => /^gemini-\d.*flash/.test(n) && !/(image|tts|audio|live|embed|exp|thinking|computer|robot|native|transcribe)/.test(n));
(async () => {
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "In one sentence: who is Anup Bagchi of HDFC Bank and what was his previous job?" }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 200 } }),
    });
    const t = await r.text();
    let msg = "";
    try {
      const j = JSON.parse(t);
      msg = j.error ? `${j.error.status}: ${j.error.message.slice(0, 140)}` : `${(j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text).join("").slice(0, 140)} | sources ${j.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0}`;
    } catch {
      msg = t.slice(0, 140);
    }
    console.log(`${m.padEnd(32)} ${r.status} ${msg}`);
  }
})();

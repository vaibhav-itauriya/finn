// How fast does each model answer a ledger-sized prompt, with and without limited thinking?
//   npx tsx scripts/dev/speed.ts
import { readFileSync } from "node:fs";
const key = process.env.GEMINI_API_KEY!;
const models = (JSON.parse(readFileSync("data/models.json", "utf8")) as { name: string }[])
  .map((m) => m.name)
  .filter((n) => /^gemini-\d.*flash/.test(n) && !/(image|tts|audio|live|embed|exp|computer|robot|native|transcribe)/.test(n));
const prompt = "You are an analyst. Given these notes, return JSON {\"score\": n, \"line\": \"...\", \"rows\": [{\"promise\": \"...\", \"outcome\": \"...\"}]} with 6 rows.\n" + "Notes: revenue guidance 10% growth FY27; margin 20%; capex 5000 cr; reported revenue +8%, margin 18%. ".repeat(40);
const variants: [string, object][] = [
  ["default", {}],
  ["budget0", { thinkingConfig: { thinkingBudget: 0 } }],
  ["levelLow", { thinkingConfig: { thinkingLevel: "low" } }],
];
(async () => {
  for (const m of models) {
    const out: string[] = [];
    for (const [name, extra] of variants) {
      const t0 = Date.now();
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 3000, ...extra } }),
      });
      const j = await r.json().catch(() => ({}));
      out.push(`${name} ${r.status} ${((Date.now() - t0) / 1000).toFixed(1)}s${r.ok ? ` think=${j.usageMetadata?.thoughtsTokenCount ?? 0}` : ` ${(j.error?.message || "").slice(0, 50)}`}`);
    }
    console.log(m.padEnd(30), out.join(" | "));
  }
})();

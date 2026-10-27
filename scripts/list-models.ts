// Records which Gemini models this API key can use today, so the router's fallback chain can be
// kept current (Google retires model names regularly). Output: data/models.json
import { promises as fs } from "node:fs";
import path from "node:path";

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return;
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
  const j = (await r.json()) as { models?: { name: string; displayName: string; supportedGenerationMethods: string[]; inputTokenLimit: number }[] };
  const models = (j.models || [])
    .filter((m) => m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => ({ name: m.name.replace("models/", ""), display: m.displayName, input: m.inputTokenLimit }));
  await fs.writeFile(path.join(process.cwd(), "data", "models.json"), JSON.stringify(models, null, 1));
  console.log(models.map((m) => m.name).join("\n"));
}
main().catch((e) => console.error(e));

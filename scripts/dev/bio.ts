// Debug the management-bio chain for one filing: npx tsx scripts/dev/bio.ts HDFCBANK
import { readFileSync } from "node:fs";
import { llm, setLLMLogger } from "../../lib/llm/router";
import { getJSON } from "../../lib/util/http";
import type { Digest } from "../../lib/types";

setLLMLogger((s) => console.log("llm:", s));
const t = process.argv[2] || "HDFCBANK";
(async () => {
  const d = JSON.parse(readFileSync("data/digest.json", "utf8")) as Digest;
  const f = d.filings.find((x) => x.ticker === t && x.enrichment?.kind === "management");
  if (!f || f.enrichment?.kind !== "management") return console.log("no mgmt filing");
  const p = f.enrichment.people[0];
  console.log("person:", p.name, p.role, p.change, "| filing:", f.title, f.pdf);
  try {
    const r = await llm({ tier: "search", parts: [{ text: `Who is ${p.name}, newly ${p.change} as ${p.role} of ${f.company} (India)? Two sentences, previous roles first.` }], maxOutputTokens: 400 });
    console.log("search ok:", r.model, r.text.slice(0, 300), r.sources?.slice(0, 3));
  } catch (e) {
    console.log("search failed:", (e as Error).message.slice(0, 400));
  }
  try {
    const q = await getJSON<{ query: { search: { title: string; snippet: string }[] } }>(`https://en.wikipedia.org/w/api.php?format=json&action=query&list=search&srlimit=5&srsearch=${encodeURIComponent(p.name)}`);
    console.log("wiki hits:", q.query.search.map((h) => `${h.title}: ${h.snippet.replace(/<[^>]+>/g, "").slice(0, 120)}`));
  } catch (e) {
    console.log("wiki failed:", (e as Error).message);
  }
})();

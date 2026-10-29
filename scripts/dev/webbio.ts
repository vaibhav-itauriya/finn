// Check the web-search bio fallback: npx tsx scripts/dev/webbio.ts HDFCBANK
import { readFileSync } from "node:fs";
import { webSearch } from "../../lib/sources/websearch";
import { enrichManagement } from "../../lib/push/enrich";
import { setLLMLogger } from "../../lib/llm/router";
import type { Digest } from "../../lib/types";

setLLMLogger((s) => console.log("llm:", s));
const t = process.argv[2] || "HDFCBANK";
(async () => {
  const d = JSON.parse(readFileSync("data/digest.json", "utf8")) as Digest;
  const f = d.filings.find((x) => x.ticker === t && x.enrichment?.kind === "management")!;
  const p = f.enrichment!.kind === "management" ? f.enrichment!.people[0] : null;
  const hits = await webSearch(`"${p!.name}" ${f.company} ${p!.role}`).catch((e) => (console.log("search error", e.message), []));
  console.log("hits:", hits.slice(0, 4).map((h) => `${h.title} | ${h.url} | ${h.snippet.slice(0, 90)}`));
  const r = await enrichManagement(f);
  console.log(JSON.stringify(r?.card.people.slice(0, 2), null, 1));
})();

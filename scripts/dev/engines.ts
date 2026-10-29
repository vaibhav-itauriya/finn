// Check the web-search bio path end to end: npx tsx scripts/dev/engines.ts
import { webSearch } from "../../lib/sources/websearch";
import { webBio } from "../../lib/push/enrich";
import { setLLMLogger } from "../../lib/llm/router";
setLLMLogger((s) => console.log("llm:", s));
(async () => {
  const hits = await webSearch('"Anup Bagchi" HDFC Bank MD & CEO');
  console.log(hits.slice(0, 4).map((h) => `${h.title} | ${h.url} | ${h.snippet.slice(0, 80)}`));
  for (const [n, r, c] of [["Anup Bagchi", "MD & CEO", "HDFC Bank Ltd"], ["Prashant Verma", "Chief Information Security Officer", "Bajaj Finance Ltd"]]) {
    try {
      console.log(n, JSON.stringify(await webBio(n, r, c)));
    } catch (e) {
      console.log(n, "error:", (e as Error).message.slice(0, 300));
    }
  }
})();

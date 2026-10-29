// Which keyless search engines answer from this runner? npx tsx scripts/dev/engines.ts
import { getText } from "../../lib/util/http";
const q = '"Anup Bagchi" HDFC Bank MD & CEO';
const urls = {
  ddg: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`,
  ddgLite: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
  bing: `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en-IN&cc=IN`,
};
(async () => {
  for (const [k, u] of Object.entries(urls)) {
    for (let i = 0; i < 3; i++) {
      try {
        const h = await getText(u, { retries: 0 });
        console.log(k, i, h.length, /result__a|result-link|b_algo/.test(h) ? "results" : "NO results", (h.match(/<title>([^<]*)/) || [])[1]);
      } catch (e) {
        console.log(k, i, "error", (e as Error).message.slice(0, 80));
      }
    }
  }
  const { enrichManagement } = await import("../../lib/push/enrich");
  const { readFileSync } = await import("node:fs");
  const d = JSON.parse(readFileSync("data/digest.json", "utf8"));
  for (const t of ["HDFCBANK", "BAJFINANCE"]) {
    const f = d.filings.find((x: { ticker: string; enrichment?: { kind: string } }) => x.ticker === t && x.enrichment?.kind === "management");
    const r = await enrichManagement(f);
    console.log(t, JSON.stringify(r?.card.people[0]).slice(0, 600));
  }
})();

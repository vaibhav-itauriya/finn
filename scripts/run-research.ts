// Precompute research reports for the demo companies so they open instantly.
// Any other ticker is computed live by the API with the same code.
//   npx tsx scripts/run-research.ts [TICKER ...]
import { promises as fs } from "node:fs";
import path from "node:path";
import { RESEARCH_DEMO } from "../config/portfolio";
import { meter } from "../lib/llm/router";
import { fullReport } from "../lib/pull/research";

process.env.FINN_CACHE_WRITE = "1";

async function main() {
  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : RESEARCH_DEMO;
  const dir = path.join(process.cwd(), "data", "research");
  await fs.mkdir(dir, { recursive: true });
  const log: string[] = [];
  for (const t of tickers) {
    const t0 = Date.now();
    try {
      const r = await fullReport(t);
      await fs.writeFile(path.join(dir, `${t.toUpperCase()}.json`), JSON.stringify(r));
      const s = `${t}: ${r.calls.length} calls, ledger ${r.ledger ? r.ledger.rows.length + " rows" : "none"}, thesis ${r.thesis ? "ok" : "none"} in ${((Date.now() - t0) / 1000).toFixed(0)}s ${r.errors.join(" | ")}`;
      console.log(s);
      log.push(s);
    } catch (e) {
      const s = `${t}: FAILED ${(e as Error).message}`;
      console.error(s);
      log.push(s);
    }
  }
  const m = `llm calls ${meter.calls}, cache hits ${meter.cacheHits}, tokens ${meter.tokensIn}/${meter.tokensOut}, ~$${meter.usd.toFixed(4)}, ${JSON.stringify(meter.models)}`;
  console.log(m);
  log.push(m);
  await fs.writeFile(path.join(process.cwd(), "data", "last-research.log"), log.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

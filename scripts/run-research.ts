// Precompute research reports for the demo companies so they open instantly.
// Any other ticker is computed live by the API with the same code.
//   npx tsx scripts/run-research.ts [TICKER ...]
import { promises as fs } from "node:fs";
import path from "node:path";
import { RESEARCH_DEMO } from "../config/portfolio";
import { meter, setLLMLogger } from "../lib/llm/router";
import { fullReport } from "../lib/pull/research";

process.env.FINN_CACHE_WRITE = "1";

async function main() {
  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : RESEARCH_DEMO;
  const dir = path.join(process.cwd(), "data", "research");
  await fs.mkdir(dir, { recursive: true });
  const logFile = path.join(process.cwd(), "data", "last-research.log");
  await fs.writeFile(logFile, `run started ${new Date().toISOString()}\n`);
  const log = (s: string) => {
    console.log(s);
    fs.appendFile(logFile, s + "\n").catch(() => {});
  };
  setLLMLogger(log);
  const perCompanyMs = Number(process.env.FINN_RESEARCH_MIN || 8) * 60e3;
  for (const t of tickers) {
    const t0 = Date.now();
    try {
      const r = await Promise.race([
        fullReport(t),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${perCompanyMs / 60e3} min`)), perCompanyMs)),
      ]);
      // Keep the previous snapshot's judgement if this run couldn't produce one.
      const file = path.join(dir, `${t.toUpperCase()}.json`);
      try {
        const old = JSON.parse(await fs.readFile(file, "utf8"));
        if (!r.ledger && old.ledger) r.ledger = old.ledger;
        if (!r.thesis && old.thesis) r.thesis = old.thesis;
      } catch {
        /* no previous snapshot */
      }
      await fs.writeFile(file, JSON.stringify(r));
      log(`${t}: ${r.calls.length} calls, ledger ${r.ledger ? r.ledger.rows.length + " rows" : "none"}, thesis ${r.thesis ? "ok" : "none"} in ${((Date.now() - t0) / 1000).toFixed(0)}s ${r.errors.join(" | ")}`);
    } catch (e) {
      log(`${t}: FAILED ${(e as Error).message}`);
    }
  }
  log(`llm calls ${meter.calls}, cache hits ${meter.cacheHits}, tokens ${meter.tokensIn}/${meter.tokensOut}, ~$${meter.usd.toFixed(4)}, ${JSON.stringify(meter.models)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

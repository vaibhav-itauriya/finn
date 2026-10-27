// Entry point for the scheduled push job (GitHub Actions) and local runs.
//   npx tsx scripts/run-push.ts [--days 30] [--only TCS,ITC]
import { promises as fs } from "node:fs";
import path from "node:path";
import { PORTFOLIO } from "../config/portfolio";
import { runPush } from "../lib/push/pipeline";
import { notify } from "../lib/push/notify";
import { setLLMLogger } from "../lib/llm/router";

process.env.FINN_CACHE_WRITE = "1"; // persist LLM extractions into data/cache so the next run is free

async function main() {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const days = Number(get("--days") || 30);
  const only = get("--only")?.split(",").map((s) => s.trim().toUpperCase());
  const lines: string[] = [];
  const logFile = path.join(process.cwd(), "data", "last-run.log");
  await fs.writeFile(logFile, `run started ${new Date().toISOString()}\n`);
  const log = (s: string) => {
    console.log(s);
    lines.push(s);
    // Written as we go, so even a killed run leaves a trail in the committed data.
    fs.appendFile(logFile, s + "\n").catch(() => {});
  };
  setLLMLogger(log);
  const t0 = Date.now();
  const digest = await runPush(structuredClone(PORTFOLIO), { days, tickers: only, log });
  const out = path.join(process.cwd(), "data", "digest.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(digest));
  const e = digest.engine;
  log(
    `done in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${e.filings} filings · rules ${e.byRules} · llm calls ${e.llmCalls} (cache hits ${e.cacheHits}) · ` +
      `tokens ${e.tokensIn}/${e.tokensOut} · ~$${e.estCostUSD} · models ${JSON.stringify(e.models)}`,
  );
  try {
    await notify(digest, log);
  } catch (err) {
    log(`telegram failed: ${(err as Error).message}`);
  }
  if (e.errors.length) log(`errors (${e.errors.length}):\n  ` + e.errors.join("\n  "));
  await fs.writeFile(logFile, lines.join("\n") + "\n");
  process.exit(0); // don't wait on abandoned in-flight calls
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

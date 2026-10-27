// The push pipeline, run after market close (and a few times a day for filings) by GitHub Actions.
//   1. fetch     EOD prices (Yahoo), filings (BSE), fundamentals table (Screener)
//   2. classify  rules first (free), batched cheap-LLM only for leftovers
//   3. enrich    results PDFs, management bios, one-liners for what matters
//   4. publish   data/digest.json, which the app reads. Alerts are computed on the client
//                so changing a threshold re-evaluates instantly, no re-run needed.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest, Filing, Holding, PriceSeries } from "../types";
import { fetchAnnouncements, pdfUrl, type BseAnnouncement } from "../sources/bse";
import { fetchEOD } from "../sources/yahoo";
import { fetchScreener, type ScreenerCompany } from "../sources/screener";
import { classifyByRules, tierOf, BASE_SCORE } from "./classify";
import { batchTriage, enrichManagement, enrichResults, summaryCard, type Pending } from "./enrich";
import { hasLLM, meter, resetMeter } from "../llm/router";
import { pool } from "../util/http";

const DATA = path.join(process.cwd(), "data");

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function toFiling(a: BseAnnouncement, h: Holding): Filing {
  const hit = classifyByRules({
    cat: a.CATEGORYNAME || "",
    sub: a.SUBCATNAME || "",
    subject: a.NEWSSUB || "",
    headline: `${a.HEADLINE || ""} ${a.MORE || ""}`,
    critical: a.CRITICALNEWS === "1",
  });
  const category = hit?.category ?? "unclassified";
  const score = hit?.score ?? BASE_SCORE.unclassified;
  return {
    id: a.NEWSID,
    ticker: h.ticker,
    company: h.name,
    ts: `${a.NEWS_DT.slice(0, 19)}+05:30`,
    title: (a.NEWSSUB || "").replace(/^Announcement under Regulation 30 \(LODR\)-/i, "").trim(),
    headline: (a.HEADLINE || a.MORE || "").trim(),
    bseCategory: a.CATEGORYNAME || "",
    bseSub: a.SUBCATNAME || "",
    critical: a.CRITICALNEWS === "1",
    pdf: pdfUrl(a),
    category,
    tier: tierOf(score),
    score,
    reason: hit?.reason ?? "Rules could not place this",
    classifiedBy: hit ? "rules" : "llm",
  };
}

export interface RunOptions {
  days?: number; // filings lookback
  tickers?: string[]; // limit (debugging)
  log?: (s: string) => void;
}

export async function runPush(portfolio: Holding[], opts: RunOptions = {}): Promise<Digest> {
  const log = opts.log || console.log;
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 86400 * 1000);
  const holdings = opts.tickers ? portfolio.filter((h) => opts.tickers!.includes(h.ticker)) : portfolio;
  const prev = await readJSON<Digest | null>(path.join(DATA, "digest.json"), null);
  const prevById = new Map((prev?.filings || []).map((f) => [f.id, f]));
  const errors: string[] = [];
  resetMeter();

  // 1. fetch -----------------------------------------------------------------
  const screener = new Map<string, ScreenerCompany>();
  await pool(holdings, 3, async (h) => {
    try {
      const sc = await fetchScreener(h.ticker);
      screener.set(h.ticker, sc);
      if (sc.bse) h.bse = sc.bse;
    } catch (e) {
      errors.push(`screener ${h.ticker}: ${(e as Error).message}`);
      const old = prev?.portfolio.find((p) => p.ticker === h.ticker);
      if (old?.bse) h.bse = old.bse;
    }
  });
  log(`screener: ${screener.size}/${holdings.length}`);

  const prices: PriceSeries[] = [];
  await pool(holdings, 4, async (h) => {
    try {
      prices.push({ ticker: h.ticker, bars: await fetchEOD(h.ticker) });
    } catch (e) {
      errors.push(`yahoo ${h.ticker}: ${(e as Error).message}`);
      const old = prev?.prices.find((p) => p.ticker === h.ticker);
      if (old) prices.push(old);
    }
  });
  log(`prices: ${prices.length}/${holdings.length}`);

  let filings: Filing[] = [];
  await pool(holdings, 3, async (h) => {
    if (!h.bse) return errors.push(`no BSE code for ${h.ticker}`);
    try {
      const anns = await fetchAnnouncements(h.bse, since);
      for (const a of anns) {
        const f = toFiling(a, h);
        const old = prevById.get(f.id);
        // Keep earlier enrichment and LLM decisions; documents don't change after filing.
        if (old?.enrichment) f.enrichment = old.enrichment;
        if (old?.classifiedBy === "llm") Object.assign(f, { category: old.category, score: old.score, tier: old.tier, reason: old.reason, classifiedBy: "llm" });
        filings.push(f);
      }
    } catch (e) {
      errors.push(`bse ${h.ticker}: ${(e as Error).message}`);
      filings.push(...(prev?.filings || []).filter((f) => f.ticker === h.ticker && new Date(f.ts) >= since));
    }
  });
  const seen = new Set<string>();
  filings = filings.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  filings.sort((a, b) => b.ts.localeCompare(a.ts));
  const byRules = filings.filter((f) => f.classifiedBy === "rules").length;
  log(`filings: ${filings.length} (${byRules} placed by rules)`);

  // 2-3. classify leftovers + enrich -----------------------------------------
  if (hasLLM()) {
    // Results: newest results filing per company only. Older ones are history.
    const latestResult = new Map<string, Filing>();
    for (const f of filings) {
      if (f.category === "results" && f.score >= 85 && f.pdf && !latestResult.has(f.ticker)) latestResult.set(f.ticker, f);
    }
    await pool([...latestResult.values()], 2, async (f) => {
      if (f.enrichment) return;
      try {
        const card = await enrichResults(f.pdf!, screener.get(f.ticker));
        if (card) f.enrichment = card;
      } catch (e) {
        errors.push(`results ${f.ticker}: ${(e as Error).message.slice(0, 160)}`);
      }
    });

    const mgmt = filings.filter((f) => f.category === "management_change" && f.score >= 60 && !f.enrichment);
    await pool(mgmt, 2, async (f) => {
      try {
        const card = await enrichManagement(f);
        if (card) f.enrichment = card;
      } catch (e) {
        errors.push(`mgmt ${f.ticker}: ${(e as Error).message.slice(0, 160)}`);
      }
    });

    // Batch everything else that is either unplaced or worth a one-liner.
    const pending: Pending[] = filings
      .filter((f) => !f.enrichment && (f.classifiedBy === "llm" ? f.reason === "Rules could not place this" : f.tier !== "routine"))
      .filter((f) => f.category !== "results" || f.score < 85)
      .map((f) => ({ id: f.id, company: f.company, title: f.title, headline: f.headline, needsCategory: f.reason === "Rules could not place this" }));
    const tri = await batchTriage(pending);
    for (const f of filings) {
      const t = tri[f.id];
      if (!t) continue;
      if (t.category && f.reason === "Rules could not place this") {
        f.category = t.category;
        f.score = Math.min(100, BASE_SCORE[t.category] + (t.material ? 10 : 0));
        f.tier = tierOf(f.score);
        f.reason = "Classified by model (rules had no match)";
      }
      if (t.line && f.tier !== "routine") f.enrichment = summaryCard(t.line);
    }
  } else {
    errors.push("GEMINI_API_KEY not set: skipped enrichment");
  }

  // 4. publish ---------------------------------------------------------------
  const digest: Digest = {
    portfolio: holdings,
    filings,
    prices,
    engine: {
      generatedAt: new Date().toISOString(),
      filings: filings.length,
      byRules,
      byLLM: filings.length - byRules,
      enriched: filings.filter((f) => f.enrichment).length,
      llmCalls: meter.calls,
      cacheHits: meter.cacheHits,
      tokensIn: meter.tokensIn,
      tokensOut: meter.tokensOut,
      estCostUSD: Math.round(meter.usd * 10000) / 10000,
      models: meter.models,
      errors,
    },
  };
  return digest;
}

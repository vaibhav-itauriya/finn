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
import { enrichManagement, enrichResults, fuse, resultsFromScreener, secondOpinion } from "./enrich";
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
  let score = hit?.score ?? BASE_SCORE.unclassified;
  let reason = hit?.reason ?? "Rules could not place this";
  // Lenders issue debt every week; for them it is plumbing, not news.
  if (category === "fund_raise" && score < 50 && /bank|nbfc|financ/i.test(h.sector)) {
    score = 10;
    reason = "Routine funding for a lender";
  }
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
    reason,
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
  const errors: string[] = [];
  resetMeter();
  // Time budget: a scheduled job must always publish something. Enrichment that doesn't fit
  // is picked up by the next run (every model output is cached as soon as it's produced).
  const t0 = Date.now();
  const budgetMs = Number(process.env.FINN_BUDGET_MIN || 13) * 60e3;
  const timeLeft = () => budgetMs - (Date.now() - t0);
  let skipped = 0;
  const stage = (name: string) => log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${name}`);

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
        // No need to carry over last run's enrichment: model outputs are cached by document,
        // so recomputing is free and picks up rule changes.
        filings.push(toFiling(a, h));
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

  // 2-3. enrich: results, management, then a second opinion on what might matter --------
  if (hasLLM()) {
    const now = Date.now();
    const ageDays = (f: Filing) => (now - new Date(f.ts).getTime()) / 86400e3;

    // Results: one card per company for its newest results event, read from the primary filing.
    const primary = new Map<string, Filing>();
    for (const f of filings) {
      if (f.category !== "results" || f.score < 85 || !f.pdf) continue;
      const cur = primary.get(f.ticker);
      const better = (a: Filing) => (/financial results|results for the/i.test(a.title) ? 2 : 0) + (a.bseCategory === "Result" ? 1 : 0);
      if (!cur) primary.set(f.ticker, f);
      else if (Math.abs(new Date(cur.ts).getTime() - new Date(f.ts).getTime()) < 2 * 86400e3 && better(f) > better(cur)) primary.set(f.ticker, f);
    }
    stage(`results: ${primary.size} filings`);
    await pool([...primary.values()], 2, async (f) => {
      const sc = screener.get(f.ticker);
      if (timeLeft() < 60e3) {
        skipped++;
        if (sc) f.enrichment = resultsFromScreener(sc) ?? undefined;
        return;
      }
      try {
        const card = await enrichResults(f.pdf!, sc);
        if (card) f.enrichment = card;
      } catch (e) {
        errors.push(`results ${f.ticker}: ${(e as Error).message.slice(0, 160)}`);
      }
      if (!f.enrichment && sc) {
        const fb = resultsFromScreener(sc);
        if (fb) f.enrichment = fb;
      }
    });

    // Management: find out who. Senior roles go up, secretarial changes go down.
    const mgmt = filings.filter((f) => f.category === "management_change" && f.score >= 45 && ageDays(f) <= 21);
    stage(`management: ${mgmt.length} filings`);
    await pool(mgmt, 2, async (f) => {
      if (timeLeft() < 60e3) return void skipped++;
      try {
        const r = await enrichManagement(f);
        if (!r) return;
        f.enrichment = r.card;
        if (r.senior) {
          f.score = Math.max(f.score, 86);
          f.reason = "Top management or board-level executive change";
        } else {
          f.score = Math.min(f.score, 30);
          f.reason = "Change below top management";
        }
        f.tier = tierOf(f.score);
      } catch (e) {
        errors.push(`mgmt ${f.ticker}: ${(e as Error).message.slice(0, 160)}`);
      }
    });

    // Second opinion: every filing the rules couldn't place, plus recent non-routine ones.
    const skip = new Set(["results", "earnings_call", "investor_meetings", "dividend", "management_change"]);
    const review = filings
      .filter((f) => !f.enrichment)
      .filter((f) => f.classifiedBy === "llm" || (f.tier !== "routine" && !skip.has(f.category) && ageDays(f) <= 10))
      .slice(0, 60);
    stage(`second opinion: ${review.length} filings`);
    await pool(review, 3, async (f) => {
      if (timeLeft() < 45e3) return void skipped++;
      try {
        const o = await secondOpinion(f);
        if (o) fuse(f, o);
      } catch (e) {
        errors.push(`opinion ${f.ticker}: ${(e as Error).message.slice(0, 120)}`);
      }
    });
    stage(`enrichment done${skipped ? `, ${skipped} deferred to next run (time budget)` : ""}`);
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

// Screener.in: standardised multi-year financials (parsed from HTML, zero LLM cost)
// plus links to the primary documents we read with LLMs (concall transcripts, annual reports,
// quarterly results PDFs). Works for any NSE/BSE company Screener covers.
import * as cheerio from "cheerio";
import { getJSON, getText } from "../util/http";

export interface Table {
  cols: string[]; // period labels, e.g. "Sep 2026", "Mar 2025", "TTM"
  rows: Record<string, (number | null)[]>; // label -> values aligned with cols
}

export interface DocLink {
  label: string; // "Oct 2026" or "Annual Report 2026"
  url: string;
}

export interface ScreenerCompany {
  ticker: string;
  name: string;
  url: string;
  basis: "consolidated" | "standalone";
  bse: number | null;
  nse: string | null;
  companyId?: number | null; // Screener's internal id, used by its price-chart API
  sector: string | null;
  about: string | null;
  topRatios: Record<string, string>;
  isLender: boolean;
  quarters: Table;
  quarterPdfs: (string | null)[]; // aligned with quarters.cols
  pl: Table;
  bs: Table;
  cf: Table;
  ratios: Table;
  growth: Record<string, Record<string, string>>; // "Compounded Sales Growth" -> {"3 Years": "6%"}
  shareholding: Table;
  concalls: { label: string; transcript: string | null; ppt: string | null }[];
  annualReports: DocLink[];
  fetchedAt: string;
}

const BASE = "https://www.screener.in";

export function num(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.replace(/[,%₹\s]/g, "").replace(/^\+/, "");
  if (t === "" || t === "-" || t === "--") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function cleanLabel(s: string): string {
  return s.replace(/\s*\+\s*$/, "").replace(/\s+/g, " ").trim();
}

function parseTable($: cheerio.CheerioAPI, sectionId: string, index = 0): Table {
  const tbl = $(`section#${sectionId} table`).eq(index);
  const cols = tbl
    .find("thead th")
    .toArray()
    .slice(1)
    .map((th) => $(th).text().trim());
  const rows: Record<string, (number | null)[]> = {};
  tbl.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td").toArray();
    if (!tds.length) return;
    const label = cleanLabel($(tds[0]).text());
    if (!label || label === "Raw PDF") return;
    rows[label] = tds.slice(1).map((td) => num($(td).text()));
  });
  return { cols, rows };
}

async function fetchPage(ticker: string, basis: "consolidated" | "standalone") {
  const url = `${BASE}/company/${encodeURIComponent(ticker)}/${basis === "consolidated" ? "consolidated/" : ""}`;
  const html = await getText(url, { headers: { Referer: BASE + "/" } });
  return { url, html };
}

export async function fetchScreener(tickerRaw: string): Promise<ScreenerCompany> {
  const ticker = tickerRaw.trim().toUpperCase();
  let basis: "consolidated" | "standalone" = "consolidated";
  let { url, html } = await fetchPage(ticker, basis);
  let $ = cheerio.load(html);
  // Companies without subsidiaries have empty consolidated tables; fall back to standalone.
  const qCells = $("section#quarters table tbody tr").first().find("td").length;
  if (qCells <= 1) {
    basis = "standalone";
    ({ url, html } = await fetchPage(ticker, basis));
    $ = cheerio.load(html);
  }

  const name = $("h1").first().text().trim() || ticker;
  const companyId = Number($("#company-info").attr("data-company-id")) || null;
  const about = $(".company-profile .about p, .about p").first().text().trim() || null;

  // Exchange codes live in the company-links block: "BSE: 532540", "NSE: TCS".
  let bse: number | null = null;
  let nse: string | null = null;
  $("a[href*='bseindia.com']").each((_, a) => {
    const t = $(a).text();
    const m = t.match(/BSE:\s*(\d{6})/) || ($(a).attr("href") || "").match(/\/(\d{6})\/?$/);
    if (m && !bse) bse = Number(m[1]);
  });
  $("a[href*='nseindia.com']").each((_, a) => {
    const m = $(a).text().match(/NSE:\s*([A-Z0-9&\-]+)/);
    if (m && !nse) nse = m[1];
  });
  // Peer breadcrumbs: links titled "Broad Sector", "Sector", "Broad Industry", "Industry"; the text is the value.
  const crumb = (t: string) => $("a[href*='/market/']").filter((_, a) => $(a).attr("title") === t).first().text().trim();
  const sector = crumb("Industry") || crumb("Sector") || crumb("Broad Industry") || $("a[href*='/market/']").last().text().trim() || null;

  const topRatios: Record<string, string> = {};
  $("#top-ratios li").each((_, li) => {
    const k = $(li).find(".name").text().trim();
    const v = $(li).find(".value").text().replace(/\s+/g, " ").trim();
    if (k) topRatios[k] = v;
  });

  const quarters = parseTable($, "quarters");
  const quarterPdfs: (string | null)[] = [];
  $("section#quarters table tbody tr")
    .last()
    .find("td")
    .toArray()
    .slice(1)
    .forEach((td) => {
      const href = $(td).find("a").attr("href");
      quarterPdfs.push(href ? (href.startsWith("http") ? href : BASE + href) : null);
    });

  const growth: Record<string, Record<string, string>> = {};
  $("section#profit-loss table.ranges-table").each((_, t) => {
    const title = $(t).find("th").first().text().trim();
    const m: Record<string, string> = {};
    $(t)
      .find("tr")
      .each((__, tr) => {
        const tds = $(tr).find("td");
        if (tds.length === 2) m[$(tds[0]).text().replace(":", "").trim()] = $(tds[1]).text().trim();
      });
    if (title) growth[title] = m;
  });

  const concalls: ScreenerCompany["concalls"] = [];
  $(".documents.concalls li").each((_, li) => {
    const label = $(li).find("div").first().text().trim();
    const tr = $(li).find("a[title='Raw Transcript']").attr("href") || null;
    const ppt = $(li)
      .find("a.button-chip")
      .filter((__, a) => $(a).text().trim() === "PPT")
      .attr("href") || null;
    concalls.push({ label, transcript: tr, ppt });
  });

  const annualReports: DocLink[] = [];
  $(".documents.annual-reports li a").each((_, a) => {
    const href = $(a).attr("href");
    if (href) annualReports.push({ label: $(a).text().trim(), url: href });
  });

  const isLender = Object.keys(quarters.rows).some((k) => /Financing Profit/i.test(k));

  return {
    ticker,
    name,
    url,
    basis,
    bse,
    companyId,
    nse,
    sector,
    about,
    topRatios,
    isLender,
    quarters,
    quarterPdfs,
    pl: parseTable($, "profit-loss"),
    bs: parseTable($, "balance-sheet"),
    cf: parseTable($, "cash-flow"),
    ratios: parseTable($, "ratios"),
    growth,
    shareholding: parseTable($, "shareholding"),
    concalls,
    annualReports,
    fetchedAt: new Date().toISOString(),
  };
}

/** Find a row by any of several labels (Screener uses different labels for lenders). */
export function row(t: Table, ...labels: string[]): (number | null)[] {
  for (const l of labels) {
    const hit = Object.keys(t.rows).find((k) => k.toLowerCase() === l.toLowerCase());
    if (hit) return t.rows[hit];
  }
  for (const l of labels) {
    const hit = Object.keys(t.rows).find((k) => k.toLowerCase().startsWith(l.toLowerCase()));
    if (hit) return t.rows[hit];
  }
  return t.cols.map(() => null);
}

export interface SearchHit {
  name: string;
  ticker: string;
  url: string;
}

/** Screener's public company search, used for the research box autocomplete. */
export async function searchCompanies(q: string): Promise<SearchHit[]> {
  const res = await getJSON<{ name: string; url: string; id: number }[]>(
    `${BASE}/api/company/search/?q=${encodeURIComponent(q)}&v=3&fts=1`,
    { headers: { Referer: BASE + "/" } },
  );
  return res
    .filter((r) => r.url && r.url.startsWith("/company/"))
    .map((r) => ({ name: r.name, url: BASE + r.url, ticker: r.url.split("/")[2] }))
    .slice(0, 8);
}

/** Daily closes and volumes from Screener's chart API: the fallback when Yahoo refuses a server. */
export async function fetchScreenerPrices(companyId: number, days = 1825): Promise<{ d: string; c: number; v: number }[]> {
  const j = await getJSON<{ datasets: { metric: string; values: [string, string | number][] }[] }>(
    `${BASE}/api/company/${companyId}/chart/?q=Price-Volume&days=${days}`,
    { headers: { Referer: BASE + "/" } },
  );
  const price = j.datasets.find((d) => d.metric === "Price")?.values ?? [];
  const vol = new Map((j.datasets.find((d) => d.metric === "Volume")?.values ?? []).map(([d, v]) => [d, Number(v)]));
  return price.map(([d, c]) => ({ d, c: Number(c), v: vol.get(d) ?? 0 })).filter((b) => Number.isFinite(b.c));
}

// Research sections that need no model at all: financial snapshot, trajectory, balance sheet,
// cash quality. Parsed from Screener's standardised tables and turned into plain-English
// signals by code, so every number is reproducible and costs nothing.
import type { ScreenerCompany, Table } from "../sources/screener";
import { row } from "../sources/screener";

export type Tone = "good" | "bad" | "watch" | "neutral";
export interface Signal {
  tone: Tone;
  text: string;
}

export interface Series {
  cols: string[];
  values: (number | null)[];
}

export interface NumbersView {
  header: {
    name: string;
    ticker: string;
    sector: string | null;
    basis: string;
    isLender: boolean;
    price: string | null;
    mcap: string | null;
    pe: string | null;
    roce: string | null;
    roe: string | null;
    divYield: string | null;
    screenerUrl: string;
  };
  snapshot: { label: string; value: string; sub?: string; tone?: Tone }[];
  quarters: { cols: string[]; revenue: (number | null)[]; ebitda: (number | null)[]; margin: (number | null)[]; pat: (number | null)[]; revYoY: (number | null)[]; patYoY: (number | null)[] };
  trajectory: { cols: string[]; revenue: (number | null)[]; pat: (number | null)[]; margin: (number | null)[]; signals: Signal[] };
  balance: { cols: string[]; borrowings: (number | null)[]; equity: (number | null)[]; de: (number | null)[]; wcDays: (number | null)[]; ccc: (number | null)[]; signals: Signal[] };
  cash: { cols: string[]; cfo: (number | null)[]; pat: (number | null)[]; fcf: (number | null)[]; conversion: (number | null)[]; signals: Signal[] };
  flags: Signal[];
}

const last = <T,>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));
const fmtCr = (x: number | null) =>
  x == null ? "–" : Math.abs(x) >= 100000 ? `₹${(x / 100000).toFixed(2)} L cr` : `₹${Math.round(x).toLocaleString("en-IN")} cr`;
const pctS = (x: number | null, d = 0) => (x == null ? "–" : `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(d)}%`);

function cagr(a: number | null, b: number | null, years: number): number | null {
  if (a == null || b == null || a <= 0 || b <= 0 || years <= 0) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}

/** Annual columns only (drop "TTM" and half-year columns like "Sep 2026"). */
function annual(t: Table) {
  const idx = t.cols.map((c, i) => (/^Mar \d{4}$/.test(c) ? i : -1)).filter((i) => i >= 0);
  return {
    cols: idx.map((i) => t.cols[i]),
    pick: (vals: (number | null)[]) => idx.map((i) => vals[i] ?? null),
  };
}

export function buildNumbers(sc: ScreenerCompany): NumbersView {
  const L = sc.isLender;
  // ---- quarters (last 8)
  const qRev = row(sc.quarters, "Sales", "Revenue");
  const qOp = row(sc.quarters, "Operating Profit", "Financing Profit");
  const qPat = row(sc.quarters, "Net Profit");
  const qn = sc.quarters.cols.length;
  const yoy = (v: (number | null)[], i: number) => {
    const a = v[i - 4];
    const b = v[i];
    return a != null && b != null && a > 0 ? ((b - a) / a) * 100 : null;
  };
  const qIdx = last(
    sc.quarters.cols.map((_, i) => i),
    8,
  );
  const quarters = {
    cols: qIdx.map((i) => sc.quarters.cols[i]),
    revenue: qIdx.map((i) => qRev[i]),
    ebitda: qIdx.map((i) => qOp[i]),
    margin: qIdx.map((i) => (qRev[i] && qOp[i] != null ? (qOp[i]! / qRev[i]!) * 100 : null)),
    pat: qIdx.map((i) => qPat[i]),
    revYoY: qIdx.map((i) => yoy(qRev, i)),
    patYoY: qIdx.map((i) => yoy(qPat, i)),
  };

  // ---- trajectory (annual, last 10)
  const pl = annual(sc.pl);
  const rev = pl.pick(row(sc.pl, "Sales", "Revenue"));
  const op = pl.pick(row(sc.pl, "Operating Profit", "Financing Profit"));
  const pat = pl.pick(row(sc.pl, "Net Profit"));
  const margin = rev.map((r, i) => (r && op[i] != null ? (op[i]! / r) * 100 : null));
  const n = rev.length;
  const tCols = last(pl.cols, 10);
  const trajSignals: Signal[] = [];
  const rev3 = cagr(rev[n - 4], rev[n - 1], 3);
  const rev5 = cagr(rev[n - 6], rev[n - 1], 5);
  const pat3 = cagr(pat[n - 4], pat[n - 1], 3);
  if (rev3 != null && rev5 != null) {
    trajSignals.push({
      tone: rev3 < rev5 - 3 ? "watch" : rev3 > rev5 + 3 ? "good" : "neutral",
      text: `Revenue grew ${rev3.toFixed(0)}% a year over 3 years vs ${rev5.toFixed(0)}% over 5: growth is ${rev3 < rev5 - 3 ? "slowing" : rev3 > rev5 + 3 ? "accelerating" : "steady"}.`,
    });
  }
  if (rev3 != null && pat3 != null) {
    trajSignals.push({
      tone: pat3 > rev3 + 2 ? "good" : pat3 < rev3 - 2 ? "bad" : "neutral",
      text: `Profit compounded at ${pat3.toFixed(0)}% vs revenue at ${rev3.toFixed(0)}%: ${pat3 > rev3 + 2 ? "operating leverage is showing" : pat3 < rev3 - 2 ? "profits are lagging sales" : "profit is tracking sales"}.`,
    });
  }
  const m0 = margin[n - 4];
  const m1 = margin[n - 1];
  if (m0 != null && m1 != null && !L) {
    const d = (m1 - m0) * 100;
    trajSignals.push({
      tone: d <= -200 ? "bad" : d >= 200 ? "good" : "neutral",
      text: `Operating margin ${d >= 0 ? "expanded" : "compressed"} ${Math.abs(Math.round(d))} bps in 3 years (${m0.toFixed(1)}% → ${m1.toFixed(1)}%).`,
    });
  }

  // ---- balance sheet
  const bs = annual(sc.bs);
  const borrowings = bs.pick(row(sc.bs, "Borrowings", "Borrowing"));
  const eqCap = bs.pick(row(sc.bs, "Equity Capital"));
  const reserves = bs.pick(row(sc.bs, "Reserves"));
  const equity = eqCap.map((e, i) => (e == null && reserves[i] == null ? null : (e ?? 0) + (reserves[i] ?? 0)));
  const de = borrowings.map((b, i) => (b != null && equity[i] ? b / equity[i]! : null));
  const ra = annual(sc.ratios);
  const wcDays = ra.pick(row(sc.ratios, "Working Capital Days"));
  const ccc = ra.pick(row(sc.ratios, "Cash Conversion Cycle"));
  const bn = borrowings.length;
  const balSignals: Signal[] = [];
  if (!L && de[bn - 1] != null) {
    const d = de[bn - 1]!;
    balSignals.push({
      tone: d > 1 ? "bad" : d > 0.5 ? "watch" : "good",
      text: d < 0.1 ? `Practically debt-free (debt/equity ${d.toFixed(2)}).` : `Debt/equity is ${d.toFixed(2)}${de[bn - 4] != null ? ` (was ${de[bn - 4]!.toFixed(2)} three years ago)` : ""}.`,
    });
  }
  if (!L && borrowings[bn - 4] && borrowings[bn - 1] && equity[bn - 4] && equity[bn - 1]) {
    const bx = borrowings[bn - 1]! / borrowings[bn - 4]!;
    const ex = equity[bn - 1]! / equity[bn - 4]!;
    if (bx > ex * 1.3 && borrowings[bn - 1]! > 0.2 * equity[bn - 1]!)
      balSignals.push({ tone: "watch", text: `Borrowings grew ${bx.toFixed(1)}x in 3 years while equity grew ${ex.toFixed(1)}x: growth is being funded with debt.` });
  }
  const wn = wcDays.length;
  if (wcDays[wn - 1] != null && wcDays[wn - 4] != null) {
    const d = wcDays[wn - 1]! - wcDays[wn - 4]!;
    if (Math.abs(d) >= 15)
      balSignals.push({ tone: d > 0 ? "watch" : "good", text: `Working-capital days ${d > 0 ? "lengthened" : "shortened"} by ${Math.abs(Math.round(d))} days in 3 years (${Math.round(wcDays[wn - 4]!)} → ${Math.round(wcDays[wn - 1]!)}).` });
  }

  // ---- cash quality
  const cf = annual(sc.cf);
  const cfo = cf.pick(row(sc.cf, "Cash from Operating Activity"));
  const fcfRow = row(sc.cf, "Free Cash Flow");
  const fcf = cf.pick(fcfRow);
  // Align PAT to cash-flow years.
  const patByYear = new Map(pl.cols.map((c, i) => [c, pat[i]]));
  const patCf = cf.cols.map((c) => patByYear.get(c) ?? null);
  const conversion = cfo.map((c, i) => (c != null && patCf[i] && patCf[i]! > 0 ? (c / patCf[i]!) * 100 : null));
  const cn = cfo.length;
  const sum = (a: (number | null)[]) => a.reduce<number>((s, x) => s + (x ?? 0), 0);
  const cfo5 = sum(last(cfo, 5));
  const pat5 = sum(last(patCf, 5));
  const cashSignals: Signal[] = [];
  if (!L && pat5 > 0) {
    const r = (cfo5 / pat5) * 100;
    cashSignals.push({
      tone: r >= 90 ? "good" : r >= 70 ? "watch" : "bad",
      text: `Over 5 years, operating cash flow was ${r.toFixed(0)}% of reported profit${r >= 90 ? ": profits are turning into cash" : r >= 70 ? ": some profit is stuck in working capital" : ": profits are not converting to cash, a red flag"}.`,
    });
  }
  const neg = last(fcf, 5).filter((x) => x != null && x < 0).length;
  if (!L && neg >= 3) cashSignals.push({ tone: "watch", text: `Free cash flow was negative in ${neg} of the last 5 years: capex is running ahead of cash generation.` });

  // ---- headline snapshot
  const ttmIdx = sc.pl.cols.indexOf("TTM");
  const ttmRev = ttmIdx >= 0 ? row(sc.pl, "Sales", "Revenue")[ttmIdx] : rev[n - 1];
  const ttmPat = ttmIdx >= 0 ? row(sc.pl, "Net Profit")[ttmIdx] : pat[n - 1];
  const ttmOp = ttmIdx >= 0 ? row(sc.pl, "Operating Profit", "Financing Profit")[ttmIdx] : op[n - 1];
  const r = sc.topRatios;
  const snapshot: NumbersView["snapshot"] = [
    { label: "Revenue (TTM)", value: fmtCr(ttmRev), sub: rev3 != null ? `${pctS(rev3)} 3y CAGR` : undefined },
    {
      label: L ? "Financing margin" : "EBITDA margin",
      value: ttmRev && ttmOp != null ? pctS((ttmOp / ttmRev) * 100, 1) : "–",
      sub: m0 != null && m1 != null && !L ? `${m1 - m0 >= 0 ? "+" : "−"}${Math.abs(Math.round((m1 - m0) * 100))} bps vs 3y ago` : undefined,
    },
    { label: "PAT (TTM)", value: fmtCr(ttmPat), sub: pat3 != null ? `${pctS(pat3)} 3y CAGR` : undefined },
    { label: L ? "ROE" : "ROCE", value: (L ? r["ROE"] : r["ROCE"]) || "–" },
  ];
  if (!L) {
    snapshot.push({ label: "Debt / equity", value: de[bn - 1] != null ? de[bn - 1]!.toFixed(2) : "–", tone: de[bn - 1] != null && de[bn - 1]! > 1 ? "bad" : undefined });
    snapshot.push({ label: "Cash conversion (5y)", value: pat5 > 0 ? `${((cfo5 / pat5) * 100).toFixed(0)}%` : "–", sub: "CFO ÷ PAT" });
  }

  const flags = [...trajSignals, ...balSignals, ...cashSignals].filter((s) => s.tone === "bad" || s.tone === "watch");

  return {
    header: {
      name: sc.name,
      ticker: sc.ticker,
      sector: sc.sector,
      basis: sc.basis,
      isLender: L,
      price: r["Current Price"] || null,
      mcap: r["Market Cap"] || null,
      pe: r["Stock P/E"] || null,
      roce: r["ROCE"] || null,
      roe: r["ROE"] || null,
      divYield: r["Dividend Yield"] || null,
      screenerUrl: sc.url,
    },
    snapshot,
    quarters,
    trajectory: { cols: tCols, revenue: last(rev, 10), pat: last(pat, 10), margin: last(margin, 10), signals: trajSignals },
    balance: { cols: last(bs.cols, 8), borrowings: last(borrowings, 8), equity: last(equity, 8), de: last(de, 8), wcDays: last(wcDays, 8), ccc: last(ccc, 8), signals: balSignals },
    cash: { cols: last(cf.cols, 8), cfo: last(cfo, 8), pat: last(patCf, 8), fcf: last(fcf, 8), conversion: last(conversion, 8), signals: cashSignals },
    flags,
  };
}

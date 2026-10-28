"use client";
// Financials tab: share-price chart, key stats, and results / balance sheet / cash views.
// Every bar chart shares one column grid with the numbers under it, so a bar always sits
// exactly above its own quarter. Wide tables scroll sideways with the row labels pinned.
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { NumbersView, Signal } from "@/lib/pull/numbers";
import { fmtCr, fmtPct } from "@/lib/client/format";

type Bar3 = [string, number, number]; // date, close, volume

const short = (c: string) => c.replace(/^(\w{3}) 20(\d\d)$/, "$1 '$2");
const compact = (x: number | null) => {
  if (x == null) return "";
  const a = Math.abs(x);
  const s = a >= 100000 ? `${(a / 100000).toFixed(1)}L` : a >= 10000 ? `${(a / 1000).toFixed(0)}k` : a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return `${x < 0 ? "−" : ""}${s}`;
};
const yoyOf = (v: (number | null)[], lag: number) =>
  v.map((b, i) => {
    const a = v[i - lag];
    return a != null && b != null && a > 0 ? ((b - a) / a) * 100 : null;
  });
const toneCls = (s: string) => (s.startsWith("−") ? "text-down" : s.startsWith("+") ? "text-up" : "");

export function Financials({ n, ticker }: { n: NumbersView; ticker: string }) {
  return (
    <>
      <PriceChart ticker={ticker} />
      <KeyStats n={n} />
      <Results n={n} />
      {n.trajectory.signals.length > 0 && (
        <section className="card mx-4 mt-3 p-4">
          <h3 className="text-[14px] font-bold">What the trend says</h3>
          <SignalList s={n.trajectory.signals} />
        </section>
      )}
      {!n.header.isLender && <BalanceSheet n={n} />}
      {!n.header.isLender && <CashQuality n={n} />}
      <p className="mx-4 mt-3 text-[11.5px] text-dim">
        Figures in ₹ crore, {n.header.basis}, from exchange filings via Screener. Every number on this tab is computed in code, no model involved.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- share price

const RANGES = [
  { k: "1M", days: 31 },
  { k: "6M", days: 183 },
  { k: "1Y", days: 365 },
  { k: "3Y", days: 1096 },
  { k: "5Y", days: 1827 },
] as const;

function PriceChart({ ticker }: { ticker: string }) {
  const [bars, setBars] = useState<Bar3[] | null>(null);
  const [err, setErr] = useState(false);
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>("1Y");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/research/${ticker}?step=price`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.data?.bars?.length) setBars(j.data.bars);
        else setErr(true);
      })
      .catch(() => live && setErr(true));
    return () => {
      live = false;
    };
  }, [ticker]);

  const view = useMemo(() => {
    if (!bars) return null;
    const days = RANGES.find((r) => r.k === range)!.days;
    const end = new Date(bars[bars.length - 1][0]).getTime();
    const pts = bars.filter((b) => new Date(b[0]).getTime() >= end - days * 86400e3);
    const yr = bars.filter((b) => new Date(b[0]).getTime() >= end - 365 * 86400e3).map((b) => b[1]);
    return { pts, hi52: Math.max(...yr), lo52: Math.min(...yr) };
  }, [bars, range]);

  if (err)
    return (
      <section className="card mx-4 mt-4 p-4 text-[12.5px] text-dim">
        <h3 className="text-[14px] font-bold text-ink">Share price</h3>
        <p className="mt-1">Price history isn&apos;t available for {ticker} right now.</p>
      </section>
    );

  const W = 340;
  const H = 150;
  const VH = 26; // volume strip
  if (!view || view.pts.length < 2)
    return (
      <section className="card mx-4 mt-4 p-4" aria-busy="true">
        <h3 className="text-[14px] font-bold">Share price</h3>
        <div className="mt-3 h-[176px] animate-pulse rounded-xl bg-raise" />
      </section>
    );

  const { pts } = view;
  const closes = pts.map((p) => p[1]);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  const y = (c: number) => 6 + (H - 12) * (1 - (c - (lo - pad)) / (hi - lo + 2 * pad));
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L${W},${H}L0,${H}Z`;
  const vmax = Math.max(...pts.map((p) => p[2])) || 1;
  const first = closes[0];
  const sel = hover ?? pts.length - 1;
  const cur = pts[sel];
  const chg = ((cur[1] - first) / first) * 100;
  const up = chg >= 0;
  const color = up ? "rgb(var(--up))" : "rgb(var(--down))";
  const iHi = closes.indexOf(hi);
  const iLo = closes.indexOf(lo);
  const date = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const onMove = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((clientX - r.left) / r.width) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };

  return (
    <section className="card mx-4 mt-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-dim">{hover == null ? "Share price" : date(cur[0])}</p>
          <p className="mt-0.5 text-[24px] font-extrabold leading-none tracking-tight num">₹{cur[1].toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
          <p className={clsx("mt-1 text-[12.5px] font-bold num", up ? "text-up" : "text-down")}>
            {fmtPct(chg, 2)} <span className="font-medium text-dim">{hover == null ? `in ${range}` : `since ${date(pts[0][0])}`}</span>
          </p>
        </div>
        <div className="text-right text-[11px] text-dim num">
          <p>
            52W high <span className="font-semibold text-ink">₹{view.hi52.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
          </p>
          <p className="mt-0.5">
            52W low <span className="font-semibold text-ink">₹{view.lo52.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
          </p>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H + VH + 4}`}
        className="mt-3 block w-full touch-none select-none"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => e.pointerType !== "mouse" && setHover(null)}
        role="img"
        aria-label={`${ticker} share price over ${range}: ${fmtPct(chg, 1)}`}
      >
        <defs>
          <linearGradient id="pfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(var(--rule))" strokeDasharray="2 4" />
        ))}
        <line x1="0" x2={W} y1={y(first)} y2={y(first)} stroke="rgb(var(--dim))" strokeOpacity=".5" strokeDasharray="1 3" />
        <path d={area} fill="url(#pfill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => {
          const h = (p[2] / vmax) * VH;
          return <rect key={p[0]} x={x(i) - W / pts.length / 2} width={Math.max(0.6, (W / pts.length) * 0.7)} y={H + 4 + VH - h} height={h} fill="rgb(var(--dim))" opacity={i === sel ? 0.9 : 0.28} />;
        })}
        {hover == null && (
          <>
            <text x={Math.min(Math.max(x(iHi), 20), W - 20)} y={Math.max(y(hi) - 4, 9)} textAnchor="middle" fontSize="9" fill="rgb(var(--dim))" className="num">
              {hi.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </text>
            <text x={Math.min(Math.max(x(iLo), 20), W - 20)} y={Math.min(y(lo) + 11, H - 1)} textAnchor="middle" fontSize="9" fill="rgb(var(--dim))" className="num">
              {lo.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </text>
          </>
        )}
        <line x1={x(sel)} x2={x(sel)} y1="0" y2={H} stroke="rgb(var(--ink))" strokeOpacity={hover == null ? 0 : 0.35} />
        <circle cx={x(sel)} cy={y(cur[1])} r="3.6" fill={color} stroke="rgb(var(--sheet))" strokeWidth="1.5" />
      </svg>

      <div className="mt-3 grid grid-cols-5 gap-1 rounded-xl bg-raise p-1" role="tablist" aria-label="Chart range">
        {RANGES.map((r) => (
          <button
            key={r.k}
            role="tab"
            aria-selected={range === r.k}
            onClick={() => setRange(r.k)}
            className={clsx("rounded-lg py-1.5 text-[12px] font-bold", range === r.k ? "bg-sheet text-ink shadow-sm" : "text-dim")}
          >
            {r.k}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- key stats

function KeyStats({ n }: { n: NumbersView }) {
  return (
    <section className="card mx-4 mt-3 p-4">
      <h3 className="text-[14px] font-bold">Key numbers</h3>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {n.snapshot.map((s) => (
          <div key={s.label} className="rounded-xl bg-raise px-3 py-2.5">
            <dt className="text-[11px] text-dim">{s.label}</dt>
            <dd className={clsx("mt-0.5 text-[17px] font-extrabold num tracking-tight", s.tone === "bad" && "text-down")}>{s.value}</dd>
            {s.sub && <dd className="text-[11px] text-dim num">{s.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------- aligned chart + table

interface Row {
  label: string;
  values: string[];
  tone?: boolean; // colour +/− values
  bold?: boolean;
}
interface BarSeries {
  name: string;
  values: (number | null)[];
  cls: string; // fill class
}

/**
 * One grid for chart and numbers: column 1 is the pinned label, then one column per period.
 * The chart row lives in the same grid, so bars and figures can never drift apart.
 */
function GridChart({ cols, series, rows, height = 120, labels = true }: { cols: string[]; series: BarSeries[]; rows: Row[]; height?: number; labels?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Latest period is on the right: start scrolled to it.
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [cols.length]);
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const maxP = Math.max(0, ...all);
  const maxN = Math.max(0, ...all.map((v) => -v));
  const span = maxP + maxN || 1;
  const plot = height - (labels ? 16 : 4);
  const zero = (maxP / span) * plot; // px from the top of the plot area to the zero line
  const grid = { gridTemplateColumns: `88px repeat(${cols.length}, minmax(50px, 1fr))` };
  const single = series.length === 1;

  return (
    <div ref={scroller} className="scroll-x mt-3 overflow-x-auto">
      <div className="grid min-w-full text-[12px] num" style={grid}>
        {/* chart row */}
        <div className="sticky left-0 z-10 bg-sheet" />
        {cols.map((c, i) => (
          <div key={c} className="relative" style={{ height }}>
            <div className="absolute inset-x-0 border-t border-rule" style={{ top: (labels ? 16 : 4) + zero }} />
            <div className="absolute inset-x-1.5 bottom-0 flex justify-center gap-[3px]" style={{ top: labels ? 16 : 4 }}>
              {series.map((s) => {
                const v = s.values[i];
                const h = v == null ? 0 : (Math.abs(v) / span) * plot;
                const top = v == null ? zero : v >= 0 ? zero - h : zero;
                const last = i === cols.length - 1;
                return (
                  <div key={s.name} className="relative h-full" style={{ width: single ? "70%" : `${90 / series.length}%`, maxWidth: single ? 30 : 16 }}>
                    <div
                      className={clsx("absolute inset-x-0 rounded-[4px]", v != null && v < 0 ? "bg-down" : s.cls, single && !last && "opacity-45")}
                      style={{ top, height: Math.max(h, v == null ? 0 : 1.5) }}
                    />
                    {labels && single && v != null && (
                      <span
                        className={clsx("absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px]", last ? "font-bold text-ink" : "text-dim")}
                        style={{ top: v >= 0 ? top - 15 : top + h + 1 }}
                      >
                        {compact(v)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* period labels */}
        <div className="sticky left-0 z-10 bg-sheet py-1.5 text-[11px] text-dim">₹ cr</div>
        {cols.map((c, i) => (
          <div key={c} className={clsx("py-1.5 text-center text-[11px]", i === cols.length - 1 ? "font-bold text-ink" : "text-dim")}>
            {short(c)}
          </div>
        ))}

        {/* figures */}
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <div className="sticky left-0 z-10 truncate border-t border-rule bg-sheet py-1.5 pr-2 text-dim shadow-[6px_0_6px_-6px_rgb(var(--shadow)/0.25)]">{r.label}</div>
            {r.values.map((v, i) => (
              <div key={i} className={clsx("border-t border-rule py-1.5 text-center", r.tone ? toneCls(v) : v.startsWith("−") && "text-down", r.bold && "font-bold")}>
                {v}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Seg<T extends string>({ options, value, onChange, label }: { options: readonly { k: T; label: string }[]; value: T; onChange: (k: T) => void; label: string }) {
  return (
    <div className="flex gap-1 rounded-xl bg-raise p-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.k}
          role="tab"
          aria-selected={value === o.k}
          onClick={() => onChange(o.k)}
          className={clsx("flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[12px] font-bold", value === o.k ? "bg-sheet text-ink shadow-sm" : "text-dim")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { name: string; cls: string }[] }) {
  return (
    <div className="mt-2 flex gap-4 text-[11.5px] text-dim">
      {items.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5">
          <span className={clsx("h-2.5 w-2.5 rounded-[3px]", s.cls)} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- results

type Metric = "revenue" | "ebitda" | "pat" | "margin";

function Results({ n }: { n: NumbersView }) {
  const L = n.header.isLender;
  const [period, setPeriod] = useState<"q" | "y">("q");
  const [metric, setMetric] = useState<Metric>("revenue");

  const d = useMemo(() => {
    if (period === "q") {
      const q = n.quarters;
      return { cols: q.cols, revenue: q.revenue, ebitda: q.ebitda, pat: q.pat, margin: q.margin, revG: q.revYoY, patG: q.patYoY, gLabel: "YoY" };
    }
    const t = n.trajectory;
    const ebitda = t.revenue.map((r, i) => (r != null && t.margin[i] != null ? (r * t.margin[i]!) / 100 : null));
    return { cols: t.cols, revenue: t.revenue, ebitda, pat: t.pat, margin: t.margin, revG: yoyOf(t.revenue, 1), patG: yoyOf(t.pat, 1), gLabel: "growth" };
  }, [n, period]);

  const opName = L ? "Fin. profit" : "EBITDA";
  const METRICS = [
    { k: "revenue", label: "Revenue" },
    { k: "ebitda", label: opName },
    { k: "pat", label: "Profit" },
    { k: "margin", label: "Margin" },
  ] as const;
  const values = d[metric];
  const pct = (v: (number | null)[]) => v.map((x) => fmtPct(x, 0));
  const rows: Row[] = [
    { label: "Revenue", values: d.revenue.map(fmtCr), bold: metric === "revenue" },
    { label: opName, values: d.ebitda.map(fmtCr), bold: metric === "ebitda" },
    { label: "Net profit", values: d.pat.map(fmtCr), bold: metric === "pat" },
    { label: "Margin", values: d.margin.map((x) => (x == null ? "–" : `${x.toFixed(1)}%`)), bold: metric === "margin" },
    { label: `Rev ${d.gLabel}`, values: pct(d.revG), tone: true },
    { label: `Profit ${d.gLabel}`, values: pct(d.patG), tone: true },
  ];
  const lastIdx = d.cols.length - 1;
  const lastV = values[lastIdx];
  const headline =
    metric === "margin"
      ? `${lastV == null ? "–" : lastV.toFixed(1) + "%"}`
      : `₹${fmtCr(lastV)} cr`;
  const g = metric === "revenue" ? d.revG[lastIdx] : metric === "pat" ? d.patG[lastIdx] : null;

  return (
    <section className="card mx-4 mt-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-bold">Results</h3>
        <div className="w-[168px]">
          <Seg label="Period" options={[{ k: "q", label: "Quarterly" }, { k: "y", label: "Annual" }] as const} value={period} onChange={setPeriod} />
        </div>
      </div>
      <div className="scroll-x -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        {METRICS.map((m) => (
          <button
            key={m.k}
            onClick={() => setMetric(m.k)}
            className={clsx(
              "shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold",
              metric === m.k ? "bg-brand text-brand-ink" : "bg-sheet text-dim shadow-[inset_0_0_0_1px_rgb(var(--rule))]",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-dim">
        {short(d.cols[lastIdx] ?? "")} {METRICS.find((m) => m.k === metric)!.label.toLowerCase()}
      </p>
      <p className="text-[20px] font-extrabold tracking-tight num">
        {headline}
        {g != null && <span className={clsx("ml-2 text-[13px] font-bold", g >= 0 ? "text-up" : "text-down")}>{fmtPct(g, 1)} {d.gLabel}</span>}
      </p>
      <GridChart cols={d.cols} series={[{ name: metric, values, cls: "bg-brand" }]} rows={rows} />
    </section>
  );
}

// ---------------------------------------------------------------- balance sheet and cash

function BalanceSheet({ n }: { n: NumbersView }) {
  const b = n.balance;
  const k = Math.min(5, b.cols.length);
  const cut = <T,>(a: T[]) => a.slice(-k);
  const series = [
    { name: "Equity", values: cut(b.equity), cls: "bg-brand" },
    { name: "Borrowings", values: cut(b.borrowings), cls: "bg-flag" },
  ];
  return (
    <section className="card mx-4 mt-3 p-4">
      <h3 className="text-[14px] font-bold">Balance sheet</h3>
      <Legend items={series} />
      <GridChart
        cols={cut(b.cols)}
        series={series}
        labels={false}
        height={96}
        rows={[
          { label: "Equity", values: cut(b.equity).map(fmtCr) },
          { label: "Borrowings", values: cut(b.borrowings).map(fmtCr) },
          { label: "Debt/equity", values: cut(b.de).map((x) => (x == null ? "–" : x.toFixed(2))), bold: true },
          { label: "WC days", values: cut(b.wcDays).map((x) => (x == null ? "–" : x.toFixed(0))) },
        ]}
      />
      <SignalList s={b.signals} />
    </section>
  );
}

function CashQuality({ n }: { n: NumbersView }) {
  const c = n.cash;
  const k = Math.min(5, c.cols.length);
  const cut = <T,>(a: T[]) => a.slice(-k);
  const series = [
    { name: "Net profit", values: cut(c.pat), cls: "bg-dim/50" },
    { name: "Operating cash", values: cut(c.cfo), cls: "bg-brand" },
  ];
  return (
    <section className="card mx-4 mt-3 p-4">
      <h3 className="text-[14px] font-bold">Profit vs cash</h3>
      <p className="mt-0.5 text-[12px] text-dim">Does reported profit turn into cash?</p>
      <Legend items={series} />
      <GridChart
        cols={cut(c.cols)}
        series={series}
        labels={false}
        height={96}
        rows={[
          { label: "Net profit", values: cut(c.pat).map(fmtCr) },
          { label: "Op. cash", values: cut(c.cfo).map(fmtCr) },
          { label: "Free cash", values: cut(c.fcf).map(fmtCr) },
          { label: "Cash ÷ profit", values: cut(c.conversion).map((x) => (x == null ? "–" : `${x.toFixed(0)}%`)), bold: true },
        ]}
      />
      <SignalList s={c.signals} />
    </section>
  );
}

function SignalList({ s }: { s: Signal[] }) {
  if (!s.length) return null;
  const dot = { good: "bg-up", bad: "bg-down", watch: "bg-flag", neutral: "bg-dim" } as const;
  return (
    <ul className="mt-3 space-y-1.5 text-[13px] leading-snug">
      {s.map((x, i) => (
        <li key={i} className="flex gap-2">
          <span className={clsx("mt-[6px] h-2 w-2 shrink-0 rounded-full", dot[x.tone])} />
          <span>{x.text}</span>
        </li>
      ))}
    </ul>
  );
}

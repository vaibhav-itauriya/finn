"use client";
// Portfolio: what you own and how it moved, in three views (holdings list, heatmap, sectors),
// plus a sheet per holding with its chart, position, flags and recent filings.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import type { Digest, Filing } from "@/lib/types";
import { AppHeader } from "../AppHeader";
import { Icon } from "../Icon";
import { Sparkline } from "../Sparkline";
import { PriceChart } from "../research/Financials";
import { askFinn } from "../copilot/Copilot";
import { ShareButton } from "../share/Share";
import { inr, sectorMix, SECTOR_PALETTE, signed, summarise, type Position } from "@/lib/client/portfolio";
import { SummaryCard } from "./SummaryCard";
import { useRules } from "@/lib/client/prefs";
import { fmtPct, relTime } from "@/lib/client/format";
import { squarify } from "@/lib/client/treemap";
import { useScreenContext } from "@/lib/client/screen";
import { filingLine } from "@/lib/feed";
import { CATEGORY_LABEL } from "@/lib/push/classify";

type View = "list" | "map" | "sectors";
type SortKey = "value" | "day" | "m1" | "m3" | "name";
const SORTS: { k: SortKey; label: string }[] = [
  { k: "value", label: "Value" },
  { k: "day", label: "Today" },
  { k: "m1", label: "1M" },
  { k: "m3", label: "3M" },
  { k: "name", label: "A–Z" },
];

/** Day-change colour for heatmap tiles: deeper with bigger moves, capped at ±3%. */
function heat(day: number | null) {
  if (day == null) return { bg: "rgb(var(--raise))", fg: "rgb(var(--ink))" };
  const k = Math.min(1, Math.abs(day) / 3);
  const a = 0.18 + k * 0.72;
  return { bg: `rgb(var(${day >= 0 ? "--up" : "--down"}) / ${a.toFixed(2)})`, fg: a > 0.55 ? "#fff" : "rgb(var(--ink))" };
}

export function PortfolioView({ digest }: { digest: Digest }) {
  const s = useMemo(() => summarise(digest), [digest]);
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<SortKey>("value");
  const [rules] = useRules();
  const [open, setOpen] = useState<string | null>(null);

  // ?h=TICKER (from a notification or the copilot) opens that holding's sheet.
  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("h");
    if (h) setOpen(h.toUpperCase());
  }, []);
  const show = (t: string | null) => {
    setOpen(t);
    const u = new URL(window.location.href);
    if (t) u.searchParams.set("h", t);
    else u.searchParams.delete("h");
    window.history.replaceState(null, "", u);
  };

  const weight = (p: Position) => (s.value ? ((p.value ?? 0) / s.value) * 100 : 0);
  const rows = [...s.positions].sort((a, b) =>
    sort === "name" ? a.h.ticker.localeCompare(b.h.ticker) : sort === "day" ? (b.day ?? 0) - (a.day ?? 0) : sort === "m1" ? (b.m1 ?? 0) - (a.m1 ?? 0) : sort === "m3" ? (b.m3 ?? 0) - (a.m3 ?? 0) : (b.value ?? 0) - (a.value ?? 0),
  );
  const sectors = useMemo(() => sectorMix(s), [s]);
  const sectorColor = (name: string) => sectors.find((x) => x.name === name)?.color ?? SECTOR_PALETTE[0];

  const movers = [...s.positions].filter((p) => p.dayPnl != null).sort((a, b) => (b.dayPnl ?? 0) - (a.dayPnl ?? 0));
  const contributors = [...movers.slice(0, 2), ...movers.slice(-2).reverse()];
  const hot = (p: Position) => (p.volX ?? 0) >= rules.volMultiple || Math.abs(p.day ?? 0) >= rules.moveAbs;
  const sel = open ? s.positions.find((p) => p.h.ticker === open) ?? null : null;

  return (
    <main>
      <AppHeader />
      <SummaryCard
        s={s}
        action={
          <button onClick={() => askFinn("How did my portfolio do and why?")} className="flex items-center gap-1 text-[12px] font-semibold text-brand" aria-label="Ask FINN to explain your portfolio">
            <Icon name="mic" size={13} /> Explain
          </button>
        }
      />
      <Link href="/alerts" className="card mx-4 mt-2.5 flex items-center gap-3 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <Icon name="dial" size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">Alert thresholds</span>
          <span className="block text-[12px] text-dim">
            Alert me at ±{rules.moveAbs}% price or {rules.volMultiple}× volume
          </span>
        </span>
        <span className="text-[13px] font-bold text-brand">Change</span>
      </Link>

      {contributors.length > 0 && (
        <section className="mt-4">
          <h2 className="px-4 text-[13px] font-bold text-dim">Biggest swings last session</h2>
          <div className="scroll-x mt-2 flex gap-2 overflow-x-auto px-4">
            {contributors.map((p) => (
              <button key={p.h.ticker} onClick={() => show(p.h.ticker)} className="card min-w-[140px] shrink-0 p-3 text-left">
                <p className="text-[13px] font-extrabold">{p.h.ticker}</p>
                <p className={clsx("mt-0.5 text-[15px] font-extrabold num", (p.dayPnl ?? 0) >= 0 ? "text-up" : "text-down")}>{signed(p.dayPnl ?? 0, (v) => inr(v, true))}</p>
                <p className="text-[11px] text-dim num">
                  {fmtPct(p.day, 2)} · {weight(p).toFixed(1)}% of book
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mx-4 mt-4 flex gap-1 rounded-xl bg-raise p-1" role="tablist" aria-label="Portfolio view">
        {(
          [
            { k: "list", label: "Holdings", icon: "list" },
            { k: "map", label: "Heatmap", icon: "grid" },
            { k: "sectors", label: "Sectors", icon: "pie" },
          ] as const
        ).map((o) => (
          <button
            key={o.k}
            role="tab"
            aria-selected={view === o.k}
            onClick={() => setView(o.k)}
            className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-bold", view === o.k ? "bg-sheet text-ink shadow-sm" : "text-dim")}
          >
            <Icon name={o.icon} size={15} />
            {o.label}
          </button>
        ))}
      </div>

      {view === "list" && (
        <>
          <div className="scroll-x mt-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Sort holdings">
            {SORTS.map((o) => (
              <button
                key={o.k}
                role="tab"
                aria-selected={sort === o.k}
                onClick={() => setSort(o.k)}
                className={clsx("shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold", sort === o.k ? "bg-brand text-brand-ink" : "bg-sheet text-dim shadow-[inset_0_0_0_1px_rgb(var(--rule))]")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <ul className="card mx-4 mt-3 divide-y divide-rule overflow-hidden">
            {rows.map((p) => (
              <Row key={p.h.ticker} p={p} weight={weight(p)} hot={hot(p)} color={sectorColor(p.h.sector)} metric={sort === "m3" ? "m3" : sort === "m1" ? "m1" : "day"} onOpen={() => show(p.h.ticker)} />
            ))}
          </ul>
        </>
      )}

      {view === "map" && <Heatmap positions={s.positions} total={s.value} onOpen={show} />}

      {view === "sectors" && <Sectors sectors={sectors} total={s.value} onPick={(t) => show(t)} />}

      <p className="mx-4 mt-4 text-[11px] leading-snug text-dim">Mock quantities for the demo. End-of-day prices from Yahoo Finance as of {s.asOf}.</p>

      <AnimatePresence>{sel && <HoldingSheet key={sel.h.ticker} p={sel} weight={weight(sel)} hot={hot(sel)} filings={digest.filings.filter((f) => f.ticker === sel.h.ticker)} onClose={() => show(null)} />}</AnimatePresence>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div className="rounded-xl bg-raise px-2.5 py-2">
      <p className="text-[11px] text-dim">{label}</p>
      <p className={clsx("mt-0.5 text-[14px] font-extrabold num", tone != null && (tone >= 0 ? "text-up" : "text-down"))}>{value}</p>
      {sub && <p className={clsx("text-[11px] font-bold num", tone != null && (tone >= 0 ? "text-up" : "text-down"))}>{sub}</p>}
    </div>
  );
}

function Row({ p, weight, hot, color, metric, onOpen }: { p: Position; weight: number; hot: boolean; color: string; metric: "day" | "m1" | "m3"; onOpen: () => void }) {
  const v = p[metric];
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-raise">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white" style={{ background: color }} aria-hidden>
          {p.h.ticker.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="text-[14px] font-extrabold">{p.h.ticker}</span>
            {hot && <span className="rounded bg-flag/15 px-1 text-[10px] font-bold text-flag">Unusual</span>}
            {p.material7d > 0 && <span className="whitespace-nowrap rounded bg-brand-soft px-1 text-[10px] font-bold text-brand">{p.material7d} new</span>}
          </p>
          <p className="truncate text-[11.5px] text-dim">
            {p.h.qty} × ₹{p.ltp?.toLocaleString("en-IN") ?? "–"}
          </p>
          <div className="mt-1 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-raise">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, weight * 6)}%`, background: color }} />
          </div>
        </div>
        <Sparkline values={p.spark} width={56} height={24} />
        <div className="w-[88px] text-right">
          <p className="text-[13.5px] font-bold num">{p.value != null ? inr(p.value, true) : "–"}</p>
          <p className={clsx("text-[12px] font-bold num", (v ?? 0) >= 0 ? "text-up" : "text-down")}>
            {fmtPct(v, metric === "day" ? 2 : 1)}
            {metric !== "day" && <span className="ml-1 font-semibold text-dim">{metric.toUpperCase()}</span>}
          </p>
          <p className="text-[10.5px] text-dim num">{weight.toFixed(1)}% of book</p>
        </div>
      </button>
    </li>
  );
}

function Heatmap({ positions, total, onOpen }: { positions: Position[]; total: number; onOpen: (t: string) => void }) {
  const W = 100;
  const H = 128;
  const tiles = squarify(
    positions.filter((p) => (p.value ?? 0) > 0).map((p) => ({ item: p, value: p.value ?? 0 })),
    W,
    H,
  );
  return (
    <section className="mx-4 mt-3">
      <div className="relative w-full overflow-hidden rounded-[14px]" style={{ aspectRatio: `${W} / ${H}` }} role="img" aria-label="Holdings sized by value, coloured by last session's move">
        {tiles.map((t) => {
          const c = heat(t.item.day);
          const big = t.w * t.h > 220;
          return (
            <button
              key={t.item.h.ticker}
              onClick={() => onOpen(t.item.h.ticker)}
              className="absolute flex flex-col items-center justify-center overflow-hidden border-[1.5px] border-paper text-center"
              style={{ left: `${(t.x / W) * 100}%`, top: `${(t.y / H) * 100}%`, width: `${(t.w / W) * 100}%`, height: `${(t.h / H) * 100}%`, background: c.bg, color: c.fg }}
            >
              <span className={clsx("font-extrabold leading-tight", big ? "text-[14px]" : "text-[10.5px]")}>{t.item.h.ticker}</span>
              <span className={clsx("font-bold num", big ? "text-[13px]" : "text-[10px]")}>{fmtPct(t.item.day, 1)}</span>
              {big && <span className="mt-0.5 text-[10.5px] opacity-80 num">{(((t.item.value ?? 0) / total) * 100).toFixed(1)}%</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-dim">
        <span>−3%</span>
        <span className="h-2 w-40 rounded-full" style={{ background: "linear-gradient(90deg, rgb(var(--down)), rgb(var(--down) / .2), rgb(var(--up) / .2), rgb(var(--up)))" }} />
        <span>+3%</span>
      </div>
      <p className="mt-1 text-center text-[11px] text-dim">Size is position value. Tap a tile for its chart and filings.</p>
    </section>
  );
}

function Sectors({ sectors, total, onPick }: { sectors: { name: string; value: number; day: number; color: string; tickers: string[] }[]; total: number; onPick: (t: string) => void }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <section className="card mx-4 mt-3 p-4">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 140 140" className="h-[132px] w-[132px] shrink-0 -rotate-90" role="img" aria-label="Sector weights">
          {sectors.map((x) => {
            const f = x.value / total;
            const el = <circle key={x.name} cx="70" cy="70" r={R} fill="none" stroke={x.color} strokeWidth="22" strokeDasharray={`${Math.max(0, f * C - 1.5)} ${C}`} strokeDashoffset={-acc * C} />;
            acc += f;
            return el;
          })}
        </svg>
        <div>
          <p className="text-[12px] text-dim">Largest sector</p>
          <p className="text-[17px] font-extrabold leading-tight">{sectors[0]?.name}</p>
          <p className="text-[13px] font-bold num">{((sectors[0]?.value / total) * 100).toFixed(1)}% of book</p>
          <p className="mt-1 text-[11.5px] text-dim">{sectors.length} sectors across {sectors.reduce((a, x) => a + x.tickers.length, 0)} holdings</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-rule">
        {sectors.map((x) => (
          <li key={x.name} className="flex items-center gap-3 py-2.5">
            <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: x.color }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold">{x.name}</p>
              <p className="flex flex-wrap gap-x-2 text-[11.5px]">
                {x.tickers.map((t) => (
                  <button key={t} onClick={() => onPick(t)} className="font-semibold text-brand">
                    {t}
                  </button>
                ))}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[13.5px] font-bold num">{((x.value / total) * 100).toFixed(1)}%</p>
              <p className={clsx("text-[11.5px] font-bold num", x.day >= 0 ? "text-up" : "text-down")}>{fmtPct(x.day, 2)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HoldingSheet({ p, weight, hot, filings, onClose }: { p: Position; weight: number; hot: boolean; filings: Filing[]; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  const recent = filings.filter((f) => f.tier !== "routine").slice(0, 5);
  useScreenContext(
    `Holding sheet for ${p.h.name} (${p.h.ticker}), ${p.h.sector}. ${p.h.qty} shares at ₹${p.ltp}, worth ${p.value != null ? inr(p.value) : "–"}, ${weight.toFixed(1)}% of the portfolio. Last session ${fmtPct(p.day, 2)}, 1 month ${fmtPct(p.m1, 1)}, 3 months ${fmtPct(p.m3, 1)}, volume ${p.volX?.toFixed(1)}x its 20-day average.${hot ? " This move crossed the user's alert thresholds." : ""}\nRecent filings:\n${recent.map((f) => `- ${f.ts.slice(0, 10)} ${CATEGORY_LABEL[f.category]}: ${filingLine(f)}`).join("\n") || "none material in 30 days"}`,
  );
  const routine = filings.filter((f) => f.tier === "routine").length;
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <motion.section
        role="dialog"
        aria-label={`${p.h.name}`}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] max-w-[520px] overflow-y-auto rounded-t-[22px] bg-sheet px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl"
      >
        <span className="mx-auto block h-1 w-10 rounded-full bg-rule" aria-hidden />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-extrabold leading-tight tracking-tight">{p.h.name}</h2>
            <p className="text-[12px] text-dim">
              {p.h.ticker} · {p.h.sector} · {p.h.size} cap
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton
              label=""
              className="grid h-8 w-8 place-items-center rounded-full bg-raise"
              payload={{
                title: `${p.h.name} (${p.h.ticker})`,
                text: `*${p.h.name}* (${p.h.ticker})\n₹${p.ltp?.toLocaleString("en-IN")} · day ${fmtPct(p.day, 2)} · 1M ${fmtPct(p.m1, 1)}${recent[0] ? `\nLatest: ${filingLine(recent[0])}` : ""}`,
                path: `/portfolio?h=${p.h.ticker}`,
                bot: { kind: "holding", ticker: p.h.ticker },
              }}
            />
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-raise" aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        <PriceChart ticker={p.h.ticker} bare />

        <div className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
          <Stat label="Position" value={p.value != null ? inr(p.value, true) : "–"} sub={`${p.h.qty} shares`} />
          <Stat label="Weight" value={`${weight.toFixed(1)}%`} />
          <Stat label="Last session" value={signed(p.dayPnl ?? 0, (v) => inr(v, true))} sub={fmtPct(p.day, 2)} tone={p.dayPnl ?? 0} />
          <Stat label="1 month" value={fmtPct(p.m1, 1)} tone={p.m1 ?? 0} />
          <Stat label="3 months" value={fmtPct(p.m3, 1)} tone={p.m3 ?? 0} />
          <Stat label="Volume" value={p.volX != null ? `${p.volX.toFixed(1)}×` : "–"} sub="vs 20-day avg" />
        </div>
        {hot && <p className="mt-3 rounded-xl bg-flag/15 px-3 py-2 text-[12.5px] font-semibold text-flag">This move crossed your alert thresholds.</p>}

        <h3 className="mt-5 text-[13px] font-bold text-dim">Recent filings</h3>
        {recent.length === 0 ? (
          <p className="mt-1 text-[13px] text-dim">Nothing material in the last 30 days{routine ? `, ${routine} routine filings folded away` : ""}.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule">
            {recent.map((f) => (
              <li key={f.id}>
                <Link href={`/digest?f=${encodeURIComponent(f.id)}`} className="block py-2.5">
                  <p className="flex items-center gap-2 text-[11.5px]">
                    <span className={clsx("rounded px-1.5 py-[1px] font-bold", f.tier === "material" ? "bg-brand-soft text-brand" : "bg-raise text-dim")}>{CATEGORY_LABEL[f.category]}</span>
                    <span className="text-dim">{relTime(f.ts)}</span>
                  </p>
                  <p className="mt-1 text-[13px] leading-snug line-clamp-2">{filingLine(f)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Link href={`/research/${p.h.ticker}`} className="rounded-xl bg-brand py-2.5 text-center text-[13px] font-bold text-brand-ink">
            Research
          </Link>
          <Link href={`/digest?t=${p.h.ticker}`} className="rounded-xl bg-raise py-2.5 text-center text-[13px] font-bold">
            All filings
          </Link>
          <button
            onClick={() => {
              onClose();
              askFinn(`What's going on with ${p.h.name}?`);
            }}
            className="flex items-center justify-center gap-1 rounded-xl bg-raise py-2.5 text-[13px] font-bold"
          >
            <Icon name="mic" size={14} /> Ask
          </button>
        </div>
      </motion.section>
    </>
  );
}

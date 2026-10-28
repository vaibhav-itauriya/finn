"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Digest } from "@/lib/types";
import { AppHeader } from "../AppHeader";
import { Sparkline } from "../Sparkline";
import { inr, signed, summarise, type Position } from "@/lib/client/portfolio";
import { useRules } from "@/lib/client/prefs";
import { fmtPct } from "@/lib/client/format";

type SortKey = "value" | "day" | "m1" | "name";
const SORTS: { k: SortKey; label: string }[] = [
  { k: "value", label: "Value" },
  { k: "day", label: "Today" },
  { k: "m1", label: "1 month" },
  { k: "name", label: "A–Z" },
];

export function PortfolioView({ digest }: { digest: Digest }) {
  const s = useMemo(() => summarise(digest), [digest]);
  const [sort, setSort] = useState<SortKey>("value");
  const [rules] = useRules();
  const rows = [...s.positions].sort((a, b) =>
    sort === "name" ? a.h.ticker.localeCompare(b.h.ticker) : sort === "day" ? (b.day ?? 0) - (a.day ?? 0) : sort === "m1" ? (b.m1 ?? 0) - (a.m1 ?? 0) : (b.value ?? 0) - (a.value ?? 0),
  );
  const sectors = Object.entries(
    s.positions.reduce<Record<string, number>>((acc, p) => {
      acc[p.h.sector] = (acc[p.h.sector] || 0) + (p.value ?? 0);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <main>
      <AppHeader />
      <section className="card mx-4 mt-2 p-4">
        <h1 className="text-[12px] font-semibold text-dim">Portfolio value · {digest.portfolio.length} holdings</h1>
        <p className="mt-1 text-[28px] font-bold tracking-tight num">{inr(s.value)}</p>
        <p className={clsx("text-[13px] font-bold num", s.dayPnl >= 0 ? "text-up" : "text-down")}>
          {signed(s.dayPnl, (v) => inr(v))} ({fmtPct(s.dayPct, 2)}) today
        </p>
        {/* Sector mix as one stacked bar */}
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-raise" role="img" aria-label="Sector mix">
          {sectors.map(([name, v], i) => (
            <span key={name} style={{ width: `${(v / s.value) * 100}%`, opacity: 1 - i * 0.07 }} className="h-full bg-brand first:rounded-l-full [&+span]:ml-px" title={`${name} ${((v / s.value) * 100).toFixed(0)}%`} />
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-dim">
          {sectors
            .slice(0, 4)
            .map(([n, v]) => `${n} ${((v / s.value) * 100).toFixed(0)}%`)
            .join(" · ")}
          {sectors.length > 4 ? ` · ${sectors.length - 4} more` : ""}
        </p>
        <p className="mt-2 text-[10.5px] text-dim">Quantities are a mock portfolio for the demo. Prices are end of day from Yahoo Finance, as of {s.asOf}.</p>
      </section>

      <div className="scroll-x mt-4 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Sort holdings">
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
          <Row key={p.h.ticker} p={p} weight={s.value ? ((p.value ?? 0) / s.value) * 100 : 0} hot={(p.volX ?? 0) >= rules.volMultiple || Math.abs(p.day ?? 0) >= rules.moveAbs} />
        ))}
      </ul>
    </main>
  );
}

function Row({ p, weight, hot }: { p: Position; weight: number; hot: boolean }) {
  return (
    <li>
      <Link href={`/research/${p.h.ticker}`} className="flex items-center gap-3 px-3.5 py-3 active:bg-raise">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="text-[14px] font-extrabold">{p.h.ticker}</span>
            {hot && <span className="rounded bg-flag/15 px-1 text-[10px] font-bold text-flag">Unusual</span>}
            {p.material7d > 0 && <span className="whitespace-nowrap rounded bg-brand-soft px-1 text-[10px] font-bold text-brand">{p.material7d} filing{p.material7d > 1 ? "s" : ""}</span>}
          </p>
          <p className="truncate text-[11.5px] text-dim">
            {p.h.qty} × ₹{p.ltp?.toLocaleString("en-IN") ?? "–"} · {weight.toFixed(1)}%
          </p>
        </div>
        <Sparkline values={p.spark} width={56} height={24} />
        <div className="w-[92px] text-right">
          <p className="text-[13.5px] font-bold num">{p.value != null ? inr(p.value, true) : "–"}</p>
          <p className={clsx("text-[12px] font-bold num", (p.day ?? 0) >= 0 ? "text-up" : "text-down")}>{fmtPct(p.day, 2)}</p>
          <p className="text-[10.5px] text-dim num">1M {fmtPct(p.m1, 1)}</p>
        </div>
      </Link>
    </li>
  );
}

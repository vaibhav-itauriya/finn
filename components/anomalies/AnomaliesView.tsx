"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Digest } from "@/lib/types";
import { AppHeader } from "../AppHeader";
import { Sparkline } from "../Sparkline";
import { Icon } from "../Icon";
import { barStats, moveAlerts } from "@/lib/client/alerts";
import { useRules } from "@/lib/client/prefs";
import { fmtPct, istDay } from "@/lib/client/format";
import { SendToTelegram } from "../telegram/TelegramBanner";

const WINDOWS = [
  { k: 1, label: "Last session" },
  { k: 7, label: "7 days" },
  { k: 30, label: "30 days" },
];

export function AnomaliesView({ digest }: { digest: Digest }) {
  const [rules, , ready] = useRules();
  const [days, setDays] = useState(1);
  const lastDay = digest.prices.map((p) => p.bars.at(-1)?.d).filter(Boolean).sort().at(-1) || "";
  const since = days === 1 ? lastDay : new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const alerts = useMemo(() => (ready ? moveAlerts(digest.prices, rules, since) : []), [digest.prices, rules, since, ready]);

  // How close each holding came to your lines in the last session: the "almost" list.
  const near = useMemo(
    () =>
      digest.prices
        .map((s) => {
          const i = s.bars.length - 1;
          if (i < 21) return null;
          const { change, volX } = barStats(s.bars, i);
          const closeness = Math.max(Math.abs(change) / rules.moveAbs, volX / rules.volMultiple);
          return { ticker: s.ticker, change, volX, closeness };
        })
        .filter((x): x is { ticker: string; change: number; volX: number; closeness: number } => Boolean(x) && x!.closeness < 1)
        .sort((a, b) => b.closeness - a.closeness)
        .slice(0, 5),
    [digest.prices, rules],
  );

  return (
    <main>
      <AppHeader />
      <header className="px-4 pt-2">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Anomalies</h1>
        <p className="mt-1 text-[13px] text-dim">
          End-of-day moves that crossed your lines: price beyond <b className="text-ink">±{rules.moveAbs}%</b> or volume above <b className="text-ink">{rules.volMultiple}×</b> its 20-day average.{" "}
          <Link href="/alerts" className="font-semibold text-brand">
            Change
          </Link>
        </p>
        <div className="scroll-x -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Window">
          {WINDOWS.map((w) => (
            <button
              key={w.k}
              role="tab"
              aria-selected={days === w.k}
              onClick={() => setDays(w.k)}
              className={clsx("shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold", days === w.k ? "bg-brand text-brand-ink" : "bg-sheet text-dim shadow-[inset_0_0_0_1px_rgb(var(--rule))]")}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      <ul className="mx-4 mt-4 space-y-2.5">
        {alerts.map((m) => (
          <li key={m.ticker + m.d} className="card p-3.5">
            <div className="flex items-center gap-2">
              <Link href={`/research/${m.ticker}`} className="text-[14px] font-extrabold">
                {m.ticker}
              </Link>
              {m.kinds.map((k) => (
                <span key={k} className="rounded-md bg-flag/15 px-1.5 py-[1px] text-[11px] font-bold text-flag">
                  {k === "price" ? "Price" : "Volume"}
                </span>
              ))}
              <span className="ml-auto text-[11.5px] text-dim">{istDay(m.d + "T16:00:00+05:30")}</span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="grid flex-1 grid-cols-3 gap-2 text-[11px]">
                <Stat label="Close" value={`₹${m.close.toLocaleString("en-IN")}`} />
                <Stat label="Day" value={fmtPct(m.change, 1)} tone={m.change >= 0 ? "up" : "down"} hot={m.kinds.includes("price")} />
                <Stat label="Vol vs 20d" value={`${m.volX.toFixed(1)}×`} hot={m.kinds.includes("volume")} />
              </div>
              <Sparkline values={m.spark} width={64} height={30} />
            </div>
            <div className="mt-2.5 flex items-center gap-3.5 border-t border-rule pt-2.5 text-[12px]">
              <Link href={`/research/${m.ticker}`} className="font-semibold text-brand">
                Research
              </Link>
              <Link href={`/digest?w=7d`} className="font-semibold text-brand">
                Recent filings
              </Link>
              <SendToTelegram body={{ kind: "move", ticker: m.ticker, d: m.d, rules }} />
            </div>
          </li>
        ))}
        {ready && alerts.length === 0 && (
          <li className="card p-5 text-center">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-up/15 text-up">
              <Icon name="check" />
            </span>
            <p className="mt-2 text-[14px] font-bold">Nothing crossed your lines</p>
            <p className="mt-0.5 text-[12.5px] text-dim">in the {days === 1 ? "last session" : `last ${days} days`}. Closest calls are below.</p>
          </li>
        )}
      </ul>

      {near.length > 0 && (
        <section className="mx-4 mt-6">
          <h2 className="text-[13px] font-bold text-dim">Closest to your lines, last session</h2>
          <ul className="card mt-2 divide-y divide-rule">
            {near.map((n) => (
              <li key={n.ticker} className="flex items-center gap-3 px-3.5 py-2.5 text-[12.5px]">
                <span className="w-24 font-extrabold">{n.ticker}</span>
                <span className="flex-1">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-raise">
                    <span className="block h-full rounded-full bg-flag" style={{ width: `${Math.min(100, n.closeness * 100)}%` }} />
                  </span>
                </span>
                <span className={clsx("w-14 text-right font-bold num", n.change >= 0 ? "text-up" : "text-down")}>{fmtPct(n.change, 1)}</span>
                <span className="w-10 text-right text-dim num">{n.volX.toFixed(1)}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, tone, hot }: { label: string; value: string; tone?: "up" | "down"; hot?: boolean }) {
  return (
    <div className={clsx("rounded-lg p-2", hot ? "bg-flag/10 ring-1 ring-flag/40" : "bg-raise")}>
      <p className="text-dim">{label}</p>
      <p className={clsx("mt-0.5 text-[13px] font-extrabold num", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</p>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useMemo } from "react";
import clsx from "clsx";
import type { Digest } from "@/lib/types";
import { AppHeader } from "../AppHeader";
import { Icon, type IconName } from "../Icon";
import { Sparkline } from "../Sparkline";
import { inr, signed, summarise } from "@/lib/client/portfolio";
import { moveAlerts } from "@/lib/client/alerts";
import { bundle } from "@/lib/client/bundle";
import { useRules } from "@/lib/client/prefs";
import { fmtPct } from "@/lib/client/format";
import { RelTime } from "../RelTime";
import { CATEGORY_LABEL } from "@/lib/push/classify";
import { TelegramBanner } from "../telegram/TelegramBanner";

export function Home({ digest }: { digest: Digest }) {
  const [rules, , ready] = useRules();
  const s = useMemo(() => summarise(digest), [digest]);
  const gen = new Date(digest.engine.generatedAt).getTime();

  const day24 = useMemo(() => {
    const fs = digest.filings.filter((f) => new Date(f.ts).getTime() >= gen - 24 * 3600e3);
    const b = bundle(fs);
    return { filings: fs.length, material: b.filter((x) => x.lead.tier === "material").sort((a, z) => z.lead.score - a.lead.score) };
  }, [digest, gen]);

  const lastSession = s.asOf ?? "";
  const anomalies = useMemo(() => (ready ? moveAlerts(digest.prices, rules, lastSession) : []), [digest.prices, rules, lastSession, ready]);
  const week = new Date(gen - 7 * 86400e3).toISOString().slice(0, 10);
  const anomaliesWeek = useMemo(() => (ready ? moveAlerts(digest.prices, rules, week) : []), [digest.prices, rules, week, ready]);

  const sorted = [...s.positions].sort((a, b) => Math.abs(b.day ?? 0) - Math.abs(a.day ?? 0));

  return (
    <main>
      <AppHeader
        right={
          <span className="flex items-center gap-1.5 rounded-full bg-raise px-2.5 py-1 text-[11px] font-semibold text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-up" aria-hidden />
            Updated <RelTime iso={digest.engine.generatedAt} />
          </span>
        }
      />

      {/* Portfolio glance */}
      <section className="card mx-4 mt-2 p-4" aria-labelledby="pf">
        <div className="flex items-baseline justify-between">
          <h2 id="pf" className="text-[12px] font-semibold text-dim">
            Current value
          </h2>
          <Link href="/portfolio" className="flex items-center gap-0.5 text-[12px] font-semibold text-brand">
            {digest.portfolio.length} holdings <Icon name="chev" size={14} />
          </Link>
        </div>
        <p className="mt-1 text-[30px] font-bold tracking-tight num">{inr(s.value)}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-[12px]">
          <div>
            <p className="text-dim">Day&apos;s P&amp;L</p>
            <p className={clsx("mt-0.5 font-bold num", s.dayPnl >= 0 ? "text-up" : "text-down")}>
              {signed(s.dayPnl, (v) => inr(v, true))}
              <span className="block text-[11px] font-semibold">{fmtPct(s.dayPct, 2)}</span>
            </p>
          </div>
          <div>
            <p className="text-dim">1 month</p>
            <p className={clsx("mt-0.5 font-bold num", (s.m1Pct ?? 0) >= 0 ? "text-up" : "text-down")}>{fmtPct(s.m1Pct, 1)}</p>
            <p className="text-[11px] text-dim">value change</p>
          </div>
          <div>
            <p className="text-dim">Breadth</p>
            <p className="mt-0.5 font-bold num">
              <span className="text-up">{s.up}▲</span> <span className="text-down">{s.down}▼</span>
            </p>
          </div>
        </div>
      </section>

      {/* Holdings strip: biggest movers first */}
      <section className="mt-4" aria-label="Holdings, biggest movers first">
        <div className="scroll-x flex gap-2.5 overflow-x-auto px-4 pb-1 snap-x">
          {sorted.map((p) => (
            <Link key={p.h.ticker} href={`/research/${p.h.ticker}`} className="card min-w-[132px] snap-start p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold">{p.h.ticker}</span>
                {p.material7d > 0 && <span className="h-2 w-2 rounded-full bg-flag" title="Material filing this week" />}
              </div>
              <p className="mt-1 text-[13px] font-semibold num">{p.ltp != null ? `₹${p.ltp.toLocaleString("en-IN")}` : "–"}</p>
              <div className="mt-1 flex items-end justify-between">
                <span className={clsx("text-[12px] font-bold num", (p.day ?? 0) >= 0 ? "text-up" : "text-down")}>{fmtPct(p.day, 2)}</span>
                <Sparkline values={p.spark} width={54} height={22} tone="brand" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Action keys: one per job in the brief */}
      <section className="mx-4 mt-5 grid grid-cols-2 gap-2.5" aria-label="Actions">
        <ActionKey href="/digest?w=24h" icon="inbox" title="24h digest" sub={day24.material.length ? `${day24.material.length} need you · ${day24.filings} filings` : `${day24.filings} filings, nothing material`} hot={day24.material.length > 0} />
        <ActionKey href="/anomalies" icon="bolt" title="Anomalies" sub={ready ? `${anomalies.length} last session · ${anomaliesWeek.length} this week` : "Checking…"} hot={anomalies.length > 0} />
        <ActionKey href="/research" icon="lens" title="Deep dive" sub="Any NSE company, promises vs numbers" />
        <ActionKey href="/alerts" icon="dial" title="Thresholds" sub={`±${rules.moveAbs}% price · ${rules.volMultiple}× volume`} />
      </section>

      <TelegramBanner />

      {/* Top of the inbox */}
      <section className="mt-6" aria-labelledby="top">
        <div className="flex items-baseline justify-between px-4">
          <h2 id="top" className="text-[15px] font-bold">
            Needs you today
          </h2>
          <Link href="/digest?w=24h" className="text-[12px] font-semibold text-brand">
            Open digest
          </Link>
        </div>
        <ul className="mx-4 mt-2 space-y-2">
          {day24.material.slice(0, 4).map((b) => {
            const f = b.lead;
            const e = f.enrichment;
            const line = e?.kind === "results" ? `${e.period.split(" (")[0]}: ${e.verdict}` : e?.kind === "summary" ? e.line : e?.kind === "management" ? `${e.people[0].name}, ${e.people[0].role} (${e.people[0].change})` : f.title;
            return (
              <li key={b.key}>
                <Link href={`/digest?w=24h#${f.id}`} className="card flex gap-3 p-3">
                  <span className="mt-0.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2 text-[12px]">
                      <span className="font-bold text-[13px]">{f.ticker}</span>
                      <span className="rounded bg-brand-soft px-1.5 py-[1px] font-semibold text-brand">{CATEGORY_LABEL[f.category]}</span>
                      <span className="ml-auto text-dim"><RelTime iso={f.ts} /></span>
                    </p>
                    <p className="mt-1 text-[13.5px] leading-snug line-clamp-2">{line}</p>
                  </div>
                </Link>
              </li>
            );
          })}
          {day24.material.length === 0 && (
            <li className="card p-4 text-[13px] text-dim">
              Nothing material in the last 24 hours. {day24.filings} routine filings were read and folded away.
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}

function ActionKey({ href, icon, title, sub, hot }: { href: string; icon: IconName; title: string; sub: string; hot?: boolean }) {
  return (
    <Link href={href} className="card relative flex flex-col gap-2 p-3.5 active:scale-[.98] transition-transform">
      <span className={clsx("grid h-9 w-9 place-items-center rounded-xl", hot ? "bg-brand text-brand-ink" : "bg-brand-soft text-brand")}>
        <Icon name={icon} size={19} />
      </span>
      <span className="text-[14px] font-bold leading-tight">{title}</span>
      <span className="text-[11.5px] leading-snug text-dim">{sub}</span>
      {hot && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-flag" aria-label="Has new items" />}
    </Link>
  );
}

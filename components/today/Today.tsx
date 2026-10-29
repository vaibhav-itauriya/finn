"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { Digest, Filing } from "@/lib/types";
import { moveAlerts, type MoveAlert } from "@/lib/client/alerts";
import { useCleared, useLastVisit, useRules } from "@/lib/client/prefs";
import { fmtPct, istDay, relTime } from "@/lib/client/format";
import { CATEGORY_LABEL } from "@/lib/push/classify";
import { FilingItem } from "./FilingItem";
import { bundle, type Bundle } from "@/lib/client/bundle";
import { Sparkline } from "../Sparkline";
import { AppHeader } from "../AppHeader";
import { ShareButton } from "../share/Share";
import { useScreenContext } from "@/lib/client/screen";
import { filingLine } from "@/lib/feed";
import { Brief } from "./Brief";
import { Icon } from "../Icon";

type WindowKey = "24h" | "3d" | "7d" | "30d" | "custom";
const WINDOWS: { k: WindowKey; label: string; hours: number }[] = [
  { k: "24h", label: "24 hours", hours: 24 },
  { k: "3d", label: "3 days", hours: 72 },
  { k: "7d", label: "7 days", hours: 168 },
  { k: "30d", label: "30 days", hours: 720 },
  { k: "custom", label: "Custom dates", hours: 720 },
];
const istDate = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const nice = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function Today({ digest }: { digest: Digest }) {
  const [rules, setRules, rulesReady] = useRules();
  const [cleared, setCleared] = useCleared();
  const lastVisit = useLastVisit();
  // The brief's default: the last 24 hours. What's new since the last visit is badged inside it.
  const [win, setWin] = useState<WindowKey>("24h");
  const [autoBrief, setAutoBrief] = useState(false);
  // Deep links: ?w=24h from action keys, ?f=<filing> from a notification, ?t=TICKER from Portfolio.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const w = q.get("w");
    if (w && WINDOWS.some((x) => x.k === w)) {
      setWin(w as WindowKey);
      setAutoBrief(w === "24h");
    }
    if (q.get("t")) {
      setOnly(q.get("t")!.toUpperCase());
      if (!w) setWin("30d");
    }
    if (q.get("f")) {
      setFocusId(q.get("f"));
      window.scrollTo({ top: 0 });
    }
  }, []);
  const focusBundle = useMemo(() => (focusId ? bundle(digest.filings).find((b) => b.lead.id === focusId || b.related.some((r) => r.id === focusId)) ?? null : null), [focusId, digest.filings]);
  const [showFolded, setShowFolded] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  const [showCleared, setShowCleared] = useState(false);

  const generated = new Date(digest.engine.generatedAt).getTime();
  // Custom dates are whole IST days; the data covers the last 30 days.
  const today = istDate(generated);
  const earliest = istDate(generated - 30 * 86400e3);
  const [range, setRange] = useState({ from: istDate(generated - 6 * 86400e3), to: today });
  const custom = win === "custom";
  const since = useMemo(
    () => (custom ? new Date(`${range.from}T00:00:00+05:30`) : new Date(generated - WINDOWS.find((x) => x.k === win)!.hours * 3600e3)),
    [win, generated, custom, range.from],
  );
  const until = custom ? new Date(`${range.to}T23:59:59+05:30`).getTime() : Infinity;
  const windowLabel = custom ? (range.from === range.to ? nice(range.from) : `${nice(range.from)} to ${nice(range.to)}`) : `the last ${WINDOWS.find((w) => w.k === win)!.label}`;
  const tickers = useMemo(() => [...digest.portfolio].sort((a, b) => a.ticker.localeCompare(b.ticker)), [digest.portfolio]);
  const isFresh = (ts: string) => Boolean(lastVisit) && ts > lastVisit!;

  const clearedSet = useMemo(() => new Set(cleared.ids), [cleared]);
  const mutedSet = useMemo(() => new Set(rules.muted), [rules.muted]);

  const inWindow = digest.filings.filter((f) => new Date(f.ts) >= since && new Date(f.ts).getTime() <= until && (!only || f.ticker === only) && f.id !== focusBundle?.lead.id);
  const visible = inWindow.filter((f) => !mutedSet.has(`${f.ticker}:${f.category}`));
  const bundles = bundle(visible);
  const isLead = (b: Bundle) => b.lead.tier === "material" || (rules.pushCategories.includes(b.lead.category) && b.lead.score >= 45);
  const isCleared = (b: Bundle) => clearedSet.has(b.lead.id) || b.related.some((r) => clearedSet.has(r.id));
  const leadAll = bundles.filter(isLead).sort((a, b) => b.lead.score - a.lead.score || b.lead.ts.localeCompare(a.lead.ts));
  const glanceAll = bundles.filter((b) => !isLead(b) && b.lead.tier === "notable").sort((a, b) => b.lead.ts.localeCompare(a.lead.ts));
  const lead = leadAll.filter((b) => !isCleared(b));
  const glance = glanceAll.filter((b) => !isCleared(b));
  const folded = visible.filter((f) => f.tier === "routine" && !bundles.some((b) => b.lead.tier !== "routine" && b.related.includes(f)));
  const mutedCount = inWindow.length - visible.length;

  const sinceDay = new Date(since.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const moves = useMemo(() => (rulesReady ? moveAlerts(digest.prices, rules, sinceDay).filter((m) => (!only || m.ticker === only) && (!custom || m.d <= range.to)) : []), [digest.prices, rules, sinceDay, rulesReady, only, custom, range.to]);
  const openMoves = moves.filter((m) => !clearedSet.has(`mv:${m.ticker}:${m.d}`));

  const needs = lead.length + openMoves.length;
  const freshCount = [...lead, ...glance].filter((b) => isFresh(b.lead.ts)).length;
  useScreenContext(
    `Digest for ${windowLabel}${only ? `, ${only} only` : ""}: ${needs} things need the user.\n${lead
      .slice(0, 12)
      .map((b) => `- ${b.lead.ticker} ${CATEGORY_LABEL[b.lead.category]}: ${filingLine(b.lead)}`)
      .join("\n")}\n${openMoves.map((m) => `- ${m.ticker} unusual move ${m.d}: ${m.change.toFixed(1)}% on ${m.volX.toFixed(1)}x volume`).join("\n")}`,
  );

  const clear = (id: string, label: string) => {
    setCleared((c) => ({ ids: [...c.ids.filter((x) => x !== id), id].slice(-800) }));
    setToast({ text: `Cleared ${label}`, undo: () => setCleared((c) => ({ ids: c.ids.filter((x) => x !== id) })) });
    setTimeout(() => setToast(null), 4000);
  };
  const mute = (f: Filing) => {
    const key = `${f.ticker}:${f.category}`;
    setRules((r) => ({ ...r, muted: [...r.muted.filter((m) => m !== key), key] }));
    setToast({
      text: `Muted ${CATEGORY_LABEL[f.category].toLowerCase()} for ${f.ticker}`,
      undo: () => setRules((r) => ({ ...r, muted: r.muted.filter((m) => m !== key) })),
    });
    setTimeout(() => setToast(null), 5000);
  };

  const foldedByType = Object.entries(
    folded.reduce<Record<string, number>>((acc, f) => {
      const k = CATEGORY_LABEL[f.category];
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <main>
      <AppHeader />
      <header className="px-4 pt-2">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
          {needs === 0 ? "You're caught up." : <>{needs} {needs === 1 ? "thing needs" : "things need"} you</>}
        </h1>
        <p className="mt-1 text-[13px] leading-snug text-dim">
          {inWindow.length} filings and {digest.prices.length} price charts read {custom ? "for" : "in"} {windowLabel}.{" "}
          {folded.length > 0 && <>{folded.length} routine ones folded away.</>}
          {freshCount > 0 && lastVisit && (
            <span className="mt-1 block font-semibold text-flag">
              {freshCount} new since your last visit ({new Date(lastVisit).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}), marked New.
            </span>
          )}
        </p>
        <div className="scroll-x -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.k}
              role="tab"
              aria-selected={win === w.k}
              onClick={() => setWin(w.k)}
              className={clsx("shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold", win === w.k ? "bg-brand text-brand-ink" : "bg-sheet text-dim shadow-[inset_0_0_0_1px_rgb(var(--rule))]")}
            >
              {w.label}
            </button>
          ))}
        </div>
        {custom && (
          <div className="card mt-3 grid grid-cols-2 gap-3 p-3">
            <label className="text-[12px] font-semibold text-dim">
              From
              <input
                type="date"
                value={range.from}
                min={earliest}
                max={range.to}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-rule bg-sheet px-2.5 py-2 text-[14px] font-semibold text-ink"
              />
            </label>
            <label className="text-[12px] font-semibold text-dim">
              To
              <input
                type="date"
                value={range.to}
                min={range.from}
                max={today}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-rule bg-sheet px-2.5 py-2 text-[14px] font-semibold text-ink"
              />
            </label>
            <p className="col-span-2 -mt-1 text-[11px] text-dim">FINN keeps the last 30 days of filings, from {nice(earliest)}.</p>
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-dim">
          Stock
          <select
            value={only ?? ""}
            onChange={(e) => setOnly(e.target.value || null)}
            className={clsx("min-w-0 flex-1 rounded-xl border px-3 py-2 text-[14px] font-semibold", only ? "border-brand bg-brand-soft text-brand" : "border-rule bg-sheet text-ink")}
            aria-label="Show filings for one stock"
          >
            <option value="">All {digest.portfolio.length} holdings</option>
            {tickers.map((h) => (
              <option key={h.ticker} value={h.ticker}>
                {h.ticker} · {h.name}
              </option>
            ))}
          </select>
          {only && (
            <button onClick={() => setOnly(null)} className="grid h-9 w-9 place-items-center rounded-full bg-raise text-ink" aria-label="Show all holdings">
              <Icon name="x" size={15} />
            </button>
          )}
        </label>
      </header>

      {focusBundle && (
        <section className="mt-4" aria-label="The item you opened">
          <h2 className="mx-4 flex items-center justify-between text-[12px] font-bold uppercase tracking-wide text-brand">
            From your alert
            <button onClick={() => setFocusId(null)} className="text-[12px] font-semibold normal-case tracking-normal text-dim">
              Dismiss
            </button>
          </h2>
          <ul className="mx-4 mt-2 rounded-[16px] ring-2 ring-brand/60">
            <FilingItem f={focusBundle.lead} related={focusBundle.related} variant="lead" defaultOpen onDone={(x) => { clear(x.id, x.ticker); setFocusId(null); }} onMute={mute} />
          </ul>
        </section>
      )}

      {/* The brief looks back from now, so it shows for the preset windows across all holdings. */}
      {!only && !custom && <Brief hours={WINDOWS.find((w) => w.k === win)!.hours} auto={autoBrief} />}

      {/* What needs you: material filings + threshold breaches */}
      <section className="mt-5" aria-labelledby="needs">
        <h2 id="needs" className="sr-only">
          Needs you
        </h2>
        <ul className="mx-4 space-y-2.5">
          <AnimatePresence initial={false}>
            {lead.map((b, i) => (
              <motion.div key={b.key} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                <FilingItem f={b.lead} related={b.related} variant="lead" defaultOpen={i < 3} fresh={isFresh(b.lead.ts)} onDone={(x) => clear(x.id, x.ticker)} onMute={mute} />
              </motion.div>
            ))}
          </AnimatePresence>
        </ul>
        {openMoves.length > 0 && (
          <>
            <h2 className="mt-5 px-4 text-[13px] font-bold text-dim">Unusual moves at your thresholds</h2>
            <ul className="mx-4 mt-2 space-y-2.5">
              {openMoves.map((m) => (
                <MoveItem key={`${m.ticker}${m.d}`} m={m} volX={rules.volMultiple} moveAbs={rules.moveAbs} onDone={() => clear(`mv:${m.ticker}:${m.d}`, `${m.ticker} move`)} />
              ))}
            </ul>
          </>
        )}
        {needs === 0 && (
          <div className="card mx-4 px-4 py-8 text-center">
            <span className="stamp text-up">Clear</span>
            <p className="mt-3 text-[14px] text-dim">
              Nothing material in this window. {leadAll.length > 0 && <>You cleared {leadAll.length}.</>}
            </p>
            {leadAll.length > 0 && (
              <button className="mt-2 text-[13px] font-semibold text-brand" onClick={() => setShowCleared((s) => !s)}>
                {showCleared ? "Hide cleared" : "Show what you cleared"}
              </button>
            )}
          </div>
        )}
        {showCleared && (
          <ul className="mx-4 mt-2.5 space-y-2.5 opacity-70">
            {leadAll.filter(isCleared).map((b) => (
              <FilingItem key={b.key} f={b.lead} related={b.related} variant="glance" onDone={() => {}} onMute={mute} />
            ))}
          </ul>
        )}
      </section>

      {glance.length > 0 && (
        <section className="mt-7" aria-labelledby="glance">
          <h2 id="glance" className="px-4 text-[13px] font-bold text-dim">
            Worth a glance <span className="font-normal">({glance.length})</span>
          </h2>
          <ul className="mx-4 mt-2 space-y-2">
            {glance.map((b) => (
              <FilingItem key={b.key} f={b.lead} related={b.related} variant="glance" fresh={isFresh(b.lead.ts)} onDone={(x) => clear(x.id, x.ticker)} onMute={mute} />
            ))}
          </ul>
        </section>
      )}

      {folded.length > 0 && (
        <section className="card mx-4 mt-7 p-4" aria-labelledby="folded">
          <button id="folded" onClick={() => setShowFolded((s) => !s)} className="w-full text-left" aria-expanded={showFolded}>
            <h2 className="text-[13px] font-bold text-dim">
              Folded: {folded.length} routine {folded.length === 1 ? "filing" : "filings"} {showFolded ? "▴" : "▾"}
            </h2>
            <p className="mt-1 text-[12px] text-dim">{foldedByType.map(([k, n]) => `${k} ${n}`).join(", ")}</p>
          </button>
          {showFolded && (
            <ul className="mt-3 space-y-2">
              {folded.map((f) => (
                <li key={f.id} className="text-[13px] leading-snug">
                  <span className="font-medium">{f.ticker}</span> <span className="text-dim">{istDay(f.ts)}</span>{" "}
                  {f.pdf ? (
                    <a href={f.pdf} target="_blank" rel="noreferrer" className="text-ink/80 hover:underline">
                      {f.title}
                    </a>
                  ) : (
                    f.title
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mutedCount > 0 && (
        <p className="mt-6 px-4 text-[12px] text-dim">
          {mutedCount} filings hidden by your mutes. <Link href="/alerts" className="font-semibold text-brand">Manage</Link>
        </p>
      )}

      <EngineNote d={digest} />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed left-1/2 -translate-x-1/2 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 flex items-center gap-4 rounded-full bg-ink text-paper px-4 py-2 text-[13px] shadow-lg"
            role="status"
          >
            {toast.text}
            <button
              className="font-bold underline underline-offset-2"
              onClick={() => {
                toast.undo();
                setToast(null);
              }}
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function MoveItem({ m, onDone, volX, moveAbs }: { m: MoveAlert; onDone: () => void; volX: number; moveAbs: number }) {
  const parts: string[] = [];
  if (m.kinds.includes("price")) parts.push(`${m.change > 0 ? "up" : "down"} ${Math.abs(m.change).toFixed(1)}% (your line: ${moveAbs}%)`);
  if (m.kinds.includes("volume")) parts.push(`volume ${m.volX.toFixed(1)}× its 20-day average (your line: ${volX}×)`);
  return (
    <li className="card relative p-3.5">
      <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-r bg-flag" aria-hidden />
      <div className="flex items-center gap-2">
        <Link href={`/research/${m.ticker}`} className="text-[14px] font-extrabold tracking-tight">
          {m.ticker}
        </Link>
        <span className="rounded-md bg-flag/15 px-1.5 py-[1px] text-[11px] font-bold text-flag">Unusual move</span>
        <span className="ml-auto text-[12px] text-dim">{istDay(m.d + "T16:00:00+05:30")}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <p className="flex-1 text-[14px] leading-snug">
          Closed <span className="font-bold num">₹{m.close.toLocaleString("en-IN")}</span> <span className={clsx("font-bold num", m.change >= 0 ? "text-up" : "text-down")}>{fmtPct(m.change)}</span>
          <span className="block text-[12.5px] text-dim">{parts.join(", ")}</span>
        </p>
        <Sparkline values={m.spark} />
      </div>
      <div className="mt-2.5 flex items-center gap-3.5 border-t border-rule pt-2.5 text-[12px]">
        <Link href={`/research/${m.ticker}`} className="font-semibold text-brand">
          Research
        </Link>
        <ShareButton
          className="ml-auto"
          payload={{
            title: `${m.ticker} · Unusual move`,
            text: `*${m.ticker}* · Unusual move on ${m.d}\nClosed ₹${m.close.toLocaleString("en-IN")}, ${m.change >= 0 ? "+" : "−"}${Math.abs(m.change).toFixed(1)}% on ${m.volX.toFixed(1)}× its 20-day volume`,
            path: `/portfolio?h=${m.ticker}`,
            bot: { kind: "move", ticker: m.ticker, d: m.d },
          }}
        />
        <button onClick={onDone} className="rounded-full bg-raise px-3.5 py-1.5 font-bold">
          Done
        </button>
      </div>
    </li>
  );
}

function EngineNote({ d }: { d: Digest }) {
  const e = d.engine;
  const [open, setOpen] = useState(false);
  return (
    <section className="mx-4 mt-10 mb-6 text-[11.5px] leading-snug text-dim">
      <button onClick={() => setOpen((o) => !o)} className="text-left" aria-expanded={open}>
        How this was sorted: {e.byRules} of {e.filings} filings by exchange-metadata rules, {e.llmCalls} model calls, {e.cacheHits} cache hits, about $
        {e.estCostUSD.toFixed(3)} at paid rates. {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-2 space-y-1 leading-snug">
          <p>Models: {Object.entries(e.models).map(([m, n]) => `${m} ×${n}`).join(", ") || "none this run (everything cached)"}</p>
          <p>
            Tokens in/out: {e.tokensIn.toLocaleString()} / {e.tokensOut.toLocaleString()}. Generated {new Date(e.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.
          </p>
          {e.errors.length > 0 && <p>Source hiccups this run: {e.errors.length} (shown from the previous run where possible).</p>}
        </div>
      )}
    </section>
  );
}

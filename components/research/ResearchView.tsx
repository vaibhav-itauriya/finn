"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ResearchReport } from "@/lib/pull/research";
import type { CallExtract, TranscriptRef } from "@/lib/pull/calls";
import type { Ledger, Outcome, Thesis } from "@/lib/pull/ledger";
import type { NumbersView, Signal } from "@/lib/pull/numbers";
import { Bars } from "../Sparkline";
import { Cite } from "./Cite";
import { AppHeader } from "../AppHeader";
import { fmtCr, fmtPct } from "@/lib/client/format";

type Status = "idle" | "loading" | "done" | "error";

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j.data as T;
}

export function ResearchView({ ticker, initial }: { ticker: string; initial: ResearchReport | null }) {
  const [numbers, setNumbers] = useState<NumbersView | null>(initial?.numbers ?? null);
  const [transcripts, setTranscripts] = useState<TranscriptRef[]>(initial?.transcripts ?? []);
  const [calls, setCalls] = useState<(CallExtract | null)[]>(initial?.calls ?? []);
  const [callStatus, setCallStatus] = useState<Status[]>(initial ? initial.calls.map(() => "done") : []);
  const [ledger, setLedger] = useState<Ledger | null>(initial?.ledger ?? null);
  const [thesis, setThesis] = useState<Thesis | null>(initial?.thesis ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [judging, setJudging] = useState<Status>(initial?.ledger && initial?.thesis ? "done" : "idle");
  const started = useRef(false);
  const callErrors = useRef<Record<number, string>>({});
  const [tab, setTab] = useState<"overview" | "promises" | "financials" | "calls">("overview");

  const judge = async (ok: CallExtract[]) => {
    setJudging("loading");
    const [l, t] = await Promise.allSettled([
      api<Ledger>(`/api/research/${ticker}?step=ledger`, { calls: ok }),
      api<Thesis>(`/api/research/${ticker}?step=thesis`, { calls: ok }),
    ]);
    if (l.status === "fulfilled") setLedger(l.value);
    if (t.status === "fulfilled") setThesis(t.value);
    setJudging(l.status === "fulfilled" || t.status === "fulfilled" ? "done" : "error");
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial) {
      // Precomputed snapshot; only fill in a judgement step if the nightly run missed it.
      if ((!initial.ledger || !initial.thesis) && initial.calls.length) judge(initial.calls);
      return;
    }
    (async () => {
      try {
        const n = await api<{ numbers: NumbersView; transcripts: TranscriptRef[] }>(`/api/research/${ticker}?step=numbers`);
        setNumbers(n.numbers);
        setTranscripts(n.transcripts);
        setCallStatus(n.transcripts.map(() => "loading"));
        const results = await Promise.all(
          n.transcripts.map((_, i) =>
            api<CallExtract>(`/api/research/${ticker}?step=call&i=${i}`)
              .then((c) => {
                setCalls((prev) => {
                  const next = [...prev];
                  next[i] = c;
                  return next;
                });
                setCallStatus((s) => s.map((x, j) => (j === i ? "done" : x)));
                return c;
              })
              .catch((e: Error) => {
                callErrors.current[i] = (e.message.split(": ").slice(1).join(": ") || e.message).slice(0, 80);
                setCallStatus((s) => s.map((x, j) => (j === i ? "error" : x)));
                return null;
              }),
          ),
        );
        const ok = results.filter((c): c is CallExtract => Boolean(c));
        if (!ok.length) {
          setJudging("error");
          return;
        }
        await judge(ok);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [ticker, initial]);

  const doneCalls = calls.filter((c): c is CallExtract => Boolean(c));
  const verified = doneCalls.reduce((a, c) => a + c.guidance.filter((g) => g.verified).length, 0);
  const totalQuotes = doneCalls.reduce((a, c) => a + c.guidance.length, 0);

  if (err)
    return (
      <main className="px-4 pt-10">
        <Back />
        <h1 className="mt-4 text-[28px] font-semibold tracking-tight">{ticker}</h1>
        <p className="mt-2 text-[15px]">{err}</p>
        <p className="mt-1 text-[13px] text-dim">Try the exact NSE symbol, for example ASIANPAINT or KAYNES.</p>
      </main>
    );

  const TABS = [
    { k: "overview", label: "Overview" },
    { k: "promises", label: "Promises" },
    { k: "financials", label: "Financials" },
    { k: "calls", label: "Calls & Ask" },
  ] as const;

  return (
    <main className="pb-6">
      <AppHeader />
      <header className="px-4 pt-1">
        <Back />
        {numbers ? (
          <div className="card mt-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">{numbers.header.name}</h1>
                <p className="mt-0.5 text-[12px] text-dim">
                  {ticker}
                  {numbers.header.sector ? ` · ${numbers.header.sector}` : ""}
                </p>
              </div>
              {numbers.header.price && <p className="shrink-0 text-[18px] font-extrabold num">₹{numbers.header.price.replace(/^₹\s*/, "")}</p>}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              {[
                ["M.cap", numbers.header.mcap?.replace(/^₹\s*/, "₹").replace(" Cr.", " Cr")],
                ["P/E", numbers.header.pe],
                [numbers.header.isLender ? "ROE" : "ROCE", numbers.header.isLender ? numbers.header.roe : numbers.header.roce],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-raise px-2 py-1.5">
                  <p className="text-dim">{l}</p>
                  <p className="mt-0.5 text-[12.5px] font-bold num">{v || "–"}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card mt-2 p-4">
            <h1 className="text-[20px] font-extrabold tracking-tight">{ticker}</h1>
            <p className="mt-1 text-[13px] text-dim">Fetching financials…</p>
          </div>
        )}
      </header>

      <div className="sticky top-0 z-20 mt-3 bg-paper/95 py-2 backdrop-blur">
        <div className="scroll-x flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Research sections">
          {TABS.map((t) => (
            <button
              key={t.k}
              role="tab"
              aria-selected={tab === t.k}
              onClick={() => setTab(t.k)}
              className={clsx("shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold", tab === t.k ? "bg-brand text-brand-ink" : "bg-sheet text-dim shadow-[inset_0_0_0_1px_rgb(var(--rule))]")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <>
          {ledger && <Verdict ledger={ledger} />}
          {thesis && <BullBear thesis={thesis} />}
          {thesis?.business && <Business thesis={thesis} />}
          {!ledger && !thesis && <Loading calls={calls} callStatus={callStatus} transcripts={transcripts} judging={judging} what="verdict" errors={callErrors.current} onRetry={doneCalls.length ? () => judge(doneCalls) : undefined} />}
        </>
      )}
      {tab === "promises" && (
        <>
          {ledger ? <Promises ledger={ledger} /> : <Loading calls={calls} callStatus={callStatus} transcripts={transcripts} judging={judging} what="promise ledger" errors={callErrors.current} onRetry={doneCalls.length ? () => judge(doneCalls) : undefined} />}
          {ledger && ledger.divergences.length > 0 && <Divergences ledger={ledger} />}
          {ledger && ledger.currentGuidance.length > 0 && <Guidance ledger={ledger} />}
        </>
      )}
      {tab === "financials" && (numbers ? <Numbers n={numbers} /> : <Skeleton rows={4} label="Fetching ten years of financials" />)}
      {tab === "calls" && (
        <>
          {doneCalls.length === 0 && <Skeleton rows={3} label="Reading the transcripts" />}
          {doneCalls.length > 0 && <Ask ticker={ticker} />}
          {doneCalls.length > 0 && <Tone calls={doneCalls} />}
        </>
      )}

      <Sources ticker={ticker} transcripts={transcripts} calls={doneCalls} numbers={numbers} verified={verified} total={totalQuotes} generatedAt={initial?.generatedAt} />
    </main>
  );
}

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Skeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <section className="card mx-4 mt-3 p-4" aria-busy="true" aria-live="polite">
      <p className="flex items-center gap-2 text-[13px] font-bold text-brand">
        <Spinner size={16} /> {label}…
      </p>
      <div className="mt-3 space-y-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-3.5 animate-pulse rounded-full bg-raise" style={{ width: `${92 - i * 14}%` }} />
        ))}
      </div>
    </section>
  );
}

/** Step-by-step progress while FINN reads the calls and judges them: the work is shown, not hidden. */
function Loading({
  calls,
  callStatus,
  transcripts,
  judging,
  what,
  onRetry,
  errors,
}: {
  calls: (CallExtract | null)[];
  callStatus: Status[];
  transcripts: TranscriptRef[];
  judging: Status;
  what: string;
  onRetry?: () => void;
  errors?: Record<number, string>;
}) {
  const done = callStatus.filter((s) => s === "done").length;
  const failed = callStatus.filter((s) => s === "error").length;
  const total = transcripts.length;
  const settled = total > 0 && done + failed === total;
  if (settled && done === 0)
    return (
      <section className="card mx-4 mt-3 p-4 text-[13px]">
        <p className="font-bold text-down">None of the {total} transcripts could be opened.</p>
        <p className="mt-1 text-dim">The company hosts them somewhere that blocks our server. The Financials tab is complete.</p>
      </section>
    );
  if (judging === "done")
    return (
      <section className="card mx-4 mt-3 p-4 text-[13px]">
        <p className="font-bold">Not enough material for a {what}.</p>
        <p className="mt-1 text-dim">
          Read {done} of {total} calls{failed ? ` (${failed} couldn't be opened)` : ""}. The calls that were read are in Calls &amp; Ask.
        </p>
        {onRetry && (
          <button onClick={onRetry} className="mt-3 rounded-xl bg-brand px-4 py-2 text-[13px] font-bold text-brand-ink">
            Try again
          </button>
        )}
      </section>
    );
  const pct = total ? Math.round(((done + failed) / (total + 1)) * 100) : 5;
  if (judging === "error")
    return (
      <section className="card mx-4 mt-3 p-4 text-[13px]">
        <p className="font-bold text-down">Couldn&apos;t build the {what} this time.</p>
        <p className="mt-1 text-dim">Usually the free model quota is busy. The Financials tab is complete.</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-3 rounded-xl bg-brand px-4 py-2 text-[13px] font-bold text-brand-ink">
            Try again
          </button>
        )}
      </section>
    );
  return (
    <section className="card mx-4 mt-3 p-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-[14px] font-bold text-brand">
        <Spinner />
        {total === 0 ? "Finding the latest earnings calls…" : judging === "loading" ? `Checking promises against reported numbers…` : `Reading earnings calls (${done} of ${total})…`}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raise">
        <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {total > 0 && (
        <ul className="mt-3 space-y-1.5 text-[12.5px]">
          {transcripts.map((t, i) => (
            <li key={t.url} className="flex items-center justify-between">
              <span>{calls[i]?.quarter ?? t.label} call</span>
              <span className={clsx("flex items-center gap-1 font-semibold", callStatus[i] === "done" ? "text-up" : callStatus[i] === "error" ? "text-down" : "text-dim")}>
                {callStatus[i] === "done" ? (
                  `✓ ${calls[i]?.guidance.length ?? 0} promises`
                ) : callStatus[i] === "error" ? (
                  <span title={errors?.[i]}>{errors?.[i] ? errors[i] : "couldn't read"}</span>
                ) : (
                  <>
                    <Spinner size={12} /> reading
                  </>
                )}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between">
            <span>Promise vs delivery check</span>
            <span className="flex items-center gap-1 font-semibold text-dim">
              {judging === "loading" ? (
                <>
                  <Spinner size={12} /> judging
                </>
              ) : (
                "waiting"
              )}
            </span>
          </li>
        </ul>
      )}
      <p className="mt-3 text-[11.5px] text-dim">First read of a company takes about a minute. After that it&apos;s cached and opens instantly.</p>
    </section>
  );
}

function Back() {
  return (
    <Link href="/research" className="text-[12.5px] font-semibold text-brand">
      ‹ Research
    </Link>
  );
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="px-4 text-[13px] font-semibold text-dim">
      {children}
    </h2>
  );
}

const OUTCOME: Record<Outcome, { label: string; cls: string }> = {
  delivered: { label: "Delivered", cls: "text-up" },
  missed: { label: "Missed", cls: "text-down" },
  partly: { label: "Partly", cls: "text-marigold" },
  pending: { label: "Pending", cls: "text-dim" },
  dropped: { label: "Dropped", cls: "text-down" },
};

function Verdict({ ledger }: { ledger: Ledger }) {
  // Counts come from the rows themselves, not the model's summary, so the headline always matches the ledger.
  const c = { ...ledger.credibility, delivered: 0, missed: 0, partly: 0, pending: 0, dropped: 0 };
  for (const r of ledger.rows) if (r.outcome in c) c[r.outcome] += 1;
  const judged = c.delivered + c.missed + c.partly + c.dropped;
  return (
    <section className="card mx-4 mt-3 p-4">
      <p className="text-[26px] leading-[1.1] font-extrabold tracking-tight">
        Kept {c.delivered} of {judged} {judged === 1 ? "promise" : "promises"}
        {c.partly ? `, ${c.partly} partly` : ""}.
      </p>
      <p className="mt-2 text-[15px] leading-snug">{c.line}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
        {(["delivered", "partly", "missed", "dropped", "pending"] as Outcome[]).map((o) =>
          c[o] ? (
            <span key={o} className="flex items-center gap-1.5">
              <span className={clsx("stamp", OUTCOME[o].cls)}>{OUTCOME[o].label}</span>
              <span className="num text-dim">×{c[o]}</span>
            </span>
          ) : null,
        )}
        <span className="ml-auto text-dim num">Credibility {c.score}/10</span>
      </div>
    </section>
  );
}

function BullBear({ thesis }: { thesis: Thesis }) {
  return (
    <section className="card mx-4 mt-3 grid gap-5 p-4">
      {(["bull", "bear"] as const).map((side) => (
        <div key={side}>
          <h2 className={clsx("text-[13px] font-semibold", side === "bull" ? "text-up" : "text-down")}>{side === "bull" ? "Bull case" : "Bear case"}</h2>
          <ul className="mt-2 space-y-2">
            {thesis[side].map((p, i) => (
              <li key={i} className="text-[14px] leading-snug">
                {p.point} <Cite c={p.cite} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {thesis.watch.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-dim">Check next quarter</h2>
          <ul className="mt-2 space-y-1 text-[14px] leading-snug list-disc pl-5 marker:text-marigold">
            {thesis.watch.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const RANK: Record<Outcome, number> = { missed: 0, dropped: 1, partly: 2, delivered: 3, pending: 4 };

function Promises({ ledger }: { ledger: Ledger }) {
  const [open, setOpen] = useState<number | null>(null);
  // Broken promises first: that is what changes a view on management.
  const rows = [...ledger.rows].sort((a, b) => (RANK[a.outcome] ?? 9) - (RANK[b.outcome] ?? 9));
  return (
    <section className="mt-4">
      <H2>Promise ledger</H2>
      <p className="px-4 mt-1 text-[12px] text-dim">What management said on earlier calls, and what happened. Tap a row for the receipts.</p>
      <ul className="card mx-4 mt-3 divide-y divide-rule overflow-hidden">
        {rows.map((r, i) => (
          <li key={i}>
            <button className="w-full px-4 py-3 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <div className="flex items-start gap-3">
                <span className={clsx("stamp mt-0.5 shrink-0", OUTCOME[r.outcome]?.cls)}>{OUTCOME[r.outcome]?.label ?? r.outcome}</span>
                <div className="min-w-0">
                  <p className="text-[14px] leading-snug">{r.promise}</p>
                  <p className="mt-0.5 text-[12px] text-dim">
                    Said in {r.made} · for {r.horizon}
                  </p>
                </div>
              </div>
            </button>
            {open === i && (
              <div className="px-4 pb-4 pl-[88px] text-[13px] space-y-2">
                <div>
                  <p className="text-[11px] text-dim">They said</p>
                  <Cite c={r.promiseCite} quote />
                </div>
                <div>
                  <p className="text-[11px] text-dim">What happened</p>
                  <p className="leading-snug">
                    {r.evidence} <Cite c={r.evidenceCite} />
                  </p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Divergences({ ledger }: { ledger: Ledger }) {
  return (
    <section className="card mx-4 mt-4 py-4">
      <H2>Story vs numbers</H2>
      <ul className="mt-3 space-y-4 px-4">
        {ledger.divergences.map((d, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto_1fr] gap-2 text-[13px] leading-snug items-start">
            <p>
              <span className="block text-[11px] text-dim">They say</span>“{d.claim}” <Cite c={d.cite} />
            </p>
            <span className={clsx("mt-4 text-[15px]", d.tone === "good" ? "text-up" : d.tone === "bad" ? "text-down" : "text-marigold")} aria-hidden>
              ≠
            </span>
            <p>
              <span className="block text-[11px] text-dim">Numbers say</span>
              {d.reality}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Guidance({ ledger }: { ledger: Ledger }) {
  return (
    <section className="card mx-4 mt-4 py-4">
      <H2>Guidance on the table now</H2>
      <ul className="mt-2 px-4 space-y-2">
        {ledger.currentGuidance.map((g, i) => (
          <li key={i} className="text-[14px] leading-snug">
            <span className="text-dim">{g.metric}, {g.horizon}:</span> {g.statement} <Cite c={g.cite} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SignalList({ s }: { s: Signal[] }) {
  if (!s.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {s.map((x, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-snug">
          <span
            className={clsx("mt-[6px] h-2 w-2 shrink-0 rounded-full", x.tone === "good" ? "bg-up" : x.tone === "bad" ? "bg-down" : x.tone === "watch" ? "bg-marigold" : "bg-dim/50")}
            aria-label={x.tone}
          />
          {x.text}
        </li>
      ))}
    </ul>
  );
}

function Numbers({ n }: { n: NumbersView }) {
  const q = n.quarters;
  const short = (c: string) => c.replace(/^(\w{3}) 20(\d\d)$/, "$1 '$2");
  return (
    <section className="mt-4">
      <H2>Numbers</H2>
      <p className="px-4 mt-1 text-[12px] text-dim">From exchange filings via Screener, {n.header.basis}. Computed in code, no model involved.</p>
      <dl className="card mx-4 mt-3 grid grid-cols-2 gap-px overflow-hidden bg-rule">
        {n.snapshot.map((s) => (
          <div key={s.label} className="bg-sheet p-3">
            <dt className="text-[11px] text-dim">{s.label}</dt>
            <dd className={clsx("mt-0.5 text-[18px] font-semibold num tracking-tight", s.tone === "bad" && "text-down")}>{s.value}</dd>
            {s.sub && <dd className="text-[11px] text-dim num">{s.sub}</dd>}
          </div>
        ))}
      </dl>

      <div className="card mx-4 mt-3 p-4">
        <h3 className="text-[14px] font-medium">Last 8 quarters</h3>
        <div className="mt-2">
          <Bars values={q.revenue} labels={q.cols} height={56} />
          <div className="mt-1 grid text-[10px] text-dim num" style={{ gridTemplateColumns: `repeat(${q.cols.length}, minmax(0, 1fr))` }}>
            {q.cols.map((c) => (
              <span key={c} className="text-center">
                {short(c)}
              </span>
            ))}
          </div>
        </div>
        <table className="mt-3 w-full text-[12px] num">
          <tbody>
            {[
              ["Revenue YoY", q.revYoY.map((x) => fmtPct(x, 0))],
              [n.header.isLender ? "Fin. margin" : "Margin", q.margin.map((x) => (x == null ? "–" : `${x.toFixed(0)}%`))],
              ["PAT YoY", q.patYoY.map((x) => fmtPct(x, 0))],
            ].map(([label, vals]) => (
              <tr key={label as string} className="border-t border-rule">
                <th className="py-1 pr-1 text-left font-normal text-dim whitespace-nowrap">{label as string}</th>
                {(vals as string[]).map((v, i) => (
                  <td key={i} className={clsx("py-1 text-right", v.startsWith("−") && "text-down")}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mx-4 mt-3 p-4">
        <h3 className="text-[14px] font-medium">Trajectory</h3>
        <p className="text-[12px] text-dim">Revenue by year, ₹ cr: {fmtCr(n.trajectory.revenue[0])} in {n.trajectory.cols[0]} to {fmtCr(n.trajectory.revenue.at(-1) ?? null)} in {n.trajectory.cols.at(-1)}</p>
        <div className="mt-2">
          <Bars values={n.trajectory.revenue} labels={n.trajectory.cols} height={48} />
        </div>
        <SignalList s={n.trajectory.signals} />
      </div>

      {!n.header.isLender && (
        <div className="card mx-4 mt-3 p-4">
          <h3 className="text-[14px] font-medium">Balance sheet</h3>
          <table className="mt-2 w-full text-[12px] num">
            <thead>
              <tr className="text-dim">
                <th className="text-left font-normal">₹ cr</th>
                {n.balance.cols.slice(-4).map((c) => (
                  <th key={c} className="text-right font-normal">
                    {short(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Borrowings", n.balance.borrowings.slice(-4).map(fmtCr)],
                ["Equity", n.balance.equity.slice(-4).map(fmtCr)],
                ["Debt/equity", n.balance.de.slice(-4).map((x) => (x == null ? "–" : x.toFixed(2)))],
                ["WC days", n.balance.wcDays.slice(-4).map((x) => (x == null ? "–" : x.toFixed(0)))],
              ].map(([l, v]) => (
                <tr key={l as string} className="border-t border-rule">
                  <th className="py-1 text-left font-normal text-dim">{l as string}</th>
                  {(v as string[]).map((x, i) => (
                    <td key={i} className="py-1 text-right">
                      {x}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <SignalList s={n.balance.signals} />
        </div>
      )}

      {!n.header.isLender && (
        <div className="card mx-4 mt-3 p-4">
          <h3 className="text-[14px] font-medium">Cash quality</h3>
          <table className="mt-2 w-full text-[12px] num">
            <thead>
              <tr className="text-dim">
                <th className="text-left font-normal">₹ cr</th>
                {n.cash.cols.slice(-4).map((c) => (
                  <th key={c} className="text-right font-normal">
                    {short(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Profit (PAT)", n.cash.pat.slice(-4).map(fmtCr)],
                ["Operating cash", n.cash.cfo.slice(-4).map(fmtCr)],
                ["Free cash", n.cash.fcf.slice(-4).map(fmtCr)],
                ["Cash ÷ profit", n.cash.conversion.slice(-4).map((x) => (x == null ? "–" : `${x.toFixed(0)}%`))],
              ].map(([l, v]) => (
                <tr key={l as string} className="border-t border-rule">
                  <th className="py-1 text-left font-normal text-dim">{l as string}</th>
                  {(v as string[]).map((x, i) => (
                    <td key={i} className={clsx("py-1 text-right", x.startsWith("−") && "text-down")}>
                      {x}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <SignalList s={n.cash.signals} />
        </div>
      )}
    </section>
  );
}

function Business({ thesis }: { thesis: Thesis }) {
  const b = thesis.business!;
  return (
    <section className="card mx-4 mt-3 p-4">
      <h2 className="text-[13px] font-semibold text-dim">What the business is, in management&apos;s words</h2>
      <p className="mt-2 text-[14px] leading-snug">
        {b.summary} <Cite c={b.cite} />
      </p>
      {b.segments.length > 0 && (
        <ul className="mt-3 divide-y divide-rule text-[13px]">
          {b.segments.map((s) => (
            <li key={s.name} className="py-2 flex gap-3">
              <span className="font-medium w-[38%] shrink-0">{s.name}</span>
              <span className="text-dim leading-snug">
                {s.share ? `${s.share}. ` : ""}
                {s.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tone({ calls }: { calls: CallExtract[] }) {
  return (
    <section className="card mx-4 mt-3 p-4">
      <h2 className="text-[13px] font-semibold text-dim">Tone and pushback, call by call</h2>
      <ol className="mt-2 space-y-3">
        {calls.map((c) => (
          <li key={c.url} className="text-[13px] leading-snug">
            <p>
              <span className="font-medium">{c.quarter}</span> <span className="text-dim">{c.tone}</span>
            </p>
            {c.pushback.length > 0 && (
              <p className="mt-0.5 text-dim">
                Analysts pressed on:{" "}
                {c.pushback.map((p, i) => (
                  <span key={i}>
                    {p.topic} <Cite c={{ quarter: c.quarter, page: p.page, url: c.url, quote: p.gist }} />
                    {i < c.pushback.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Ask({ ticker }: { ticker: string }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<Status>("idle");
  const [ans, setAns] = useState<{ answer: string; cites: { id: string; quarter: string; page: number; url: string }[] } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setState("loading");
    try {
      setAns(await api(`/api/research/${ticker}?step=ask&q=${encodeURIComponent(q.trim())}`));
      setState("done");
    } catch {
      setState("error");
    }
  };
  const render = (text: string) =>
    text.split(/(\[S\d+\])/g).map((part, i) => {
      const m = part.match(/\[(S\d+)\]/);
      const c = m && ans?.cites.find((x) => x.id === m[1]);
      return c ? <Cite key={i} c={{ quarter: c.quarter, page: c.page, url: c.url }} /> : <span key={i}>{part}</span>;
    });
  return (
    <section className="card mx-4 mt-3 p-4">
      <h2 className="text-[13px] font-semibold text-dim">Ask the transcripts</h2>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <label htmlFor="ask" className="sr-only">
          Question
        </label>
        <input
          id="ask"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. What did they say about working capital?"
          className="min-w-0 flex-1 rounded-lg border border-rule bg-sheet px-3 py-2.5 text-[15px] outline-none focus:border-ink"
        />
        <button className="rounded-lg bg-ink px-4 text-[14px] font-medium text-paper" disabled={state === "loading"}>
          {state === "loading" ? "…" : "Ask"}
        </button>
      </form>
      {state === "error" && <p className="mt-2 text-[13px] text-down">Couldn&apos;t answer that right now. Try again in a minute.</p>}
      {ans && state === "done" && <p className="mt-3 text-[14px] leading-snug">{render(ans.answer)}</p>}
    </section>
  );
}

function Sources({
  ticker,
  transcripts,
  calls,
  numbers,
  verified,
  total,
  generatedAt,
}: {
  ticker: string;
  transcripts: TranscriptRef[];
  calls: CallExtract[];
  numbers: NumbersView | null;
  verified: number;
  total: number;
  generatedAt?: string;
}) {
  return (
    <section className="mx-4 mt-6 text-[11.5px] leading-snug text-dim">
      <p>
        Sources: {ticker}&apos;s own earnings-call transcripts ({calls.map((c) => `${c.quarter}, ${c.pages} pages`).join("; ") || transcripts.map((t) => t.label).join(", ")}) and
        reported financials{" "}
        {numbers && (
          <a href={numbers.header.screenerUrl} className="text-brand" target="_blank" rel="noreferrer">
            via Screener
          </a>
        )}
        . No news, broker notes or model background knowledge.
      </p>
      {total > 0 && (
        <p className="mt-1">
          {verified} of {total} management quotes were found word for word in the PDFs; the rest are marked as paraphrases.
        </p>
      )}
      {generatedAt && <p className="mt-1">Prepared {new Date(generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>}
    </section>
  );
}

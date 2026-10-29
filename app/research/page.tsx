import { PORTFOLIO, RESEARCH_DEMO } from "@/config/portfolio";
import { SearchBox } from "@/components/research/SearchBox";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function ResearchHome() {
  return (
    <main>
      <AppHeader />
      <div className="px-4">
      <h1 className="mt-2 text-[26px] leading-tight font-extrabold tracking-tight">Did they do what they said?</h1>
      <p className="mt-2 text-[14px] text-dim leading-snug">
        Pick any NSE company. FINN reads its last four earnings calls and its latest annual report, then checks every promise against the numbers it later
        reported. Only the company&apos;s own documents are used.
      </p>
      <div className="mt-5">
        <SearchBox />
      </div>
      <section className="mt-7">
        <h2 className="text-[13px] font-bold text-dim">Ready to open</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {RESEARCH_DEMO.map((t) => (
            <Link key={t} href={`/research/${t}`} className="rounded-full bg-brand px-3.5 py-1.5 text-[13.5px] font-bold text-brand-ink">
              {t}
            </Link>
          ))}
        </div>
      </section>
      <section className="mt-6">
        <h2 className="text-[13px] font-bold text-dim">Your holdings</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {PORTFOLIO.map((h) => (
            <Link key={h.ticker} href={`/research/${h.ticker}`} className="rounded-full bg-sheet px-3 py-1.5 text-[13px] font-semibold shadow-[inset_0_0_0_1px_rgb(var(--rule))]">
              {h.ticker}
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-dim">Holdings and new tickers are read live, which takes about a minute the first time and is instant after that.</p>
      </section>
      </div>
    </main>
  );
}

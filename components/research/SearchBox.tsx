"use client";
import { Spinner } from "../Spinner";
import { startNav } from "../NavProgress";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Hit {
  name: string;
  ticker: string;
}

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const j = await r.json();
        setHits(j.data || []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 220);
  }, [q]);

  const [searching, setSearching] = useState(false);
  const [going, setGoing] = useState<string | null>(null);
  const go = (t: string) => {
    setGoing(t.trim().toUpperCase());
    startNav();
    router.push(`/research/${encodeURIComponent(t.trim().toUpperCase())}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (hits[0]) go(hits[0].ticker);
        else if (q.trim()) go(q);
      }}
      className="relative"
    >
      <label htmlFor="ticker" className="sr-only">
        Company or NSE symbol
      </label>
      <input
        id="ticker"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Company or NSE symbol, e.g. Kaynes"
        autoComplete="off"
        autoCapitalize="characters"
        className="card w-full px-4 py-3.5 pr-11 text-[16px] outline-none focus:ring-2 focus:ring-brand"
      />
      {(searching || going) && (
        <span className="absolute right-4 top-[15px] text-brand" aria-label={going ? `Opening ${going}` : "Searching"}>
          <Spinner size={18} />
        </span>
      )}
      {going && <p className="mt-2 text-[12.5px] font-semibold text-brand">Opening {going}…</p>}
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-rule bg-sheet shadow-lg">
          {hits.map((h) => (
            <li key={h.ticker + h.name}>
              <button type="button" onClick={() => go(h.ticker)} className="flex w-full items-baseline justify-between px-4 py-3 text-left hover:bg-ink/5">
                <span className="text-[15px]">{h.name}</span>
                <span className="shrink-0 pl-3 text-[12px] text-dim">{/^\d+$/.test(h.ticker) ? `BSE ${h.ticker}` : h.ticker}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

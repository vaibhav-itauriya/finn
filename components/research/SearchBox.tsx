"use client";
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
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const j = await r.json();
        setHits(j.data || []);
      } catch {
        setHits([]);
      }
    }, 220);
  }, [q]);

  const go = (t: string) => router.push(`/research/${encodeURIComponent(t.trim().toUpperCase())}`);

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
        className="card w-full px-4 py-3.5 text-[16px] outline-none focus:ring-2 focus:ring-brand"
      />
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

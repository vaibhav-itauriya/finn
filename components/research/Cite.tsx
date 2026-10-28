import type { Cite as C } from "@/lib/pull/ledger";

/** Every claim in Research carries one of these: the call and page, or the reported-numbers table. */
export function Cite({ c, quote }: { c?: C | null; quote?: boolean }) {
  if (!c) return null;
  if (c.table && !c.quarter)
    return <span className="whitespace-nowrap rounded-[4px] bg-ink/[.06] px-1.5 py-[1px] text-[11px] text-dim">reported numbers</span>;
  const label = `${c.quarter ?? "call"}${c.page ? ` p.${c.page}` : ""}`;
  return (
    <>
      {c.url ? (
        <a
          href={`${c.url}${c.page ? `#page=${c.page}` : ""}`}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap rounded-[4px] bg-brand-soft px-1.5 py-[1px] text-[11px] font-medium text-brand"
          title={c.quote || undefined}
        >
          {label}
        </a>
      ) : (
        <span className="whitespace-nowrap rounded-[4px] bg-ink/[.06] px-1.5 py-[1px] text-[11px] text-dim">{label}</span>
      )}
      {quote && c.quote && <q className="mt-1 block text-[12px] text-dim italic leading-snug">{c.quote}</q>}
    </>
  );
}

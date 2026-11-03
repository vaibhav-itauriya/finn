// Shown instantly while a screen loads, in the shape of what's coming.
const bar = "animate-pulse rounded-full bg-raise";

export function PageSkeleton({ variant = "page" }: { variant?: "page" | "research" }) {
  return (
    <main aria-busy="true" aria-label="Loading">
      <header className="flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))] pb-2">
        <div className="flex items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="9" fill="#00707A" />
            <path d="M10 23V9h11M10 16h8" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="23" cy="22" r="2.6" fill="#009662" />
          </svg>
          <span className="text-[17px] font-extrabold tracking-tight">FINN</span>
        </div>
        <div className="flex gap-2">
          <span className={`h-9 w-[74px] ${bar}`} />
          <span className={`h-9 w-9 ${bar}`} />
          <span className={`h-9 w-9 ${bar}`} />
        </div>
      </header>
      {variant === "research" ? (
        <>
          <section className="card mx-4 mt-2 p-4">
            <div className={`h-6 w-2/3 ${bar}`} />
            <div className={`mt-2 h-3 w-1/3 ${bar}`} />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-raise" />
              ))}
            </div>
          </section>
          <div className="mt-3 flex gap-2 px-4">
            {[84, 92, 96, 100].map((w, i) => (
              <span key={i} className={`h-8 ${bar}`} style={{ width: w }} />
            ))}
          </div>
          <Block lines={4} />
          <Block lines={3} />
        </>
      ) : (
        <>
          <Block lines={3} tall />
          <Block lines={2} />
          <Block lines={3} />
        </>
      )}
      <p className="mt-4 text-center text-[12px] font-semibold text-dim">Loading…</p>
    </main>
  );
}

function Block({ lines, tall }: { lines: number; tall?: boolean }) {
  return (
    <section className="card mx-4 mt-3 p-4">
      {tall && <div className={`mb-3 h-8 w-1/2 ${bar}`} />}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`mt-2.5 h-3.5 ${bar}`} style={{ width: `${92 - i * 15}%` }} />
      ))}
    </section>
  );
}

export function NoData() {
  return (
    <main className="px-4 pt-10">
      <h1 className="text-[28px] font-extrabold tracking-tight">No data yet</h1>
      <p className="mt-2 text-dim">Run the push pipeline (GitHub Actions, FINN push pipeline, Run workflow) to fetch filings and prices.</p>
    </main>
  );
}

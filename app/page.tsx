import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest } from "@/lib/types";
import { Today } from "@/components/today/Today";

// The digest is produced by the scheduled pipeline and committed to the repo; every data commit
// redeploys, so reading it at build time keeps the page static and instant on a phone.
export const dynamic = "force-static";

async function loadDigest(): Promise<Digest | null> {
  try {
    const d = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "digest.json"), "utf8")) as Digest;
    // Ship only what the client needs: 70 bars covers the 20-day average and the sparkline.
    d.prices = d.prices.map((p) => ({ ...p, bars: p.bars.slice(-70) }));
    return d;
  } catch {
    return null;
  }
}

export default async function Page() {
  const d = await loadDigest();
  if (!d)
    return (
      <main className="px-4 pt-10">
        <h1 className="text-[32px] font-semibold tracking-tight">No digest yet.</h1>
        <p className="mt-2 text-dim">Run the push pipeline (GitHub Actions → FINN push pipeline → Run workflow) to fetch filings and prices.</p>
      </main>
    );
  return <Today digest={d} />;
}

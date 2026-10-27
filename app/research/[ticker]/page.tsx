import { ResearchView } from "@/components/research/ResearchView";
import { snapshot } from "@/lib/pull/research";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase().replace(/[^A-Z0-9&\-]/g, "");
  // Demo companies are precomputed nightly; everything else is read live, step by step.
  const snap = await snapshot(ticker);
  return <ResearchView ticker={ticker} initial={snap && snap.calls.length ? snap : null} />;
}

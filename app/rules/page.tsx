import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest } from "@/lib/types";
import { RulesView } from "@/components/RulesView";

export const dynamic = "force-static";

export default async function Page() {
  let prices: Digest["prices"] = [];
  try {
    const d = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "digest.json"), "utf8")) as Digest;
    prices = d.prices.map((p) => ({ ...p, bars: p.bars.slice(-70) }));
  } catch {
    /* empty state handled in the view */
  }
  return <RulesView prices={prices} />;
}

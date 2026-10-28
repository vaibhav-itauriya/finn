import { PortfolioView } from "@/components/portfolio/PortfolioView";
import { loadDigest } from "@/lib/data";
import { NoData } from "@/components/NoData";

export const dynamic = "force-static";

export default async function Page() {
  const d = await loadDigest();
  return d ? <PortfolioView digest={d} /> : <NoData />;
}

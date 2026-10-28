import { AnomaliesView } from "@/components/anomalies/AnomaliesView";
import { loadDigest } from "@/lib/data";
import { NoData } from "@/components/NoData";

export const dynamic = "force-static";

export default async function Page() {
  const d = await loadDigest();
  return d ? <AnomaliesView digest={d} /> : <NoData />;
}

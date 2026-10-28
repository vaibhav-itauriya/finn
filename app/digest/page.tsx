import { Today } from "@/components/today/Today";
import { loadDigest } from "@/lib/data";
import { NoData } from "@/components/NoData";

export const dynamic = "force-static";

export default async function Page() {
  const d = await loadDigest();
  return d ? <Today digest={d} /> : <NoData />;
}

import { Home } from "@/components/home/Home";
import { loadDigest } from "@/lib/data";
import { NoData } from "@/components/NoData";

// The digest is produced by the scheduled pipeline and committed to the repo; every data commit
// redeploys, so reading it at build time keeps every screen static and instant on a phone.
export const dynamic = "force-static";

export default async function Page() {
  const d = await loadDigest();
  return d ? <Home digest={d} /> : <NoData />;
}

import { RulesView } from "@/components/RulesView";
import { loadDigest } from "@/lib/data";

export const dynamic = "force-static";

export default async function Page() {
  const d = await loadDigest();
  return <RulesView prices={d?.prices ?? []} />;
}

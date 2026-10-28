// Optional shared store (Upstash Redis REST, e.g. added from Vercel → Storage). Used for Telegram
// subscribers and to share the research cache across serverless instances. Everything works
// without it; with it, testers who connect Telegram also get the scheduled pushes.
const url = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const tok = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const kvEnabled = () => Boolean(url() && tok());

export async function kv<T = unknown>(...cmd: (string | number)[]): Promise<T | null> {
  if (!kvEnabled()) return null;
  const r = await fetch(url(), {
    method: "POST",
    headers: { Authorization: `Bearer ${tok()}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    cache: "no-store",
  });
  const j = (await r.json()) as { result?: T; error?: string };
  if (j.error) throw new Error(`kv: ${j.error}`);
  return (j.result ?? null) as T | null;
}

// Optional shared store (Upstash Redis REST, e.g. added from Vercel → Storage). Used for Telegram
// subscribers and to share the research cache across serverless instances. Everything works
// without it; with it, testers who connect Telegram also get the scheduled pushes.
//
// Vercel's Upstash integration names its variables after a prefix you can customise
// (KV_REST_API_URL, UPSTASH_REDIS_REST_URL, MYDB_KV_REST_API_URL...), so we look for any of them.
function find(suffixes: string[]): string {
  for (const s of suffixes) if (process.env[s]) return process.env[s]!;
  for (const [k, v] of Object.entries(process.env)) if (v && suffixes.some((s) => k.endsWith("_" + s) || k.endsWith(s))) return v;
  return "";
}
const url = () => find(["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"]);
const tok = () => find(["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"]);

export const kvEnabled = () => Boolean(url() && tok());

/** Names (never values) of store-related variables this deployment can see, for the health check. */
export const kvEnvNames = () => Object.keys(process.env).filter((k) => /KV_|REDIS|UPSTASH/i.test(k));

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

export async function kvPing(): Promise<string> {
  if (!kvEnabled()) return "not configured";
  try {
    return String(await kv("PING"));
  } catch (e) {
    return (e as Error).message;
  }
}

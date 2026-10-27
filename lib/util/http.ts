// Small fetch wrapper: browser-like headers, timeout, polite retries.
// Exchanges and Screener reject bare server requests, so every source goes through here.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface GetOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function httpGet(url: string, opts: GetOpts = {}): Promise<Response> {
  const { headers = {}, timeoutMs = 20000, retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers },
        signal: ctrl.signal,
        redirect: "follow",
        cache: "no-store",
      });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${res.status} on ${url}`);
        await sleep(800 * (attempt + 1) ** 2);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getText(url: string, opts?: GetOpts): Promise<string> {
  const res = await httpGet(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function getJSON<T = unknown>(url: string, opts?: GetOpts): Promise<T> {
  const res = await httpGet(url, { ...opts, headers: { Accept: "application/json", ...(opts?.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Non-JSON from ${url}: ${txt.slice(0, 120)}`);
  }
}

export async function getBytes(url: string, opts?: GetOpts): Promise<Uint8Array> {
  const res = await httpGet(url, { timeoutMs: 45000, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run async jobs with a concurrency cap (keeps us polite to sources and inside LLM rate limits). */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

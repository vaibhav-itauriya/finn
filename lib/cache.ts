// Content-addressed cache for expensive work (LLM extractions, parsed documents).
// Primary documents never change once filed, so an extraction keyed by
// (prompt version + document URL) is valid forever. This is the main cost lever.
//
// Layers: memory -> repo snapshot (data/cache, committed by the pipeline) -> /tmp -> Upstash (optional).
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const mem = new Map<string, unknown>();
const REPO_DIR = path.join(process.cwd(), "data", "cache");
const TMP_DIR = path.join("/tmp", "finn-cache");
const canWriteRepo = process.env.FINN_CACHE_WRITE === "1";

const upUrl = process.env.UPSTASH_REDIS_REST_URL;
const upTok = process.env.UPSTASH_REDIS_REST_TOKEN;

export function cacheKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("␟")).digest("hex").slice(0, 20);
}

async function readJSON(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

export async function cacheGet<T>(ns: string, key: string): Promise<T | undefined> {
  const k = `${ns}/${key}`;
  if (mem.has(k)) return mem.get(k) as T;
  for (const dir of [REPO_DIR, TMP_DIR]) {
    const v = await readJSON(path.join(dir, ns, `${key}.json`));
    if (v !== undefined) {
      mem.set(k, v);
      return v as T;
    }
  }
  if (upUrl && upTok) {
    try {
      const r = await fetch(`${upUrl}/get/${encodeURIComponent("finn:" + k)}`, {
        headers: { Authorization: `Bearer ${upTok}` },
        cache: "no-store",
      });
      const j = (await r.json()) as { result: string | null };
      if (j.result) {
        const v = JSON.parse(j.result);
        mem.set(k, v);
        return v as T;
      }
    } catch {
      /* cache miss on network error is fine */
    }
  }
  return undefined;
}

export async function cacheSet(ns: string, key: string, value: unknown): Promise<void> {
  const k = `${ns}/${key}`;
  mem.set(k, value);
  const dir = path.join(canWriteRepo ? REPO_DIR : TMP_DIR, ns);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(value));
  } catch {
    /* read-only FS: memory + Upstash only */
  }
  if (upUrl && upTok) {
    try {
      await fetch(`${upUrl}/set/${encodeURIComponent("finn:" + k)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${upTok}` },
        body: JSON.stringify(value),
      });
    } catch {
      /* best effort */
    }
  }
}

/** Memoise an async function through the cache. */
export async function cached<T>(ns: string, key: string, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const hit = await cacheGet<T>(ns, key);
  if (hit !== undefined) return { value: hit, hit: true };
  const value = await fn();
  await cacheSet(ns, key, value);
  return { value, hit: false };
}

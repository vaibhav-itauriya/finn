// Save (or remove) a phone's push subscription together with that person's alert thresholds,
// so scheduled pushes use the same definition of "unusual" as their screen.
import { NextResponse } from "next/server";
import { kv, kvEnabled } from "@/lib/kv";
import { subId, type PushSub } from "@/lib/webpush";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { sub?: PushSub; rules?: unknown; off?: boolean };
  const ep = b.sub?.endpoint || "";
  if (!/^https:\/\//.test(ep) || !b.sub?.keys?.p256dh) return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  if (!kvEnabled()) return NextResponse.json({ error: "no store configured" }, { status: 501 });
  const id = subId(ep);
  if (b.off) await kv("HDEL", "finn:wp", id);
  else await kv("HSET", "finn:wp", id, JSON.stringify({ sub: b.sub, rules: b.rules || null, at: new Date().toISOString() }));
  return NextResponse.json({ ok: true, id });
}

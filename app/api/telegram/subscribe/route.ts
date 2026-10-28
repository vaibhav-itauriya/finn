// Scheduled pushes for testers (needs the optional Redis store). The app sends the tester's
// thresholds so their pushes use the same definition of "unusual" as their screen.
import { NextResponse } from "next/server";
import { kv, kvEnabled } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { chatId?: string; name?: string; rules?: unknown; off?: boolean };
  const chat = String(b.chatId || "");
  if (!/^-?\d{5,15}$/.test(chat)) return NextResponse.json({ error: "bad chat" }, { status: 400 });
  if (!kvEnabled()) return NextResponse.json({ scheduled: false });
  if (b.off) await kv("HDEL", "finn:subs", chat);
  else await kv("HSET", "finn:subs", chat, JSON.stringify({ name: b.name || "", rules: b.rules || null, at: new Date().toISOString() }));
  return NextResponse.json({ scheduled: !b.off });
}

// Polled by the app after it opens t.me/<bot>?start=<code>. Returns the chat once the tester taps Start.
import { NextResponse } from "next/server";
import { findStart, send } from "@/lib/telegram/bot";
import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") || "";
  if (!/^f[a-z0-9]{8,24}$/.test(code)) return NextResponse.json({ error: "bad code" }, { status: 400 });
  try {
    const hit = await findStart(code);
    if (!hit) return NextResponse.json({ status: "pending" });
    const fresh = await kv<number>("SADD", "finn:claimed", code);
    if (fresh !== 0) {
      await send(
        hit.chatId,
        `<b>Connected to FINN, ${hit.name}.</b>\nYou'll get results cards, management changes and unusual moves for the demo portfolio here, using the thresholds you set in the app.\nTry "Send to Telegram" on any card.`,
      );
    }
    return NextResponse.json({ status: "connected", chatId: String(hit.chatId), name: hit.name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

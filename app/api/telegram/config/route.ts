import { NextResponse } from "next/server";
import { botEnabled, botUsername, ensureWebhook } from "@/lib/telegram/bot";
import { kvEnabled } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // The production deployment points the bot at itself so it can answer chats and voice notes.
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    let chat = false;
    if (prod && new URL(req.url).host === prod) chat = await ensureWebhook(`https://${prod}`).catch(() => false);
    return NextResponse.json({ enabled: botEnabled(), bot: await botUsername(), scheduled: kvEnabled(), chat });
  } catch (e) {
    return NextResponse.json({ enabled: false, bot: null, scheduled: false, error: (e as Error).message });
  }
}

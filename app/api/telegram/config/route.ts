import { NextResponse } from "next/server";
import { botEnabled, botUsername } from "@/lib/telegram/bot";
import { kvEnabled } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ enabled: botEnabled(), bot: await botUsername(), scheduled: kvEnabled() });
  } catch (e) {
    return NextResponse.json({ enabled: false, bot: null, scheduled: false, error: (e as Error).message });
  }
}

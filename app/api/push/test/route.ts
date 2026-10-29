import { NextResponse } from "next/server";
import { sendPush, type PushSub } from "@/lib/webpush";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { sub } = (await req.json().catch(() => ({}))) as { sub?: PushSub };
  if (!sub?.endpoint) return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  try {
    const ok = await sendPush(sub, {
      title: "FINN notifications are on",
      body: "You'll hear from FINN when a filing or a price move crosses your thresholds, plus a short wrap after market close.",
      url: "/alerts",
      tag: "finn-test",
    });
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { vapid } from "@/lib/webpush";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const k = await vapid();
    return NextResponse.json({ enabled: Boolean(k), publicKey: k?.publicKey ?? null });
  } catch (e) {
    return NextResponse.json({ enabled: false, error: (e as Error).message }, { status: 500 });
  }
}

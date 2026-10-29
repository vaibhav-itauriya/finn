// Everything that could interrupt someone over the last week. The browser applies its own
// thresholds, so the inbox matches what that person's Telegram and phone receive.
import { NextResponse } from "next/server";
import { loadDigest } from "@/lib/data";
import { candidates } from "@/lib/feed";

export const revalidate = 300;

export async function GET() {
  const d = await loadDigest(70);
  if (!d) return NextResponse.json({ items: [], generatedAt: null });
  return NextResponse.json({ items: candidates(d, 7), generatedAt: d.engine.generatedAt });
}

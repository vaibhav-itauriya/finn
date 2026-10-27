import { NextResponse } from "next/server";
import { searchCompanies } from "@/lib/sources/screener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ data: [] });
  try {
    return NextResponse.json({ data: await searchCompanies(q) }, { headers: { "Cache-Control": "s-maxage=86400" } });
  } catch (e) {
    return NextResponse.json({ data: [], error: (e as Error).message }, { status: 502 });
  }
}

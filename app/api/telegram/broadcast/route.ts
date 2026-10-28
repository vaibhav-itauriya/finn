// Called by the scheduled pipeline after each run with the new push items. Fans them out to every
// connected tester, filtered by that tester's own thresholds and mutes, never sending twice.
import { NextResponse } from "next/server";
import { kv, kvEnabled } from "@/lib/kv";
import { send } from "@/lib/telegram/bot";
import { DEFAULT_RULES, type Rules } from "@/lib/client/alerts";
import type { PushItem } from "@/lib/telegram/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;


export async function POST(req: Request) {
  if (!process.env.FINN_PUSH_SECRET || req.headers.get("x-finn-secret") !== process.env.FINN_PUSH_SECRET)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!kvEnabled()) return NextResponse.json({ error: "no store configured" }, { status: 501 });
  const { items = [], skip = [] } = (await req.json()) as { items: PushItem[]; skip?: string[] };
  const subs = (await kv<string[]>("HGETALL", "finn:subs")) || [];
  let sent = 0;
  for (let i = 0; i < subs.length; i += 2) {
    const chat = subs[i];
    if (skip.includes(chat)) continue;
    let rules: Rules = DEFAULT_RULES;
    try {
      rules = { ...DEFAULT_RULES, ...(JSON.parse(subs[i + 1]).rules || {}) };
    } catch {
      /* default rules */
    }
    const wanted = items.filter((it) => {
      if (it.kind === "move") return Math.abs(it.change ?? 0) >= rules.moveAbs || (it.volX ?? 0) >= rules.volMultiple;
      if (rules.muted.includes(`${it.ticker}:${it.category}`)) return false;
      return it.tier === "material" || (it.category && rules.pushCategories.includes(it.category) && (it.score ?? 0) >= 45);
    });
    let n = 0;
    for (const it of wanted) {
      if (n >= 10) break;
      if ((await kv<number>("SADD", `finn:sent:${chat}`, it.id)) !== 1) continue;
      try {
        await send(chat, it.html);
        n++;
        sent++;
      } catch {
        break; // tester blocked the bot or chat is gone
      }
    }
  }
  return NextResponse.json({ subscribers: subs.length / 2, sent });
}

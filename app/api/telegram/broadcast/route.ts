// Called by the scheduled pipeline after each run with the new push items. Fans them out to every
// connected person, on Telegram and as phone notifications, filtered by that person's own
// thresholds and mutes, never sending the same item twice.
import { NextResponse } from "next/server";
import { kv, kvEnabled } from "@/lib/kv";
import { send } from "@/lib/telegram/bot";
import { pushSecret } from "@/lib/telegram/secret";
import { DEFAULT_RULES, type Rules } from "@/lib/client/alerts";
import { wants } from "@/lib/feed";
import type { PushItem } from "@/lib/telegram/format";
import { sendPush, type PushSub } from "@/lib/webpush";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rulesOf = (json: string): Rules => {
  try {
    return { ...DEFAULT_RULES, ...(JSON.parse(json).rules || {}) };
  } catch {
    return DEFAULT_RULES;
  }
};

export async function POST(req: Request) {
  const secret = pushSecret();
  if (!secret || req.headers.get("x-finn-secret") !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!kvEnabled()) return NextResponse.json({ error: "no store configured" }, { status: 501 });
  const origin = new URL(req.url).origin;
  const { items = [], skip = [] } = (await req.json()) as { items: PushItem[]; skip?: string[] };
  // Wrap first, then the most recent items.
  const ordered = [...items].sort((a, b) => Number(b.kind === "digest") - Number(a.kind === "digest") || b.ts.localeCompare(a.ts));

  // Telegram
  const subs = (await kv<string[]>("HGETALL", "finn:subs")) || [];
  let tgSent = 0;
  for (let i = 0; i < subs.length; i += 2) {
    const chat = subs[i];
    if (skip.includes(chat)) continue;
    const rules = rulesOf(subs[i + 1]);
    let n = 0;
    for (const it of ordered.filter((x) => wants(x, rules))) {
      if (n >= 10) break;
      if ((await kv<number>("SADD", `finn:sent:${chat}`, it.id)) !== 1) continue;
      try {
        await send(chat, it.html);
        n++;
        tgSent++;
      } catch {
        break; // the person blocked the bot or the chat is gone
      }
    }
  }

  // Phone notifications
  const wp = (await kv<string[]>("HGETALL", "finn:wp")) || [];
  let wpSent = 0;
  for (let i = 0; i < wp.length; i += 2) {
    const id = wp[i];
    let sub: PushSub;
    try {
      sub = JSON.parse(wp[i + 1]).sub;
    } catch {
      continue;
    }
    const rules = rulesOf(wp[i + 1]);
    let n = 0;
    for (const it of ordered.filter((x) => wants(x, rules))) {
      if (n >= 6) break;
      if ((await kv<number>("SADD", `finn:wpsent:${id}`, it.id)) !== 1) continue;
      try {
        const alive = await sendPush(sub, { title: it.title, body: it.body, url: origin + it.path, tag: it.id });
        if (!alive) {
          await kv("HDEL", "finn:wp", id);
          break;
        }
        n++;
        wpSent++;
      } catch {
        break;
      }
    }
  }
  return NextResponse.json({ telegram: { subscribers: subs.length / 2, sent: tgSent }, phones: { subscribers: wp.length / 2, sent: wpSent } });
}

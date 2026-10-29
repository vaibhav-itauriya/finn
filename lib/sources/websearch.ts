// Plain web search for push-side enrichment (who is the new CFO?), used when the model's own
// grounded search has no quota. DuckDuckGo's HTML endpoint needs no key; we keep the result
// titles, snippets and real URLs so every bio can show where it came from.
import * as cheerio from "cheerio";
import { getText } from "../util/http";

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(q: string, n = 8): Promise<WebHit[]> {
  const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`, { headers: { Referer: "https://duckduckgo.com/" } });
  const $ = cheerio.load(html);
  const out: WebHit[] = [];
  $(".result").each((_, el) => {
    const a = $(el).find("a.result__a").first();
    let url = a.attr("href") || "";
    const m = url.match(/[?&]uddg=([^&]+)/);
    if (m) url = decodeURIComponent(m[1]);
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) return; // skip ads
    out.push({ title: a.text().trim(), url, snippet: $(el).find(".result__snippet").text().trim() });
  });
  return out.slice(0, n);
}

// Plain web search for push-side enrichment (who is the new CFO?), used when the model's own
// grounded search has no quota. No API keys: DuckDuckGo's HTML page, then its lite page, then
// Bing, because any one of them may answer a cloud runner with a bot check. We keep titles,
// snippets and real URLs so every bio can show where it came from.
import * as cheerio from "cheerio";
import { getText, sleep } from "../util/http";

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

const unwrap = (u: string) => {
  const m = u.match(/[?&]uddg=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : u;
};
const ok = (h: WebHit) => /^https?:\/\//.test(h.url) && !/duckduckgo\.com\/y\.js|bing\.com\/aclick/.test(h.url) && h.title.length > 0;

const ENGINES: { name: string; url: (q: string) => string; parse: (html: string) => WebHit[] }[] = [
  {
    name: "ddg",
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=in-en`,
    parse: (html) => {
      const $ = cheerio.load(html);
      return $(".result")
        .map((_, el) => {
          const a = $(el).find("a.result__a").first();
          return { title: a.text().trim(), url: unwrap(a.attr("href") || ""), snippet: $(el).find(".result__snippet").text().trim() };
        })
        .get();
    },
  },
  {
    name: "ddg-lite",
    url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}&kl=in-en`,
    parse: (html) => {
      const $ = cheerio.load(html);
      const out: WebHit[] = [];
      $("a.result-link").each((_, a) => {
        const row = $(a).closest("tr");
        const snippet = row.nextAll("tr").first().find(".result-snippet").text().trim();
        out.push({ title: $(a).text().trim(), url: unwrap($(a).attr("href") || ""), snippet });
      });
      return out;
    },
  },
  {
    name: "bing",
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en-IN&cc=IN`,
    parse: (html) => {
      const $ = cheerio.load(html);
      return $("li.b_algo")
        .map((_, el) => {
          const a = $(el).find("h2 a").first();
          return { title: a.text().trim(), url: a.attr("href") || "", snippet: $(el).find(".b_caption p, p").first().text().trim() };
        })
        .get();
    },
  },
];

export async function webSearch(q: string, n = 8): Promise<WebHit[]> {
  for (const e of ENGINES) {
    try {
      const hits = e.parse(await getText(e.url(q), { headers: { Referer: new URL(e.url(q)).origin + "/" }, retries: 0, timeoutMs: 12000 })).filter(ok);
      if (hits.length) return hits.slice(0, n);
    } catch {
      /* try the next engine */
    }
    await sleep(400);
  }
  return [];
}

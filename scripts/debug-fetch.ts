// One-off diagnostics: how do document hosts respond to a server request? Output: data/debug.log
import { writeFileSync } from "node:fs";
const urls = process.argv.slice(2);
const variants: [string, Record<string, string>][] = [
  ["bare", {}],
  ["browser-ua", { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/pdf,*/*" }],
  ["ua+referer", { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/pdf,*/*", Referer: "https://www.marutisuzuki.com/" }],
];
(async () => {
  const out: string[] = [];
  for (const u of urls)
    for (const [name, h] of variants) {
      try {
        const r = await fetch(u, { headers: h, redirect: "follow" });
        const b = new Uint8Array(await r.arrayBuffer());
        out.push(`${name} ${r.status} ${r.headers.get("content-type")} ${b.length}B ${r.url.slice(0, 80)} :: ${Buffer.from(b.slice(0, 160)).toString("latin1").replace(/\s+/g, " ")}`);
      } catch (e) {
        out.push(`${name} ERR ${(e as Error).message}`);
      }
    }
  writeFileSync("data/debug.log", out.join("\n") + "\n");
  console.log(out.join("\n"));
})();

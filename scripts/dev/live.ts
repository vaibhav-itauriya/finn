// End-to-end check of live research on the deployed site, the way the phone does it:
//   npx tsx scripts/dev/live.ts ITC TITAN ...
const APP = process.env.FINN_APP_URL || "https://finn-opal-delta.vercel.app";
const j = async (url: string, body?: unknown) => {
  const r = await fetch(APP + url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const t = await r.text();
  try {
    return { status: r.status, ...JSON.parse(t) };
  } catch {
    return { status: r.status, error: t.slice(0, 120) };
  }
};
(async () => {
  for (const t of process.argv.slice(2)) {
    const t0 = Date.now();
    const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    const n = await j(`/api/research/${t}?step=numbers`);
    if (!n.data) {
      console.log(t, "numbers failed", n.status, n.error);
      continue;
    }
    const docs = n.data.transcripts as { label: string }[];
    const calls = (await Promise.all(docs.map((_, i) => j(`/api/research/${t}?step=call&i=${i}`)))).map((r, i) => (r.data ? r.data : (console.log(t, at(), "doc", docs[i].label, "failed", r.status, r.error), null))).filter(Boolean);
    console.log(t, at(), `read ${calls.length}/${docs.length} docs`);
    const [l, th] = await Promise.all([j(`/api/research/${t}?step=ledger`, { calls }), j(`/api/research/${t}?step=thesis`, { calls })]);
    console.log(t, at(), "ledger:", l.data ? `ok, ${l.data.rows.length} rows, ${l.data.credibility.score}/10` : `FAILED ${l.status} ${l.error}`, "| thesis:", th.data ? "ok" : `FAILED ${th.status} ${th.error}`);
  }
})();

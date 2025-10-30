// Builds public/used_dated.json and public/used_first_seen.json from NYT Wordle v2.
// SPOILER-SAFE: only up to YESTERDAY in America/New_York.
// Adds diagnostics + short retry loop for "yesterday" to handle late NYT/CDN availability.

import fs from "node:fs/promises";

const start = new Date("2021-06-19T00:00:00-04:00"); // Wordle #0 (ET)

const pad = n => String(n).padStart(2, "0");
const isoET = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function nowET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function yesterdayET() {
  const n = nowET();
  const y = new Date(n);
  y.setDate(y.getDate() - 1);
  y.setHours(0,0,0,0);
  return y;
}

async function fetchDay(iso, opts = { headOnly: false }) {
  const url = `https://www.nytimes.com/svc/wordle/v2/${iso}.json`;
  try {
    const res = await fetch(url, { method: opts.headOnly ? "HEAD" : "GET", headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status };
    if (opts.headOnly) return { ok: true, status: res.status };
    const j = await res.json();
    const word = (j.solution || j.answer || j.word || "").toLowerCase();
    const number = j.day ?? j.id ?? j.puzzle ?? j.game ?? j.index ?? null;
    if (!/^[a-z]{5}$/.test(word)) return { ok: false, status: 200, reason: "bad-word" };
    return { ok: true, status: 200, rec: { date: iso, number, word } };
  } catch (e) {
    return { ok: false, status: 0, reason: e?.message || "fetch-error" };
  }
}

async function main() {
  const end = yesterdayET();
  const endISO = isoET(end);

  const byDate = [];
  const byWord = new Map();

  // Build history up to end (yesterday)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoET(d);
    const out = await fetchDay(iso);
    if (out.ok && out.rec) {
      byDate.push(out.rec);
      if (!byWord.has(out.rec.word)) byWord.set(out.rec.word, { date: out.rec.date, number: out.rec.number });
    } else if (iso === endISO) {
      // If yesterday wasn't immediately available, do a targeted short retry.
      console.error(`[warn] yesterday ${endISO} not ready: status=${out.status}${out.reason ? ` reason=${out.reason}` : ""}`);
      let ok = false, last = out;
      for (let i = 1; i <= 10; i++) {
        await new Promise(r => setTimeout(r, 5000)); // 5s
        const retry = await fetchDay(endISO);
        if (retry.ok && retry.rec) {
          byDate.push(retry.rec);
          if (!byWord.has(retry.rec.word)) byWord.set(retry.rec.word, { date: retry.rec.date, number: retry.rec.number });
          ok = true;
          console.log(`[info] yesterday ${endISO} succeeded on retry ${i}`);
          break;
        }
        last = retry;
        console.error(`[warn] retry ${i} for ${endISO}: status=${retry.status}${retry.reason ? ` reason=${retry.reason}` : ""}`);
      }
      if (!ok) {
        console.error(`[error] yesterday ${endISO} still missing after retries. Last status=${last.status}${last.reason?` reason=${last.reason}`:""}`);
      }
    }
  }

  // DIAGNOSTICS: show HEAD status for yesterday and the day before
  {
    const dayBefore = new Date(end); dayBefore.setDate(dayBefore.getDate() - 1);
    const prevISO = isoET(dayBefore);
    const h1 = await fetchDay(prevISO, { headOnly: true });
    const h2 = await fetchDay(endISO, { headOnly: true });
    console.log(`[diag] HEAD ${prevISO}: status=${h1.status} | HEAD ${endISO}: status=${h2.status}`);
  }

  // Sort & write
  byDate.sort((a,b) => (a.date < b.date ? -1 : 1));
  await fs.mkdir("public", { recursive: true });
  await fs.writeFile("public/used_dated.json", JSON.stringify({ results: byDate }, null, 2));
  await fs.writeFile("public/used_first_seen.json", JSON.stringify(Object.fromEntries(byWord), null, 2));

  const last = byDate.at(-1)?.date;
  if (last !== endISO) {
    console.error(`Expected last date ${endISO} but got ${last ?? "none"}. NYT data may not be live yet or transiently failing.`);
    process.exit(2); // signal "retry later" to CI
  }

  console.log(`OK up to ${last}. Entries: ${byDate.length}, unique words: ${byWord.size}`);
}

await main().catch(e => {
  console.error(e?.stack || e);
  process.exit(1);
});

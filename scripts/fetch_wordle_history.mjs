// Builds public/used_dated.json and public/used_first_seen.json from NYT Wordle v2.
// SPOILER-SAFE: only up to YESTERDAY in America/New_York.
// Fails CI if "yesterday ET" is missing, so you notice & can re-run later.

import fs from "node:fs/promises";

const start = new Date("2021-06-19T00:00:00-04:00"); // Wordle #0 (ET)

function pad(n) { return String(n).padStart(2, "0"); }

function todayET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isoET(d) {
  const y = d.getFullYear(), m = pad(d.getMonth()+1), dy = pad(d.getDate());
  return `${y}-${m}-${dy}`;
}

function yesterdayET() {
  const now = todayET();
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  y.setHours(0,0,0,0);
  return y;
}

async function fetchDay(iso) {
  const url = `https://www.nytimes.com/svc/wordle/v2/${iso}.json`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const j = await res.json();
  const word = (j.solution || j.answer || j.word || "").toLowerCase();
  const number = j.day ?? j.id ?? j.puzzle ?? j.game ?? j.index ?? null;
  if (!/^[a-z]{5}$/.test(word)) return null;
  return { date: iso, number, word };
}

async function main() {
  const end = yesterdayET(); // we must include up to 'end' if available
  const endISO = isoET(end);

  const byDate = [];
  const byWord = new Map();

  // Build full history up to 'end'
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    const iso = isoET(d);
    const rec = await fetchDay(iso);
    if (rec) {
      byDate.push(rec);
      if (!byWord.has(rec.word)) byWord.set(rec.word, { date: rec.date, number: rec.number });
    }
  }

  // Sort
  byDate.sort((a,b) => (a.date < b.date ? -1 : 1));

  // Write artifacts
  await fs.mkdir("public", { recursive: true });
  await fs.writeFile("public/used_dated.json", JSON.stringify({ results: byDate }, null, 2));
  await fs.writeFile("public/used_first_seen.json", JSON.stringify(Object.fromEntries(byWord), null, 2));

  const last = byDate.at(-1)?.date;
  if (last !== endISO) {
    // NYT likely hadn't published the latest yet; fail CI so it's visible.
    console.error(`Expected last date ${endISO} but got ${last ?? "none"}. NYT data may not be live yet.`);
    process.exit(2);
  }

  console.log(`OK up to ${last}. Entries: ${byDate.length}, unique words: ${byWord.size}`);
}

await main().catch(e => {
  console.error(e?.stack || e);
  process.exit(1);
});

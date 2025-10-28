// Builds public/used_dated.json and public/used_first_seen.json from NYT v2 JSON.
// SPOILER-SAFE: only up to YESTERDAY in America/New_York.
import fs from "node:fs/promises";

const start = new Date("2021-06-19T00:00:00-04:00"); // Wordle #0 (ET)

// Compute yesterday in ET
function yesterdayET() {
  const nowET = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const y = new Date(nowET);
  y.setDate(y.getDate() - 1); // stop at *yesterday* ET
  y.setHours(0, 0, 0, 0);
  return y;
}

const end = yesterdayET();
const pad = (n) => String(n).padStart(2, "0");

const byDate = [];
const byWord = new Map();

for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
  const y = d.getFullYear(),
    m = pad(d.getMonth() + 1),
    day = pad(d.getDate());
  const iso = `${y}-${m}-${day}`;
  const url = `https://www.nytimes.com/svc/wordle/v2/${iso}.json`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) continue; // skip pre-launch days or NYT hiccups
    const j = await res.json();
    const word = (j.solution || j.answer || j.word || "").toLowerCase();
    const number = j.day ?? j.id ?? j.puzzle ?? j.game ?? j.index ?? null;
    if (!/^[a-z]{5}$/.test(word)) continue;
    byDate.push({ date: iso, number, word });
    if (!byWord.has(word)) byWord.set(word, { date: iso, number });
  } catch {
    // transient issues are fine; nightly job will catch up tomorrow
  }
}

byDate.sort((a, b) => (a.date < b.date ? -1 : 1));

await fs.mkdir("public", { recursive: true });
await fs.writeFile(
  "public/used_dated.json",
  JSON.stringify({ results: byDate }, null, 2)
);
await fs.writeFile(
  "public/used_first_seen.json",
  JSON.stringify(Object.fromEntries(byWord), null, 2)
);
console.log(
  `wrote ${byDate.length} dated entries up to ${byDate.at(-1)?.date}, ${byWord.size} unique words`
);

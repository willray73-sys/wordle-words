// Incremental, spoiler-safe Wordle history builder (up to YESTERDAY ET).
// - Reads existing public/used_dated.json and only fetches missing dates
// - Busts CDN on the last few days
// - Never exits non-zero solely because "yesterday" isn't live yet

import fs from "node:fs/promises";

const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const nowET = () => new Date(new Date().toLocaleString("en-US",{ timeZone:"America/New_York" }));
const yET = () => { const t=nowET(), y=new Date(t); y.setDate(y.getDate()-1); y.setHours(0,0,0,0); return y; };
const start = new Date("2021-06-19T00:00:00-04:00"); // Wordle #0 (ET)

async function fetchDay(isoStr, bust=false){
  const url = `https://www.nytimes.com/svc/wordle/v2/${isoStr}.json${bust ? `?nocache=${Date.now()}` : ""}`;
  try{
    const r = await fetch(url,{ headers:{ accept:"application/json", "cache-control":"no-cache" }});
    if(!r.ok) return null;
    const j = await r.json();
    const word = (j.solution || j.answer || j.word || "").toLowerCase();
    const number = j.day ?? j.id ?? j.puzzle ?? j.game ?? j.index ?? null;
    if(!/^[a-z]{5}$/.test(word)) return null;
    return { date: isoStr, number, word };
  }catch{ return null; }
}

async function main(){
  const end = yET();               // stop at *yesterday* (spoiler-safe)
  const endISO = iso(end);

  // Load existing data if present
  let existing = { results: [] };
  try{ existing = JSON.parse(await fs.readFile("public/used_dated.json","utf-8")); }catch{}
  const map = new Map(existing.results?.map(r => [r.date, r]) ?? []);

  // Determine where to start: day after the latest existing date, else full rebuild
  let startDate = start;
  if (map.size > 0) {
    const last = [...map.keys()].sort().at(-1);
    const d = last ? new Date(`${last}T00:00:00-05:00`) : start; // parse in ET-ish
    startDate = new Date(d);
    startDate.setDate(startDate.getDate() + 1);
  }

  // Fetch missing dates up to end
  const tailBustSet = new Set(); // dates we will bust cache for
  // Bust yesterday and day-before to fight CDN staleness
  tailBustSet.add(endISO);
  const dayBefore = new Date(end); dayBefore.setDate(dayBefore.getDate()-1);
  tailBustSet.add(iso(dayBefore));

  for (let d = new Date(startDate); d <= end; d.setDate(d.getDate()+1)) {
    const s = iso(d);
    const bust = tailBustSet.has(s);
    const rec = await fetchDay(s, bust);
    if (rec) map.set(s, rec);
    else     console.error(`[warn] missing ${s} (bust=${bust})`);
  }

  const merged = [...map.values()].sort((a,b)=> a.date < b.date ? -1 : 1);
  await fs.mkdir("public",{recursive:true});
  await fs.writeFile("public/used_dated.json", JSON.stringify({ results: merged }, null, 2));

  // Also (re)build first_seen map
  const firstSeen = {};
  for (const r of merged) if (!firstSeen[r.word]) firstSeen[r.word] = { date: r.date, number: r.number };
  await fs.writeFile("public/used_first_seen.json", JSON.stringify(firstSeen, null, 2));

  const tail = merged.at(-1)?.date;
  console.log(`Tail now: ${tail} (target yesterday ET: ${endISO}) | entries: ${merged.length}`);
  // NOTE: We do not exit non-zero if tail<endISO to avoid "stuck" runs.
}

await main().catch(e => { console.error(e?.stack || e); process.exit(1); });

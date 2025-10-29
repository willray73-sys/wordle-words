// Backfills the last N days (up to yesterday ET) into public/used_dated.json
import fs from "node:fs/promises";

const N = parseInt(process.env.DAYS || "3", 10);

function pad(n){return String(n).padStart(2,"0");}
function todayET(){return new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));}
function isoET(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function yesterdayET(){const t=todayET(); const y=new Date(t); y.setDate(y.getDate()-1); y.setHours(0,0,0,0); return y;}

async function fetchDay(iso){
  const url=`https://www.nytimes.com/svc/wordle/v2/${iso}.json`;
  const r=await fetch(url,{headers:{accept:"application/json"}});
  if(!r.ok) return null;
  const j=await r.json();
  const word=(j.solution||j.answer||j.word||"").toLowerCase();
  const number=j.day??j.id??j.puzzle??j.game??j.index??null;
  if(!/^[a-z]{5}$/.test(word)) return null;
  return {date:iso, number, word};
}

(async()=>{
  const path="public/used_dated.json";
  let data={results:[]};
  try{ data=JSON.parse(await fs.readFile(path,"utf-8")); }catch{}
  const map=new Map(data.results.map(r=>[r.date, r]));
  const end=yesterdayET();
  for(let i=0;i<N;i++){
    const d=new Date(end); d.setDate(d.getDate()-i);
    const iso=isoET(d);
    const rec=await fetchDay(iso);
    if(rec) map.set(iso, rec);
  }
  const merged=[...map.values()].sort((a,b)=> a.date<b.date ? -1 : 1);
  await fs.mkdir("public",{recursive:true});
  await fs.writeFile(path, JSON.stringify({results:merged}, null, 2));
  console.log(`Backfilled last ${N} days. New tail:`, merged.at(-1));
})().catch(e=>{console.error(e); process.exit(1);});

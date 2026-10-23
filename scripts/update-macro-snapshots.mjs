import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const fetchText=async url=>{const res=await fetch(url);if(!res.ok)throw Error(`${url} HTTP ${res.status}`);return res.text()};
// Brent moved to scripts/update-brent-futures.mjs (期交所 BRF 近月結算價 via FinMind); the old EIA spot
// series is archived in pages-data/brent-eia.json and no longer updated.
const raw=JSON.parse(await fetchText('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day')),fx=[];
for(const row of raw){const date=String(row['日期']||''),value=Number(row.NTD_USD);if(/^\d{8}$/.test(date)&&Number.isFinite(value))fx.push({date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}`,value})}
if(fx.length<200)throw Error('CBC snapshot has too few days');
await mkdir(new URL('pages-data/',root),{recursive:true});
// Append-only: days already saved are kept as they are (never dropped or overwritten); only new dates are added.
const keep=async(name,fresh)=>{let old=[];try{old=JSON.parse(await readFile(new URL(`pages-data/${name}`,root),'utf8')).days||[]}catch{}
  const byDate=new Map(old.map(x=>[x.date,x]));let added=0;for(const x of fresh)if(!byDate.has(x.date)){byDate.set(x.date,x);added++}
  return{days:[...byDate.values()].sort((a,c)=>a.date.localeCompare(c.date)),added}};
const kf=await keep('fx.json',fx),f=kf.days;
await writeFile(new URL('pages-data/fx.json',root),JSON.stringify({days:f,latest:f.at(-1).date,source:'CBC FTDOpenData_Day',unit:'TWD/USD'})+'\n');
console.log(`CBC: +${kf.added} new, ${f.length} kept through ${f.at(-1).date}`);

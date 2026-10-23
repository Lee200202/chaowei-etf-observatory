import {readFile,writeFile} from 'node:fs/promises';
import {BRF_SOURCE,brfNearMonth,finmindBrf} from './brf-near.mjs';

// Brent reference line: 期交所布蘭特原油期貨（BRF）近月每日結算價，新台幣／桶，經 FinMind 取得（須標示 FinMind）。
// Append-only like the other snapshots: saved days are kept as they are; only new dates are added.
// The first run (or a file still holding the old EIA spot series) loads the full history from 2018.
const file=new URL('../pages-data/brent.json',import.meta.url);
let old=null;try{old=JSON.parse(await readFile(file,'utf8'))}catch{}
const continuing=old?.unit==='TWD/barrel'&&old.days?.length>0;
const start=continuing?new Date(Date.parse(old.latest)-20*86400000).toISOString().slice(0,10):'2018-01-01';
const fresh=brfNearMonth(await finmindBrf(start));
const today=new Date(Date.now()+28800000).toISOString().slice(0,10);
if(fresh.some(x=>x.date>today||!(x.value>0)))throw Error('FinMind BRF 日期或數值異常');
const byDate=new Map((continuing?old.days:[]).map(x=>[x.date,x]));let added=0;
for(const x of fresh)if(!byDate.has(x.date)){byDate.set(x.date,x);added++}
const days=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
if(days.length<600)throw Error(`FinMind BRF 只有 ${days.length} 天，少於 600 天`);
const last=days.at(-1);
await writeFile(file,JSON.stringify({days,latest:last.date,contract:last.contract,source:BRF_SOURCE,attribution:'FinMind',snapshot:true,unit:'TWD/barrel'})+'\n');
console.log(`BRF near-month: +${added} new, ${days.length} kept through ${last.date} (${last.contract} ${last.value} TWD/barrel)`);

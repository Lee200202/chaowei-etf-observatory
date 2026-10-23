// Market-wide margin balance (信用交易統計) from TWSE MI_MARGN selectType=MS, one small request per trading day.
// Trading days come from pages-data/history/market.json. Missing days are fetched; by default only the
// last 10 trading days are checked; --older N also fills up to N older missing days, newest first (the daily job
// uses this to finish the ten-year history over a few runs). --all fills every missing day, newest first.
// Progress is written every 50 days, so an interrupted backfill resumes where it stopped.
// Usage: node scripts/update-margin.mjs [--older 250] [--all] [--gap 1200]
import {readFile,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url),file=new URL('pages-data/history/margin.json',root);
const args=process.argv.slice(2),flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const gap=Math.max(1000,Number(flag('--gap')||1200)),all=args.includes('--all'),older=Math.max(0,Number(flag('--older')||0));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const num=v=>{const n=Number(String(v??'').replaceAll(',',''));return Number.isFinite(n)?n:null};
const market=JSON.parse(await readFile(new URL('pages-data/history/market.json',root),'utf8'));
let old=[];try{old=JSON.parse(await readFile(file,'utf8')).rows||[]}catch{}
const have=new Map(old.map(r=>[r[0],r]));
const days=market.rows.map(r=>r[0]),missing=days.filter(d=>!have.has(d)).reverse();
const recent=new Set(days.slice(-10)),wanted=all?missing:[...missing.filter(d=>recent.has(d)),...missing.filter(d=>!recent.has(d)).slice(0,older)];
let lastCall=0,fetched=0,failed=0;

async function day(date){
  const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);lastCall=Date.now();
  for(let attempt=1;;attempt++){
    try{
      const res=await fetch(`https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date.replaceAll('-','')}&selectType=MS`,{headers:{'user-agent':'Mozilla/5.0 chaowei-etf-observatory'},signal:AbortSignal.timeout(20000)});
      if(!res.ok)throw Error('HTTP '+res.status);
      const j=await res.json();if(j.stat!=='OK')return null;
      // The summary rows are labelled; read them by label, not by position.
      const rows=j.tables?.[0]?.data||j.creditList||[],pick=label=>rows.find(r=>String(r[0]).startsWith(label));
      const m=pick('融資(交易單位)'),s=pick('融券(交易單位)'),a=pick('融資金額');
      const marginLots=num(m?.[5]),shortLots=num(s?.[5]),amountK=num(a?.[5]);
      return [marginLots,shortLots,amountK].every(Number.isFinite)?[date,marginLots,shortLots,amountK]:null;
    }catch(e){if(attempt>=4)throw e;await sleep(gap*attempt*3)}
  }
}
async function save(){
  const rows=[...have.values()].sort((a,b)=>a[0].localeCompare(b[0]));
  await writeFile(file,JSON.stringify({source:'TWSE MI_MARGN 信用交易統計（全市場）',fields:['date','marginLots','shortLots','marginAmountThousand'],
    unit:'lots (交易單位); margin amount in thousand TWD',first:rows[0]?.[0]||null,latest:rows.at(-1)?.[0]||null,rows})+'\n');
}
for(const date of wanted){
  try{const row=await day(date);if(row){have.set(date,row);fetched++}else failed++}
  catch(e){failed++;console.warn(`${date}: ${e.message}`)}
  if((fetched+failed)%50===0){await save();console.log(`… ${date}: ${fetched} saved, ${failed} empty or failed`)}
}
await save();
console.log(`Market margin: ${fetched} days added, ${failed} empty or failed; ${have.size} days through ${[...have.keys()].sort().at(-1)}.`);

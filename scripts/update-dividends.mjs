// Cash dividends (ex-dividend date and amount per share) for every catalogue ETF.
// Source: TWSE TWT49U 除權除息計算結果表, one request per calendar year. Amounts are per share as
// traded on the ex-date (not split-adjusted); the page divides by later split factors itself.
// Usage: node scripts/update-dividends.mjs [--years 11] [--gap 1500]
import {readFile,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url),out=new URL('pages-data/history/dividends.json',root);
const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(x=>x.trim().split(/\s+/)));
const years=Number(args.years||11),gap=Number(args.gap||1500);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=v=>{const x=Number(String(v??'').replaceAll(',',''));return Number.isFinite(x)?x:null};
const roc=s=>{const m=String(s).match(/^(\d{2,3})年(\d{2})月(\d{2})日$/);return m?`${Number(m[1])+1911}-${m[2]}-${m[3]}`:null};
const readJson=async(url,fallback)=>{try{return JSON.parse(await readFile(url,'utf8'))}catch{return fallback}};
const catalog=await readJson(new URL('worker/etf-catalog.json',root),{etfs:[]}),known=new Set(catalog.etfs.map(x=>x.code));
const current=await readJson(out,{events:{}});
const thisYear=new Date(Date.now()+28800000).getUTCFullYear();
// Past years never change once fetched; always refresh the current and previous year.
const done=new Set(current.years||[]),events=current.events||{};
let lastCall=0;
for(let y=thisYear-years+1;y<=thisYear;y++){
  if(done.has(y)&&y<thisYear-1)continue;
  const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);lastCall=Date.now();
  const res=await fetch(`https://www.twse.com.tw/rwd/zh/exRight/TWT49U?startDate=${y}0101&endDate=${y}1231&response=json`,{headers:{'User-Agent':'Mozilla/5.0 chaowei-etf-observatory'},signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw Error(`TWT49U ${y} HTTP ${res.status}`);
  const data=await res.json();
  if(data.stat!=='OK'&&!/沒有符合|查無/.test(data.stat||''))throw Error(`TWT49U ${y}: ${data.stat}`);
  const f=name=>data.fields?.indexOf(name)??-1,[iDate,iCode,iValue,iKind]=['資料日期','股票代號','權值+息值','權/息'].map(f);
  let count=0;
  for(const r of data.data||[]){
    const code=String(r[iCode]).trim(),date=roc(r[iDate]),value=num(r[iValue]),kind=String(r[iKind]).trim();
    // Only cash dividends ("息"); stock dividends ("權") are rare for ETFs and change the share count instead.
    if(!known.has(code)||!date||!(value>0)||kind!=='息')continue;
    const list=(events[code]||=[]).filter(([d])=>d!==date);list.push([date,value]);list.sort((a,b)=>a[0].localeCompare(b[0]));events[code]=list;count++;
  }
  done.add(y);console.log(`${y}: ${count} ETF cash dividends`);
}
const total=Object.values(events).reduce((a,l)=>a+l.length,0);
await writeFile(out,JSON.stringify({source:'TWSE TWT49U 除權除息計算結果表（現金股利，每股，除息當時股數基準）',years:[...done].sort(),updated:new Date().toISOString(),events})+'\n');
console.log(`Dividends: ${Object.keys(events).length} ETFs, ${total} events.`);

// Append the latest weekly ETF ownership buckets from TDCC's official open API.
// Bucket 12-15 = over 400 lots; bucket 15 = over 1,000 lots. Never infer daily data.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),file=new URL('pages-data/history/holders.json',root);
const catalog=JSON.parse(await readFile(new URL('worker/etf-catalog.json',root),'utf8'));
const codes=new Set((Array.isArray(catalog)?catalog:catalog.items||catalog.etfs||[]).map(x=>x.code).filter(Boolean));
if(!codes.size)throw Error('ETF 名錄沒有可用代號');
const url='https://openapi.tdcc.com.tw/v1/opendata/1-5';
const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error(`TDCC HTTP ${response.status}`);
const source=await response.json();
if(!Array.isArray(source)||source.length<1000)throw Error('TDCC 資料筆數異常');
const byCode=new Map();let date='';
for(const r of source){
  const code=String(r['證券代號']||'').trim();if(!codes.has(code))continue;
  const d=String(r['\ufeff資料日期']||r['資料日期']||'');if(!/^\d{8}$/.test(d))continue;
  const iso=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`;
  if(date&&date!==iso)throw Error('TDCC 回傳多個週期日期');date=iso;
  const level=Number(r['持股分級']),shares=Number(r['股數']),holders=Number(r['人數']);
  if(!Number.isInteger(level)||![shares,holders].every(Number.isFinite))continue;
  let x=byCode.get(code);if(!x){x={total:null,big:0,veryBig:0,countBig:0,countVeryBig:0,levels:new Set()};byCode.set(code,x)}
  x.levels.add(level);
  if(level===17)x.total=shares;
  if(level>=12&&level<=15){x.big+=shares;x.countBig+=holders}
  if(level===15){x.veryBig=shares;x.countVeryBig=holders}
}
if(!date||byCode.size<100)throw Error('TDCC ETF 覆蓋不足');
let old={rows:[]};try{old=JSON.parse(await readFile(file,'utf8'))}catch{}
const existing=new Set(old.rows.map(r=>r[0]+'|'+r[1]));let added=0;
for(const [code,x] of byCode){
  if(x.levels.size<16||!Number.isFinite(x.total)||x.total<=0)continue;
  if(existing.has(date+'|'+code))continue;
  old.rows.push([date,code,Math.round(x.big/x.total*10000)/100,Math.round(x.veryBig/x.total*10000)/100,x.countBig,x.countVeryBig]);added++;
}
old.rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
const out={source:'TDCC 1-5 集保戶股權分散表',sourceUrl:url,unit:'ratio percent; holder counts',fields:['date','code','over400Pct','over1000Pct','over400Holders','over1000Holders'],latest:date,rows:old.rows};
if(added)await writeFile(file,JSON.stringify(out)+'\n');
console.log(`TDCC ${date}: ${byCode.size} ETFs, added ${added} rows`);

// Daily TWSE institutional trading and foreign/PRC ownership for listed ETFs.
// Run --days 30 for initial backfill; scheduled updates refresh the latest 6 sessions.
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const args=process.argv.slice(2),flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const days=Math.max(1,Math.min(240,Number(flag('--days')||6)));
const gap=Math.max(1000,Number(flag('--gap')||1500));
const catalog=await read('worker/etf-catalog.json');
const codes=new Set(catalog.etfs.map(x=>x.code));
const market=await read('pages-data/history/market.json');
const dates=market.rows.slice(-days).map(x=>x[0]);
const output=new URL('pages-data/chips/',root);
await mkdir(output,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const num=value=>{const n=Number(String(value??'').replaceAll(',',''));return Number.isFinite(n)?n:null};
const rows=new Map();
let lastCall=0;

async function official(report,date){
  const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);lastCall=Date.now();
  const url=`https://www.twse.com.tw/rwd/zh/fund/${report}?date=${date.replaceAll('-','')}&selectType=ALLBUT0999&response=json`;
  const response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 chaowei-etf-observatory'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`${report} ${date}: HTTP ${response.status}`);
  const data=await response.json();
  if(data.stat!=='OK'||!Array.isArray(data.fields)||!Array.isArray(data.data))throw Error(`${report} ${date}: ${data.stat||'資料格式異常'}`);
  return data;
}
function field(data,row,name){const i=data.fields.indexOf(name);return i<0?null:num(row[i])}

for(const date of dates){
  let trades,held,margin;
  try{trades=await official('T86',date);held=await official('MI_QFIIS',date)}
  catch(error){console.warn(error.message);continue}
  try{
    const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);lastCall=Date.now();
    const response=await fetch(`https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date.replaceAll('-','')}&selectType=ALL`,{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});
    const report=await response.json();margin=report.stat==='OK'?new Map((report.tables?.[1]?.data||[]).map(row=>[String(row[0]).trim(),row])):new Map();
  }catch(error){console.warn(`融資資料 ${date}: ${error.message}`);margin=new Map()}
  const ownership=new Map(held.data.map(row=>[String(row[0]).trim(),row]));
  let count=0;
  for(const row of trades.data){
    const code=String(row[0]).trim();if(!codes.has(code))continue;
    const h=ownership.get(code);
    const foreignNet=field(trades,row,'外陸資買賣超股數(不含外資自營商)');
    const trustNet=field(trades,row,'投信買賣超股數');
    const dealerNet=field(trades,row,'自營商買賣超股數');
    const totalNet=field(trades,row,'三大法人買賣超股數');
    if([foreignNet,trustNet,dealerNet,totalNet].some(v=>v===null))continue;
    const issued=h?field(held,h,'發行股數'):null;
    const foreignHeld=h?field(held,h,'全體外資及陸資持有股數'):null;
    const m=margin.get(code);
    const item=[date,foreignNet,trustNet,dealerNet,totalNet,foreignHeld,issued,m?num(m[6]):null,m?num(m[12]):null];
    if(!rows.has(code))rows.set(code,[]);
    rows.get(code).push(item);count++;
  }
  console.log(`${date}: ${count} ETF 法人買賣超`);
}

let files=0;
for(const [code,current] of rows){
  const path=new URL(`${code}.json`,output);
  let old=[];try{old=JSON.parse(await readFile(path,'utf8')).rows||[]}catch{}
  const merged=new Map(old.map(row=>[row[0],row]));
  for(const row of current)merged.set(row[0],row);
  const history=[...merged.values()].sort((a,b)=>a[0].localeCompare(b[0]));
  await writeFile(path,JSON.stringify({code,source:{trades:'TWSE T86',foreignOwnership:'TWSE MI_QFIIS',margin:'TWSE MI_MARGN'},unit:'shares; margin balances in trading units (lots)',fields:['date','foreignNet','trustNet','dealerNet','totalNet','foreignHeld','issued','marginBalanceLots','shortBalanceLots'],first:history[0][0],latest:history.at(-1)[0],rows:history})+'\n');
  files++;
}
console.log(`Saved ${files} ETF chip snapshots through ${dates.at(-1)}`);

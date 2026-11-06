// Brent for the market card: Yahoo Finance BZ=F daily closes (front-month futures, USD/barrel).
// Old days are kept; the last three months are re-read so revised closes replace provisional ones.
// The earlier FinMind/EIA spot history is a different instrument and stays archived in oil-spot-finmind.json.
import{readFile,writeFile}from'node:fs/promises';
import{YAHOO_BRENT_URL,parseYahooDaily}from'./yahoo-brent.mjs';
const SOURCE='Yahoo Finance BZ=F',file=new URL('../pages-data/oil-spot.json',import.meta.url);
let old={days:[]};try{old=JSON.parse(await readFile(file,'utf8'))}catch{}
const fresh=old.source!==SOURCE;
const r=await fetch(YAHOO_BRENT_URL(fresh?'10y':'3mo'),{headers:{'User-Agent':'Mozilla/5.0 (compatible; ChaoweiResearch/1.0)'},signal:AbortSignal.timeout(45000)});
if(!r.ok)throw Error('Yahoo BZ=F HTTP '+r.status);
const incoming=parseYahooDaily(await r.json());if(!incoming.length)throw Error('Yahoo BZ=F 沒有完成的日收盤');
const byDate=new Map((fresh?[]:old.days).map(x=>[x.date,x]));for(const x of incoming)byDate.set(x.date,x);
const days=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));if(days.length<360)throw Error('Brent history too short');
await writeFile(file,JSON.stringify({source:SOURCE,sourceUrl:'https://finance.yahoo.com/quote/BZ%3DF/',symbol:'BZ=F',unit:'USD/barrel',frequency:'daily',
  notice:'ICE 布蘭特近月連續合約每日收盤（Yahoo 延遲行情）；換月時價格可能跳動，非現貨',latest:days.at(-1).date,days})+'\n');
console.log(`Yahoo BZ=F: ${days.length} days, ${days[0].date} through ${days.at(-1).date}, ${days.at(-1).value} USD/barrel${fresh?' (replaced FinMind spot history)':''}`);

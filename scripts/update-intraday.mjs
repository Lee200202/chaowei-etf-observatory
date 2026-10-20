// Intraday turnover profile: cumulative traded lots at every 5-minute mark (09:05–13:30) per trading day.
// Lets the site compare today's volume so far with past days at the same time of day.
// Source: TWSE MI_5MINS (每5秒委託成交統計). Usage: node scripts/update-intraday.mjs [--days 600] [--gap 1500]
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url),out=new URL('pages-data/history/intraday-volume.json',root),cache=new URL('.history-cache/',root);
const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(x=>x.trim().split(/\s+/)));
const keep=Number(args.days||600),gap=Number(args.gap||1500);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=v=>{const x=Number(String(v??'').replaceAll(',',''));return Number.isFinite(x)?x:null};
const readJson=async(url,fallback)=>{try{return JSON.parse(await readFile(url,'utf8'))}catch{return fallback}};
const taipeiNow=new Date(Date.now()+28800000),today=taipeiNow.toISOString().slice(0,10);
const closed=taipeiNow.getUTCHours()*60+taipeiNow.getUTCMinutes()>=14*60+30;
export const MARKS=[];for(let m=9*60+5;m<=13*60+30;m+=5)MARKS.push(`${String(Math.floor(m/60)).padStart(2,'0')}${String(m%60).padStart(2,'0')}`);
await mkdir(cache,{recursive:true});

let lastCall=0;
async function twse(url){
  const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);
  for(let attempt=1;;attempt++){
    lastCall=Date.now();
    try{const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 chaowei-etf-observatory'},signal:AbortSignal.timeout(30000)});if(res.status===200)return await res.json();throw Error('HTTP '+res.status)}
    catch(e){if(attempt>=4)throw Error(`${url}: ${e.message}`);await sleep(gap*attempt*4)}
  }
}
async function profile(date){
  const key=new URL(`m5-${date}.json`,cache),hit=await readJson(key,null);if(hit)return hit.lots;
  const data=await twse(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_5MINS?date=${date.replaceAll('-','')}&response=json`);
  let lots=null;
  if(data.stat==='OK'&&Array.isArray(data.data)){
    const at=new Map(data.data.map(r=>[String(r[0]).slice(0,5).replace(':',''),num(r[6])]));
    lots=MARKS.map(m=>at.get(m)??null);
    // Fill an occasional missing mark with the previous cumulative value (cumulative series never decrease).
    for(let i=1;i<lots.length;i++)if(lots[i]==null)lots[i]=lots[i-1];
    if(lots.some(v=>v==null))lots=null;
  }
  if(date<today||closed)await writeFile(key,JSON.stringify({date,lots}));
  return lots;
}

const market=await readJson(new URL('pages-data/history/market.json',root),{rows:[]});
const current=await readJson(out,{days:[]});
const have=new Map(current.days.map(([d,l])=>[d,l]));
const dates=market.rows.map(r=>r[0]).filter(d=>d<today||closed).slice(-keep);
let added=0;
for(const date of dates){
  if(have.has(date))continue;
  const lots=await profile(date);
  if(lots){have.set(date,lots);added++}
  if(added&&added%50===0)console.log(`… ${date} (${added} days added)`);
}
const days=[...have.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-keep);
await writeFile(out,JSON.stringify({source:'TWSE MI_5MINS 每5秒委託成交統計（累積成交數量，張）',marks:MARKS,first:days[0]?.[0]||null,latest:days.at(-1)?.[0]||null,days})+'\n');
console.log(`Intraday profile: ${added} days added; ${days.length} days ${days[0]?.[0]}–${days.at(-1)?.[0]}.`);

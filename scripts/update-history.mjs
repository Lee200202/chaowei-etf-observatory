// Builds the static long-history files that GitHub Pages and Apps Script read in one request.
// ETF prices: TWSE MI_INDEX type=0099P (one request per trading day covers every listed ETF).
// Market: TWSE FMTQIK (one request per month). Existing files are extended incrementally.
// Usage: node scripts/update-history.mjs [--from YYYY-MM-DD] [--years 10] [--gap 1500]
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const out=new URL('pages-data/history/',root),cache=new URL('.history-cache/',root);
const args=Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(x=>x.trim().split(/\s+/)));
const years=Number(args.years||10),gap=Number(args.gap||1500);
const taipeiToday=new Date(Date.now()+28800000).toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=v=>{const x=Number(String(v??'').replaceAll(',',''));return Number.isFinite(x)?x:null};
const iso=d=>d.toISOString().slice(0,10);
const round=(v,d=4)=>Math.round(v*10**d)/10**d;
await mkdir(out,{recursive:true});await mkdir(cache,{recursive:true});

let lastCall=0;
async function twse(url){
  const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);
  for(let attempt=1;;attempt++){
    lastCall=Date.now();
    try{
      const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 chaowei-etf-observatory'},signal:AbortSignal.timeout(20000)});
      if(res.status===200)return await res.json();
      throw Error('HTTP '+res.status);
    }catch(e){
      if(attempt>=4)throw Error(`${url}: ${e.message}`);
      await sleep(gap*attempt*4);
    }
  }
}
const readJson=async(url,fallback)=>{try{return JSON.parse(await readFile(url,'utf8'))}catch{return fallback}};

/* ---------- ETF daily table ---------- */
async function etfDay(date){
  const key=new URL(`mi-${date}.json`,cache),hit=await readJson(key,null);
  if(hit)return hit;
  const d=date.replaceAll('-','');
  const data=await twse(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${d}&type=0099P&response=json`);
  let rows=null;
  if(data.stat==='OK'){
    const table=(data.tables||[]).find(t=>Array.isArray(t.fields)&&t.fields[0]==='證券代號'&&t.fields.includes('收盤價'));
    if(table){
      const f=name=>table.fields.indexOf(name);
      const [iCode,iName,iVol,iVal,iO,iH,iL,iC,iSign,iChg]=['證券代號','證券名稱','成交股數','成交金額','開盤價','最高價','最低價','收盤價','漲跌(+/-)','漲跌價差'].map(f);
      rows={};
      for(const r of table.data){
        const o=num(r[iO]),h=num(r[iH]),l=num(r[iL]),c=num(r[iC]),v=num(r[iVol]);
        if(![o,h,l,c,v].every(Number.isFinite)||c<=0)continue;
        const sign=/-/.test(String(r[iSign]).replace(/<[^>]+>/g,''))?-1:1,chg=num(r[iChg]);
        rows[String(r[iCode]).trim()]=[o,h,l,c,v,num(r[iVal]),Number.isFinite(chg)?sign*chg:null,String(r[iName]).trim()];
      }
      // TWSE may answer stat=OK with an empty ETF table on an exceptional closure.
      // Do not advance the trading-day cursor or invent an empty trading session.
      if(!Object.keys(rows).length)rows=null;
    }
  }
  // Past days never change: cache them, including holidays (rows=null). Today is fetched again next run.
  const result={date,rows};
  if(date<taipeiToday||rows)await writeFile(key,JSON.stringify(result));
  return result;
}

async function loadSeries(code){return readJson(new URL(`${code}.json`,out),null)}
function niceFactor(x){
  // Splits are whole-number ratios (1→4) or reverse splits (4→1).
  if(x>=1.5){const k=Math.round(x);return Math.abs(x/k-1)<0.03?k:round(x,4)}
  if(x<=0.67){const k=Math.round(1/x);return Math.abs(x*k-1)<0.03?round(1/k,6):round(x,6)}
  return null;
}

const catalog=await readJson(new URL('worker/etf-catalog.json',root),{etfs:[]});
const known=new Set(catalog.etfs.map(x=>x.code));
const meta=await readJson(new URL('_meta.json',out),{});
const firstDate=(()=>{const d=new Date(taipeiToday+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-years);return iso(d)})();
const from=args.from||(meta.latest?iso(new Date(Date.parse(meta.latest+'T00:00:00Z')+86400000)):firstDate);

const series=new Map();
async function seriesFor(code,name){
  if(!series.has(code))series.set(code,(await loadSeries(code))||{code,name,rows:[],adjustments:[]});
  const s=series.get(code);if(name)s.name=name;return s;
}
let fetched=0,tradingDays=0,latest=meta.latest||null;
for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(taipeiToday+'T00:00:00Z');t+=86400000){
  const day=new Date(t);if(day.getUTCDay()===0||day.getUTCDay()===6)continue;
  const date=iso(day),{rows}=await etfDay(date);fetched++;
  if(!rows)continue;tradingDays++;latest=!latest||date>latest?date:latest;
  for(const [code,[o,h,l,c,v,,chg,name]] of Object.entries(rows)){
    if(!known.has(code))continue;
    const s=await seriesFor(code,name),prev=s.rows.at(-1);
    if(prev&&prev[0]>=date)continue;
    // The exchange quotes the change against the split-adjusted reference price, so prevClose/reference is the ratio.
    if(prev&&Number.isFinite(chg)&&c-chg>0){
      const factor=niceFactor(prev[4]/(c-chg));
      if(factor){
        // Preserve exchange-reported traded shares. Only the price axis is split-adjusted.
        for(const r of s.rows){r[1]=round(r[1]/factor);r[2]=round(r[2]/factor);r[3]=round(r[3]/factor);r[4]=round(r[4]/factor)}
        s.adjustments.push({date,factor});
        console.log(`${code}: split/merge factor ${factor} on ${date}`);
      }
    }
    s.rows.push([date,o,h,l,c,v]);
  }
  if(fetched%50===0)console.log(`… ${date} (${fetched} weekdays checked, ${series.size} ETFs touched)`);
}

for(const s of series.values()){
  const listing=catalog.etfs.find(x=>x.code===s.code);
  await writeFile(new URL(`${s.code}.json`,out),JSON.stringify({
    code:s.code,name:s.name,listingDate:listing?.listingDate||null,
    source:'TWSE MI_INDEX 每日收盤行情(ETF)',
    basis:s.adjustments.length?'split-adjusted':'raw-price',volumeBasis:'raw-traded-shares',adjustments:s.adjustments,
    first:s.rows[0]?.[0]||null,latest:s.rows.at(-1)?.[0]||null,
    fields:['date','open','high','low','close','volume'],rows:s.rows
  })+'\n');
}

/* ---------- Market (TAIEX + turnover) ---------- */
const marketFile=new URL('market.json',out),market=await readJson(marketFile,{rows:[]});
const roc=s=>{const m=String(s).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);return m?`${Number(m[1])+1911}-${m[2]}-${m[3]}`:null};
const lastMarket=market.rows.at(-1)?.[0]||firstDate;
const months=[];for(let d=new Date(lastMarket.slice(0,7)+'-01T00:00:00Z');iso(d)<=taipeiToday;d.setUTCMonth(d.getUTCMonth()+1))months.push(iso(d).slice(0,7));
const byDate=new Map(market.rows.map(r=>[r[0],r]));
for(const m of months){
  const data=await twse(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${m.replace('-','')}01&response=json`);
  if(data.stat!=='OK'||!Array.isArray(data.data))continue;
  for(const r of data.data){const date=roc(r[0]),volume=num(r[1]),value=num(r[2]),index=num(r[4]);if(date&&[volume,value,index].every(Number.isFinite))byDate.set(date,[date,volume,value,index])}
}
const marketRows=[...byDate.values()].sort((a,b)=>a[0].localeCompare(b[0]));
await writeFile(marketFile,JSON.stringify({source:'TWSE FMTQIK 市場成交資訊',fields:['date','volume','value','index'],first:marketRows[0]?.[0],latest:marketRows.at(-1)?.[0],rows:marketRows})+'\n');

const files=(await readdir(out)).filter(f=>/^[0-9A-Z]+\.json$/.test(f)&&f!=='market.json');
const actualLatest=(await Promise.all(files.map(async f=>{
  const code=f.slice(0,-5),s=series.get(code)||await readJson(new URL(f,out),null);
  return s?.rows?.at(-1)?.[0]||null;
}))).filter(Boolean).sort().at(-1)||null;
await writeFile(new URL('_meta.json',out),JSON.stringify({latest:actualLatest,updated:new Date().toISOString(),etfFiles:files.length,marketLatest:marketRows.at(-1)?.[0]||null})+'\n');
console.log(`History: ${tradingDays} trading days added through ${actualLatest}; ${series.size} ETF files written; market through ${marketRows.at(-1)?.[0]}.`);

// Bundled by scripts/build.mjs. The HTML placeholder is replaced at build time.
const PAGE = __PAGE__;
const ETF = [
  ['0050','元大台灣50','passive','大型權值'],
  ['0056','元大高股息','passive','高股息'],
  ['006208','富邦台50','passive','大型權值'],
  ['00878','國泰永續高股息','passive','高股息'],
  ['00919','群益台灣精選高息','passive','高股息'],
  ['00929','復華台灣科技優息','passive','科技高息'],
  ['00940','元大台灣價值高息','passive','高股息'],
  ['00980A','主動野村臺灣優選','active','主動台股'],
  ['00981A','主動統一台股增長','active','主動台股'],
  ['00982A','主動群益台灣強棒','active','主動台股'],
].map(([code,name,type,note])=>({code,name,type,note}));
const monthCache=new Map();
let brentCache=null;
let fxCache=null;
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':status===200?'public, max-age=300':'no-store','x-content-type-options':'nosniff'}})}
function num(v){const n=Number(String(v??'').replaceAll(',',''));return Number.isFinite(n)?n:null}
function rocDate(s){const m=String(s).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);return m?`${Number(m[1])+1911}-${m[2]}-${m[3]}`:null}
function months(count){const now=new Date(Date.now()+28800000),y=now.getUTCFullYear(),m=now.getUTCMonth();return Array.from({length:count},(_,i)=>{const d=new Date(Date.UTC(y,m-i,1));return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}01`})}
async function official(report,month,code){const key=`${report}/${month}/${code||''}`,old=monthCache.get(key);if(old&&Date.now()-old.time<21600000)return old.data;const url=new URL(`https://www.twse.com.tw/exchangeReport/${report}`);url.searchParams.set('response','json');url.searchParams.set('date',month);if(code)url.searchParams.set('stockNo',code);const res=await fetch(url,{headers:{accept:'application/json'},cf:{cacheTtl:3600,cacheEverything:true}});if(!res.ok)throw Error(`證交所 HTTP ${res.status}`);const data=await res.json();if(data.stat!=='OK'&&!/查無|很抱歉|沒有符合/.test(data.stat||''))throw Error(data.stat||'資料格式異常');monthCache.set(key,{time:Date.now(),data});return data}
async function pool(items,limit,fn){const out=new Array(items.length);let cur=0;await Promise.all(Array.from({length:limit},async()=>{while(cur<items.length){const i=cur++;try{out[i]=await fn(items[i])}catch(e){out[i]={error:e.message}}}}));return out}
function dedupSort(rows){return rows.sort((a,b)=>a.date.localeCompare(b.date)).filter((x,i,a)=>!i||x.date!==a[i-1].date)}
function barsFrom(raw){const rows=[];for(const data of raw){if(!Array.isArray(data?.data))continue;for(const r of data.data){const date=rocDate(r[0]),volume=num(r[1]),open=num(r[3]),high=num(r[4]),low=num(r[5]),close=num(r[6]);if(date&&[volume,open,high,low,close].every(Number.isFinite))rows.push({date,volume,open,high,low,close})}}return dedupSort(rows)}
function marketFrom(raw){const rows=[];for(const data of raw){if(!Array.isArray(data?.data))continue;for(const r of data.data){const date=rocDate(r[0]),volume=num(r[1]),value=num(r[2]),index=num(r[4]);if(date&&[volume,value,index].every(Number.isFinite))rows.push({date,volume,value,index})}}return dedupSort(rows)}
function adjust0050(code,rows){if(code!=='0050')return rows;return rows.map(b=>b.date<='2025-06-10'?{...b,open:b.open/4,high:b.high/4,low:b.low/4,close:b.close/4,volume:b.volume*4}:b)}
async function brentDaily(){
  if(brentCache&&Date.now()-brentCache.time<21600000)return brentCache.days;
  const res=await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU',{cf:{cacheTtl:3600,cacheEverything:true}});
  if(!res.ok)throw Error(`布蘭特資料 HTTP ${res.status}`);
  const text=await res.text(),days=[];
  for(const line of text.split(/\r?\n/).slice(1)){const [date,raw]=line.split(','),value=Number(raw);if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&raw!=='.'&&Number.isFinite(value))days.push({date,value})}
  if(!days.length)throw Error('布蘭特資料格式異常');
  brentCache={time:Date.now(),days:days.slice(-650)};
  return brentCache.days;
}
async function fxDaily(){
  if(fxCache&&Date.now()-fxCache.time<21600000)return fxCache.days;
  const res=await fetch('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day',{cf:{cacheTtl:3600,cacheEverything:true}});
  if(!res.ok)throw Error(`央行匯率 HTTP ${res.status}`);
  const data=await res.json(),days=[];
  for(const row of data){const raw=String(row['日期']||''),value=Number(row.NTD_USD);if(/^\d{8}$/.test(raw)&&Number.isFinite(value))days.push({date:`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`,value})}
  if(!days.length)throw Error('央行匯率格式異常');
  fxCache={time:Date.now(),days:days.slice(-650)};
  return fxCache.days;
}
export default {async fetch(request){const url=new URL(request.url),path=url.pathname;
  if(path==='/')return new Response(PAGE,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=600','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
  if(path==='/api/etfs')return json({etfs:ETF});
  if(path==='/api/brent'){try{const days=await brentDaily();return json({days,latest:days.at(-1).date,source:'EIA via FRED DCOILBRENTEU',unit:'USD/barrel'})}catch(e){return json({error:e.message},503)}}
  if(path==='/api/fx'){try{const days=await fxDaily();return json({days,latest:days.at(-1).date,source:'CBC FTDOpenData_Day',unit:'TWD/USD'})}catch(e){return json({error:e.message},503)}}
  if(path==='/api/bars'){
    const code=url.searchParams.get('code');if(!ETF.some(x=>x.code===code))return json({error:'此 ETF 尚未列入首批名單'},404);
    try{const raw=await pool(months(36),5,m=>official('STOCK_DAY',m,code)),bars=adjust0050(code,barsFrom(raw));if(!bars.length)throw Error('尚無有效日 K');return json({code,bars,latest:bars.at(-1).date,source:'TWSE STOCK_DAY',basis:'split-adjusted-price',missingMonths:raw.filter(x=>x?.error).length})}catch(e){return json({error:e.message},503)}
  }
  if(path==='/api/market'){
    try{const raw=await pool(months(36),5,m=>official('FMTQIK',m)),days=marketFrom(raw);if(!days.length)throw Error('尚無有效大盤資料');return json({days,latest:days.at(-1).date,source:'TWSE FMTQIK',missingMonths:raw.filter(x=>x?.error).length})}catch(e){return json({error:e.message},503)}
  }
  return new Response('Not found',{status:404});
}};
export const _test={num,rocDate,barsFrom,marketFrom,adjust0050};

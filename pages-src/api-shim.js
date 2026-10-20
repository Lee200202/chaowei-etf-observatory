// GitHub Pages is static: TWSE allows browser CORS, while EIA/CBC snapshots update daily.
window.CHAOWEI_STATIC=true;
const nativeFetch=window.fetch.bind(window),monthCache=new Map();
const response=data=>({ok:!data.error,status:data.error?503:200,json:async()=>data});
const n=v=>{const x=Number(String(v??'').replaceAll(',',''));return Number.isFinite(x)?x:null};
const roc=s=>{const m=String(s).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);return m?`${Number(m[1])+1911}-${m[2]}-${m[3]}`:null};
const months=(count,offset=0)=>{const now=new Date(Date.now()+28800000),y=now.getUTCFullYear(),m=now.getUTCMonth();return Array.from({length:count},(_,i)=>{const d=new Date(Date.UTC(y,m-i-offset,1));return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}01`})};
async function twse(report,date,code){
  const key=`${report}-${date}-${code||''}`,old=monthCache.get(key);if(old&&Date.now()-old.time<21600000)return old.data;
  const url=new URL(`https://www.twse.com.tw/exchangeReport/${report}`);url.searchParams.set('response','json');url.searchParams.set('date',date);if(code)url.searchParams.set('stockNo',code);
  const res=await nativeFetch(url);if(!res.ok)throw Error(`證交所 HTTP ${res.status}`);
  const data=await res.json();if(data.stat!=='OK'&&!/查無|很抱歉|沒有符合/.test(data.stat||''))throw Error(data.stat||'資料格式異常');
  monthCache.set(key,{time:Date.now(),data});return data;
}
async function pool(items,fn){const out=new Array(items.length);let index=0;await Promise.all(Array.from({length:5},async()=>{while(index<items.length){const i=index++;try{out[i]=await fn(items[i])}catch(e){out[i]={error:e.message}}}}));return out}
function sorted(rows){return rows.sort((a,b)=>a.date.localeCompare(b.date)).filter((x,i,a)=>!i||x.date!==a[i-1].date)}
function barsFrom(raw){const rows=[];for(const data of raw){if(!Array.isArray(data?.data))continue;for(const r of data.data){const date=roc(r[0]),volume=n(r[1]),open=n(r[3]),high=n(r[4]),low=n(r[5]),close=n(r[6]);if(date&&[volume,open,high,low,close].every(Number.isFinite))rows.push({date,volume,open,high,low,close})}}return sorted(rows)}
function marketFrom(raw){const rows=[];for(const data of raw){if(!Array.isArray(data?.data))continue;for(const r of data.data){const date=roc(r[0]),volume=n(r[1]),value=n(r[2]),index=n(r[4]);if(date&&[volume,value,index].every(Number.isFinite))rows.push({date,volume,value,index})}}return sorted(rows)}
async function api(path,params){
  if(path==='/api/etfs')return nativeFetch('./etf-catalog.json').then(r=>r.json());
  if(path==='/api/brent')return nativeFetch('./data/brent.json').then(r=>r.json());
  if(path==='/api/fx')return nativeFetch('./data/fx.json').then(r=>r.json());
  if(path==='/api/bars'){
    const code=params.get('code'),offset=Number(params.get('offset')||0),count=Number(params.get('count')||36);
    if(!/^[0-9A-Z]{4,6}$/.test(code||'')||!Number.isInteger(offset)||offset<0||offset>120||!Number.isInteger(count)||count<1||count>36)return{error:'查詢範圍錯誤'};
    const raw=await pool(months(count,offset),m=>twse('STOCK_DAY',m,code));let bars=barsFrom(raw);
    if(code==='0050')bars=bars.map(b=>b.date<='2025-06-10'?{...b,open:b.open/4,high:b.high/4,low:b.low/4,close:b.close/4,volume:b.volume*4}:b);
    return{code,bars,latest:bars.at(-1)?.date||null,source:'TWSE STOCK_DAY',basis:code==='0050'?'0050-split-adjusted':'raw-price',offset,count,missingMonths:raw.filter(x=>x?.error).length};
  }
  if(path==='/api/market'){
    const raw=await pool(months(36),m=>twse('FMTQIK',m)),days=marketFrom(raw);
    if(!days.length)return{error:'大盤資料暫不可用'};
    return{days,latest:days.at(-1).date,source:'TWSE FMTQIK',missingMonths:raw.filter(x=>x?.error).length};
  }
  return{error:'未知 API'};
}
window.fetch=(input,options)=>{const url=new URL(input,location.href);if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);return api(url.pathname,url.searchParams).then(response).catch(e=>response({error:e.message}))};

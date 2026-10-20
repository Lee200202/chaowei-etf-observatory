const CATALOG=__CATALOG__;
const BRENT_FALLBACK=__BRENT__;
const ETF=CATALOG.etfs;

function doGet(){return HtmlService.createHtmlOutputFromFile('Index').setTitle('潮位 ETF 觀測所')}
function num(v){const n=Number(String(v==null?'':v).replace(/,/g,''));return isFinite(n)?n:null}
function rocDate(s){const m=String(s).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);return m?`${Number(m[1])+1911}-${m[2]}-${m[3]}`:null}
function months(count,offset){const now=new Date(Date.now()+28800000),y=now.getUTCFullYear(),m=now.getUTCMonth();return Array.from({length:count},(_,i)=>{const d=new Date(Date.UTC(y,m-i-offset,1));return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}01`})}
function fetchMonths(report,dates,code){
  const cache=CacheService.getScriptCache(),out=new Array(dates.length),miss=[];
  dates.forEach((date,i)=>{const key=`twse-${report}-${date}-${code||'all'}`,cached=cache.get(key);if(cached){try{out[i]=JSON.parse(cached)}catch{miss.push({date,i,key})}}else miss.push({date,i,key})});
  for(let start=0;start<miss.length;start+=5){
    const batch=miss.slice(start,start+5),requests=batch.map(x=>({url:`https://www.twse.com.tw/exchangeReport/${report}?response=json&date=${x.date}${code?`&stockNo=${encodeURIComponent(code)}`:''}`,method:'get',muteHttpExceptions:true,headers:{Accept:'application/json'}}));
    let responses;try{responses=UrlFetchApp.fetchAll(requests)}catch(e){batch.forEach(x=>out[x.i]={error:String(e)});continue}
    responses.forEach((res,j)=>{const item=batch[j];try{if(res.getResponseCode()!==200)throw Error(`HTTP ${res.getResponseCode()}`);const data=JSON.parse(res.getContentText('UTF-8'));if(data.stat!=='OK'&&!/查無|很抱歉|沒有符合/.test(data.stat||''))throw Error(data.stat||'資料格式異常');out[item.i]=data;const value=JSON.stringify(data);if(value.length<95000)cache.put(item.key,value,21600)}catch(e){out[item.i]={error:String(e)}}});
  }
  return out;
}
function dedupSort(rows){return rows.sort((a,b)=>a.date.localeCompare(b.date)).filter((x,i,a)=>!i||x.date!==a[i-1].date)}
function barsFrom(raw){const rows=[];raw.forEach(data=>{if(!Array.isArray(data&&data.data))return;data.data.forEach(r=>{const date=rocDate(r[0]),volume=num(r[1]),open=num(r[3]),high=num(r[4]),low=num(r[5]),close=num(r[6]);if(date&&[volume,open,high,low,close].every(Number.isFinite))rows.push({date,volume,open,high,low,close})})});return dedupSort(rows)}
function marketFrom(raw){const rows=[];raw.forEach(data=>{if(!Array.isArray(data&&data.data))return;data.data.forEach(r=>{const date=rocDate(r[0]),volume=num(r[1]),value=num(r[2]),index=num(r[4]);if(date&&[volume,value,index].every(Number.isFinite))rows.push({date,volume,value,index})})});return dedupSort(rows)}
function adjust0050(code,rows){if(code!=='0050')return rows;return rows.map(b=>b.date<='2025-06-10'?{...b,open:b.open/4,high:b.high/4,low:b.low/4,close:b.close/4,volume:b.volume*4}:b)}
function parseEia(html){const month={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11},rows=[],re=/<td class=.B6.>\s*(?:&nbsp;)*\s*(\d{4})\s+([A-Za-z]{3})-\s*(\d{1,2})\s+to\s+[A-Za-z]{3}-\s*\d{1,2}<\/td>([\s\S]*?)<\/tr>/g;let m;while((m=re.exec(html))){const values=[...m[4].matchAll(/<td class=.B3.>(.*?)<\/td>/g)].map(x=>x[1]);for(let i=0;i<Math.min(5,values.length);i++){const value=Number(values[i]);if(values[i]&&isFinite(value)){const d=new Date(Date.UTC(Number(m[1]),month[m[2]],Number(m[3])+i));rows.push({date:d.toISOString().slice(0,10),value})}}}return rows}
function brentDaily(){const cache=CacheService.getScriptCache(),old=cache.get('brent-daily-v1');if(old)return JSON.parse(old);let result;try{const res=UrlFetchApp.fetch('https://www.eia.gov/dnav/pet/hist/rbrteD.htm',{muteHttpExceptions:true});if(res.getResponseCode()!==200)throw Error('EIA HTTP '+res.getResponseCode());const days=parseEia(res.getContentText('UTF-8')).slice(-650);if(days.length<600)throw Error('EIA 歷史筆數不足');result={days,latest:days[days.length-1].date,source:'EIA Brent daily table',snapshot:false,unit:'USD/barrel'}}catch{const days=BRENT_FALLBACK;result={days,latest:days[days.length-1].date,source:'EIA verified snapshot',snapshot:true,unit:'USD/barrel'}}cache.put('brent-daily-v1',JSON.stringify(result),21600);return result}
function fxDaily(){const cache=CacheService.getScriptCache(),old=cache.get('cbc-fx-v1');if(old)return JSON.parse(old);const res=UrlFetchApp.fetch('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day',{muteHttpExceptions:true});if(res.getResponseCode()!==200)throw Error('央行匯率 HTTP '+res.getResponseCode());const data=JSON.parse(res.getContentText('UTF-8')),days=[];data.forEach(row=>{const raw=String(row['日期']||''),value=Number(row.NTD_USD);if(/^\d{8}$/.test(raw)&&isFinite(value))days.push({date:`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`,value})});if(!days.length)throw Error('央行匯率格式異常');const result={days:days.slice(-650),latest:days[days.length-1].date,source:'CBC FTDOpenData_Day',unit:'TWD/USD'};cache.put('cbc-fx-v1',JSON.stringify(result),21600);return result}

function api(path,params){
  params=params||{};
  try{
    if(path==='/api/etfs')return CATALOG;
    if(path==='/api/brent')return brentDaily();
    if(path==='/api/fx')return fxDaily();
    if(path==='/api/bars'){
      const code=params.code,offset=Number(params.offset||0),count=Number(params.count||36);
      if(!ETF.some(x=>x.code===code))return{error:'此 ETF 不在目前證交所名錄'};
      if(!Number.isInteger(offset)||offset<0||offset>120||!Number.isInteger(count)||count<1||count>36)return{error:'歷史資料查詢範圍錯誤'};
      const raw=fetchMonths('STOCK_DAY',months(count,offset),code),bars=adjust0050(code,barsFrom(raw));
      return{code,bars,latest:bars.length?bars[bars.length-1].date:null,source:'TWSE STOCK_DAY',basis:code==='0050'?'0050-split-adjusted':'raw-price',offset,count,missingMonths:raw.filter(x=>x&&x.error).length};
    }
    if(path==='/api/market'){
      const raw=fetchMonths('FMTQIK',months(36,0)),days=marketFrom(raw);
      if(!days.length)throw Error('尚無有效大盤資料');return{days,latest:days[days.length-1].date,source:'TWSE FMTQIK',missingMonths:raw.filter(x=>x&&x.error).length};
    }
    return{error:'未知 API'};
  }catch(e){return{error:String(e&&e.message||e)}}
}

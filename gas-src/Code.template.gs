// 潮位 ETF 觀測所：Apps Script 入口。
// 網頁在瀏覽器直接讀 GitHub Pages 的每日快照（一檔 ETF 一個檔案）；瀏覽器讀不到時才由這裡代讀。
const PAGES_BASE='__PAGES_BASE__';
const ALLOWED=/^(etf-catalog\.json|data\/(brent|oil-spot|fx)\.json|data\/history\/(market|margin|holders|histock-bank|intraday-volume|dividends|radar|[0-9A-Z]{4,6})\.json|data\/chips\/[0-9A-Z]{4,6}\.json)$/;

function doGet(e){
  if(e&&e.parameter&&(e.parameter.api==='bank'||e.parameter.api==='holders')){
    let result;try{result=e.parameter.api==='bank'?getBankHistory():getHolderHistory(e.parameter.code)}catch(err){result={rows:[],error:String(err.message).slice(0,160)}}
    const cb=String(e.parameter.callback||'');
    if(/^__cwx_[A-Za-z0-9]{8,40}$/.test(cb))return ContentService.createTextOutput(cb+'('+JSON.stringify(result)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  if(e&&e.parameter&&e.parameter.api==='quote'){
    const result=getQuote(e.parameter.code);
    const callback=String(e.parameter.callback||'');
    if(/^__cwq_[A-Za-z0-9]{8,40}$/.test(callback))
      return ContentService.createTextOutput(callback+'('+JSON.stringify(result)+');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if(e&&e.parameter&&e.parameter.api==='store'){
    let status;try{status=storeStatus()}catch(err){status={ready:false,error:err.message}}
    return ContentService.createTextOutput(JSON.stringify(status)).setMimeType(ContentService.MimeType.JSON);
  }
  if(e&&e.parameter&&e.parameter.api==='popular'){
    let result;try{result=getPopular()}catch(err){result={codes:[]}}
    const callback=String(e.parameter.callback||'');
    if(/^__cwp_[A-Za-z0-9]{8,40}$/.test(callback))
      return ContentService.createTextOutput(callback+'('+JSON.stringify(result)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  if(e&&e.parameter&&e.parameter.api==='live'){
    const result=getLiveMarket();
    const callback=String(e.parameter.callback||'');
    if(/^__cwl_[A-Za-z0-9]{8,40}$/.test(callback))
      return ContentService.createTextOutput(callback+'('+JSON.stringify(result)+');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('潮位 ETF 觀測所｜看見 ETF 的現在位置')
    .addMetaTag('viewport','width=device-width,initial-scale=1');
}

// The key stays in Script Properties. Public display remains off until its licensed scope is checked.
function getQuote(code){
  code=String(code||'').toUpperCase();
  if(!/^[0-9A-Z]{4,6}$/.test(code))return{available:false,reason:'代號格式錯誤'};
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty('FUGLE_PUBLIC_DISPLAY_ENABLED')!=='true')
    return{available:false,reason:'盤中報價尚未啟用'};
  const key=props.getProperty('FUGLE_API_KEY');
  if(!key)return{available:false,reason:'行情金鑰尚未設定'};
  const catalog=readSnapshot('etf-catalog.json');
  if(!catalog.etfs||!catalog.etfs.some(x=>x.code===code))
    return{available:false,reason:'代號不在 ETF 名錄'};
  const cache=CacheService.getScriptCache(),cacheKey='fugle-quote-v1-'+code;
  const hit=cache.get(cacheKey);if(hit)return JSON.parse(hit);
  try{
    const url='https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/'+code;
    const res=UrlFetchApp.fetch(url,{headers:{'X-API-KEY':key},muteHttpExceptions:true});
    if(res.getResponseCode()!==200)return{available:false,reason:'富果行情 HTTP '+res.getResponseCode()};
    const q=JSON.parse(res.getContentText('UTF-8'));
    const price=Number(q.closePrice||q.lastTrade&&q.lastTrade.price);
    const micros=Number(q.closeTime||q.lastTrade&&q.lastTrade.time||q.lastUpdated);
    if(q.symbol!==code||!Number.isFinite(price)||price<=0||q.isTrial)
      return{available:false,reason:'尚無正式成交報價'};
    const result={available:true,code,date:String(q.date||''),price,
      time:Number.isFinite(micros)&&micros>0?new Date(Math.floor(micros/1000)).toISOString():null,
      previousClose:Number(q.previousClose)||null,open:Number(q.openPrice)||null,
      high:Number(q.highPrice)||null,low:Number(q.lowPrice)||null,
      volumeShares:Number(q.total&&q.total.tradeVolume)?Number(q.total.tradeVolume)*1000:null,
      source:'富果行情 API',isClose:!!q.isClose};
    cache.put(cacheKey,JSON.stringify(result),240);
    return result;
  }catch(err){return{available:false,reason:'行情來源暫不可用'}}
}

function readSnapshot(path){
  path=String(path||'');
  if(!ALLOWED.test(path))return{error:'不支援的資料路徑'};
  const cache=CacheService.getScriptCache(),key='snap-v2-'+path,hit=cache.get(key);
  if(hit)return JSON.parse(hit);
  const res=UrlFetchApp.fetch(PAGES_BASE+path,{muteHttpExceptions:true});
  if(res.getResponseCode()!==200)return{error:'快照 HTTP '+res.getResponseCode()};
  const text=res.getContentText('UTF-8');
  // CacheService 單筆上限 100KB；較大的十年檔每次直接讀 GitHub。
  if(text.length<95000)cache.put(key,text,600);
  return JSON.parse(text);
}

// 市場刻度的最新資料：盤中加權指數與累計成交量（證交所基本市況報導）、期交所 BRF 布蘭特期貨近月結算價、央行匯率。
// 整包快取 4 分鐘，所有訪客共用一次對外請求；前端每 5 分鐘讀一次。
function getLiveMarket(){
  const cache=CacheService.getScriptCache(),hit=cache.get('live-v4');
  if(hit)return JSON.parse(hit);
  const out={generated:new Date().toISOString(),intraday:null,brent:null,fx:null,store:false,errors:[]};
  const now=new Date(Date.now()+8*3600000),mins=now.getUTCHours()*60+now.getUTCMinutes(),day=now.getUTCDay();
  // The cloud spreadsheet is the first source; a direct read covers a missing or stale record.
  let stored=null;
  try{stored=liveFromStore_()}catch(err){out.errors.push('潮位資料庫：'+err.message)}
  if(stored){out.store=true;out.intraday=stored.intraday;out.brent=stored.brent;out.fx=stored.fx}
  if(!out.intraday&&day>=1&&day<=5&&mins>=9*60+1&&mins<=16*60){
    try{out.intraday=twseIntraday_(now.toISOString().slice(0,10))}catch(err){out.errors.push('證交所盤中統計：'+err.message)}
  }
  if(!out.brent)try{out.brent=brfNear_()}catch(err){out.errors.push('FinMind BRF：'+err.message)}
  if(!out.fx)try{out.fx=cbcFx_()}catch(err){out.errors.push('央行：'+err.message)}
  try{out.oil=oilSpot_()}catch(err){out.errors.push('FinMind 原油：'+err.message)}
  try{out.oilFuture=oilFuture_()}catch(err){out.errors.push('Yahoo 原油期貨：'+err.message)}
  cache.put('live-v4',JSON.stringify(out),240);
  return out;
}
function liveNum_(v){const n=Number(String(v==null?'':v).replace(/,/g,''));return isFinite(n)?n:null}
function twseIntraday_(date){
  // MI_5MINS is a post-close report. During trading it returns "沒有符合條件的資料".
  // Basic Market Information Reporting (MIS) publishes the current index and cumulative lots.
  const misUrl='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_='+Date.now();
  try{
    const misRes=UrlFetchApp.fetch(misUrl,{headers:{Referer:'https://mis.twse.com.tw/stock/'},muteHttpExceptions:true});
    if(misRes.getResponseCode()===200){
      const mis=JSON.parse(misRes.getContentText('UTF-8'));
      const row=(mis.msgArray||[]).filter(x=>x.c==='t00')[0];
      const time=String(row&&row.t||''),index=liveNum_(row&&row.z),lots=liveNum_(row&&row.m);
      if(row&&row.d===date.replace(/-/g,'')&&/^\d\d:\d\d:\d\d$/.test(time)&&index>0&&lots>0){
        const minute=Math.floor(Number(time.slice(3,5))/5)*5;
        const mark=time.slice(0,2)+String(minute).padStart(2,'0');
        return{date,time,index,volumeTime:time,lots,valueMillion:null,
          marks:{[mark]:lots},source:'證交所基本市況報導（盤中）'};
      }
    }
  }catch(err){} // MIS can fail briefly; the post-close report remains a fallback.
  // Once the exchange has published the post-close report, it provides the full day of marks.
  const d=date.replace(/-/g,'');
  const urls=['https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?date='+d+'&response=json','https://www.twse.com.tw/rwd/zh/afterTrading/MI_5MINS?date='+d+'&response=json'];
  const res=UrlFetchApp.fetchAll(urls.map(url=>({url,muteHttpExceptions:true})));
  res.forEach(r=>{if(r.getResponseCode()!==200)throw Error('HTTP '+r.getResponseCode())});
  const idx=JSON.parse(res[0].getContentText('UTF-8')),vol=JSON.parse(res[1].getContentText('UTF-8'));
  if(idx.stat!=='OK'||vol.stat!=='OK'||!idx.data||!vol.data||!idx.data.length||!vol.data.length)return null;
  const lastIdx=idx.data[idx.data.length-1],marks={};
  let last=null;
  vol.data.forEach(r=>{const t=String(r[0]),lots=liveNum_(r[6]);if(!(lots>0))return;last=r;if(/^\d\d:\d[05]:00$/.test(t))marks[t.slice(0,5).replace(':','')]=lots});
  if(!last)return null;
  return{date,time:String(lastIdx[0]),index:liveNum_(lastIdx[1]),volumeTime:String(last[0]),lots:liveNum_(last[6]),valueMillion:liveNum_(last[7]),marks,
    source:'證交所盤後每5秒指數及委託成交統計'};
}
// 期交所布蘭特原油期貨（BRF）近月結算價，新台幣／桶，經 FinMind 取得（網站須標示 FinMind）。
// 近月 = 每個交易日一般交易時段有結算價的最近單一月份契約。指令碼屬性 FINMIND_API_TOKEN 有設就放在標頭，沒設用匿名額度。
const BRF_SOURCE='FinMind／期交所 BRF 近月結算';
function brfNearRows_(rows){
  const byDate={};
  rows.forEach(r=>{
    if(r.trading_session!=='position'||!/^\d{6}$/.test(String(r.contract_date))||!(Number(r.settlement_price)>0))return;
    const best=byDate[r.date];
    if(!best||r.contract_date<best.contract)byDate[r.date]={date:r.date,value:Number(r.settlement_price),contract:String(r.contract_date)};
  });
  return Object.keys(byDate).sort().map(d=>byDate[d]);
}
function brfNear_(){
  const cache=CacheService.getScriptCache(),hit=cache.get('brf-near-live');if(hit)return JSON.parse(hit);
  const start=new Date(Date.now()+8*3600000-70*86400000).toISOString().slice(0,10);
  const token=String(PropertiesService.getScriptProperties().getProperty('FINMIND_API_TOKEN')||'').trim();
  const res=UrlFetchApp.fetch('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesDaily&data_id=BRF&start_date='+start,
    {headers:token?{Authorization:'Bearer '+token}:{},muteHttpExceptions:true});
  let body={};try{body=JSON.parse(res.getContentText('UTF-8'))}catch(err){}
  if(res.getResponseCode()!==200||body.status!==200||!Array.isArray(body.data))throw Error('HTTP '+res.getResponseCode()+' '+String(body.msg||'').slice(0,60));
  const days=brfNearRows_(body.data);
  if(days.length<20)throw Error('資料不足或格式變更');
  const last=days[days.length-1];
  const out={days:days.slice(-40),latest:last.date,contract:last.contract,source:BRF_SOURCE,unit:'TWD/barrel'};
  cache.put('brf-near-live',JSON.stringify(out),1200);
  return out;
}
function cbcFx_(){
  const cache=CacheService.getScriptCache(),hit=cache.get('cbc-fx-live');if(hit)return JSON.parse(hit);
  const res=UrlFetchApp.fetch('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day',{muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw Error('HTTP '+res.getResponseCode());
  const days=[];JSON.parse(res.getContentText('UTF-8')).forEach(r=>{const d=String(r['日期']||''),v=Number(r.NTD_USD);if(/^\d{8}$/.test(d)&&isFinite(v))days.push({date:d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6),value:v})});
  if(!days.length)throw Error('沒有資料');
  const out={days:days.slice(-40),latest:days[days.length-1].date,source:'CBC FTDOpenData_Day'};
  cache.put('cbc-fx-live',JSON.stringify(out),600);
  return out;
}

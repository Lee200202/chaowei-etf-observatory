// 潮位 ETF 觀測所：Apps Script 入口。
// 網頁在瀏覽器直接讀 GitHub Pages 的每日快照（一檔 ETF 一個檔案）；瀏覽器讀不到時才由這裡代讀。
const PAGES_BASE='https://lee200202.github.io/chaowei-etf-observatory/';
const ALLOWED=/^(etf-catalog\.json|data\/(brent|fx)\.json|data\/history\/(market|[0-9A-Z]{4,6})\.json)$/;

function doGet(e){
  if(e&&e.parameter&&e.parameter.api==='quote'){
    const result=getQuote(e.parameter.code);
    const callback=String(e.parameter.callback||'');
    if(/^__cwq_[A-Za-z0-9]{8,40}$/.test(callback))
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

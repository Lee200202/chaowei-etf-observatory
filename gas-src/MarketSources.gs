// Market-wide series. Tokens stay in Script Properties; only timestamps and values leave this backend.
// Brent daily closes from Yahoo Finance BZ=F (front-month futures, USD/barrel). A daily bar is stamped at
// midnight New York time; the bar still trading has no close and is left out. The page merges these recent days
// into the committed history, so a missed CI run is filled from here.
function oilSpot_(){
  const cache=CacheService.getScriptCache(),hit=cache.get('oil-yahoo-daily-v1');if(hit)return JSON.parse(hit);
  const r=UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?interval=1d&range=1mo',{muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw Error('Yahoo BZ=F 日線 HTTP '+r.getResponseCode());
  const d=JSON.parse(r.getContentText('UTF-8')),res=d.chart&&d.chart.result&&d.chart.result[0],m=res&&res.meta;
  if(!m||m.symbol!=='BZ=F'||m.currency!=='USD')throw Error('Yahoo BZ=F 日線格式異常');
  const t=res.timestamp||[],c=(res.indicators&&res.indicators.quote&&res.indicators.quote[0]&&res.indicators.quote[0].close)||[],days=[],seen={};
  for(let i=0;i<t.length;i++){
    const v=Number(c[i]);if(c[i]==null||!(v>0))continue;
    const at=new Date(t[i]*1000);if(Utilities.formatDate(at,'America/New_York','HH:mm')!=='00:00')continue;
    const date=Utilities.formatDate(at,'America/New_York','yyyy-MM-dd');if(seen[date])continue;seen[date]=true;
    days.push({date,value:Math.round(v*100)/100});
  }
  if(!days.length)throw Error('Yahoo BZ=F 沒有完成的日收盤');days.sort((x,y)=>x.date.localeCompare(y.date));
  const out={days,latest:days[days.length-1].date,source:'Yahoo Finance BZ=F',unit:'USD/barrel',frequency:'daily'};cache.put('oil-yahoo-daily-v1',JSON.stringify(out),240);return out;
}
function oilFuture_(){
  return yahooMarketQuote_('BZ=F','USD','USD/barrel');
}
function yahooMarketQuote_(symbol,currency,unit){
  const cache=CacheService.getScriptCache(),key='yahoo-market-v2-'+symbol,hit=cache.get(key);
  if(hit)return JSON.parse(hit);
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=5m&range=1d';
  const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('HTTP '+response.getResponseCode());
  const meta=JSON.parse(response.getContentText('UTF-8')).chart?.result?.[0]?.meta;
  if(!meta||meta.symbol!==symbol||meta.currency!==currency||!(meta.regularMarketPrice>0)||!(meta.regularMarketTime>0)){
    throw Error('報價格式異常');
  }
  const result={symbol,price:meta.regularMarketPrice,time:new Date(meta.regularMarketTime*1000).toISOString(),unit,
    source:'Yahoo Finance '+symbol,delayed:true,previousClose:meta.previousClose||meta.chartPreviousClose||null};
  cache.put(key,JSON.stringify(result),240);
  return result;
}
// Yahoo offers delayed five-minute bars. Use an opening bar only if it belongs to
// the quote's session and is inside its first 15 minutes (including the first published VIX value).
function yahooVixSession_(row){
  const meta=row?.meta,period=meta?.currentTradingPeriod?.regular;
  const last=meta?.regularMarketTime,price=meta?.regularMarketPrice;
  if(meta?.symbol!=='^VIX'||meta.currency!=='USD'||!(price>0)||!(period?.start>0)||
    !(period.end>period.start)||!(last>=period.start&&last<=period.end+60))return null;
  const opens=row.indicators?.quote?.[0]?.open||[],times=row.timestamp||[];
  const first=times.findIndex((time,i)=>time>=period.start&&time<=period.start+900&&time<=last&&opens[i]>0);
  if(first<0)return null;
  return {symbol:'^VIX',date:Utilities.formatDate(new Date(last*1000),'America/New_York','yyyy-MM-dd'),
    open:Math.round(opens[first]*100)/100,openTime:new Date(times[first]*1000).toISOString(),
    price,time:new Date(last*1000).toISOString(),endTime:new Date(period.end*1000).toISOString(),
    delayed:true,source:'Yahoo Finance ^VIX'};
}
function vixQuote_(){
  const response=UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=5m',{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('HTTP '+response.getResponseCode());
  return yahooVixSession_(JSON.parse(response.getContentText('UTF-8')).chart?.result?.[0]);
}
function getBankHistory(){
  const cache=CacheService.getScriptCache(),hit=cache.get('histock-bank-public-v1');if(hit)return JSON.parse(hit);
  const ss=store_(),sh=ss&&ss.getSheetByName(STORE_TABS.bank[0]);
  if(!sh||sh.getLastRow()<2)return{rows:[],error:'八大行庫資料尚未匯入'};
  const rows=storeTail_(sh,2700).map(r=>[r[0],liveNum_(r[1]),liveNum_(r[2])]).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r[0])&&r.slice(1).every(Number.isFinite)).sort((a,b)=>a[0].localeCompare(b[0]));
  const out={rows,latest:rows.length?rows[rows.length-1][0]:null,source:'HiStock 八大行庫全市場買賣總金額',unit:'億元',frequency:'daily'};
  if(JSON.stringify(out).length<95000)cache.put('histock-bank-public-v1',JSON.stringify(out),240);return out;
}

// A maximum of eight missing weeks per call keeps UI progress visible and execution bounded.
// Each query uses the site's ordinary session and form token. No challenge or access restriction is bypassed.
function tdccDates_(html){const a=[],rx=/<option value="(\d{8})"/g;let m;while((m=rx.exec(html)))a.push(m[1]);return a}
function tdccParse_(html,code,date){
  if(html.indexOf('value="'+date+'" selected')<0)throw Error('集保回傳日期不符');
  const levels={},tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let m,total=null;
  while((m=tr.exec(html))){const cells=[],td=/<td[^>]*>([\s\S]*?)<\/td>/gi;let c;while((c=td.exec(m[1])))cells.push(c[1].replace(/<[^>]*>/g,'').replace(/&[^;]+;/g,' ').trim());
    if(cells.length!==5||!/^\d+$/.test(cells[0]))continue;levels[Number(cells[0])]=cells;if(/合\s*計/.test(cells[1]))total=liveNum_(cells[3]);
  }
  if(!(total>0))throw Error('集保沒有這檔 ETF 的當週資料');
  let big=0,count=0;[12,13,14,15].forEach(n=>{if(!levels[n])throw Error('集保分級不足');big+=liveNum_(levels[n][3]);count+=liveNum_(levels[n][2])});
  const iso=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6);return[iso,code,storeRound_(big/total*100,2),storeRound_(liveNum_(levels[15][3])/total*100,2),count,liveNum_(levels[15][2])];
}
function tdccRows_(code,dates){
  const url='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
  const pages=UrlFetchApp.fetchAll(dates.map(()=>({url,muteHttpExceptions:true})));
  const queries=pages.map((r,i)=>{
    if(r.getResponseCode()!==200)throw Error('集保 HTTP '+r.getResponseCode());const html=r.getContentText('UTF-8'),match=html.match(/name="SYNCHRONIZER_TOKEN" value="([^"]+)/);if(!match)throw Error('集保表單暫不可用');
    const headers=r.getAllHeaders(),cookies=headers['Set-Cookie']||headers['set-cookie']||[],cookie=(Array.isArray(cookies)?cookies:[cookies]).map(c=>String(c).split(';')[0]).join('; ');
    return{url,method:'post',headers:{Cookie:cookie},payload:{SYNCHRONIZER_TOKEN:match[1],SYNCHRONIZER_URI:'/portal/zh/smWeb/qryStock',method:'submit',firDate:tdccDates_(html)[0],scaDate:dates[i],sqlMethod:'StockNo',stockNo:code,stockName:''},muteHttpExceptions:true};
  });
  return UrlFetchApp.fetchAll(queries).map((q,i)=>{if(q.getResponseCode()!==200)throw Error('集保查詢 HTTP '+q.getResponseCode());return tdccParse_(q.getContentText('UTF-8'),code,dates[i])});
}
function getHolderHistory(code){
  code=String(code||'').toUpperCase();if(!/^[0-9A-Z]{4,6}$/.test(code))return{rows:[],error:'代號格式錯誤'};
  const catalog=readSnapshot('etf-catalog.json'),etf=(catalog.etfs||[]).filter(x=>x.code===code)[0];if(!etf)return{rows:[],error:'不在 ETF 名錄'};
  const ss=store_();if(!ss)return{rows:[],error:'資料庫尚未啟用'};
  const sh=storeTab_(ss,'holders'),all=storeTail_(sh,60000),own=all.filter(r=>r[1]===code).map(r=>[r[0],r[1],Number(r[2]),Number(r[3]),Number(r[4]),Number(r[5])]);
  const url='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock',res=UrlFetchApp.fetch(url,{muteHttpExceptions:true});if(res.getResponseCode()!==200)return{rows:own,error:'集保暫不可用'};
  const dates=tdccDates_(res.getContentText('UTF-8')).filter(d=>!etf.listingDate||d>=etf.listingDate.replace(/-/g,'')),have={};own.forEach(r=>have[r[0].replace(/-/g,'')]=true);
  const missing=dates.filter(d=>!have[d]),batch=missing.slice(0,8),added=[];let error=null;
  for(let i=0;i<batch.length;i+=4){try{added.push.apply(added,tdccRows_(code,batch.slice(i,i+4)))}catch(e){error=String(e.message).slice(0,120);break}}
  if(added.length){const lock=LockService.getScriptLock();if(lock.tryLock(1000)){try{const exists={};storeTail_(sh,60000).forEach(r=>exists[r[0]+'|'+r[1]]=true);storeAppend_(sh,'holders',added.filter(r=>!exists[r[0]+'|'+r[1]]))}finally{lock.releaseLock()}}}
  const rows=own.concat(added).sort((a,b)=>a[0].localeCompare(b[0]));return{rows,code,hasMore:!error&&missing.length>added.length,totalWeeks:dates.length,error,source:'TDCC 官網一年歷史查詢'};
}

// Market-wide series. Tokens stay in Script Properties; only timestamps and values leave this backend.
function oilSpot_(){
  const cache=CacheService.getScriptCache(),hit=cache.get('oil-spot-v1');if(hit)return JSON.parse(hit);
  const since=new Date(Date.now()-35*86400000).toISOString().slice(0,10),token=String(storeProps_().getProperty('FINMIND_API_TOKEN')||'').trim();
  const r=UrlFetchApp.fetch('https://api.finmindtrade.com/api/v4/data?dataset=CrudeOilPrices&data_id=Brent&start_date='+since,{headers:token?{Authorization:'Bearer '+token}:{},muteHttpExceptions:true});
  const d=JSON.parse(r.getContentText('UTF-8'));if(r.getResponseCode()!==200||d.status!==200||!Array.isArray(d.data))throw Error('FinMind 原油 HTTP '+r.getResponseCode()+'：'+String(d.msg||'').slice(0,80));
  const days=d.data.filter(x=>x.name==='Brent'&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number(x.price)>0).map(x=>({date:x.date,value:Number(x.price)})).sort((a,b)=>a.date.localeCompare(b.date));
  if(!days.length)throw Error('FinMind Brent 沒有可用資料');
  const out={days,latest:days[days.length-1].date,source:'FinMind CrudeOilPrices Brent',unit:'USD/barrel',frequency:'daily'};cache.put('oil-spot-v1',JSON.stringify(out),240);return out;
}
function oilFuture_(){
  const cache=CacheService.getScriptCache(),hit=cache.get('oil-future-v1');if(hit)return JSON.parse(hit);
  const r=UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?interval=5m&range=1d',{muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw Error('Yahoo Brent HTTP '+r.getResponseCode());
  const d=JSON.parse(r.getContentText('UTF-8')),m=d.chart&&d.chart.result&&d.chart.result[0]&&d.chart.result[0].meta;
  if(!m||m.symbol!=='BZ=F'||m.currency!=='USD'||!(m.regularMarketPrice>0)||!(m.regularMarketTime>0))throw Error('Yahoo Brent 報價格式異常');
  const out={symbol:'BZ=F',price:m.regularMarketPrice,time:new Date(m.regularMarketTime*1000).toISOString(),unit:'USD/barrel',source:'Yahoo Finance Brent futures',delayed:true,previousClose:m.previousClose||m.chartPreviousClose||null};
  cache.put('oil-future-v1',JSON.stringify(out),240);return out;
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
function tdccRow_(code,date){
  const url='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock',r=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw Error('集保 HTTP '+r.getResponseCode());const html=r.getContentText('UTF-8'),match=html.match(/name="SYNCHRONIZER_TOKEN" value="([^"]+)/);if(!match)throw Error('集保表單暫不可用');
  const headers=r.getAllHeaders(),cookies=headers['Set-Cookie']||headers['set-cookie']||[],cookie=(Array.isArray(cookies)?cookies:[cookies]).map(c=>String(c).split(';')[0]).join('; ');
  const q=UrlFetchApp.fetch(url,{method:'post',headers:{Cookie:cookie},payload:{SYNCHRONIZER_TOKEN:match[1],SYNCHRONIZER_URI:'/portal/zh/smWeb/qryStock',method:'submit',firDate:tdccDates_(html)[0],scaDate:date,sqlMethod:'StockNo',stockNo:code,stockName:''},muteHttpExceptions:true});
  if(q.getResponseCode()!==200)throw Error('集保查詢 HTTP '+q.getResponseCode());return tdccParse_(q.getContentText('UTF-8'),code,date);
}
function getHolderHistory(code){
  code=String(code||'').toUpperCase();if(!/^[0-9A-Z]{4,6}$/.test(code))return{rows:[],error:'代號格式錯誤'};
  const catalog=readSnapshot('etf-catalog.json'),etf=(catalog.etfs||[]).filter(x=>x.code===code)[0];if(!etf)return{rows:[],error:'不在 ETF 名錄'};
  const ss=store_();if(!ss)return{rows:[],error:'資料庫尚未啟用'};
  const sh=storeTab_(ss,'holders'),all=storeTail_(sh,60000),own=all.filter(r=>r[1]===code).map(r=>[r[0],r[1],Number(r[2]),Number(r[3]),Number(r[4]),Number(r[5])]);
  const url='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock',res=UrlFetchApp.fetch(url,{muteHttpExceptions:true});if(res.getResponseCode()!==200)return{rows:own,error:'集保暫不可用'};
  const dates=tdccDates_(res.getContentText('UTF-8')).filter(d=>!etf.listingDate||d>=etf.listingDate.replace(/-/g,'')),have={};own.forEach(r=>have[r[0].replace(/-/g,'')]=true);
  const missing=dates.filter(d=>!have[d]),batch=missing.slice(0,8),added=[];let error=null;
  for(let i=0;i<batch.length;i++){try{added.push(tdccRow_(code,batch[i]))}catch(e){error=String(e.message).slice(0,120);break}}
  if(added.length){const lock=LockService.getScriptLock();if(lock.tryLock(1000)){try{const exists={};storeTail_(sh,60000).forEach(r=>exists[r[0]+'|'+r[1]]=true);storeAppend_(sh,'holders',added.filter(r=>!exists[r[0]+'|'+r[1]]))}finally{lock.releaseLock()}}}
  const rows=own.concat(added).sort((a,b)=>a[0].localeCompare(b[0]));return{rows,code,hasMore:!error&&missing.length>added.length,totalWeeks:dates.length,error,source:'TDCC 官網一年歷史查詢'};
}

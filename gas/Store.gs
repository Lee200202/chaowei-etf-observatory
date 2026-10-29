// 潮位資料庫：Google 試算表是市場資料的雲端主檔（盤中與歷史）。
// 第一次：在 Apps Script 編輯器選 setupStore 執行並授權；之後由排程維護，不需要任何本機電腦。
//   - 每 5 分鐘 captureIntraday：盤中（09:00–13:40）記錄加權指數與累計成交量；每小時順便更新原油與匯率。
//   - 每天 18 點 appendDaily：證交所 ETF 日 K、大盤日 K、同時段量能、期交所 BRF 布蘭特期貨近月、央行匯率。
//   - importStep：建檔時把 GitHub 上的十年歷史分批匯入，完成後自動移除自己的排程。
// 價格存交易所原始價；分割比例另列在「ETF分割紀錄」，需要還原時用它換算。

const STORE_MARKS=(()=>{const out=[];for(let m=9*60+5;m<=13*60+30;m+=5)out.push(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));return out})();
const STORE_TABS={
  readme:['說明',['項目','內容'],[]],
  intraday:['盤中大盤',['日期','資料時間','加權指數','累計成交量（張）','累計成交金額（百萬元）','5分鐘刻度','刻度累計量（張）','記錄時間'],[1,2,6,8]],
  profile:['同時段量能',['日期'].concat(STORE_MARKS),[1]],
  market:['大盤日K',['日期','成交股數','成交金額（元）','加權指數'],[1]],
  etf:['ETF日K',['日期','代號','開盤','最高','最低','收盤','成交股數'],[1,2]],
  splits:['ETF分割紀錄',['代號','生效日','比例','說明'],[1,2,4]],
  brent:['布蘭特原油',['日期','美元／桶'],[1]],// EIA 現貨舊資料，2026-10 起停止更新
  brf:['布蘭特期貨近月',['日期','結算價（新台幣／桶）','合約月份'],[1,3]],
  fx:['美元新台幣',['日期','新台幣／美元'],[1]],
  bank:['八大行庫總額',['日期','八大行庫買賣總金額（億元）','加權指數','來源','寫入時間'],[1,4,5]],
  holders:['ETF集保歷史',['日期','代號','400張以上比例','1000張以上比例','400張以上戶數','1000張以上戶數'],[1,2]],
  log:['更新紀錄',['時間','工作','結果'],[1,2,3]],
  usage:['使用紀錄',['時間','訪客','工作階段','事件','代號','搜尋字詞','停留秒數','裝置','網站','會員'],[1,2,3,4,5,6,8,9,10]]
};
const STORE_JOBS=['captureIntraday','appendDaily','importStep'];
const storeProps_=()=>PropertiesService.getScriptProperties();
const taipeiNow_=()=>new Date(Date.now()+8*3600000);
const taipeiDate_=()=>taipeiNow_().toISOString().slice(0,10);
const stamp_=()=>taipeiNow_().toISOString().slice(0,19).replace('T',' ');

function store_(){
  const id=storeProps_().getProperty('STORE_ID');
  if(!id)return null;
  try{return SpreadsheetApp.openById(id)}catch(err){return null}
}
// Dates and codes are stored as plain text so 0050 stays 0050 and dates are not turned into Date objects.
function storeTab_(ss,key){
  const [name,header,textCols]=STORE_TABS[key];
  let sh=ss.getSheetByName(name);
  if(!sh){
    sh=ss.insertSheet(name);
    if(sh.getMaxColumns()<header.length)sh.insertColumnsAfter(sh.getMaxColumns(),header.length-sh.getMaxColumns());
    if(sh.getMaxColumns()>header.length)sh.deleteColumns(header.length+1,sh.getMaxColumns()-header.length);
    const head=sh.getRange(1,1,1,header.length);head.setNumberFormat('@').setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    textCols.forEach(c=>sh.getRange(1,c,sh.getMaxRows(),1).setNumberFormat('@'));
  }
  return sh;
}
function storeAppend_(sh,key,rows){
  if(!rows.length)return 0;
  const textCols=STORE_TABS[key][2],width=rows[0].length,start=sh.getLastRow()+1,need=start+rows.length-1-sh.getMaxRows();
  if(need>0)sh.insertRowsAfter(sh.getMaxRows(),need);
  textCols.forEach(c=>sh.getRange(start,c,rows.length,1).setNumberFormat('@'));
  sh.getRange(start,1,rows.length,width).setValues(rows);
  return rows.length;
}
function storeTail_(sh,count){
  const last=sh.getLastRow();if(last<2)return[];
  const n=Math.min(count,last-1);
  return sh.getRange(last-n+1,1,n,sh.getLastColumn()).getDisplayValues();
}
function storeLog_(ss,job,result){
  try{storeAppend_(storeTab_(ss,'log'),'log',[[stamp_(),job,String(result).slice(0,480)]])}catch(err){}
  console.log(job+'：'+result);
}
function pagesJson_(path){
  const res=UrlFetchApp.fetch(PAGES_BASE+path,{muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw Error(path+' HTTP '+res.getResponseCode());
  return JSON.parse(res.getContentText('UTF-8'));
}
function storeRound_(v,d){const p=Math.pow(10,d);return Math.round(v*p)/p}
function storeFactor_(x){
  if(x>=1.5){const k=Math.round(x);return Math.abs(x/k-1)<0.03?k:storeRound_(x,4)}
  if(x<=0.67){const k=Math.round(1/x);return Math.abs(x*k-1)<0.03?storeRound_(1/k,6):storeRound_(x,6)}
  return null;
}

/** 在編輯器執行一次：建立試算表、分頁與排程，並開始匯入十年歷史。 */
function setupStore(){
  const props=storeProps_();
  let ss=store_();
  if(!ss){ss=SpreadsheetApp.create('潮位資料庫（ETF 盤中與歷史資料）');props.setProperty('STORE_ID',ss.getId())}
  Object.keys(STORE_TABS).filter(key=>key!=='brent').forEach(key=>storeTab_(ss,key));// 舊 EIA 分頁只保留在既有資料庫
  const blank=ss.getSheetByName('工作表1')||ss.getSheetByName('Sheet1');
  if(blank&&ss.getSheets().length>1)ss.deleteSheet(blank);
  storeReadme_(ss);
  ScriptApp.getProjectTriggers().forEach(t=>{if(STORE_JOBS.indexOf(t.getHandlerFunction())>=0)ScriptApp.deleteTrigger(t)});
  ScriptApp.newTrigger('captureIntraday').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('appendDaily').timeBased().everyDays(1).atHour(18).nearMinute(30).create();
  // Running setup again must not restart an import half way (that would duplicate rows).
  const imported=props.getProperty('STORE_IMPORT');
  if(imported!=='done'){
    if(!imported)props.setProperty('STORE_IMPORT',JSON.stringify({phase:'small',next:0}));
    ScriptApp.newTrigger('importStep').timeBased().everyMinutes(1).create();
  }
  storeLog_(ss,'setupStore','試算表與排程已建立：'+ss.getUrl());
  console.log('潮位資料庫：'+ss.getUrl());
  return ss.getUrl();
}
function storeReadme_(ss){
  const sh=storeTab_(ss,'readme'),rows=[
    ['用途','潮位 ETF 觀測所的雲端資料主檔：盤中與歷史市場資料。網站的即時刻度先讀這裡，十年歷史另有 GitHub 鏡像供網頁快速讀取。'],
    ['盤中大盤','交易日 09:00–13:40 每 5 分鐘記錄：證交所基本市況報導的即時加權指數與累計成交張數。'],
    ['同時段量能','每個交易日 54 個 5 分鐘刻度的累計成交量（張），用來和「過去交易日同一時刻」比較。'],
    ['大盤日K','證交所 FMTQIK：成交股數、成交金額、加權指數。'],
    ['ETF日K','證交所 MI_INDEX（type=0099P）每日收盤行情；價格為交易所原始價，未還原分割。'],
    ['ETF分割紀錄','由漲跌價差推算的分割／反分割比例；生效日以前的價格除以比例即為還原價。'],
    ['布蘭特原油','美國 EIA 現貨日價舊資料，2026-10 改用期交所 BRF 後停止更新。'],
    ['布蘭特期貨近月','期交所布蘭特原油期貨（BRF）近月每日結算價，新台幣／桶，資料來源 FinMind；網站的布蘭特參考線。'],
    ['美元新台幣','中央銀行每日收盤匯率。'],
    ['八大行庫總額','HiStock 圖表的全市場八大行庫買賣總金額，單位億元；不是逐檔 ETF 買賣超。私人研究分頁，平日約 23:15 單次更新。'],
    ['排程','captureIntraday 每 5 分鐘；appendDaily 每天 18:30 前後；importStep 只在建檔時分批匯入。'],
    ['網站','https://lee200202.github.io/chaowei-etf-observatory/'],
    ['最後更新',stamp_()]
  ];
  if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,2).clearContent();
  sh.getRange(2,1,rows.length,2).setNumberFormat('@').setValues(rows);
  sh.setColumnWidth(1,120);sh.setColumnWidth(2,720);
}

/** 建檔匯入：每分鐘一批，約十分鐘完成，完成後移除排程。 */
function importStep(){
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  const started=Date.now(),props=storeProps_(),ss=store_();
  try{
    let state;try{state=JSON.parse(props.getProperty('STORE_IMPORT')||'')}catch(err){state=null}
    if(!ss||!state||state==='done'||state.phase==='done'){storeStopImport_();return}
    if(state.phase==='small'){
      const market=pagesJson_('data/history/market.json'),profile=pagesJson_('data/history/intraday-volume.json');
      const brent=pagesJson_('data/brent.json'),fx=pagesJson_('data/fx.json');
      storeAppend_(storeTab_(ss,'market'),'market',market.rows.map(r=>[r[0],r[1],r[2],r[3]]));
      storeAppend_(storeTab_(ss,'profile'),'profile',profile.days.map(([d,lots])=>[d].concat(lots)));
      storeAppend_(storeTab_(ss,'brf'),'brf',brent.days.map(x=>[x.date,x.value,x.contract||'']));
      storeAppend_(storeTab_(ss,'fx'),'fx',fx.days.map(x=>[x.date,x.value]));
      state={phase:'etf',next:0,lastClose:{}};
      storeLog_(ss,'importStep','大盤 '+market.rows.length+' 日、同時段量能 '+profile.days.length+' 日、原油 '+brent.days.length+' 筆、匯率 '+fx.days.length+' 筆已匯入');
    }
    if(state.phase==='etf'){
      const codes=pagesJson_('etf-catalog.json').etfs.map(x=>x.code),sh=storeTab_(ss,'etf'),splitSh=storeTab_(ss,'splits');
      while(state.next<codes.length&&Date.now()-started<240000){
        const batch=codes.slice(state.next,state.next+20);
        const res=UrlFetchApp.fetchAll(batch.map(code=>({url:PAGES_BASE+'data/history/'+code+'.json',muteHttpExceptions:true})));
        const rows=[],splits=[];
        res.forEach((r,i)=>{
          if(r.getResponseCode()!==200)return;
          const d=JSON.parse(r.getContentText('UTF-8')),adj=d.adjustments||[];
          d.rows.forEach(([date,o,h,l,c,v])=>{
            // Files hold split-adjusted prices; multiply back to what the exchange printed that day.
            let f=1;adj.forEach(a=>{if(date<a.date)f*=a.factor});
            rows.push([date,batch[i],storeRound_(o*f,2),storeRound_(h*f,2),storeRound_(l*f,2),storeRound_(c*f,2),v]);
          });
          adj.forEach(a=>splits.push([batch[i],a.date,a.factor,a.factor>=1?'1 拆 '+a.factor:Math.round(1/a.factor)+' 合 1']));
          const last=d.rows[d.rows.length-1];if(last)state.lastClose[batch[i]]=[last[0],last[4]];
        });
        storeAppend_(sh,'etf',rows);storeAppend_(splitSh,'splits',splits);
        state.next+=batch.length;
      }
      if(state.next>=codes.length){
        props.setProperty('STORE_LAST_CLOSE',JSON.stringify(state.lastClose));
        props.setProperty('STORE_IMPORT','done');
        storeLog_(ss,'importStep','ETF 日 K 匯入完成，共 '+codes.length+' 檔、'+(sh.getLastRow()-1)+' 列');
        storeReadme_(ss);storeStopImport_();return;
      }
      storeLog_(ss,'importStep','ETF 匯入進度 '+state.next+'／'+codes.length);
    }
    props.setProperty('STORE_IMPORT',JSON.stringify(state));
  }catch(err){if(ss)storeLog_(ss,'importStep','錯誤：'+err.message);else console.log('importStep 錯誤：'+err.message)}
  finally{lock.releaseLock()}
}
function storeStopImport_(){ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='importStep')ScriptApp.deleteTrigger(t)})}

/** 每 5 分鐘：盤中記錄大盤；每小時順便更新原油與匯率。 */
function captureIntraday(){
  const ss=store_();if(!ss)return;
  const now=taipeiNow_(),mins=now.getUTCHours()*60+now.getUTCMinutes(),day=now.getUTCDay(),props=storeProps_();
  if(day>=1&&day<=5&&mins>=9*60+1&&mins<=13*60+40){
    try{
      const d=twseIntraday_(taipeiDate_());
      if(d){
        const sh=storeTab_(ss,'intraday'),last=storeTail_(sh,1)[0];
        if(!last||last[0]!==d.date||last[1]!==d.time){
          const keys=Object.keys(d.marks).sort(),mark=keys[keys.length-1]||'';
          storeAppend_(sh,'intraday',[[d.date,d.time,d.index,d.lots,d.valueMillion,mark?mark.slice(0,2)+':'+mark.slice(2):'',mark?d.marks[mark]:'',stamp_()]]);
        }
      }
    }catch(err){storeLog_(ss,'captureIntraday','盤中統計失敗：'+err.message)}
  }
  if(Date.now()-Number(props.getProperty('STORE_MACRO_AT')||0)>3600000){
    try{storeMacro_(ss);props.setProperty('STORE_MACRO_AT',String(Date.now()))}catch(err){storeLog_(ss,'captureIntraday','原油／匯率更新失敗：'+err.message)}
  }
}
function storeMacro_(ss){
  [['brf',brfNear_],['fx',cbcFx_]].forEach(([key,fetcher])=>{
    const sh=storeTab_(ss,key),last=(storeTail_(sh,1)[0]||[''])[0];
    let days=fetcher().days;
    // An empty BRF tab is first filled with the full history GitHub Pages already publishes.
    if(key==='brf'&&!last){try{const all=pagesJson_('data/brent.json');if(all.unit==='TWD/barrel')days=all.days.concat(days)}catch(err){}}
    const seen={},rows=[];
    days.forEach(x=>{if(x.date>last&&!seen[x.date]){seen[x.date]=true;rows.push(key==='brf'?[x.date,x.value,x.contract||'']:[x.date,x.value])}});
    rows.sort((a,b)=>a[0].localeCompare(b[0]));
    if(rows.length)storeLog_(ss,'macro',STORE_TABS[key][0]+' 新增 '+storeAppend_(sh,key,rows)+' 筆');
  });
}

/** 每天 18:30 前後：當日 ETF 日 K、大盤、同時段量能、原油與匯率。 */
function appendDaily(){
  const ss=store_();if(!ss)return;
  if(storeProps_().getProperty('STORE_IMPORT')!=='done'){storeLog_(ss,'appendDaily','歷史匯入尚未完成，今日略過');return}
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))return;
  const today=taipeiDate_(),d=today.replace(/-/g,''),notes=[];
  try{
    // ETF 日 K（交易所原始價）與分割偵測。
    const etfSh=storeTab_(ss,'etf'),lastDate=(storeTail_(etfSh,1)[0]||[''])[0];
    if(lastDate<today){
      const mi=JSON.parse(UrlFetchApp.fetch('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date='+d+'&type=0099P&response=json',{muteHttpExceptions:true}).getContentText('UTF-8'));
      const table=(mi.tables||[]).filter(t=>t.fields&&t.fields[0]==='證券代號'&&t.fields.indexOf('收盤價')>=0)[0];
      if(mi.stat==='OK'&&table){
        const f=n=>table.fields.indexOf(n),known={},lastClose=JSON.parse(storeProps_().getProperty('STORE_LAST_CLOSE')||'{}'),rows=[],splits=[];
        pagesJson_('etf-catalog.json').etfs.forEach(x=>known[x.code]=true);
        table.data.forEach(r=>{
          const code=String(r[f('證券代號')]).trim();if(!known[code])return;
          const o=liveNum_(r[f('開盤價')]),h=liveNum_(r[f('最高價')]),l=liveNum_(r[f('最低價')]),c=liveNum_(r[f('收盤價')]),v=liveNum_(r[f('成交股數')]);
          if([o,h,l,c,v].some(x=>x==null)||c<=0)return;
          const sign=/-/.test(String(r[f('漲跌(+/-)')]).replace(/<[^>]+>/g,''))?-1:1,chg=liveNum_(r[f('漲跌價差')]),prev=lastClose[code];
          if(prev&&chg!=null&&c-sign*chg>0){const k=storeFactor_(prev[1]/(c-sign*chg));if(k)splits.push([code,today,k,k>=1?'1 拆 '+k:Math.round(1/k)+' 合 1'])}
          rows.push([today,code,o,h,l,c,v]);lastClose[code]=[today,c];
        });
        storeAppend_(etfSh,'etf',rows);storeAppend_(storeTab_(ss,'splits'),'splits',splits);
        storeProps_().setProperty('STORE_LAST_CLOSE',JSON.stringify(lastClose));
        notes.push('ETF 日 K '+rows.length+' 檔'+(splits.length?'、分割 '+splits.map(s=>s[0]+' '+s[3]).join('、'):''));
      }else notes.push('今日非交易日或證交所尚未公布 ETF 行情');
    }
    // 大盤日 K。
    const mkSh=storeTab_(ss,'market'),mkLast=(storeTail_(mkSh,1)[0]||[''])[0];
    const fm=JSON.parse(UrlFetchApp.fetch('https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date='+d.slice(0,6)+'01&response=json',{muteHttpExceptions:true}).getContentText('UTF-8'));
    const mkRows=(fm.data||[]).map(r=>{const m=String(r[0]).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);return m?[(Number(m[1])+1911)+'-'+m[2]+'-'+m[3],liveNum_(r[1]),liveNum_(r[2]),liveNum_(r[4])]:null}).filter(r=>r&&r[0]>mkLast&&r[3]!=null);
    notes.push('大盤 '+storeAppend_(mkSh,'market',mkRows)+' 日');
    // 同時段量能（今天 54 個刻度）。
    const pfSh=storeTab_(ss,'profile'),pfLast=(storeTail_(pfSh,1)[0]||[''])[0];
    if(pfLast<today){
      const m5=JSON.parse(UrlFetchApp.fetch('https://www.twse.com.tw/rwd/zh/afterTrading/MI_5MINS?date='+d+'&response=json',{muteHttpExceptions:true}).getContentText('UTF-8'));
      if(m5.stat==='OK'&&m5.data&&m5.data.length){
        const at={};m5.data.forEach(r=>{at[String(r[0]).slice(0,5)]=liveNum_(r[6])});
        const lots=STORE_MARKS.map(k=>at[k]);for(let i=1;i<lots.length;i++)if(lots[i]==null)lots[i]=lots[i-1];
        if(lots.every(x=>x!=null)){storeAppend_(pfSh,'profile',[[today].concat(lots)]);notes.push('同時段量能 1 日')}
      }
    }
    storeMacro_(ss);storeProps_().setProperty('STORE_MACRO_AT',String(Date.now()));
    storeReadme_(ss);storeLog_(ss,'appendDaily',notes.join('；'));
  }catch(err){storeLog_(ss,'appendDaily','錯誤：'+err.message)}
  finally{lock.releaseLock()}
}

/* ---------- 匿名使用紀錄：一個事件一列；不收姓名、email 或 IP ---------- */
const USAGE_EVENTS=['visit','search','select','view','leave'];
function usageClean_(e){
  if(!e||typeof e!=='object')return null;
  const id=v=>/^[A-Za-z0-9-]{8,40}$/.test(String(v||''))?String(v):'';
  const type=String(e.type||'');if(USAGE_EVENTS.indexOf(type)<0||!id(e.sid)||!id(e.vid))return null;
  // Free text is trimmed, stripped of control characters and kept from starting a spreadsheet formula.
  let q=String(e.query||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,40);if(/^[=+\-@]/.test(q))q="'"+q;
  const code=/^[0-9A-Z]{4,6}$/.test(String(e.code||''))?String(e.code):'';
  const sec=Math.max(0,Math.min(86400,Math.round(Number(e.seconds)||0)));
  return[stamp_(),id(e.vid),id(e.sid),type,code,q,sec,e.device==='mobile'?'mobile':'desktop',e.host==='gas'?'gas':'pages',e.member?'Y':''];
}
function logEvent(e){
  const row=usageClean_(e);if(!row)return{ok:false};
  // At most 60 events a minute per browsing session.
  const cache=CacheService.getScriptCache(),key='usage-rate-'+row[2],n=Number(cache.get(key)||0);if(n>=60)return{ok:false,limited:true};cache.put(key,String(n+1),60);
  const ss=store_();if(!ss)return{ok:false};
  storeTab_(ss,'usage').appendRow(row);
  return{ok:true};
}
function doPost(e){
  const action=e&&e.parameter&&e.parameter.action;
  if(action==='aiChat'||action==='aiFeedback'||action==='aiResult')return quantPost_(e);
  let body=null;try{body=JSON.parse(e&&e.postData&&e.postData.contents||'')}catch(err){}
  const list=Array.isArray(body)?body.slice(0,20):[body];list.forEach(x=>logEvent(x));
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}
/** 近 30 天最常被查看的 ETF（選取與停留事件），快取 10 分鐘。 */
function getPopular(){
  const cache=CacheService.getScriptCache(),hit=cache.get('popular-v1');if(hit)return JSON.parse(hit);
  const ss=store_();if(!ss)return{codes:[]};
  const since=new Date(Date.now()+8*3600000-30*86400000).toISOString().slice(0,10),count={};
  storeTail_(storeTab_(ss,'usage'),8000).forEach(r=>{if(r[0].slice(0,10)<since||!r[4])return;if(r[3]==='select')count[r[4]]=(count[r[4]]||0)+3;else if(r[3]==='view'&&Number(r[6])>=10)count[r[4]]=(count[r[4]]||0)+1});
  const out={since,codes:Object.keys(count).sort((a,b)=>count[b]-count[a]).slice(0,10)};
  cache.put('popular-v1',JSON.stringify(out),600);return out;
}

/** 公開的唯讀狀態：各分頁列數、最新日期與匯入進度（不含試算表網址）。 */
function storeStatus(){
  const ss=store_();if(!ss)return{ready:false};
  const raw=storeProps_().getProperty('STORE_IMPORT');let progress=raw;
  try{const s=JSON.parse(raw);progress={phase:s.phase,next:s.next}}catch(err){}
  const tabs={};
  Object.keys(STORE_TABS).forEach(k=>{const name=STORE_TABS[k][0],sh=ss.getSheetByName(name);if(!sh)return;const last=sh.getLastRow();
    tabs[name]={rows:Math.max(0,last-1),latest:last>1&&k!=='readme'?sh.getRange(last,1).getDisplayValue():null}});
  return{ready:true,import:progress,triggers:ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction()),tabs};
}

/** 網站的即時刻度：從試算表讀最新盤中、原油與匯率；資料不新時回傳 null 交由直接讀取。 */
function liveFromStore_(){
  const ss=store_();if(!ss)return null;
  const out={intraday:null,brent:null,fx:null};
  const today=taipeiDate_(),rows=storeTail_(storeTab_(ss,'intraday'),70).filter(r=>r[0]===today);
  if(rows.length){
    const last=rows[rows.length-1],recorded=Date.parse(last[7].replace(' ','T')+'+08:00'),marks={};
    rows.forEach(r=>{if(r[5]&&r[6]!=='')marks[r[5].replace(':','')]=liveNum_(r[6])});
    // Validate the source time as well as the insertion time: a fresh row can contain an old MIS response.
    const mins=taipeiNow_().getUTCHours()*60+taipeiNow_().getUTCMinutes();
    const sourceAt=Date.parse(today+'T'+last[1]+'+08:00'),sourceMins=Number(String(last[1]).slice(0,2))*60+Number(String(last[1]).slice(3,5));
    const fresh=mins>13*60+40?sourceMins>=13*60+30:Date.now()-recorded<6*60000&&Date.now()-sourceAt<6*60000;
    if(fresh)
      out.intraday={date:last[0],time:last[1],index:liveNum_(last[2]),volumeTime:last[1],lots:liveNum_(last[3]),valueMillion:liveNum_(last[4]),marks,source:'潮位資料庫（證交所基本市況報導）'};
  }
  [['brent','brf',BRF_SOURCE,'TWD/barrel'],['fx','fx','CBC FTDOpenData_Day','TWD/USD']].forEach(([key,tab,source,unit])=>{
    const days=storeTail_(storeTab_(ss,tab),40).map(r=>({date:r[0],value:liveNum_(r[1])})).filter(x=>x.value!=null);
    if(days.length)out[key]={days,latest:days[days.length-1].date,source:source+'（潮位資料庫）',unit};
  });
  return out;
}

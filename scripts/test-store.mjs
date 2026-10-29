// Offline test of the cloud spreadsheet store (gas/Store.gs) against an in-memory spreadsheet.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const code=await readFile(new URL('../gas/Code.gs',import.meta.url),'utf8')+'\n'+await readFile(new URL('../gas/Store.gs',import.meta.url),'utf8');

/* ---------- fake Google services ---------- */
function fakeSheet(name){
  const sh={name,rows:[],maxRows:1000,maxCols:26,frozen:0,
    getMaxRows:()=>sh.maxRows,getMaxColumns:()=>sh.maxCols,
    insertRowsAfter:(_,n)=>{sh.maxRows+=n},insertColumnsAfter:(_,n)=>{sh.maxCols+=n},deleteColumns:(from,n)=>{sh.maxCols-=n},
    setFrozenRows:n=>{sh.frozen=n},setColumnWidth:()=>{},getName:()=>name,
    appendRow:row=>{const r=sh.getLastRow();if(r+1>sh.maxRows)sh.maxRows++;sh.rows[r]=row.slice()},
    getLastRow:()=>{let n=sh.rows.length;while(n&&!sh.rows[n-1]?.some(v=>v!==''&&v!=null))n--;return n},
    getLastColumn:()=>Math.max(0,...sh.rows.map(r=>r.length)),
    getRange:(r,c,nr=1,nc=1)=>{
      if(r+nr-1>sh.maxRows)throw Error(`row ${r+nr-1} beyond max ${sh.maxRows}`);
      const range={
        setNumberFormat:()=>range,setFontWeight:()=>range,
        setValues:values=>{assert.equal(values.length,nr);values.forEach((row,i)=>{assert.equal(row.length,nc);const t=(sh.rows[r-1+i]||=[]);row.forEach((v,j)=>t[c-1+j]=v)});return range},
        getDisplayValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>{const v=sh.rows[r-1+i]?.[c-1+j];return v==null?'':String(v)})),
        clearContent:()=>{for(let i=0;i<nr;i++)for(let j=0;j<nc;j++)if(sh.rows[r-1+i])sh.rows[r-1+i][c-1+j]='';return range}
      };return range;
    }};
  return sh;
}
const spreadsheets=[];
function fakeSpreadsheet(title){
  const sheets=[fakeSheet('工作表1')],ss={title,sheets,
    getId:()=>'SHEET-ID',getUrl:()=>'https://docs.google.com/spreadsheets/d/SHEET-ID',
    getSheetByName:n=>sheets.find(s=>s.name===n)||null,insertSheet:n=>{const s=fakeSheet(n);sheets.push(s);return s},
    getSheets:()=>sheets,deleteSheet:s=>sheets.splice(sheets.indexOf(s),1)};
  spreadsheets.push(ss);return ss;
}
const props=new Map(),cache=new Map(),triggers=[];
const files={
  'etf-catalog.json':{etfs:[{code:'0050'},{code:'009816'}]},
  'data/history/market.json':{rows:[['2026-10-16',1e10,5e11,46000],['2026-10-19',1.1e10,5.2e11,46500]]},
  'data/history/intraday-volume.json':{marks:[],days:[['2026-10-19',Array.from({length:54},(_,i)=>100000*(i+1))]]},
  'data/brent.json':{unit:'TWD/barrel',days:[{date:'2026-09-01',value:3200,contract:'202610'},{date:'2026-09-02',value:3210,contract:'202610'}]},
  'data/fx.json':{days:[{date:'2026-10-19',value:32.445}]},
  // Split-adjusted history: 0050 split 1→4 on 2025-06-18, so the 2025-06-17 bar is 188/4.
  'data/history/0050.json':{adjustments:[{date:'2025-06-18',factor:4}],rows:[['2025-06-17',47,47.5,46.75,47.1,1000],['2025-06-18',47.2,47.6,47,47.57,9000],['2026-10-19',108,108.5,107.5,108.15,5000]]},
  'data/history/009816.json':{adjustments:[],rows:[['2026-10-19',16,16.2,15.9,16.07,1000]]}
};
// FinMind TaiwanFuturesDaily BRF: 25 weekdays to 2026-10-16. Each day has the near (202611) and next (202612) month,
// a spread order and a night-session row; on 2026-10-07 the near month has no settlement price, so 202612 is used.
const brfDays=[];for(let t=Date.parse('2026-09-14T00:00:00Z');brfDays.length<25;t+=86400000){const d=new Date(t);if(d.getUTCDay()%6)brfDays.push(d.toISOString().slice(0,10))}
const brfRows=brfDays.flatMap((date,i)=>[
  {date,contract_date:'202611',trading_session:'position',settlement_price:date==='2026-10-07'?0:3400+i},
  {date,contract_date:'202612',trading_session:'position',settlement_price:3300+i},
  {date,contract_date:'202611/202612',trading_session:'position',settlement_price:1},
  {date,contract_date:'202610',trading_session:'after_market',settlement_price:0}]);
let fetchLog=[],twseToday=null;
const response=(body,status=200)=>({getResponseCode:()=>status,getContentText:()=>typeof body==='string'?body:JSON.stringify(body)});
function serve(url){
  fetchLog.push(url);
  const pages='https://lee200202.github.io/chaowei-etf-observatory/';
  if(url.startsWith(pages)){const f=files[url.slice(pages.length)];return f?response(f):response('',404)}
  if(url.includes('MI_INDEX'))return response(twseToday);
  if(url.includes('FMTQIK'))return response({stat:'OK',data:[['115/10/19','11,000,000,000','520,000,000,000','0','46,500.00'],['115/10/20','11,310,000,000','758,684,000,000','0','46,292.93']]});
  if(url.includes('MI_5MINS_INDEX'))return response({stat:'OK',data:[['09:00:00','46,822.08'],['10:12:05','46,700.10']]});
  if(url.includes('MI_5MINS'))return response({stat:'OK',data:[['09:05:00','1','1','1','1','1','867,021','78,527'],['10:10:00','1','1','1','1','1','3,000,000','200,000'],['10:12:05','1','1','1','1','1','3,100,000','205,000']]});
  if(url.includes('finmindtrade.com')&&url.includes('data_id=BRF'))return response({status:200,msg:'success',data:brfRows});
  if(url.includes('cbc.gov.tw'))return response([{'日期':'20261019',NTD_USD:'32.445'},{'日期':'20261020',NTD_USD:'32.401'}]);
  return response('',404);
}
let clock=Date.parse('2026-10-20T02:12:30Z');// 10:12:30 in Taipei
const RealDate=Date;
class FakeDate extends RealDate{constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}}
const box={JSON,String,Number,Math,Object,Array,Error,RegExp,isFinite,console:{log:()=>{}},Date:FakeDate,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.has(k)?props.get(k):null,setProperty:(k,v)=>props.set(k,String(v)),deleteProperty:k=>props.delete(k)})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  SpreadsheetApp:{create:fakeSpreadsheet,openById:id=>{const s=spreadsheets.find(x=>x.getId()===id);if(!s)throw Error('no sheet');return s}},
  ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),
    newTrigger:fn=>{const b={timeBased:()=>b,everyMinutes:()=>b,everyDays:()=>b,atHour:()=>b,nearMinute:()=>b,create:()=>{const t={getHandlerFunction:()=>fn};triggers.push(t);return t}};return b}},
  UrlFetchApp:{fetch:url=>serve(url),fetchAll:reqs=>reqs.map(r=>serve(r.url))},
  HtmlService:{createHtmlOutputFromFile:()=>({setTitle(){return this},addMetaTag(){return this}})},
  ContentService:{MimeType:{JAVASCRIPT:'js',JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this}})}};
vm.createContext(box);vm.runInContext(code,box);
const tab=name=>spreadsheets[0].getSheetByName(name);

/* ---------- setup and import ---------- */
const url=box.setupStore();
assert.match(url,/SHEET-ID/);
assert.deepEqual(triggers.map(t=>t.getHandlerFunction()).sort(),['appendDaily','captureIntraday','importStep']);
assert.equal(spreadsheets[0].getSheetByName('工作表1'),null,'default blank tab removed');
box.setupStore();
assert.equal(triggers.filter(t=>t.getHandlerFunction()==='importStep').length,1,'setup twice keeps one import trigger');
for(let i=0;i<5&&props.get('STORE_IMPORT')!=='done';i++)box.importStep();
assert.equal(props.get('STORE_IMPORT'),'done');
assert.equal(triggers.some(t=>t.getHandlerFunction()==='importStep'),false,'import trigger removes itself');
const etf=tab('ETF日K').rows;
assert.deepEqual(etf[0],['日期','代號','開盤','最高','最低','收盤','成交股數']);
assert.deepEqual(etf[1],['2025-06-17','0050',188,190,187,188.4,1000],'pre-split bar restored to the price printed that day');
assert.deepEqual(etf[2].slice(0,6),['2025-06-18','0050',47.2,47.6,47,47.57]);
assert.equal(etf.length,5);
assert.deepEqual(tab('ETF分割紀錄').rows[1],['0050','2025-06-18',4,'1 拆 4']);
assert.equal(tab('大盤日K').rows.length,3);assert.equal(tab('同時段量能').rows[1].length,55);
assert.deepEqual(JSON.parse(props.get('STORE_LAST_CLOSE'))['0050'],['2026-10-19',108.15]);

/* ---------- intraday capture and the site's live read ---------- */
box.captureIntraday();box.captureIntraday();
const intra=tab('盤中大盤').rows;
assert.equal(intra.length,2,'same data time is recorded once');
assert.deepEqual(intra[1].slice(0,7),['2026-10-20','10:12:05',46700.1,3100000,205000,'10:10',3000000]);
assert.equal(tab('美元新台幣').rows.at(-1)[0],'2026-10-20','hourly macro refresh appends the new CBC day');
const live=box.liveFromStore_();
assert.equal(live.intraday.index,46700.1);assert.equal(live.intraday.marks['1010'],3000000);assert.equal(live.intraday.lots,3100000);
assert.equal(live.fx.latest,'2026-10-20');assert.equal(live.brent.latest,'2026-10-16');assert.equal(live.brent.unit,'TWD/barrel');
const brf=tab('布蘭特期貨近月').rows;
assert.deepEqual(brf[0],['日期','結算價（新台幣／桶）','合約月份']);
assert.deepEqual(brf[1],['2026-09-01',3200,'202610'],'history imported from the published BRF snapshot');
assert.equal(brf.length,1+2+25,'every FinMind trading day after the imported history, once');
assert.deepEqual(brf.find(r=>r[0]==='2026-10-07').slice(1),[3317,'202612'],'near month without a settlement falls to the next month');
assert.deepEqual(brf.at(-1),['2026-10-16',3424,'202611'],'spread orders and night-session rows are ignored');
assert.equal(tab('布蘭特原油'),null,'the retired EIA tab is not created for a new store');
cache.clear();const bundle=box.getLiveMarket();
assert.equal(bundle.store,true);assert.equal(bundle.intraday.time,'10:12:05');
// A stalled trigger (record older than 6 minutes during trading) falls back to a direct read.
clock+=7*60000;cache.clear();fetchLog=[];
assert.equal(box.liveFromStore_().intraday,null);
assert.ok(box.getLiveMarket().intraday);assert.ok(fetchLog.some(u=>u.includes('MI_5MINS')));
// A newly written stale source must not pass freshness just because its insertion time is recent.
const savedRecord=intra[1].slice();intra[1][7]=new Date(clock+28800000).toISOString().slice(0,19).replace('T',' ');
assert.equal(box.liveFromStore_().intraday,null,'source time, not insertion time, must be fresh');
// After the close, an incomplete 13:10 record must fall back to the official final market report.
clock=Date.parse('2026-10-20T05:50:00Z');intra[1][1]='13:10:00';intra[1][7]=new Date(clock+28800000).toISOString().slice(0,19).replace('T',' ');
assert.equal(box.liveFromStore_().intraday,null,'13:10 is not a complete market close');
intra[1][1]='13:33:00';assert.ok(box.liveFromStore_().intraday,'final 13:33 record is reusable after close');
intra[1]=savedRecord;

/* ---------- daily append with a split ---------- */
clock=Date.parse('2026-10-20T10:30:00Z');// 18:30 Taipei
const row=(code,o,h,l,c,v,sign,chg)=>[code,code,v,'1','1',o,h,l,c,sign,chg];
twseToday={stat:'OK',tables:[{fields:['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價','漲跌(+/-)','漲跌價差'],
  data:[row('0050','27.00','27.20','26.90','27.10','8,000,000','<p style= color:red>+</p>','0.06'),row('009816','15.95','16.00','15.90','15.93','2,000,000','<p style= color:green>-</p>','0.14'),row('2330','1','1','1','1','1','+','0')]}]};
box.appendDaily();
const after=tab('ETF日K').rows;
assert.equal(after.length,7,'two catalogue ETFs appended, 2330 ignored');
assert.deepEqual(after.at(-2),['2026-10-20','0050',27,27.2,26.9,27.1,8000000]);
// 108.15 / (27.10 - 0.06) = 4.0 → a new 1→4 split is recorded.
assert.deepEqual(tab('ETF分割紀錄').rows.at(-1),['0050','2026-10-20',4,'1 拆 4']);
assert.equal(tab('大盤日K').rows.at(-1)[0],'2026-10-20');
assert.equal(tab('同時段量能').rows.at(-1)[0],'2026-10-20');
box.appendDaily();
assert.equal(tab('ETF日K').rows.length,7,'running twice on the same day adds nothing');
assert.ok(tab('更新紀錄').rows.length>3);
/* ---------- anonymous usage events ---------- */
const ev=(type,extra={})=>({type,vid:'visitor-0001',sid:'session-0001',device:'mobile',host:'pages',...extra});
assert.equal(box.logEvent(ev('select',{code:'0050',query:'台灣50'})).ok,true);
assert.equal(box.logEvent(ev('hack')).ok,false,'unknown event type rejected');
assert.equal(box.logEvent({...ev('search'),sid:'bad id!'}).ok,false,'malformed session id rejected');
box.logEvent(ev('search',{query:'=HYPERLINK("x")'}));
box.doPost({postData:{contents:JSON.stringify([ev('view',{code:'0050',seconds:42.6}),ev('view',{code:'009816',seconds:5}),ev('select',{code:'009816'}),ev('leave',{seconds:999999})])}});
const usage=tab('使用紀錄').rows;
assert.deepEqual(usage[0],['時間','訪客','工作階段','事件','代號','搜尋字詞','停留秒數','裝置','網站','會員']);
assert.equal(JSON.stringify(usage[1].slice(1)),JSON.stringify(['visitor-0001','session-0001','select','0050','台灣50',0,'mobile','pages','']));
assert.equal(usage[2][5],"'=HYPERLINK(\"x\")",'formula text is neutralised');
assert.equal(usage[3][6],43);assert.equal(usage.at(-1)[6],86400,'seconds are capped');
for(let k=0;k<70;k++)box.logEvent(ev('search',{query:'x'+k}));
assert.ok(tab('使用紀錄').rows.length<=1+60+0,'at most 60 events a minute per session');
cache.clear();const pop=box.getPopular();
assert.equal(JSON.stringify(pop.codes.slice(0,2)),JSON.stringify(['0050','009816']),'popular list weights selections and long views');
console.log('Spreadsheet store: setup, ten-year import, split restore, intraday capture, live read with fallback, daily append and usage logging passed');


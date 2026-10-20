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
  'data/brent.json':{days:[{date:'2026-10-13',value:120},{date:'2026-10-14',value:126.55}]},
  'data/fx.json':{days:[{date:'2026-10-19',value:32.445}]},
  // Split-adjusted history: 0050 split 1→4 on 2025-06-18, so the 2025-06-17 bar is 188/4.
  'data/history/0050.json':{adjustments:[{date:'2025-06-18',factor:4}],rows:[['2025-06-17',47,47.5,46.75,47.1,1000],['2025-06-18',47.2,47.6,47,47.57,9000],['2026-10-19',108,108.5,107.5,108.15,5000]]},
  'data/history/009816.json':{adjustments:[],rows:[['2026-10-19',16,16.2,15.9,16.07,1000]]}
};
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
  if(url.includes('eia.gov'))return response('<tr><td class="B6">&nbsp;&nbsp;2026 Oct-12 to Oct-16</td><td class="B3">125.10</td><td class="B3">126.55</td><td class="B3">127.00</td><td class="B3"></td><td class="B3"></td></tr>'.repeat(1)+Array.from({length:6},(_,i)=>`<tr><td class="B6">2026 Sep-${String(7+i*7).padStart(2,'0')} to Sep-${String(11+i*7).padStart(2,'0')}</td><td class="B3">110</td><td class="B3">111</td><td class="B3">112</td><td class="B3">113</td><td class="B3">114</td></tr>`).join(''));
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
assert.equal(live.fx.latest,'2026-10-20');assert.equal(live.brent.latest,'2026-10-16');
cache.clear();const bundle=box.getLiveMarket();
assert.equal(bundle.store,true);assert.equal(bundle.intraday.time,'10:12:05');
// A stalled trigger (record older than 12 minutes during trading) falls back to a direct read.
clock+=20*60000;cache.clear();fetchLog=[];
assert.equal(box.liveFromStore_().intraday,null);
assert.ok(box.getLiveMarket().intraday);assert.ok(fetchLog.some(u=>u.includes('MI_5MINS')));

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
console.log('Spreadsheet store: setup, ten-year import, split restore, intraday capture, live read with fallback and daily append passed');

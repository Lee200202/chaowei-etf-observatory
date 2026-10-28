import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../gas/BankHistory.gs',import.meta.url),'utf8');
const days=[
  ['2026-04-27',53.6989,39616.6],
  ...Array.from({length:16},(_,i)=>[new Date(Date.parse('2026-05-01T00:00:00Z')+i*86400000).toISOString().slice(0,10),i,40000+i]),
  ['2026-10-20',155.538,46292.9],
  ['2026-10-21',21.9126,46887.8],
  ['2026-10-22',203.428,46041.4]
];
const chart={SumMoney:JSON.stringify(days.map(([d,v])=>[Date.parse(d+'T00:00:00Z'),v])),
  Price:JSON.stringify(days.map(([d,,v])=>[Date.parse(d+'T00:00:00Z'),v]))};
const html='loadChart('+JSON.stringify(chart)+');';
const box={JSON,Date,Number,String,Array,Math,UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>html})},stamp_:()=> '2026-10-23 20:00:00'};
vm.createContext(box);vm.runInContext(source,box);
const rows=box.bankHistoryRows_();
assert.equal(rows.length,20);
assert.deepEqual([...rows[0]].slice(0,3),days[0]);
assert.deepEqual([...rows.at(-1)].slice(0,3),days.at(-1));
assert.equal(rows.at(-1)[3],'HiStock broker8');
box.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>'<html>no chart</html>'});
assert.throws(()=>box.bankHistoryRows_(),/圖表資料不存在/);
// Rescheduling: the old trigger is replaced by one near 23:15 Taipei, the backfill appends only new dates,
box.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>html});
// and it leaves today's single attempt unused so tonight's run still happens.
const sheetRows=days.slice(0,-1).map(d=>[...d,'HiStock broker8','old']),props={BANK_LAST_ATTEMPT:'2026-10-27'},logs=[];let triggers=[{getHandlerFunction:()=>'appendBankHistory',hour:20}],made=null;
const builder={timeBased:()=>builder,inTimezone:z=>(builder.zone=z,builder),everyDays:n=>(builder.days=n,builder),atHour:h=>(builder.hour=h,builder),nearMinute:m=>(builder.minute=m,builder),create:()=>{made={zone:builder.zone,days:builder.days,hour:builder.hour,minute:builder.minute};triggers.push({...made,getHandlerFunction:()=>'appendBankHistory'});return made}};
const sheet={getLastRow:()=>sheetRows.length+1,getRange:(r,c,n)=>({getValues:()=>sheetRows.slice(r-2,r-2+n),setValues:v=>{sheetRows[r-2]=v[0]}})};
Object.assign(box,{store_:()=>({}),storeTab_:()=>sheet,storeProps_:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v}}),storeReadme_:()=>{},storeLog_:(ss,name,msg)=>logs.push(name),storeAppend_:(sh,tab,rows)=>sheetRows.push(...rows),
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},CacheService:{getScriptCache:()=>({remove:()=>{}})},
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t)},newTrigger:name=>(assert.equal(name,'appendBankHistory'),builder)}});
const out=box.rescheduleBankHistory();
assert.equal(out.removedTriggers,1);assert.equal(triggers.length,1);assert.deepEqual(made,{zone:'Asia/Taipei',days:1,hour:23,minute:15});
assert.equal(out.added,1);assert.equal(out.latest,'2026-10-22');assert.equal(sheetRows.length,days.length);assert.equal(props.BANK_LAST_ATTEMPT,'2026-10-27','backfill does not consume the daily attempt');assert.deepEqual(logs,['rescheduleBankHistory']);
assert.equal(box.rescheduleBankHistory().added,0,'running twice adds nothing');
console.log('HiStock chart parsing, UTC dates, units, missing-chart failure, 23:15 reschedule and attempt-free backfill passed');

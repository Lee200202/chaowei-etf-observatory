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
console.log('HiStock chart parsing, UTC dates, units and missing-chart failure passed');

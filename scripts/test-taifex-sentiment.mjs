// TAIFEX sentiment: the shared parsers (real 2026-11-13 CSV lines), the retail ratio arithmetic, the page maths
// (ranges, low/mid/high zones, readings, red/green line), the stored history, and the two-series range join.
import fs from'node:fs';import assert from'node:assert/strict';import vm from'node:vm';
const box={};vm.createContext(box);vm.runInContext(fs.readFileSync('gas-src/TaifexSentiment.gs','utf8'),box);
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const PCR='﻿日期,賣權成交量,買權成交量,買賣權成交量比率%,賣權未平倉量,買權未平倉量,買賣權未平倉量比率%\r\n2026/11/13,473795,480228,98.66,61300,106148,57.75,\r\n2026/11/12,213349,217330,98.17,85188,127738,66.69,\r\n';
const pcr=box.parseTaifexPcr_(PCR);
assert.deepEqual(JSON.parse(JSON.stringify(pcr)),[['2026-11-12',213349,217330,85188,127738],['2026-11-13',473795,480228,61300,106148]],'sorted oldest first, counts kept');
near(box.taifexPcrRatio_(pcr[1],'oi'),61300/106148*100);assert.equal(box.taifexPcrRatio_(pcr[1],'oi').toFixed(2),'57.75','matches TAIFEX printed ratio');
assert.equal(box.taifexPcrRatio_(pcr[1],'volume').toFixed(2),'98.66');
assert.throws(()=>box.parseTaifexPcr_('<!DOCTYPE HTML><html>alert</html>'),/格式異常/,'an HTML refusal page is never read as data');
const MTX='交易日期,契約,到期月份(週別),開盤價,最高價,最低價,收盤價,漲跌價,漲跌%,成交量,結算價,未沖銷契約數,最後最佳買價,最後最佳賣價,歷史最高價,歷史最低價,是否因訊息面暫停交易,交易時段,價差對單式委託成交量\n'+[
  '2026/11/13,MTX,202611  ,43891,44824,43695,43842,714,1.66%,176268,43839,22305,43838,43848,50445,37694,,一般,,',
  '2026/11/13,MTX,202611  ,43228,44034,42365,43684,556,1.29%,226798,-,-,43666,43684,50445,37694,,盤後,,',
  '2026/11/13,MTX,202611W4,44221,44790,43799,43911,735,1.70%,40,43837,106,43819,43856,44790,42907,,一般,,',
  '2026/11/13,MTX,202612  ,43906,44881,43763,43902,742,1.72%,7627,43917,7875,43899,43914,50591,27401,,一般,,',
  '2026/11/13,MTX,202701  ,43937,44935,43881,44012,705,1.63%,273,43989,926,43989,44004,47750,37898,,一般,,',
  '2026/11/13,MTX,202703  ,44341,45076,44050,44064,619,1.42%,75,44127,642,44123,44142,51097,32298,,一般,,',
  '2026/11/13,MTX,202706  ,44536,45320,44492,44658,923,2.11%,30,44408,265,44402,44430,52000,38574,,一般,,',
  '2026/11/13,MTX,202709  ,45274,45490,44606,44606,639,1.45%,31,44620,406,44612,44641,51664,38792,,一般,,',
  '2026/11/13,MTX,202611/202612  ,-,-,-,-,-,-,0,-,-,-7,0,-,-,,一般,11,'].join('\n');
const oi=box.parseTaifexMtxOi_(MTX);assert.equal(oi['2026-11-13'],22305+106+7875+926+642+265+406,'single months and weeklies of the regular session; spreads and after-hours rows carry no OI');
const INST='日期,商品名稱,身份別,多方交易口數,多方交易契約金額(千元),空方交易口數,空方交易契約金額(千元),多空交易口數淨額,多空交易契約金額淨額(千元),多方未平倉口數,多方未平倉契約金額(千元),空方未平倉口數,空方未平倉契約金額(千元),多空未平倉口數淨額,多空未平倉契約金額淨額(千元)\n'+[
  '2026/11/13,小型臺指期貨,自營商,22107,48446369,21011,46046127,1096,2400242,3003,6589084,7923,17392514,-4920,-10803430',
  '2026/11/13,小型臺指期貨,投信,5,10960,0,0,5,10960,87,190700,119,260842,-32,-70142',
  '2026/11/13,小型臺指期貨,外資及陸資,205440,448731539,206019,450014699,-579,-1283160,4472,9804252,2997,6573410,1475,3230842',
  '2026/11/12,小型臺指期貨,自營商,1,1,1,1,0,0,10,1,10,1,0,0'].join('\n');
const inst=box.parseTaifexInstitutions_(INST);assert.deepEqual(JSON.parse(JSON.stringify(inst)),{'2026-11-13':[7562,11039]},'a day without all three identities is dropped');
const retail=box.taifexRetailRows_(oi,inst);assert.equal(retail.length,1);assert.equal(box.taifexRetailRatio_(retail[0]).toFixed(2),'10.69','(11,039 − 7,562) ÷ 32,525');
// Stored history: no duplicate dates, plausible ranges, and the CI file agrees with the parser on 11/13.
for(const [file,min] of [['pages-data/options-pcr.json',3000],['pages-data/retail-ratio.json',700]]){
  const d=JSON.parse(fs.readFileSync(file,'utf8'));assert.ok(d.days.length>=min,file+' history');assert.equal(new Set(d.days.map(r=>r[0])).size,d.days.length,file+' unique dates');
  assert.ok(d.days.every((r,i)=>!i||d.days[i-1][0]<r[0]),file+' sorted');assert.equal(d.latest,d.days.at(-1)[0]);
}
const stored=JSON.parse(fs.readFileSync('pages-data/retail-ratio.json','utf8')).days.find(r=>r[0]==='2026-11-13');assert.deepEqual(stored,['2026-11-13',32525,7562,11039]);
// Page maths.
const SC=new Function(fs.readFileSync('worker/sentiment-core.js','utf8')+';return SentimentCore')();
const rows=SC.pcrRows({days:[['2026-11-12',213349,217330,85188,127738],['2026-11-13',473795,480228,61300,106148]]});near(rows[1].oiRatio,61300/106148*100);near(rows[1].volRatio,473795/480228*100);
const r=SC.retailRows({days:[['2026-11-13',32525,7562,11039]]})[0];near(r.ratio,(11039-7562)/32525*100);assert.equal(r.net,7562-11039);
const z=SC.zone([40,100,222,57.75]);assert.equal(z.segment,'low');assert.equal(z.label,'偏低段');assert.equal(SC.zone([40,222,200]).segment,'high');assert.equal(SC.zone([40,222,130]).segment,'mid');
assert.match(SC.reading('pcr','oiRatio',z),/賣權未平倉相對偏少，避險部位偏低，情緒面偏向空方/,'the reading the owner specified');
assert.match(SC.reading('retail','ratio',SC.zone([-8,34,30])),/反向的偏空訊號/);
assert.equal(SC.side(100,100),'rise');assert.equal(SC.side(99.99,100),'fall');
assert.equal(SC.line(SC.metric('pcr','putOi'),[1,3],100),2,'counts use the range average');assert.equal(SC.line(SC.metric('retail','net'),[5],3),0,'net position uses zero');
const days=Array.from({length:200},(_,i)=>({date:new Date(Date.UTC(2026,0,1)+i*86400000).toISOString().slice(0,10),value:i}));
assert.equal(SC.range(days,'2w').length,10);assert.equal(SC.range(days,'3m')[0].date>'2026-04-19',true);
assert.deepEqual(SC.merge([{date:'a',v:1},{date:'b',v:1}],[{date:'b',v:2}]).map(x=>x.v),[1,2],'live rows replace file rows of the same date');
// Any two cards: days both series have, in date order.
const RC=new Function(fs.readFileSync('worker/range-compare-core.js','utf8')+';return RangeCompare')();
const j=RC.joinSeries([{date:'2026-01-02',value:1},{date:'2026-01-03',value:2},{date:'2026-01-05',value:4,intraday:true}],[{date:'2026-01-03',value:9},{date:'2026-01-02',value:8},{date:'2026-01-05',value:7}]);
assert.deepEqual(j,[{date:'2026-01-02',a:1,b:8},{date:'2026-01-03',a:2,b:9}]);assert.deepEqual(RC.preset([{a:1},{a:5},{a:2}],'peakToLow','a'),{a:1,b:2});
for(const f of ['worker/market-sentiment.js','worker/ph19.js','worker/market-compare.js'])new vm.Script(fs.readFileSync(f,'utf8'));
// Live bundle: Apps Script steps a refused end date back and caches for four minutes (each five-minute page check is fresh).
const gs=fs.readFileSync('gas-src/TaifexSentiment.gs','utf8');assert.match(gs,/cache\.put\(key,JSON\.stringify\(out\),240\)/);assert.match(gs,/查詢不受理/);
assert.match(fs.readFileSync('.github/workflows/refresh-taifex.yml','utf8'),/cron: '40 7 \* \* 1-5'/,'weekday afternoon refresh');
console.log(`PASS TAIFEX sentiment: PCR 11/13 ${box.taifexPcrRatio_(pcr[1],'oi').toFixed(2)}%, retail ratio ${box.taifexRetailRatio_(retail[0]).toFixed(2)}% from real CSV lines; zones, readings, red/green line, history files and two-series join.`);

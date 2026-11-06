// Market range compare: shared trading days, left-to-right selections, and the screenshot's arithmetic.
import fs from 'node:fs';import assert from 'node:assert/strict';import vm from 'node:vm';
const RC=new Function(fs.readFileSync('worker/range-compare-core.js','utf8')+';return RangeCompare')();
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
// Hand fixture: a missing margin day is skipped, intraday index rows never enter.
const market=[['2026-10-01',100],['2026-10-02',120],['2026-10-05',110],['2026-10-06',90],['2026-10-07',95],['2026-10-08',96]].map(([date,index])=>({date,index})).concat([{date:'2026-10-09',index:99,intraday:true}]);
const margin=[['2026-10-01',50],['2026-10-02',60],['2026-10-06',45],['2026-10-07',44],['2026-10-08',46]].map(([date,value])=>({date,value}));
const rows=RC.join(market,margin);assert.deepEqual(rows.map(r=>r.date),['2026-10-01','2026-10-02','2026-10-06','2026-10-07','2026-10-08']);
assert.deepEqual(RC.preset(rows,'peakToLatest'),{a:1,b:4});assert.deepEqual(RC.preset(rows,'peakToLow'),{a:1,b:2});
const c=RC.change(rows,{a:1,b:4},'index');near(c.diff,-24);near(c.pct,-.2);assert.equal(c.days,3);
const m=RC.change(rows,{a:1,b:4},'margin');near(m.diff,-14);near(RC.ratio(c,m),(46/60-1)/-.2);
// The start always stays left of the end and inside the window.
assert.deepEqual(RC.clampSel(5,3,1),{a:3,b:4});assert.deepEqual(RC.clampSel(5,4,4),{a:3,b:4});assert.deepEqual(RC.clampSel(5,-2,9),{a:0,b:4});assert.equal(RC.clampSel(1,0,0),null);
// Peak inside the selection (the screenshot's B starts from margin's own high).
assert.equal(RC.peakInside(rows,{a:1,b:4},'index'),null);const p=RC.peakInside(rows,{a:0,b:4},'margin');assert.equal(p.from,'2026-10-02');near(p.diff,-14);
// A peak at the latest day falls back to the previous high so the range is never empty.
assert.deepEqual(RC.preset([{date:'a',index:1},{date:'b',index:2},{date:'c',index:3}],'peakToLatest'),{a:1,b:2});
// Real data: TAIEX close and TWSE listed margin amount on shared days.
const mk=JSON.parse(fs.readFileSync('pages-data/history/market.json','utf8')),mg=JSON.parse(fs.readFileSync('pages-data/history/margin.json','utf8'));
const real=RC.join(mk.rows.map(r=>({date:r[0],index:r[3]})),mg.rows.map(r=>({date:r[0],value:r[3]/1e5})));
const at=d=>real.findIndex(r=>r.date===d),sel={a:at('2026-10-06'),b:at('2026-11-04')};assert.ok(sel.a>=0&&sel.b>sel.a);
const ix=RC.change(real,sel,'index'),mm=RC.change(real,sel,'margin');near(ix.start,49822.55,1e-6);near(mm.end,5969.5,0.1);
const peak=RC.peakInside(real,sel,'margin');near(peak.start,6533.3,0.1);
const window=RC.windowRows(real,6);assert.ok(window.length>100&&window[0].date>=real.at(-1).date.slice(0,4)-1+'');
// The UI script compiles and reads only the core's functions.
new vm.Script(fs.readFileSync('worker/market-compare.js','utf8'));
console.log(`PASS range compare: shared days only, presets, left-to-right clamp, ratio, peak inside; real 10/06→11/04 index ${ix.start}→${ix.end}, margin ${mm.start.toFixed(1)}→${mm.end.toFixed(1)} (peak ${peak.from} ${peak.start.toFixed(1)}).`);

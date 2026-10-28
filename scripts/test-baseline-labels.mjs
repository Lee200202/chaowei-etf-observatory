// Display rules: gaps are judged at the shown precision, and identical baselines are shown once.
import fs from 'node:fs';import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(p,'utf8'),bt=read('worker/backtest.js');
const pick=name=>{const m=bt.match(new RegExp('const '+name+'=.*'));assert.ok(m,name+' defined');return m[0]};
const {shownPct,sameBaseline}=new Function(pick('shownPct')+'\n'+pick('sameBaseline')+'\nreturn{shownPct,sameBaseline}')();
assert.equal(shownPct(0.00002),0);assert.ok(Object.is(shownPct(-0.0004),0),'no negative zero');assert.equal(shownPct(0.0006),0.001);assert.equal(shownPct(-0.042),-0.042);assert.equal(shownPct(null),null);
// The training table and both headlines use the shown-precision gap.
const training=read('worker/training-ui.js');assert.match(training,/alpha=shownPct\(r\.test-r\.dca\)/);assert.match(training,/label=alpha===0\?'後段持平'/);assert.match(training,/驗證年化差 \$\{pctText\(shownPct\(/);
assert.match(bt,/const dx=shownPct\(/);assert.match(read('worker/subtraction.js'),/sameBaseline\(r\)\?'定投≈買進持有 '/);

const E=new Function(read('worker/strategy-engine.js')+';return ChaoweiEngine')();
const h=JSON.parse(read('pages-data/history/0050.json')),bars=h.rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
const ctx=E.prepare(bars,[]),start=bars.findIndex(b=>b.date>='2021-10-27'),end=bars.findLastIndex(b=>b.date<='2026-10-22');
const base={ref:{window:'200',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,entryTranches:0,dcaPeriods:'auto',capitalMode:'pool',fee:.1425,discount:100,tax:.1,fill:'nextOpen',slipBps:5,parking:1.5,drip:true,wholeShares:false,strategy:'smart_dca_water',params:{...E.PARAMS.smart_dca_water}};
const years={2021:240000,2022:240000,2023:0,2024:360000,2025:240000,2026:240000};
const monthly=E.run(ctx,{...base,funding:{version:1,type:'annual',arrival:'monthly',annualAmount:240000,recycleGains:true,years}},start,end);
const yearStart=E.run(ctx,{...base,funding:{version:1,type:'annual',arrival:'yearStart',annualAmount:240000,recycleGains:true,years}},start,end);
const pool=E.run(ctx,base,start,end);
// Monthly arrivals: both buy on arrival and differ only by leftover-cash interest, below the shown precision.
assert.equal(sameBaseline(monthly),true,'monthly arrivals: both baselines buy on arrival');assert.ok(Math.abs(monthly.bh.equity-monthly.dca.equity)<monthly.contributed*1e-3);
assert.equal(sameBaseline(yearStart),false,'year-start budget: buy-and-hold invests the year at once');
assert.equal(sameBaseline(pool),false,'one total budget: buy-and-hold invests on day one');
console.log('PASS labels: 0.1-point gaps are ties, no negative zero, identical baselines shown once (monthly arrivals) and kept apart otherwise.');

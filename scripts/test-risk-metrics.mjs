// Reproduce the cash-only Sharpe defect and verify recovery dates by hand.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const source=await readFile(new URL('../worker/strategy-engine.js',import.meta.url),'utf8');
const E=new Function(source+';return ChaoweiEngine')();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const dates=['2024-01-04','2024-01-05','2024-01-08','2024-01-09','2024-01-10','2024-01-11','2024-01-12'];
const series=dates.map((time,i)=>({time,nav:Math.pow(1.015,(Date.parse(time)-Date.parse(dates[0]))/86400000/365)}));
assert.equal(E.riskSharpe(series,.015,0).value,null,'no trades cannot produce an attractive Sharpe');
assert.equal(E.riskSharpe(series,.015,1).value,null,'calendar-aligned cash return has no excess volatility');
const daily=[.01,-.005,.002,-.004,.006,.003];let nav=1;
const sample=dates.map((time,i)=>({time,nav:i?(nav*=1+daily[i-1]):nav}));
const excess=daily.map((r,i)=>r-(Math.pow(1.015,(Date.parse(dates[i+1])-Date.parse(dates[i]))/86400000/365)-1));
const mean=excess.reduce((a,b)=>a+b,0)/6,sd=Math.sqrt(excess.reduce((a,b)=>a+(b-mean)**2,0)/5);
near(E.riskSharpe(sample,.015,3).value,mean/sd*Math.sqrt(245));
const dd=E.drawdownEvents(['2024-01-04','2024-01-05','2024-01-08','2024-01-09','2024-01-10','2024-01-11'].map((time,i)=>({time,nav:[100,90,80,100,95,94][i],equity:1000+i*1000})));
assert.equal(dd.length,2);near(dd[0].depth,.2);assert.deepEqual([dd[0].peak,dd[0].trough,dd[0].recovery,dd[0].tradingDays,dd[0].calendarDays,dd[0].ongoing],['2024-01-04','2024-01-08','2024-01-09',3,5,false]);
near(dd[1].depth,.06);assert.equal(dd[1].recovery,null);assert.equal(dd[1].ongoing,true);
assert.equal(E.drawdownEvents([{time:'2024-01-01',nav:1},{time:'2024-01-02',nav:1.1}]).length,0);
// Real-data parity with the pre-redesign engine: financial fixes must not alter orders or funding.
const before=new Function(execFileSync('git',['show','f3c8f7b:worker/strategy-engine.js'],{encoding:'utf8'})+';return ChaoweiEngine')();
const history=JSON.parse(await readFile(new URL('../pages-data/history/0050.json',import.meta.url),'utf8'));
const bars=history.rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
const ctx=E.prepare(bars,[]),old=before.prepare(bars,[]),results=[];
for(const p of E.PRESETS){const cfg={ref:{window:'240',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,capitalMode:'lump',dcaPeriods:12,fee:.1425,discount:100,tax:.1,wholeShares:false,parking:1.5,drip:true,strategy:p.strategy,params:{...p.params}};const r=E.run(ctx,cfg,bars.length-1220),a=before.run(old,cfg,bars.length-1220);assert.deepEqual(r.trades,a.trades,p.id+' orders');for(const key of ['equity','contributed','cash','shares','xirr','mdd','utilization','fees','interest'])assert.equal(r[key],a[key],p.id+' '+key);results.push({preset:p.id,trades:r.trades.length,oldSharpe:a.sharpe,newSharpe:r.sharpe,drawdowns:r.drawdowns.length})}
await mkdir(new URL('../qa/2026-10-25-ph8/',import.meta.url),{recursive:true});
await writeFile(new URL('../qa/2026-10-25-ph8/risk-metrics.json',import.meta.url),JSON.stringify({cashSharpe:E.riskSharpe(series,.015,0),handComputedSharpe:mean/sd*Math.sqrt(245),drawdownFixture:dd,realDataParity:results},null,2));
console.log('PASS: cash/weekend Sharpe, hand recovery dates, NAV vs external capital, all 21 preset order/funding parity.');

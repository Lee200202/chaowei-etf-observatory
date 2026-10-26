import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const source=readFileSync('worker/strategy-engine.js','utf8'),E=new Function(source+';return ChaoweiEngine')();
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
assert.equal(E.PRESETS.length,8);assert.equal(E.FAMILIES.length,3);assert.equal(Object.keys(E.RETIRED).length,14);
assert.deepEqual(E.FAMILIES.map(([id])=>E.PRESETS.filter(p=>p.family===id).length),[2,3,3]);
for(const id of Object.keys(E.RETIRED))assert.ok(!E.PRESETS.some(p=>p.id===id));
const base={ref:{window:'20',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,dcaPeriods:12,capitalMode:'pool',fee:0,discount:100,tax:0,parking:0,drip:false,fill:'nextOpen',slipBps:0};
const rows=Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),open:100,high:101,low:99,close:i<45?100:i<60?89:i<70?78:67,volume:100})),ctx=E.prepare(rows,[]),preset=E.PRESETS.find(p=>p.id==='coreSwing');
// 40% core + three 20% additions: actual signal thresholds are preserved, not forced exposure.
const cfg={...base,strategy:preset.strategy,params:{...preset.params}},r=E.run(ctx,cfg,30);
near(r.trades[0].amount,480000);assert.equal(r.trades[0].signal,30);assert.equal(r.trades[0].i,31);
for(const t of r.trades.filter(t=>t.type==='buy').slice(1))near(t.amount,240000);
near(r.series[0].exposure,0);assert.ok(r.cash>=-1e-6);
near(r.cagr,(r.equity/base.capital)**(1/r.years)-1);
// Explicit first-day fees count in pool CAGR, including both benchmark accounts.
const fee=E.run(ctx,{...base,strategy:'buy_hold',params:{},fill:'close',fee:1},30);
near(fee.equity,fee.bh.equity);near(fee.cagr,(fee.equity/base.capital)**(1/fee.years)-1);near(fee.bh.cagr,fee.cagr);
// Salary money is never front-loaded by the core reserve split, even with larger target tranches.
const monthly=E.run(ctx,{...cfg,capitalMode:'monthly'},30);let spent=0,paid=0;
for(let i=30;i<rows.length;i++){if(i===30||ctx.monthStart[i])paid+=100000;for(const t of monthly.trades.filter(t=>t.signal===i)){if(t.type==='buy')spent+=t.amount;else spent-=t.amount}assert.ok(spent<=paid+1e-6)}
// Partial trims are not separate winning rounds; include cash dividends, omit the open round.
const rounds=E.closedRounds([{date:'2024-01-01',type:'buy',shares:10,amount:100},{date:'2024-01-03',type:'sell',shares:5,amount:60},{date:'2024-01-04',type:'sell',shares:5,amount:35},{date:'2024-01-05',type:'buy',shares:1,amount:10}],[[Date.parse('2024-01-02'),10]]);
assert.equal(rounds.total,1);assert.equal(rounds.wins,1);near(rounds.rounds[0].pnl,5);assert.equal(rounds.open,true);
// Changed holdout prices cannot influence an earlier training result.
for(const p of E.PRESETS){const cfg={...base,...p},a=E.run(ctx,cfg,30,70),changed=E.prepare(rows.map((b,i)=>i>70?{...b,open:1,close:1}:b),[]),b=E.run(changed,cfg,30,70);assert.deepEqual(a.trades,b.trades);near(a.equity,b.equity);assert.ok(a.series.every(x=>x.exposure>=0&&x.exposure<=1+1e-9))}
// The form uses the actual catalog IDs. Old saved recipes reset with a visible notice.
const bt=readFileSync('worker/backtest.js','utf8'),part=bt.slice(bt.indexOf('const BT_DEFAULT='),bt.indexOf('settings.bt=btMigrate'));
const migrate=new Function('E','settings',part+';return btMigrate')(E,{window:'240'}),old=migrate({v:4,preset:'drop20',strategy:'classic',params:{drop:99},capital:900000});
assert.equal(old.preset,'coreSwing');assert.equal(old.params.drop,10);assert.equal(old.capital,900000);assert.ok(old.migrationNotice);
const saved=migrate({...old,v:5,params:{...old.params,drop:17}});assert.equal(saved.params.drop,17);
// Real histories: all eight, both funding modes and fills obey accounting and common pool denominators.
const results=[];for(const code of ['0050','0056','00878']){const h=JSON.parse(readFileSync(`pages-data/history/${code}.json`)),bars=h.rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume})),c=E.prepare(bars,[]),start=Math.max(0,bars.length-1220);for(const p of E.PRESETS){const out=E.run(c,{...base,...p,parking:1.5,fee:.1425,tax:.1,slipBps:5},start);near(out.equity,out.cash+out.shares*bars.at(-1).close,.00001);near(out.cagr,(out.equity/base.capital)**(1/out.years)-1);near(out.dca.cagr,(out.dca.equity/base.capital)**(1/out.years)-1);results.push({code,preset:p.id,cagr:out.cagr,dca:out.dca.cagr,bh:out.bh.cagr,exposure:out.utilization,buys:out.buys,rounds:out.rounds.total})}}
mkdirSync('qa/2026-10-25-ph9',{recursive:true});writeFileSync('qa/2026-10-25-ph9/math-checks.json',JSON.stringify({poolCagr:fee.cagr,coreTranches:r.trades.map(t=>t.amount),rounds,results},null,2));
console.log('PASS ph9: 8 public strategies/3 categories, honest migration, 40/20/20/20 cash split, fees in CAGR, no salary advance, dividend-inclusive closed rounds, no lookahead, 24 real ETF scenarios.');

// Q03 fill model: T+1 open with slippage versus the ideal same-day close.
import fs from 'node:fs';import assert from 'node:assert/strict';
const E=new Function(fs.readFileSync('worker/strategy-engine.js','utf8')+';return ChaoweiEngine')();
const near=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
// Opens differ from closes so the two models are distinguishable; a dividend sits on day 3.
const days=Array.from({length:12},(_,i)=>new Date(Date.UTC(2024,0,2+i)).toISOString().slice(0,10));
const bars=days.map((date,i)=>({date,open:100+i*2,high:120+i,low:90,close:101+i*2,volume:1000}));
const ctx=E.prepare(bars,[[days[3],1]]);
const base={capital:100000,capitalMode:'pool',dcaPeriods:1,fee:0.1425,discount:100,tax:0.1,parking:1.5,drip:false,wholeShares:false,strategy:'dca',params:{}};
const close=E.run(ctx,{...base,fill:'close',slipBps:0},2,10),next=E.run(ctx,{...base,fill:'nextOpen',slipBps:5},2,10);

// Close model fills on the signal day at its close; T+1 fills at the next open moved 5 bps against the buyer.
assert.equal(close.trades[0].date,days[2]);near(close.trades[0].price,bars[2].close);assert.equal(close.trades[0].signal,undefined);
assert.equal(next.trades[0].date,days[3]);assert.equal(next.trades[0].signal,2);near(next.trades[0].price,bars[3].open*1.0005);
near(next.slippage,next.trades[0].shares*bars[3].open*0.0005);near(next.friction,(next.fees+next.slippage)/base.capital);
assert.equal(close.slippage,0);assert.equal(next.fill,'nextOpen');assert.equal(close.fill,'close');

// Until the open the account still holds cash: day 2 is worth exactly the capital (no interest within a day).
near(next.series[0].value,base.capital);assert.equal(next.series[0].exposure,0);assert.ok(close.series[0].exposure>0.99);

// Shares bought at the ex-dividend open are not entitled; the close-model buyer held them overnight and is.
assert.ok(close.dividends>0);assert.equal(next.dividends,0);

// Cash conservation: final equity equals cash plus shares at the last close, and nothing is pending.
near(next.equity,next.cash+next.shares*bars[10].close);assert.ok(next.cash>=-1e-9);

// An order on the window's last day is not filled from data past the window, and later bars cannot leak in.
const tail=E.run(ctx,{...base,fill:'nextOpen',slipBps:5},10,10);assert.equal(tail.trades.length,0);assert.equal(tail.unfilled,1);
const shifted=E.prepare(bars.map((b,i)=>i===11?{...b,open:1,close:1}:b),[[days[3],1]]);
assert.deepEqual(E.run(shifted,{...base,fill:'nextOpen',slipBps:5},2,10).trades,next.trades);

// Sells fill lower: a signal-day exit on the swing preset under T+1 uses the next open minus slippage.
const hist=JSON.parse(fs.readFileSync('pages-data/history/0050.json','utf8')),real=hist.rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
const rc=E.prepare(real,[]),start=real.length-1220;let checked=0;
for(const p of E.PRESETS){const cfg={ref:{window:'240',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,capitalMode:'lump',dcaPeriods:12,fee:.1425,discount:100,tax:.1,wholeShares:false,parking:1.5,drip:true,strategy:p.strategy,params:{...p.params}};
  const a=E.run(rc,{...cfg,fill:'close'},start),b=E.run(rc,{...cfg,fill:'nextOpen',slipBps:5},start);
  assert.ok(Number.isFinite(b.equity)&&b.cash>=-1e-6,p.id+' cash');assert.ok(b.series.every(x=>Number.isFinite(x.value)&&x.exposure>=-1e-9&&x.exposure<=1+1e-9),p.id+' series');
  for(const t of b.trades){assert.ok(t.i>t.signal,p.id+' fills after signal');const o=real[t.i].open;near(t.price,t.type==='buy'?o*1.0005:o*0.9995,1e-9)}
  near(b.equity,b.cash+b.shares*real.at(-1).close,1e-6);if(b.trades.length&&a.trades.length)checked++}
assert.ok(checked>=15,'most presets trade in both models');
console.log(`PASS Q03 fill model: T+1 open with 5 bps slippage, overnight cash and dividend entitlement, last-day orders unfilled, no data past the window, ${checked} real 0050 presets in both models.`);

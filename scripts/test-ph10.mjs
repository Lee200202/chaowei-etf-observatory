import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const E=new Function(readFileSync('worker/strategy-engine.js','utf8')+';return ChaoweiEngine')();
const B=new Function(readFileSync('worker/strategy-board-core.js','utf8')+';return StrategyBoard')();
const T=new Function(readFileSync('worker/training-core.js','utf8')+';return TrainingMath')();
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`),date=i=>new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10);
const bar=(i,c=100)=>({date:date(i),open:c,high:c+1,low:c-1,close:c,volume:100});
const base={capital:1200000,capitalMode:'pool',dcaPeriods:12,fee:0,discount:100,tax:0,parking:0,drip:false,fill:'nextOpen',slipBps:0,ref:{window:'20',anchorMode:'wick',anchorCount:5,method:'equal'}};
const ids=['trendPullback','kdGolden','marginFear'],cfg=id=>({...base,...E.PRESETS.find(p=>p.id===id)});
assert.equal(E.PRESETS.length,11);
// KD independent first calculation: 9 bars, RSV=100 -> K=200/3, D=500/9.
const kd=E.prepare(Array.from({length:9},(_,i)=>({...bar(i),high:100,low:0})),[]);assert.ok(Number.isNaN(kd.kdK[7]));near(kd.kdK[8],200/3);near(kd.kdD[8],500/9);
// Availability is strict: today's published EOD balance cannot be used at today's close.
const margin=Array.from({length:12},(_,i)=>({date:date(i),value:100-i})),hist=E.marginHistory(Array.from({length:13},(_,i)=>bar(i)),margin);
assert.ok(Number.isNaN(hist[5]));near(hist[6],95/100-1);near(hist[11],90/95-1);
assert.ok(Number.isNaN(E.marginHistory([bar(40)],margin)[0]));
const altered=margin.map((x,i)=>i>=7?{...x,value:1}:x);assert.deepEqual(Array.from(hist.slice(0,8)),Array.from(E.marginHistory(Array.from({length:13},(_,i)=>bar(i)),altered).slice(0,8)));
// Hand signal: a first red candle after a pullback, no new low, established MA200 trend.
const trendRows=Array.from({length:205},(_,i)=>bar(i,i<150?70:100));trendRows[199]={...bar(199,90),open:98,low:89,high:99};trendRows[200]={...bar(200,95),open:91,low:90,high:96};
const trendCtx=E.prepare(trendRows,[]),trend=E.run(trendCtx,cfg('trendPullback'),198,204);assert.equal(trend.trades.filter(t=>t.kind==='add').length,1);assert.equal(trend.trades.find(t=>t.kind==='add').signal,200);near(trend.trades[0].amount,600000);near(trend.trades.find(t=>t.kind==='add').amount,200000);assert.equal(trend.trades.find(t=>t.kind==='add').date,date(201));
const early=E.run(E.prepare(trendRows.slice(0,100),[]),cfg('trendPullback'),0,99);assert.equal(early.trades.filter(t=>t.kind==='add').length,0);
// Controlled KD crossings isolate satellite accounting, not price/indicator implementation.
const rows=Array.from({length:50},(_,i)=>bar(i,i<30?100:140)),ctx=E.prepare(rows,[]);ctx.kdK.fill(50);ctx.kdD.fill(50);ctx.kdK[9]=20;ctx.kdD[9]=21;ctx.kdK[10]=23;ctx.kdD[10]=22;ctx.kdK[29]=90;ctx.kdD[29]=89;ctx.kdK[30]=87;ctx.kdD[30]=88;
const out=E.run(ctx,cfg('kdGolden'),8,49),buy=out.trades.find(t=>t.kind==='add'),sell=out.trades.find(t=>t.kind==='trim');near(out.trades[0].amount,540000);near(buy.amount,220000);near(sell.shares,buy.shares*.15);near(out.state.satCost,220000*.85);near(sell.pnl,sell.amount-33000);near(out.shares,out.state.coreShares+out.state.satShares);assert.ok(out.shares>=out.state.coreShares);
const frozen=E.run(ctx,{...cfg('kdGolden'),entryFlags:Array(50).fill(false)},8,49);assert.equal(frozen.trades.filter(t=>t.kind==='add').length,0);assert.equal(frozen.trades.filter(t=>t.kind==='core').length,1);
// No margin is not a synthetic panic signal. AND needs all three actual inputs.
const fear=E.prepare(rows.map((b,i)=>bar(i,i<25?120:100)),[]);fear.ma60.fill(150);fear.marginDrop5.fill(NaN);const noData=E.run(fear,cfg('marginFear'),25,49);assert.equal(noData.trades.filter(t=>t.kind==='add').length,0);
fear.marginDrop5.fill(-.02);const yesData=E.run(fear,cfg('marginFear'),25,49);assert.ok(yesData.trades.some(t=>t.kind==='add'));fear.marginDrop5.fill(-.005);assert.equal(E.run(fear,cfg('marginFear'),25,49).trades.filter(t=>t.kind==='add').length,0);
// The GUI's actual configuration, not an unspecified-fill fixture: exactly one-session delay.
B.install(E);const plan={weight:100,flags:Array(50).fill(true),on:80,off:20,ruleIds:['rule-a'],ruleNames:['價格水位']},boardCfg=B.runConfig(plan,base,1200000,E),board=E.run(ctx,boardCfg,8,49);assert.equal(boardCfg.fill,'nextClose');assert.equal(board.trades[0].signal,8);assert.equal(board.trades[0].i,9);near(board.trades[0].price,ctx.close[9]);const exec=B.executions(board,plan,ctx);assert.equal(exec[0].signalDate,date(8));near(exec[0].exposure,board.series[1].exposure);
const agg=B.aggregate([{...board,code:'0050'}],1200000,0,0);near(agg.utilization,board.utilization);assert.ok(agg.series.every(x=>x.exposure>=0&&x.exposure<=1+1e-9));
// Future auxiliary values are excluded by the same holdout context as bars and dividends.
const cut=T.context(E,{...ctx,marginDrop5:Float64Array.from(rows,(_,i)=>i<25?-.01:999)},24);assert.equal(cut.marginDrop5.length,25);assert.ok(Array.from(cut.marginDrop5).every(x=>x===-.01));
const real=[];const md=JSON.parse(readFileSync('pages-data/history/margin.json')).rows.map(x=>({date:x[0],value:x[3]})),div=JSON.parse(readFileSync('pages-data/history/dividends.json','utf8'));
for(const code of ['0050','0056','00878']){const h=JSON.parse(readFileSync(`pages-data/history/${code}.json`)),bars=h.rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume})),events=(div.events?.[code]||[]).map(([date,v])=>[date,v/(h.adjustments||[]).reduce((f,a)=>date<a.date?f*a.factor:f,1)]),ctx=E.prepare(bars,events,null,{marginDrop5:E.marginHistory(bars,md)}),start=bars.findIndex(x=>x.date>='2022-01-01');
 for(const id of ids){const config={...cfg(id),ref:{...base.ref,window:'240'},fee:.1425,tax:.1,parking:1.5,drip:true,slipBps:5};for(const mode of ['pool','monthly']){const r=E.run(ctx,{...config,capitalMode:mode},start),annual=mode==='pool'?r.cagr:r.xirr,dca=mode==='pool'?r.dca.cagr:r.dca.xirr;near(r.equity,r.cash+r.shares*bars.at(-1).close,.0001);assert.ok(r.series.every(x=>x.exposure>=0&&x.exposure<=1+1e-8));assert.ok(r.cash>=-1e-6);assert.ok(r.shares>=r.state.coreShares-1e-6);const cutoff=Math.min(start+300,ctx.n-2),a=E.run(ctx,config,start,cutoff),mutated=E.prepare(bars.map((b,i)=>i>cutoff?{...b,open:1,close:1}:b),events,null,{marginDrop5:ctx.marginDrop5.map((v,i)=>i>cutoff?99:v)}),b=E.run(mutated,config,start,cutoff);assert.deepEqual(a.trades,b.trades);near(a.equity,b.equity);real.push({code,id,mode,from:r.start,to:r.end,annual,dca,delta:annual-dca,mdd:r.mdd,exposure:r.utilization,buys:r.buys,sells:r.sells,marginDays:Array.from(ctx.marginDrop5.slice(start)).filter(Number.isFinite).length})}}
}
mkdirSync('qa/2026-10-26-ph10',{recursive:true});writeFileSync('qa/2026-10-26-ph10/math-checks.json',JSON.stringify({manual:{trendSignal:date(200),kdAdd:buy.amount,kdTrimShares:sell.shares,kdTrimProfit:sell.pnl,boardSignal:exec[0].signalDate,boardFill:exec[0].date},real},null,2));
console.log('PASS ph10: KD seed/warmup, causal margin, strict AND/no fabricated data, tranche cash, core-protected satellite trim, GUI next-close one-session fill, exposure aggregation, holdout auxiliary isolation, 18 real ETF funding scenarios.');

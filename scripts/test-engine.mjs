// Offline checks for worker/strategy-engine.js: hand-computable cases, accounting identities,
// no look-ahead (prefix invariance) on real data, and a results table for the presets.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const E=new Function(await readFile(new URL('worker/strategy-engine.js',root),'utf8')+';return ChaoweiEngine')();
const base={ref:{window:'240',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,dcaPeriods:12,
  fee:0.1425,discount:100,tax:0.1,wholeShares:false,parking:0,drip:true};
const cfgOf=(preset,over={})=>({...base,strategy:preset.strategy,params:{...preset.params},...over});
const near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b}`);

/* 1. Synthetic V-shape: classic drop 20 % / gain 20 % buys at 80.00 and sells at 96.67. */
const synth=[];{let d=new Date('2024-01-01T00:00:00Z');const push=c=>{while(d.getUTCDay()%6===0)d.setUTCDate(d.getUTCDate()+1);const v=Math.round(c*100)/100;synth.push({date:d.toISOString().slice(0,10),open:v,high:v,low:v,close:v,volume:1e6});d.setUTCDate(d.getUTCDate()+1)};
  for(let i=0;i<400;i++)push(100);for(let k=0;k<30;k++)push(100-25*(k+1)/30);for(let k=0;k<30;k++)push(75+25*(k+1)/30);for(let i=0;i<20;i++)push(100)}
{
  const ctx=E.prepare(synth,[]),p=E.LEGACY_PRESETS.find(x=>x.id==='drop20'),r=E.run(ctx,cfgOf(p,{capitalMode:'lump',capital:400000}),0);
  assert.equal(r.trades.length,2);assert.equal(r.trades[0].price,80);assert.equal(r.trades[1].price,96.67);
  near(r.trades[0].amount,100000,0.01,'first tranche is a quarter of the pot');
  const sh=100000/(80*1.001425),expected=sh*96.67*(1-0.001425-0.001)-100000;near(r.trades[1].pnl,expected,0.01,'round-trip P&L with fee and tax');
  near(r.equity,400000+expected,0.01,'equity = capital + realised P&L');
}
/* 2. Parking yield on idle cash: no trades, 2 % a year for exactly 365 calendar days. */
{
  const flat=[{date:'2025-01-01',open:10,high:10,low:10,close:10,volume:1},{date:'2026-01-01',open:10,high:10,low:10,close:10,volume:1}];
  const ctx=E.prepare(flat,[]),r=E.run(ctx,{...base,strategy:'classic',params:{...E.PARAMS.classic,drop:90},capitalMode:'lump',capital:100000,parking:2},0);
  near(r.equity,102000,0.01,'one year of parking interest');near(r.interest,2000,0.01,'interest reported');near(r.xirr,0.02,1e-6,'XIRR equals the parking rate');
}
/* 3. Dividends: buy-and-hold at 100 with a 5 dividend; DRIP buys more shares, no-DRIP keeps cash. */
{
  const bars=['2025-01-02','2025-01-03','2025-01-06'].map(date=>({date,open:100,high:100,low:100,close:100,volume:1}));
  const ctx=E.prepare(bars,[['2025-01-03',5]]),dca=E.LEGACY_PRESETS.find(x=>x.id==='dca');
  const on=E.run(ctx,cfgOf(dca,{capitalMode:'lump',capital:100000,fee:0,tax:0}),0),off=E.run(ctx,cfgOf(dca,{capitalMode:'lump',capital:100000,fee:0,tax:0,drip:false}),0);
  near(on.bh.equity,105000,1e-6,'buy-and-hold gains the dividend');near(on.dividends,100000/12/100*5,1e-6,'DCA holds one installment (C ÷ 12) and receives its dividend');
  near(off.bh.equity,105000,1e-6,'dividend kept as cash without DRIP');
}
/* 4. XIRR on a known cash flow. */
near(E.xirr([[Date.parse('2025-01-01'),-100],[Date.parse('2026-01-01'),110]]),0.10,1e-6,'XIRR 10 %');

/* Real data. */
const hist=async code=>JSON.parse(await readFile(new URL(`pages-data/history/${code}.json`,root),'utf8'));
const divs=JSON.parse(await readFile(new URL('pages-data/history/dividends.json',root),'utf8')).events;
// Dividends are per share on the ex-date; history prices are split-adjusted, so divide by later split factors.
const adjDiv=(d,code)=>(divs[code]||[]).map(([date,v])=>{let f=1;for(const a of d.adjustments||[])if(date<a.date)f*=a.factor;return[date,v/f]});
const load=async code=>{const d=await hist(code);return{d,bars:d.rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume})),div:adjDiv(d,code)}};

/* 5. Same base, different split: 定期定額 buys C ÷ 12 per month, a 4-stage strategy buys C ÷ 4 per stage. */
{
  const {bars,div}=await load('0050'),ctx=E.prepare(bars,div),start=bars.length-1220,r=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='dca')),start);
  const buys=r.trades.filter(t=>t.kind==='dca');assert.equal(buys.length,12);for(const t of buys)near(t.amount,1200000/12,1e-6,'each installment is C ÷ 12');
  const s=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='drop20')),start),first=s.trades.find(t=>t.type==='buy');if(first)near(first.amount,1200000/4,1e-6,'first stage is C ÷ 4');
  near(r.contributed,1200000,0,'one capital base');near(s.contributed,1200000,0,'same capital base');
}
/* 5b. Plain DCA strategy equals the DCA benchmark exactly. */
{
  const {bars,div}=await load('0050'),ctx=E.prepare(bars,div),start=bars.length-1220,r=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='dca')),start);
  near(r.equity,r.dca.equity,1e-6,'DCA strategy matches the benchmark');
}
/* 6. No look-ahead: running on data cut at day k gives the same trades up to k. */
{
  const {bars,div}=await load('0050'),full=E.prepare(bars,div),start=bars.length-1220;
  for(const k of [bars.length-400,bars.length-120]){
    const cut=E.prepare(bars.slice(0,k+1),div);
    for(const p of E.PRESETS){
      const a=E.run(full,cfgOf(p),start,k),b=E.run(cut,cfgOf(p),start,k),sig=t=>t.map(x=>x.date+x.type+x.price+x.shares.toFixed(6)).join('|');
      assert.equal(sig(a.trades),sig(b.trades),`${p.name}: trades differ when future data is removed`);near(a.equity,b.equity,1e-6,p.name+' equity');
    }
  }
}
/* 7. Accounting: equity = cash + shares × close on every preset. */
{
  const {bars,div}=await load('00631L'),ctx=E.prepare(bars,div);
  for(const p of E.PRESETS){const r=E.run(ctx,cfgOf(p),bars.length-1220);near(r.equity,r.cash+r.shares*bars.at(-1).close,1e-4,p.name+' equity identity');assert.ok(r.cash>-1e-6,p.name+' cash never negative')}
}
/* 8. Auto installments: N = months in the window, every installment C ÷ N, all of C invested by the end. */
{
  const {bars,div}=await load('0050'),ctx=E.prepare(bars,div),start=bars.length-1220;
  const months=bars.slice(start).filter((b,k)=>k===0||b.date.slice(0,7)!==bars[start+k-1].date.slice(0,7)).length;
  const r=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='dca'),{dcaPeriods:'auto'}),start),buys=r.trades.filter(t=>t.kind==='dca');
  assert.equal(r.N,months);assert.equal(buys.length,months);for(const t of buys)near(t.amount,1200000/months,1e-6,'auto installment is C ÷ months');
  assert.ok(r.cash<1200000/months,'nothing left over beyond one installment');
}
/* 9. Monthly deposits: C ÷ N arrives each month; buy-and-hold still invests C on day one with its own flows. */
{
  const {bars,div}=await load('0050'),ctx=E.prepare(bars,div),start=bars.length-1220;
  const r=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='dca'),{dcaPeriods:'auto',capitalMode:'monthly'}),start);
  near(r.contributed,1200000,1e-6,'deposits add up to C');near(r.dca.equity,r.equity,1e-6,'DCA strategy equals the benchmark');
  near(r.bh.ret,E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='dca'),{dcaPeriods:'auto'}),start).bh.ret,1e-9,'buy-and-hold is the same in both modes');
  near(r.roic,r.xirr,1e-6,'fully invested: deployed-capital return equals XIRR');
}
/* 10. Reserve buffer: multiplier strategies never spend more than the released installments plus sales and dividends. */
{
  for(const code of ['0050','00631L']){const {bars,div}=await load(code),ctx=E.prepare(bars,div),start=bars.length-1220;
    for(const id of ['smartDca','va','bias'])for(const N of [12,'auto']){
      const r=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id===id),{dcaPeriods:N}),start),released=r.base*r.N;
      const spent=r.trades.filter(t=>t.kind==='dca').reduce((s,t)=>s+t.amount,0),back=r.trades.filter(t=>t.type==='sell').reduce((s,t)=>s+t.amount,0);
      assert.ok(spent<=released+back+r.dividends+1e-6,`${code} ${id} N=${N} spends within its pots`);
      assert.ok(r.state.reserve>=-1e-9,`${code} ${id} reserve never negative`);
    }}
}
/* 11. Buy-and-hold pays the same fee as everyone else: C × fee ÷ (1 + fee) on day one. */
{
  const bars=['2025-01-02','2025-01-03'].map(date=>({date,open:100,high:100,low:100,close:100,volume:1}));
  const r=E.run(E.prepare(bars,[]),cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='dca'),{capital:100000,dcaPeriods:1}),0);
  near(r.bh.fees,100000*0.001425/1.001425,1e-6,'buy-and-hold fee');near(r.dca.fees,r.bh.fees,1e-6,'same fee for 定期定額');
}
/* 12. Deployed-capital return: a strategy in cash most of the time still reports what its trades earned. */
{
  const ctx=E.prepare(synth,[]),r=E.run(ctx,cfgOf(E.LEGACY_PRESETS.find(x=>x.id==='drop20'),{capital:400000,parking:0}),0);
  const buy=r.trades[0],sell=r.trades[1],days=(Date.parse(sell.date)-Date.parse(buy.date))/86400000;
  near(r.roic,Math.pow(sell.amount/buy.amount,365/days)-1,1e-6,'ROIC is the round trip annualised over its holding days');
  assert.ok(r.roic>r.xirr,'higher than the whole-pot XIRR');
}
/* 13. Base position: with 3 equal parts the first part is bought on day one and never sold; the swing parts are C ÷ 3 each. */
{
  const ctx=E.prepare(synth,[]),p=E.LEGACY_PRESETS.find(x=>x.id==='drop20'),r=E.run(ctx,cfgOf(p,{capital:300000,parking:0,params:{...p.params,adds:2,core:true}}),0);
  const buys=r.trades.filter(t=>t.type==='buy'),sells=r.trades.filter(t=>t.type==='sell');
  assert.equal(buys[0].date,synth[0].date,'base bought on the first day');near(buys[0].amount,100000,0.01,'base is C ÷ 3');
  for(const t of buys.slice(1))near(t.amount,100000,0.01,'each swing part is C ÷ 3');
  const baseShares=buys[0].shares,sold=sells.reduce((s,t)=>s+t.shares,0),bought=buys.slice(1).reduce((s,t)=>s+t.shares,0);
  assert.ok(sells.length>0,'the swing part was sold');near(sold,bought,1e-6,'only swing shares are sold');near(r.shares,baseShares,1e-6,'base shares kept');
}
console.log('Engine checks passed: hand cases, parking, dividends, XIRR, DCA identity, no look-ahead, accounting, auto N, monthly mode, reserve, fees, ROIC, base position.');

/* Results table (5 years, C = 1.2M, one installment per month, parking 1.5 %, DRIP on). */
const pct=v=>v==null?'—':(v*100).toFixed(1).padStart(6)+'%';
for(const code of ['0050','0056','00631L']){
  const {bars,div}=await load(code),ctx=E.prepare(bars,div),start=bars.length-1220;
  console.log(`\n${code} ${bars[start].date}–${bars.at(-1).date}  總報酬 / XIRR / 最大回落 / 資金利用率`);
  for(const p of E.PRESETS){const r=E.run(ctx,cfgOf(p,{parking:1.5,dcaPeriods:'auto'}),start);console.log(`${p.name.padEnd(14,'　')} ${pct(r.ret)} ${pct(r.xirr)} ${pct(-r.mdd)} ${pct(r.utilization)}${r.xirr>r.dca.xirr?'  ★勝過定期定額':''}`)}
  const r=E.run(ctx,cfgOf(E.PRESETS[0],{parking:1.5,dcaPeriods:'auto'}),start);console.log(`定期定額基準　　　　　 ${pct(r.dca.ret)} ${pct(r.dca.xirr)} ${pct(-r.dca.mdd)}`);
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const V=new Function(read('worker/visual-metrics-core.js')+';return VisualMetrics')();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
// Deposits change account value but must never become a gain or a drawdown.
const deposits=[100,200,300,400].map((value,i)=>({time:`2024-01-0${i+1}`,value,nav:1}));
near(V.period(deposits,0,3).ret,0);near(V.period(deposits,0,3).mdd,0);
const rows=[{time:'2024-01-01',nav:1,value:100},{time:'2024-01-02',nav:1.2,value:120},{time:'2024-01-03',nav:.9,value:180},{time:'2024-01-04',nav:1.1,value:330}];
near(V.period(rows,0,3).ret,.1);near(V.period(rows,0,3).mdd,.25);
assert.equal(V.period(rows,0,3).high,3);assert.equal(V.period(rows,0,3,true).high,1);
near(V.period(rows,2,3).mdd,0);near(V.period(rows,2,3).ret,1.1/.9-1);
assert.deepEqual(V.range(rows,'2024-01-02','2024-01-03'),{a:1,b:2});assert.equal(V.range(rows,'2025-01-01','2025-02-01'),null);
assert.equal(V.period([],0,1),null);assert.equal(V.period(rows,8,9),null);
const ratios=V.ratios([{alpha:.1},{alpha:-.1},{alpha:0},{alpha:null},{alpha:NaN}]);assert.deepEqual([ratios.wins,ratios.ties,ratios.losses,ratios.total],[1,1,1,3]);
const h=V.histogram([0,1,2,3,4,NaN]);assert.equal(h.counts.reduce((a,b)=>a+b),5);near(h.mean,2);near(V.crossing(2,1,0,1),.5);assert.equal(V.crossing(2,1,3,1),null);
const a=V.attribution({equity:150,contributed:100,dividends:10,interest:2,fees:3});near(a.price+a.dividends+a.interest+a.fees,a.net);
const E=new Function(read('worker/strategy-engine.js')+';return ChaoweiEngine')();
const bars=JSON.parse(read('pages-data/history/0050.json')).rows.map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume})),ctx=E.prepare(bars,[]),p=E.PRESETS.find(p=>p.strategy==='smart_dca_water'),cfg={ref:{window:120,anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,dcaPeriods:60,fee:.1425,discount:100,tax:.1,wholeShares:false,parking:0,drip:true,strategy:p.strategy,params:p.params},r=E.run(ctx,cfg,600);
for(const result of [r,r.dca,r.bh]){assert.ok(result.series.every(x=>Number.isFinite(x.nav)));near(V.period(result.series,0,result.series.length-1).ret,result.series.at(-1).nav/result.series[0].nav-1)}
// Next-bar price reference uses exactly N preceding bars, including the simulation end.
const bt=read('worker/backtest.js'),helper=bt.slice(bt.indexOf('function btNextReference'),bt.indexOf('function btNow'));
const nextRef=new Function('E',helper+';return btNextReference')(E);
for(const mode of ['wick','close','average']){const c={...cfg,ref:{...cfg.ref,anchorMode:mode}},i=1000,got=nextRef(ctx,c,i),cut=bars.slice(i-119,i+1),hi=cut.map(b=>mode==='close'?b.close:b.high).sort((a,b)=>b-a),lo=cut.map(b=>mode==='close'?b.close:b.low).sort((a,b)=>a-b),k=mode==='average'?5:1;near(got.hi,hi.slice(0,k).reduce((a,b)=>a+b)/k);near(got.lo,lo.slice(0,k).reduce((a,b)=>a+b)/k)}
const html=read('docs/index.html');for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
// A guest-gated control moved into a disclosure must become interactive after sign-in.
const gateLine=read('worker/chart-enhancements.js').split('\n').find(s=>s.includes("card.querySelectorAll('[data-member-gated]')")),applyGate=new Function('document','isMember',gateLine),child={dataset:{},classList:{contains:()=>false},inert:false},group={dataset:{},classList:{contains:()=>false},inert:false},card={children:[child],querySelectorAll:()=>child.dataset.memberGated!==undefined?[child]:[]},doc={querySelectorAll:()=>[card]};
applyGate(doc,false);assert.equal(child.inert,true);card.children=[group];applyGate(doc,true);assert.equal(child.inert,false);assert.equal(group.inert,false);applyGate(doc,false);assert.equal(child.inert,true);assert.equal(group.inert,true);
assert.ok(!html.includes('max="400"'));assert.ok(html.includes('max="2400"'));assert.ok(html.includes('Math.min(all.length-1,raw)'));
console.log('PASS ph5: deposit-neutral viewport, NAV extrema, local MDD, ties/missing samples, attribution identity, real ETF benchmark NAV, exact next reference and compiled scripts.');

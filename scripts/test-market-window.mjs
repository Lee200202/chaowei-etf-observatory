// All six market factors score against one reference count (settings.marketWindow), never the ETF observation window.
import fs from 'node:fs';import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(p,'utf8');
const client=read('worker/client.js'),body=name=>{const i=client.indexOf('function '+name+'(');assert.ok(i>=0,name);return client.slice(i,client.indexOf('\n',i))};
for(const fn of ['computeMarket','computeFx']){assert.match(body(fn),/n=marketN\(\)/,fn+' uses marketN');assert.doesNotMatch(body(fn),/settings\.window/,fn+' ignores the ETF window')}
for(const f of ['worker/market-extras.js','worker/market-factor-config.js','worker/indicator-directions.js','worker/market-bank.js'])assert.doesNotMatch(read(f),/settings\.window\b/,f);
assert.match(read('worker/redesign.js'),/\.slice\(-marketN\(\)\)/,'card percentile uses the same N');assert.match(read('worker/chart-enhancements.js'),/const n=marketN\(\);/,'intraday volume uses the same N');
// marketN keeps the stored value inside 20–2400 and defaults to 120.
const settings={};const marketN=new Function('settings',body('marketN')+';return marketN')(settings);
assert.equal(marketN(),120);settings.marketWindow=5;assert.equal(marketN(),20);settings.marketWindow=99999;assert.equal(marketN(),2400);settings.marketWindow='240';assert.equal(marketN(),240);
// Real TAIEX: the index position with N=120 and N=240 uses exactly the prior N closes.
const rows=JSON.parse(read('pages-data/history/market.json')).rows.map(r=>({date:r[0],index:r[3]})),last=rows.at(-1);
for(const n of [120,240]){const prior=rows.slice(-1-n,-1).map(r=>r.index),lo=Math.min(...prior),hi=Math.max(...prior),pos=(last.index-lo)/(hi-lo);assert.equal(prior.length,n);assert.ok(pos>=-1&&pos<=2)}
console.log('PASS market window: index, volume, FX, oil, margin, bank, card percentile and intraday volume share one reference count (20–2400, default 120).');

const direction=new Function(read('worker/indicator-direction-core.js')+';return IndicatorDirection')();
assert.equal(direction.vixScore(undefined),null);
assert.equal(direction.vixScore(0),null);
assert.ok(direction.vixScore(13.99)<1);
assert.equal(direction.vixScore(14),1);
assert.equal(direction.vixScore(25),3);
assert.equal(direction.vixScore(30),4);
assert.ok(direction.vixScore(31)>4);
assert.equal(direction.vixScore(40),5);
assert.equal(direction.score('vix',4,'calm_buy'),1);
assert.equal(direction.normalize({}).vix,'fear_buy');
const {renderLookbackTrend,lookbackGauge}=new Function('fmt','ChartReadouts',read('worker/lookback-trends.js')+';return {renderLookbackTrend,lookbackGauge}')(String,{registerMini(){}});
const values=rows.map(row=>[row.date,row.index]);
for(const n of [30,60,120,240,600])assert.match(renderLookbackTrend(values,n,String),new RegExp('data-points="'+n+'"'));
assert.match(renderLookbackTrend(values.slice(-5),30,String),/近 5 筆（可用資料）/);
assert.match(renderLookbackTrend([],30,String),/走勢資料不足/);
assert.match(lookbackGauge(1-direction.vixScore(30)/5,true),/高恐慌/);
const weights=new Function('factorScores',read('worker/chip-weight.js').match(/function weightedScore\(weights\)\{[\s\S]*?\n\}/)[0]+';return weightedScore')(()=>[undefined,1,2,3,4,null,null,null,4]);
assert.equal(weights([0,0,0,0,0,0,0,0,100]).value,4);
assert.equal(weights([0,100,0,0,0,0,0,0,0]).value,1);
assert.equal(weights([0,0,0,0,0,0,0,100,0]).value,null);
console.log('PASS v17: VIX thresholds, directional reversal, ninth weight slot, missing score isolation, and exact chart reference counts.');

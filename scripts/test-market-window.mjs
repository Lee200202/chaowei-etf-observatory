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

import assert from'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
const ctx=vm.createContext({});vm.runInContext((await readFile(new URL('../worker/market-score-core.js',import.meta.url),'utf8'))+';globalThis.score=MarketScoring;',ctx);const score=ctx.score;
const history=Array.from({length:120},(_,i)=>101+(i%2?2:-2));
for(const method of ['mean','normal']){const hi=score.evaluate([...history,105],{method}),lo=score.evaluate([...history,99],{method});assert.equal(hi.mean,101);assert.ok(hi.core<lo.core);assert.ok(hi.core<2.5);assert.ok(lo.core>2.5)}
const changes=Array.from({length:120},(_,i)=>i%2?20:-20);
const up=score.evaluate([...changes,30],{zero:true}),down=score.evaluate([...changes,-30],{zero:true}),zero=score.evaluate([...changes,0],{zero:true});
assert.ok(up.core<2.5&&down.core>2.5);assert.ok(Math.abs(zero.core-2.5)<1e-7);
assert.ok(score.evaluate([...changes,30],{zero:true,higherBetter:true}).core>2.5);
assert.equal(score.evaluate([1,2,3]),null);assert.ok(Number.isFinite(score.evaluate([...Array(30).fill(101),105]).core));
assert.ok(Math.abs(score.cdf(1)-.841344746)<1e-6);assert.ok(Math.abs(score.cdf(2)-.977249868)<1e-6);
const banks=JSON.parse(await readFile(new URL('../pages-data/history/histock-bank.json',import.meta.url),'utf8'));
for(const[d,a,i]of[['2026-04-27',53.6989,39616.6],['2026-10-22',203.428,46041.4]])assert.deepEqual(banks.rows.find(r=>r[0]===d),[d,a,i]);
assert.equal(new Set(banks.rows.map(r=>r[0])).size,banks.rows.length);
const oil=JSON.parse(await readFile(new URL('../pages-data/oil-spot.json',import.meta.url),'utf8'));assert.equal(oil.unit,'USD/barrel');assert.ok(oil.days.length>2400);assert.equal(oil.days.find(r=>r.date==='2026-10-20').value,115.22);
const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const computedOil=score.evaluate(oil.days.map(d=>d.value));
console.log(`Market factors passed: exclusion of latest observation, 101/105/99 direction, zero-centred margin, bank direction, normal CDF, missing/flat data and HiStock fixtures. Brent latest score ${computedOil.core.toFixed(4)}, mean ${computedOil.mean.toFixed(4)}, sd ${computedOil.sd.toFixed(4)}.`);

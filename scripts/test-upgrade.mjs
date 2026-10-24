import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const load=async(file,name,split)=>{let s=await read(file);if(split)s=s.split(split)[0];return vm.runInNewContext(s+'\n'+name)};
const D=await load('worker/indicator-direction-core.js','IndicatorDirection');
for(const key of ['etf','index','oil','margin','bank','fx']){
  const modes=D.meta[key].modes;for(const base of [0,.4,2.5,4.6,5])assert.ok(Math.abs(D.score(key,base,modes[0][0])+D.score(key,base,modes[1][0])-5)<1e-10);
  assert.equal(D.score(key,null,modes[0][0]),null);
}
assert.equal(D.score('fx',.4,'twd_strong_buy'),.4);assert.equal(D.score('fx',.4,'twd_weak_buy'),4.6);
assert.equal(D.score('bank',4.6,'sell_follow'),.40000000000000036);
assert.ok(D.score('volume',null,'smart_pv',{rank:.9,pricePosition:.1})>D.score('volume',null,'smart_pv',{rank:.9,pricePosition:.9}));
assert.equal(D.score('volume',null,'smart_pv',{rank:.9}),null);
assert.equal(D.action(2.5).kind,'neutral');assert.equal(D.action(null).kind,'missing');
const clean=await load('pages-src/cloud-sync.js','sanitizeCloudPayload');
const cycle={good:3};cycle.self=cycle;
const payload=JSON.parse(JSON.stringify(clean({weights:[100,0],missing:undefined,n:NaN,infinite:Infinity,nested:{optional:undefined,ok:false},list:[undefined,4],cycle})));
assert.deepEqual(payload,{weights:[100,0],n:null,infinite:null,nested:{ok:false},list:[null,4],cycle:{good:3}});
const W=await load('worker/wave-backtest-bridge.js','WaveBacktestBridge','const bridge=');
const sample=[{availableDate:'2024-09-01',change:10},{availableDate:'2024-09-20',change:-6},{availableDate:'2024-10-01',change:90},{availableDate:'2025-01-01',change:-70}];
const a=W.summarize(sample,'2024-10-01');assert.equal(a.up,10);assert.equal(a.down,6);assert.equal(a.count,2);assert.equal(W.summarize(sample,'').count,4);
const C=await load('worker/chip-resonance.js','ChipResonance','function normalizeResonance');
const chips=[['2026-01-01',0,0,0,5],['2026-01-02',0,0,0,5],['2026-01-03',0,0,0,5]],holders=[['2025-12-20','0050',50,40],['2025-12-27','0050',51,42]];
assert.equal(C.evaluate(chips,holders).score,5);assert.equal(C.evaluate(chips,holders,{through:'2026-01-02'}).score,null);assert.equal(C.evaluate(chips,[]).score,null);
assert.equal(C.evaluate(chips,[holders[0],['2025-12-27','0050',49,38]]).score,2.5);
chips[1][4]=-5;assert.equal(C.evaluate(chips,holders).score,2.5);
const html=await read('docs/index.html');assert.ok(!html.includes('__ENHANCEMENTS__'));for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
console.log('Upgrade checks passed: all seven directions, missing data, FX semantics, cloud invalid fields/cycles, training cutoff exclusion, current chip resonance and browser script syntax.');

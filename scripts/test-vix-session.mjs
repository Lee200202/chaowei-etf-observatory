// VIX: a finished Yahoo session becomes a provisional close; an open session or an older quote does not; Cboe replaces it.
import fs from 'node:fs';import assert from 'node:assert/strict';
const src=fs.readFileSync('worker/ph16.js','utf8').replace(/\r\n/g,'\n'),i=src.indexOf('  function absorbSession(){'),j=src.indexOf('\n  }\n',i)+4;assert.ok(i>0&&j>i,'absorbSession present');
const mergeDays=new Function(fs.readFileSync('worker/chart-enhancements.js','utf8').match(/function mergeDays\(base,extra\)\{.*?\n?\}(?=\n|$)/m)[0].split('\n')[0]+';return mergeDays')();
const make=(days,q,now)=>{const env={live:{vixQuote:q},vixDays:days};const f=new Function('env','mergeDays','Date',`let live=env.live,vixDays=env.vixDays;${src.slice(i,j)};const r=absorbSession();return{r,vixDays}`);
  const D=class extends Date{static now(){return now}};D.parse=Date.parse;return f(env,mergeDays,D)};
const days=[{date:'2026-11-06',value:25.64},{date:'2026-11-09',value:19.92}];
const q={symbol:'^VIX',date:'2026-11-10',price:19.46,time:'2026-11-10T21:15:00Z',endTime:'2026-11-10T21:15:00Z'};
// After the close: the 11-10 session is added as provisional.
let o=make(days,q,Date.parse('2026-11-11T03:00:00Z'));assert.equal(o.r,true);assert.deepEqual(o.vixDays.at(-1),{date:'2026-11-10',value:19.46,provisional:true});
// Before the session ends nothing is added (the card shows it as a live estimate instead).
o=make(days,{...q,time:'2026-11-10T18:00:00Z'},Date.parse('2026-11-10T18:05:00Z'));assert.equal(o.r,false);assert.equal(o.vixDays.at(-1).date,'2026-11-09');
// A quote for a day already closed by Cboe, or an older day, never overwrites Cboe.
o=make([...days,{date:'2026-11-10',value:19.46}],{...q,price:19.5},Date.parse('2026-11-11T03:00:00Z'));assert.equal(o.r,false);
o=make(days,{...q,date:'2026-11-06'},Date.parse('2026-11-11T03:00:00Z'));assert.equal(o.r,false);
// Cboe's file merged later replaces the provisional row.
const merged=mergeDays(make(days,q,Date.parse('2026-11-11T03:00:00Z')).vixDays,[{date:'2026-11-10',value:19.46}]);assert.equal(merged.at(-1).provisional,undefined);
// CI runs again after the US close.
assert.match(fs.readFileSync('.github/workflows/deploy-pages.yml','utf8'),/cron: '30 22 \* \* 1-5'/);
console.log('PASS VIX session: finished session added as provisional close, open or older sessions ignored, Cboe replaces it, post-close CI schedule present.');

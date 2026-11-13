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
// Scoring value: the live quote while its session is open and under 45 minutes old, otherwise the last daily close.
const cfg=fs.readFileSync('worker/market-factor-config.js','utf8').replace(/\r\n/g,'\n'),k=cfg.indexOf('function vixLatest(){'),e=cfg.indexOf('\n}\n',k)+3;
const latest=(vixDays,q,now)=>{const D=class extends Date{static now(){return now}};D.parse=Date.parse;return new Function('vixDays','live','Date',cfg.slice(k,e)+';return vixLatest()')(vixDays,{vixQuote:q},D)};
const open={symbol:'^VIX',date:'2026-11-11',price:21.3,time:'2026-11-11T15:00:00Z',endTime:'2026-11-11T21:15:00Z'};
assert.deepEqual(latest(days,open,Date.parse('2026-11-11T15:04:00Z')),{date:'2026-11-11',value:21.3,time:open.time,intraday:true});
assert.equal(latest(days,open,Date.parse('2026-11-11T21:30:00Z')).date,'2026-11-09','after the close the daily row is used');
assert.equal(latest(days,open,Date.parse('2026-11-11T16:00:00Z')).date,'2026-11-09','a quote older than 45 minutes is not used');
assert.equal(latest([],null,Date.now()),null);
assert.equal(latest(days,{...open,time:'2026-11-11T16:00:00Z'},Date.parse('2026-11-11T15:00:00Z')).date,'2026-11-09','a future timestamp cannot become a live quote');
// Recover every missing daily date while keeping an official value over a delayed provisional close.
const a=src.indexOf('  function acceptVixDays('),z=src.indexOf('\n  function paintVix',a);
assert.ok(a>0&&z>a);
const recover=new Function('vixDays','rows','mergeDays',src.slice(a,z)+';acceptVixDays(rows);return vixDays;');
const recovered=recover([{date:'2026-11-10',value:19.46}],[{date:'2026-11-10',value:99,provisional:true},{date:'2026-11-11',value:17.49,provisional:true},{date:'2026-11-12',value:18.7,provisional:true}],mergeDays);
assert.deepEqual(recovered.map(d=>d.date),['2026-11-10','2026-11-11','2026-11-12']);
assert.equal(recovered[0].value,19.46);
const confirmed=recover(recovered,[{date:'2026-11-11',value:17.48}],mergeDays);
assert.equal(confirmed[1].value,17.48);assert.equal(confirmed[1].provisional,undefined);
// CI runs again after the US close.
assert.match(fs.readFileSync('.github/workflows/deploy-pages.yml','utf8'),/cron: '30 22 \* \* 1-5'/);
console.log('PASS VIX session: live quote scores while the session is open and fresh, finished session added as provisional close, open or older sessions ignored, Cboe replaces it, post-close CI schedule present.');

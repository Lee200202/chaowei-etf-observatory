import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Homepage and detail share one pending quote and one four-minute result, including in GAS.
let clock=1000000,calls=0,reply;
class Clock extends Date{static now(){return clock}}
const run={withSuccessHandler(fn){reply=fn;return this},withFailureHandler(){return this},getQuote(){calls++}};
const google={script:{run}},qbox={window:{google},google,Date:Clock,Map,Promise};vm.createContext(qbox);
vm.runInContext(fs.readFileSync('pages-src/quote-layer.js','utf8')+";installChaoweiQuote('')",qbox);
const a=qbox.window.CHAOWEI_QUOTE('0050'),b=qbox.window.CHAOWEI_QUOTE('0050');assert.equal(calls,1);
reply({available:true,code:'0050',date:'2026-10-29',price:107.25});assert.equal((await a).price,107.25);assert.equal((await b).price,107.25);
await qbox.window.CHAOWEI_QUOTE('0050');assert.equal(calls,1);clock+=241000;const c=qbox.window.CHAOWEI_QUOTE('0050');assert.equal(calls,2);reply({available:false});await c;
// Current-price marking is an estimate of existing holdings, never a trade or backtest mutation.
const bt=fs.readFileSync('worker/backtest.js','utf8'),fn=bt.slice(bt.indexOf('function btRenderQuote(){'),bt.indexOf("window.addEventListener('chaowei-quote-updated'"));
const element={dataset:{},classList:{toggle(k,value){this[k]=value}},textContent:''},r={end:'2026-10-28',cash:10000,shares:5000,equity:510000};
const box={isMember:true,btResult:r,liveQuote:{available:true,date:'2026-10-29',time:'2026-10-29T05:30:00Z',price:110,previousClose:100,isClose:true},bars:[{date:'2026-10-28',close:100}],$:()=>element,Date,String,fmt:(v,d)=>Number(v).toFixed(d),money:v=>String(v)};
vm.createContext(box);vm.runInContext(fn,box);box.btRenderQuote();assert.match(element.textContent,/560000/);assert.match(element.textContent,/50000/);assert.equal(element.classList.hidden,false);assert.equal(r.equity,510000);
box.btResult={...r,end:'2024-12-31'};box.btRenderQuote();assert.equal(element.classList.hidden,true,'custom historical windows do not get a today estimate');
box.btResult=r;box.isMember=false;box.btRenderQuote();assert.equal(element.classList.hidden,true);
box.isMember=true;box.liveQuote.previousClose=25;box.btRenderQuote();assert.equal(element.classList.hidden,true,'suspected split basis mismatch cannot be marked');
// Large market-card headline and detail share the same newest observation; daily history stays immutable.
const red=fs.readFileSync('worker/redesign.js','utf8'),display=red.slice(red.indexOf('function marketDisplaySeries(key){'),red.indexOf(' const factorDefs='));
const history=[{date:'2026-10-28',index:47035.58,volume:9001000000}],model={market:history,live:{intraday:{date:'2026-10-29',time:'13:33:00',index:46368.33,lots:9995117}},Number};
vm.createContext(model);vm.runInContext(display,model);assert.equal(model.marketDisplaySeries('index').at(-1).value,46368.33);assert.equal(model.marketDisplaySeries('volume').at(-1).value,99.95117);assert.equal(history.length,1);
model.live.intraday.time='11:00:00';assert.equal(model.marketDisplaySeries('volume').at(-1).partialVolume,true,'partial volume cannot enter full-session historical rank');
model.live.intraday.date='2026-10-27';assert.equal(model.marketDisplaySeries('index').at(-1).date,'2026-10-28','old live bundle cannot override a newer daily close');
console.log('PASS live refresh: shared/deduplicated quote TTL, retry after unavailable, current holding mark arithmetic, old-window/member/split guards; no backtest mutations.');

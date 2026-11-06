import assert from'node:assert/strict';import vm from'node:vm';import{readFile}from'node:fs/promises';
// Yahoo daily bars: midnight New York stamps (EST after 1 Nov), a bar still trading (null close) and the live quote point.
const at=(d,h,m=0)=>Date.UTC(...d.split('-').map((x,i)=>i===1?x-1:+x),h,m)/1000;
const DAILY={chart:{result:[{meta:{symbol:'BZ=F',currency:'USD'},timestamp:[at('2026-10-30',4),at('2026-11-03',5),at('2026-11-04',5),at('2026-11-05',5),at('2026-11-06',0,10)],indicators:{quote:[{close:[117.6399993,103.5999984,94.6200027,null,99.11]}]}}]}};
const ny=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const Utilities={formatDate:(d,zone,fmt)=>{assert.equal(zone,'America/New_York');const p=Object.fromEntries(ny.formatToParts(d).map(x=>[x.type,x.value]));return fmt==='HH:mm'?p.hour+':'+p.minute:p.year+'-'+p.month+'-'+p.day}};
const cache=new Map(),requests=[],box={console,Date,JSON,Number,String,Math,Utilities,CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},storeProps_:()=>({getProperty:()=> 'secret-test-token'}),liveNum_:x=>Number(String(x).replaceAll(',','')),storeRound_:(v,d)=>Math.round(v*10**d)/10**d,UrlFetchApp:{fetch:(url,options)=>{requests.push({url,options});return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.includes('interval=1d')?DAILY:{chart:{result:[{meta:{symbol:'BZ=F',currency:'USD',regularMarketPrice:111.66,regularMarketTime:1792789159,previousClose:108.66}}]}})}}}};
vm.createContext(box);vm.runInContext(await readFile(new URL('../gas/MarketSources.gs',import.meta.url),'utf8'),box);
const oil=box.oilSpot_();assert.deepEqual(JSON.parse(JSON.stringify(oil.days)),[{date:'2026-10-30',value:117.64},{date:'2026-11-03',value:103.6},{date:'2026-11-04',value:94.62}]);assert.equal(oil.source,'Yahoo Finance BZ=F');assert.ok(requests[0].url.includes('BZ%3DF?interval=1d'));assert.ok(!requests[0].options.headers,'no token is sent to Yahoo');box.oilSpot_();assert.equal(requests.length,1,'cached');
// The CI parser reads the same bars to the same days.
const{parseYahooDaily}=await import('./yahoo-brent.mjs');assert.deepEqual(parseYahooDaily(DAILY),JSON.parse(JSON.stringify(oil.days)));assert.throws(()=>parseYahooDaily({chart:{result:[{meta:{symbol:'CL=F',currency:'USD'}}]}}),/格式異常/);
const q=box.oilFuture_();assert.equal(q.price,111.66);assert.equal(q.symbol,'BZ=F');assert.equal(q.delayed,true);assert.equal(q.time,new Date(1792789159000).toISOString());
assert.throws(()=>box.yahooMarketQuote_('TWD=X','TWD','TWD/USD'),/格式異常/);
box.UrlFetchApp.fetch=(url)=>{
  assert.match(url,/TWD%3DX\?interval=5m/);
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({chart:{result:[{meta:{
    symbol:'TWD=X',currency:'TWD',regularMarketPrice:32.962,regularMarketTime:1793932243
  }}]}})};
};
const fx=box.yahooMarketQuote_('TWD=X','TWD','TWD/USD');
assert.equal(fx.price,32.962);
assert.equal(fx.unit,'TWD/USD');
assert.equal(fx.time,'2026-11-06T02:30:43.000Z');
assert.equal(fx.delayed,true);
const table=total=>'<option value="20260911" selected>'+[12,13,14,15].map((n,i)=>`<tr><td>${n}</td><td>bucket</td><td>${i+1}</td><td>${(i+1)*100000}</td><td>1</td></tr>`).join('')+`<tr><td>${total}</td><td>合 計</td><td>20</td><td>10000000</td><td>100</td></tr>`;
for(const total of[16,17]){const r=box.tdccParse_(table(total),'0050','20260911');assert.equal(r[0],'2026-09-11');assert.equal(r[2],10);assert.equal(r[3],4);assert.equal(r[4],10);assert.equal(r[5],4)}
assert.throws(()=>box.tdccParse_(table(17),'0050','20260918'),/日期不符/);
let batches=0;
box.UrlFetchApp.fetchAll=queries=>{batches++;return queries.map((q,i)=>{
  if(q.method==='post'){assert.equal(q.headers.Cookie,'session='+i);assert.equal(q.payload.SYNCHRONIZER_TOKEN,'token'+i);assert.equal(q.payload.stockNo,'0050');return{getResponseCode:()=>200,getContentText:()=>table(17).replaceAll('20260911',q.payload.scaDate)}}
  return{getResponseCode:()=>200,getContentText:()=>'<input name="SYNCHRONIZER_TOKEN" value="token'+i+'"><option value="20261022">',getAllHeaders:()=>({'Set-Cookie':['session='+i+'; Path=/']})};
})};
const parallel=box.tdccRows_('0050',['20260911','20260918','20260924','20261002']);assert.equal(parallel.length,4);assert.equal(parallel[3][0],'2026-10-02');assert.equal(batches,2);
console.log('Market sources passed: Yahoo BZ=F daily closes (New York dates, unfinished bar skipped, GAS and CI parsers agree), USD spot, server-only token, caching, delayed futures timestamp, TDCC 16/17-row totals and 400/1000-lot aggregation.');

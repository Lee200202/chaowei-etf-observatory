import assert from 'node:assert/strict';
const base=process.env.CHAOWEI_BASE_URL||'http://127.0.0.1:4173';
async function get(path){const response=await fetch(base+path);const data=await response.json();assert.equal(response.status,200,`${path}: ${data.error||response.status}`);return data}
const [etfs,a,b,c,market,brent,fx]=await Promise.all([
  get('/api/etfs'),get('/api/bars?code=0050'),get('/api/bars?code=0056'),get('/api/bars?code=00981A'),get('/api/market'),get('/api/brent'),get('/api/fx')
]);
assert.equal(etfs.etfs.length,10);
assert(etfs.etfs.some(e=>e.code==='00981A'&&e.type==='active'));
for(const d of [a,b,c]){
  assert(d.bars.length>200,`${d.code}: too few valid bars`);
  assert.equal(d.missingMonths,0,`${d.code}: missing months`);
  assert(d.bars.every((x,i,rows)=>Number.isFinite(x.close)&&x.high>=x.low&&x.high>=x.close&&x.low<=x.close&&(!i||rows[i-1].date<x.date)),`${d.code}: malformed OHLC/order`);
}
const before=a.bars.find(x=>x.date==='2025-06-10'),after=a.bars.find(x=>x.date==='2025-06-18');
assert(before&&after,'0050 split dates missing');
assert(Math.abs(after.close/before.close-1)<.2,'0050 split adjustment creates artificial gap');
assert(market.days.length>600&&market.days.every(x=>Number.isFinite(x.volume)&&x.volume>0));
assert(brent.days.length>=600&&fx.days.length>=600);
assert(brent.latest<=a.latest&&fx.latest<=a.latest,'factor data extends beyond selected ETF date');
console.log(JSON.stringify({result:'pass',etfs:etfs.etfs.length,barCounts:{'0050':a.bars.length,'0056':b.bars.length,'00981A':c.bars.length},marketDays:market.days.length,brentLatest:brent.latest,fxLatest:fx.latest,splitBefore:before.close,splitAfter:after.close},null,2));

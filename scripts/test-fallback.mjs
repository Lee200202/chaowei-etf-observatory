import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
const original=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Simulated upstream outage')};
try{
  const response=await worker.fetch(new Request('https://example.invalid/api/brent'));
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.snapshot,true);
  assert(data.days.length>=600);
  assert(data.latest<=new Date().toISOString().slice(0,10));
  console.log(JSON.stringify({result:'pass',fallback:'EIA snapshot',latest:data.latest,count:data.days.length}));
}finally{globalThis.fetch=original}

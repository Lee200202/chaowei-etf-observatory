import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

const base=new URL('../pages-data/history/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,base),'utf8'));
const files=(await readdir(base)).filter(x=>/^[0-9A-Z]{4,6}\.json$/.test(x));
assert(files.length>=200,`only ${files.length} ETF history files`);
let barCount=0;
for(const file of files){
  const d=await read(file);
  assert.equal(d.code,file.slice(0,-5));
  assert(Array.isArray(d.rows)&&d.rows.length>0,`${file}: no rows`);
  let previous='';
  for(const [date,open,high,low,close,volume] of d.rows){
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>previous,`${file}: unsorted date ${date}`);
    assert([open,high,low,close,volume].every(Number.isFinite),`${file}: non-finite bar ${date}`);
    assert(open>0&&close>0&&low>0&&high>=Math.max(open,close,low)&&low<=Math.min(open,close)&&volume>=0,`${file}: invalid OHLCV ${date}`);
    previous=date;barCount++;
  }
  assert.equal(d.first,d.rows[0][0]);assert.equal(d.latest,previous);
}
const etf50=await read('0050.json'),etf816=await read('009816.json'),market=await read('market.json'),meta=await read('_meta.json');
assert(etf50.rows.length>2200,'0050 ten-year series is incomplete');
assert(etf50.first<='2016-11-01','0050 start is too recent');
assert(etf816.rows.length>100,'009816 missing listing history');
assert(market.rows.length>2200,'market ten-year series is incomplete');
assert.equal(meta.etfFiles,files.length);
console.log(`Verified ${files.length} ETF files, ${barCount} OHLCV bars, 0050 ${etf50.first}–${etf50.latest}, 009816 ${etf816.first}–${etf816.latest}, market ${market.first}–${market.latest}`);

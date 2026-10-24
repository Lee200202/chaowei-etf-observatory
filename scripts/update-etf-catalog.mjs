import {writeFile} from 'node:fs/promises';

// A dated snapshot keeps the search usable when the exchange catalogue is offline.
const url='https://www.twse.com.tw/zh/ETFortune/ajaxProductsResult';
const res=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:''});
if(!res.ok)throw Error(`TWSE catalogue HTTP ${res.status}`);
const data=await res.json();
if(data.status!=='success'||!Array.isArray(data.data)||data.data.length<100)throw Error('TWSE catalogue response is incomplete');
const taipeiToday=new Date(Date.now()+28800000).toISOString().slice(0,10);
const etfs=data.data.map(x=>({
  code:String(x.stockNo).trim(),
  name:String(x.stockName).trim(),
  type:String(x.stockNo).endsWith('A')?'active':'passive',
  note:String(x.indexName||'主動管理').trim(),
  listingDate:String(x.listingDate||'').replaceAll('.','-'),
  market:'TWSE'
})).filter(x=>/^[0-9A-Z]{4,6}$/.test(x.code)&&x.name&&(!x.listingDate||x.listingDate<=taipeiToday));
if(!etfs.some(x=>x.code==='009816'))throw Error('009816 missing from TWSE catalogue');
const output={source:url,updated:taipeiToday,etfs};
await writeFile(new URL('../worker/etf-catalog.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(`Saved ${etfs.length} TWSE ETFs, including 009816`);

import {readFile} from 'node:fs/promises';

// Read-only internal comparison. Nothing from FinMind is written into public files.
const root=new URL('../',import.meta.url);
const local=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const date=new Date();date.setUTCDate(date.getUTCDate()-14);
const since=date.toISOString().slice(0,10);
const token=process.env.FINMIND_API_TOKEN?.trim();
async function query(dataset,dataId){
  const url=new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset',dataset);url.searchParams.set('data_id',dataId);url.searchParams.set('start_date',since);
  const headers=token?{Authorization:`Bearer ${token}`}:{},response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
  const payload=await response.json();
  if(!response.ok||payload.status!==200||!Array.isArray(payload.data))throw Error(`${dataset}: HTTP ${response.status}; ${String(payload.msg||'invalid response').slice(0,100)}`);
  return payload.data.sort((a,b)=>a.date.localeCompare(b.date));
}
const [brent,etf,fx]=await Promise.all([
  query('CrudeOilPrices','Brent'),query('TaiwanStockPrice','0050'),query('TaiwanExchangeRate','USD')
]);
const eia=(await local('pages-data/brent.json')).days,twse=(await local('pages-data/history/0050.json')).rows,cbc=(await local('pages-data/fx.json')).days;
const latest=rows=>rows.at(-1),sameDate=(rows,key,day)=>rows.find(r=>r.date===day)?.[key];
const oil=latest(brent),bar=latest(etf),bank=latest(fx);
console.log(`FinMind 內部驗證（${token?'自備 token':'匿名額度'}；不寫入公開檔案）`);
if(oil){const official=sameDate(eia,'value',oil.date);console.log(`Brent 現貨：FinMind ${oil.date} ${oil.price} 美元／桶；本站 EIA 同日 ${official??'無資料'}；差 ${Number.isFinite(official)?(oil.price-official).toFixed(2):'—'}`)}
if(bar){const official=twse.find(r=>r[0]===bar.date);console.log(`0050 日 K：FinMind ${bar.date} 收 ${bar.close}、量 ${bar.Trading_Volume} 股；本站證交所同日收 ${official?.[4]??'無資料'}、量 ${official?.[5]??'無資料'} 股`)}
if(bank){const mid=(bank.spot_buy+bank.spot_sell)/2,central=sameDate(cbc,'value',bank.date);console.log(`USD/TWD：FinMind ${bank.date} 銀行即期買 ${bank.spot_buy}／賣 ${bank.spot_sell}（中價 ${mid.toFixed(3)}）；本站央行 ${bank.date} 匯率 ${central??'尚未公布'}。兩者口徑不同，不直接替換。`)}
console.log('資料頻率：FinMind 原油為延遲現貨日資料；0050 為盤後日 K。五分鐘查詢不會形成五分鐘新報價。');

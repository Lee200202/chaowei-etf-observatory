import {readFile} from 'node:fs/promises';
import {brfNearMonth,finmindBrf} from './brf-near.mjs';

// Read-only internal comparison: FinMind's fresh answers against the files the site publishes.
// Brent: the published BRF near-month snapshot is itself from FinMind, so this checks it was copied faithfully.
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
const [brf,etf,fx]=await Promise.all([finmindBrf(since).then(brfNearMonth),query('TaiwanStockPrice','0050'),query('TaiwanExchangeRate','USD')]);
const site=(await local('pages-data/brent.json')).days,twse=(await local('pages-data/history/0050.json')).rows,cbc=(await local('pages-data/fx.json')).days;
const sameDate=(rows,key,day)=>rows.find(r=>r.date===day)?.[key];
const oil=brf.at(-1),bar=etf.at(-1),bank=fx.at(-1);
console.log(`FinMind 內部驗證（${token?'自備 token':'匿名額度'}；不寫入公開檔案）`);
if(oil){const saved=site.find(r=>r.date===oil.date);console.log(`BRF 近月：FinMind ${oil.date} ${oil.contract} 結算 ${oil.value} 新台幣／桶；本站快照同日 ${saved?`${saved.contract} ${saved.value}`:'尚無'}`)}
if(bar){const official=twse.find(r=>r[0]===bar.date);console.log(`0050 日 K：FinMind ${bar.date} 收 ${bar.close}、量 ${bar.Trading_Volume} 股；本站證交所同日收 ${official?.[4]??'無資料'}、量 ${official?.[5]??'無資料'} 股`)}
if(bank){const mid=(bank.spot_buy+bank.spot_sell)/2,central=sameDate(cbc,'value',bank.date);console.log(`USD/TWD：FinMind ${bank.date} 銀行即期買 ${bank.spot_buy}／賣 ${bank.spot_sell}（中價 ${mid.toFixed(3)}）；本站央行 ${bank.date} 匯率 ${central??'尚未公布'}。兩者口徑不同，不直接替換。`)}
console.log('資料頻率：BRF 為期交所每日結算價（一般交易時段收盤後）；0050 為盤後日 K。五分鐘查詢不會形成五分鐘新報價。');

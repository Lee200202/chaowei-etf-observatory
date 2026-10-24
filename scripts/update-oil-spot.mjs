import{readFile,writeFile}from'node:fs/promises';
const file=new URL('../pages-data/oil-spot.json',import.meta.url);let old={days:[]};try{old=JSON.parse(await readFile(file,'utf8'))}catch{}
const start=old.latest?new Date(Date.parse(old.latest)-30*86400000).toISOString().slice(0,10):'2016-01-01';
const u=new URL('https://api.finmindtrade.com/api/v4/data');u.search=new URLSearchParams({dataset:'CrudeOilPrices',data_id:'Brent',start_date:start});
const token=process.env.FINMIND_API_TOKEN,headers=token?{Authorization:'Bearer '+token}:{};
const r=await fetch(u,{headers,signal:AbortSignal.timeout(45000)}),d=await r.json();if(!r.ok||d.status!==200||!Array.isArray(d.data))throw Error('FinMind Brent: '+r.status+' '+d.msg);
const byDate=new Map(old.days.map(x=>[x.date,x]));for(const x of d.data){if(/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.name==='Brent'&&Number.isFinite(Number(x.price))&&Number(x.price)>0)byDate.set(x.date,{date:x.date,value:Number(x.price)})}
const days=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));if(days.length<360)throw Error('Brent spot history too short');
await writeFile(file,JSON.stringify({source:'FinMind CrudeOilPrices Brent',sourceUrl:'https://finmind.github.io/tutor/Materials/',unit:'USD/barrel',frequency:'daily',notice:'現貨日資料，通常延遲數個交易日；非即時期貨',latest:days.at(-1).date,days})+'\n');console.log(`FinMind Brent spot: ${days.length} days, ${days[0].date} through ${days.at(-1).date}, ${days.at(-1).value} USD/barrel`);

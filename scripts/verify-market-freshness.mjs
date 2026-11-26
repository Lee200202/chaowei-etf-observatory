// Public endpoints only: no secrets, no account data. Keep source dates separate from check times.
import {mkdir,writeFile} from 'node:fs/promises';
import {GAS_PUBLIC,publicJson,lastDate,businessAge} from './market-health-core.mjs';
const base='https://lee200202.github.io/chaowei-etf-observatory/';
const files=['history/0050','history/market','history/margin','fx','oil-spot','vix','options-pcr','retail-ratio','history/histock-bank'];
const report={checkedAt:new Date().toISOString(),series:[],errors:[]};
const payload={},published={};
await Promise.all(files.map(async file=>{
  try {const data=await publicJson(base+'data/'+file+'.json?health='+Date.now());
    const date=lastDate(data),age=businessAge(date);published[file]=date;
    report.series.push({name:file,kind:'published-daily',date,businessDaysOld:age});
    if(age>5)report.errors.push(file+' 超過五個平日未更新：'+date);
  }catch(e){report.errors.push(file+': '+e.message)}
}));
// Compare to the source's actual latest published date, not just an age threshold.
await Promise.all([
  (async()=>{
    try{
      const ym=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,7).replace('-','');
      const d=await publicJson('https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date='+ym+'01&response=json');
      if(d.stat!=='OK'||!d.data?.length)throw Error('TWSE 無可用月份資料');
      const dates=d.data.map(r=>{const [y,m,day]=r[0].split('/');return (+y+1911)+'-'+m.padStart(2,'0')+'-'+day.padStart(2,'0')}).sort();
      const latest=dates.at(-1);report.series.push({name:'TWSE 官方最新日',kind:'upstream-reference',date:latest});
      for(const key of ['history/market','history/0050'])if(published[key]<latest)report.errors.push(key+' 落後 TWSE 已公布資料：'+published[key]+' < '+latest);
    }catch(e){report.errors.push('TWSE 來源日期核對：'+e.message)}
  })(),
  (async()=>{
    try{
      const d=await publicJson('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day');
      const raw=d.map(r=>String(r['日期']||'')).filter(d=>/^\d{8}$/.test(d)).sort().at(-1);
      if(!raw)throw Error('CBC 無日期');
      const latest=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6);
      report.series.push({name:'CBC 官方最新日',kind:'upstream-reference',date:latest});
      if(published.fx<latest)report.errors.push('fx 落後央行已公布資料：'+published.fx+' < '+latest);
    }catch(e){report.errors.push('CBC 來源日期核對：'+e.message)}
  })()
]);
await Promise.all(['live','vix','taifex','bank','quote&code=0050'].map(async api=>{
  try{const d=await publicJson(GAS_PUBLIC+'?api='+api);payload[api]=d;
    if(d.error||d.errors?.length)report.errors.push(api+': '+(d.error||d.errors.join('; ')));
    const entries=api==='live'?[['大盤盤中',d.intraday?.date,d.intraday?.time],['原油延遲',d.oilFuture?.time?.slice(0,10),d.oilFuture?.time],['匯率延遲',d.fxQuote?.time?.slice(0,10),d.fxQuote?.time]]:
      api==='taifex'?[['PCR',d.pcr?.at(-1)?.[0]],['散戶多空比',d.retail?.at(-1)?.[0]]]:
      api==='vix'?[['VIX 延遲',d.quote?.date||lastDate(d),d.quote?.time]]:
      api==='bank'?[['官股雲端',lastDate(d)]]:[['0050 盤中',d.date,d.time]];
    for(const [name,date,time]of entries){report.series.push({name,kind:'public-api',date,time});if(businessAge(date)>5)report.errors.push(name+' 無可用近期資料：'+date)}
    if(api==='quote&code=0050'&&!d.available)report.errors.push('0050 報價不可用');
  }catch(e){report.errors.push(api+': '+e.message)}
}));
// On an active Taiwan session, yesterday's date or an old heartbeat is a failure, not a successful refresh.
const now=new Date(),today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
const hm=now.toLocaleTimeString('en-GB',{timeZone:'Asia/Taipei',hour12:false}).slice(0,5);
const intraday=payload.live?.intraday,quote=payload['quote&code=0050'];
if(intraday?.date===today&&hm>='09:10'&&hm<='13:30'){
  const at=Date.parse(today+'T'+intraday.time+'+08:00');
  if(!Number.isFinite(at)||+now-at>10*60000)report.errors.push('大盤盤中超過十分鐘未更新');
  if(quote?.date!==today||!quote?.time||+now-Date.parse(quote.time)>10*60000)report.errors.push('0050 盤中超過十分鐘未更新');
}
report.series.sort((a,b)=>a.name.localeCompare(b.name));
await mkdir('action-health',{recursive:true});
await writeFile('action-health/freshness.json',JSON.stringify(report,null,2));
console.table(report.series);
if(report.errors.length){console.error(report.errors.join('\n'));process.exitCode=1}

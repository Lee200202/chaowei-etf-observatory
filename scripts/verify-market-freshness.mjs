// Public endpoints only: no secrets, no account data. Keep source dates separate from check times.
import {mkdir,writeFile} from 'node:fs/promises';
import {GAS_PUBLIC,publicJson,lastDate,businessAge,publicationState} from './market-health-core.mjs';
import {parseTwseCalendar,checkTaiwanQuotes,taiwanTradingAge} from './market-session-health.mjs';
const now=new Date();
const base='https://lee200202.github.io/chaowei-etf-observatory/';
const files=['history/0050','history/market','history/margin','fx','oil-spot','vix','options-pcr','retail-ratio','history/histock-bank'];
const report={checkedAt:new Date().toISOString(),series:[],errors:[],pending:[]};
const payload={},published={};
const taiwanDaily=new Set(['history/0050','history/market','history/margin','fx','options-pcr','retail-ratio','history/histock-bank']);
let upstreamTwse=null,calendar=null;
function comparePublished(key,upstream,label){
  const state=publicationState(published[key],upstream,now);
  if(state==='current')return;
  const message=key+' 落後 '+label+' 已公布資料：'+published[key]+' < '+upstream;
  if(state==='awaiting-evening-publish')report.pending.push(message+'；等待晚間發布，22:00後仍落後才判定逾時');
  else report.errors.push(message);
}
await Promise.all(files.map(async file=>{
  try {const data=await publicJson(base+'data/'+file+'.json?health='+Date.now());
    const date=lastDate(data),age=businessAge(date);published[file]=date;
    report.series.push({name:file,kind:'published-daily',date,businessDaysOld:age});
    if(!taiwanDaily.has(file)&&age>5)report.errors.push(file+' 超過五個平日未更新：'+date);
  }catch(e){report.errors.push(file+': '+e.message)}
}));
// Compare to the source's actual latest published date, not just an age threshold.
await Promise.all([
  (async()=>{
    try{
      const month=new Date(now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,7)+'-01T00:00:00Z');
      let d;
      for(let back=0;back<2;back++){
        const ym=month.toISOString().slice(0,7).replace('-','');
        d=await publicJson('https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date='+ym+'01&response=json');
        if(d.stat==='OK'&&d.data?.length)break;
        month.setUTCMonth(month.getUTCMonth()-1);
      }
      if(d.stat!=='OK'||!d.data?.length)throw Error('TWSE 本月與上月均無可用資料');
      const dates=d.data.map(r=>{const [y,m,day]=r[0].split('/');return (+y+1911)+'-'+m.padStart(2,'0')+'-'+day.padStart(2,'0')}).sort();
      const latest=dates.at(-1);upstreamTwse=latest;report.series.push({name:'TWSE 官方最新日',kind:'upstream-reference',date:latest});
      for(const key of ['history/market','history/0050'])comparePublished(key,latest,'TWSE');
    }catch(e){report.errors.push('TWSE 來源日期核對：'+e.message)}
  })(),
  (async()=>{
    try{
      const d=await publicJson('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day');
      const raw=d.map(r=>String(r['日期']||'')).filter(d=>/^\d{8}$/.test(d)).sort().at(-1);
      if(!raw)throw Error('CBC 無日期');
      const latest=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6);
      report.series.push({name:'CBC 官方最新日',kind:'upstream-reference',date:latest});
      comparePublished('fx',latest,'央行');
    }catch(e){report.errors.push('CBC 來源日期核對：'+e.message)}
  })(),
  (async()=>{
    try{
      const year=Number(now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,4));
      calendar=parseTwseCalendar(await publicJson('https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?date='+year+'0101&response=json'),year);
    }catch(e){report.errors.push('TWSE 開休市日期核對：'+e.message)}
  })()
]);
if(calendar)for(const key of taiwanDaily){
  const age=taiwanTradingAge(published[key],now,calendar);
  const row=report.series.find(r=>r.name===key);if(row)row.tradingDaysOld=age;
  if(age>5)report.errors.push(key+' 超過五個交易日未更新：'+published[key]);
}
await Promise.all(['live','vix','taifex','bank','quote&code=0050'].map(async api=>{
  try{const d=await publicJson(GAS_PUBLIC+'?api='+api);payload[api]=d;
    if(d.error||d.errors?.length)report.errors.push(api+': '+(d.error||d.errors.join('; ')));
    const entries=api==='live'?[['原油延遲',d.oilFuture?.time?.slice(0,10),d.oilFuture?.time],['匯率延遲',d.fxQuote?.time?.slice(0,10),d.fxQuote?.time]]:
      api==='taifex'?[['PCR',d.pcr?.at(-1)?.[0]],['散戶多空比',d.retail?.at(-1)?.[0]]]:
      api==='vix'?[['VIX 延遲',d.quote?.date||lastDate(d),d.quote?.time]]:
      api==='bank'?[['官股雲端',lastDate(d)]]:[];
    for(const [name,date,time]of entries){report.series.push({name,kind:'public-api',date,time});
      const age=['PCR','散戶多空比','官股雲端'].includes(name)&&calendar?taiwanTradingAge(date,now,calendar):businessAge(date,now);
      if(age>5)report.errors.push(name+' 無可用近期資料：'+date)}
  }catch(e){report.errors.push(api+': '+e.message)}
}));
// Bank backup follows the existing cloud job. Do not wait a week to discover
// that the cloud has a newer date but the static backup never copied it.
if(payload.bank?.latest&&published['history/histock-bank']<payload.bank.latest)
  report.errors.push('官股靜態備份落後雲端：'+published['history/histock-bank']+' < '+payload.bank.latest);
// Missing intraday data is expected before the session. During an actual session,
// require both feeds even if neither supplies today's date (the old guard skipped that case).
if(calendar&&upstreamTwse){
  const inputs={now:now.toISOString(),calendar,intraday:payload.live?.intraday||null,
    quote:payload['quote&code=0050']||null,published,upstream:upstreamTwse};
  report.taiwanInputs=inputs;
  const checked=checkTaiwanQuotes({...inputs,now});
  report.session=checked.session;report.errors.push(...checked.errors);
  report.pending.push(...checked.notes);report.series.push(...checked.series);
}
report.series.sort((a,b)=>a.name.localeCompare(b.name));
await mkdir('action-health',{recursive:true});
await writeFile('action-health/freshness.json',JSON.stringify(report,null,2));
console.table(report.series);
if(report.pending.length)console.log(report.pending.join('\n'));
if(report.errors.length){console.error(report.errors.join('\n'));process.exitCode=1}

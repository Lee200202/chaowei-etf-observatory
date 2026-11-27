import {businessAge,publicationState} from './market-health-core.mjs';

export function parseTwseCalendar(data,year){
  if(String(data.stat).toLowerCase()!=='ok'||String(data.date).slice(0,4)!==String(year)||!data.data?.length)
    throw Error('TWSE 開休市日期的年度或格式不符');
  const closed=[],open=[];
  for(const [date,name,note]of data.data){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!date.startsWith(year+'-'))throw Error('TWSE 開休市日期格式異常');
    // The annual report also lists the first/last trading day: these are NOT holidays.
    if(/開始交易|最後交易/.test(name+' '+note))open.push(date);
    else if(/放假|補假|無交易|休市/.test(name+' '+note))closed.push(date);
    else throw Error('TWSE 未辨識的開休市紀錄：'+date+' '+name);
  }
  return{year,closed,open};
}

export function taiwanSession(now,calendar){
  const date=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
  if(calendar?.year!==Number(date.slice(0,4)))throw Error('缺少當年度 TWSE 開休市資料');
  const hm=now.toLocaleTimeString('en-GB',{timeZone:'Asia/Taipei',hour12:false}).slice(0,5);
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const tradingDay=calendar.open.includes(date)||weekday!==0&&weekday!==6&&!calendar.closed.includes(date);
  const phase=!tradingDay?'holiday':hm<'09:00'?'preopen':hm<'09:10'?'opening':hm<='13:30'?'trading':'after-close';
  return{date,hm,tradingDay,phase,requireLive:phase==='trading'};
}

export function taiwanTradingAge(date,now,calendar){
  if(!Number.isFinite(businessAge(date,now)))return Infinity;
  const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
  if(calendar?.year!==Number(today.slice(0,4)))throw Error('缺少當年度 TWSE 開休市資料');
  let age=0;
  for(let d=new Date(Date.parse(date+'T00:00:00Z')+86400000);d.toISOString().slice(0,10)<=today;d.setUTCDate(d.getUTCDate()+1)){
    const day=d.toISOString().slice(0,10),weekday=d.getUTCDay();
    if(calendar.open.includes(day)||weekday!==0&&weekday!==6&&!calendar.closed.includes(day))age++;
  }
  return age;
}

export function checkTaiwanQuotes({now,calendar,intraday,quote,published,upstream}){
  const session=taiwanSession(now,calendar),errors=[],notes=[],series=[];
  const rows=[['大盤',intraday?.date,intraday?.time?Date.parse(intraday.date+'T'+intraday.time+'+08:00'):NaN,intraday?.index,'history/market'],
    ['0050',quote?.date,Date.parse(quote?.time),quote?.available?quote.price:null,'history/0050']];
  if(quote?.available===false&&/未啟用|未設定|代號格式|不在 ETF/.test(quote.reason||''))errors.push('0050 設定異常：'+quote.reason);
  for(const[name,date,at,price,file]of rows){
    if(date>session.date||Number.isFinite(at)&&at>+now+60000){errors.push(name+' 回傳未來日期／時間');continue}
    if(session.requireLive){
      if(!Number.isFinite(price)||!(price>0)||date!==session.date||!Number.isFinite(at)||+now-at>10*60000)
        errors.push(name+' 交易時段缺少當日十分鐘內有效報價'+(name==='0050'&&quote?.reason?'：'+quote.reason:''));
      series.push({name:name+' 盤中',kind:'public-api',date,time:Number.isFinite(at)?new Date(at).toISOString():null});
    }else{
      const state=publicationState(published[file],upstream,now);
      if(state==='stale'||state==='missing')errors.push(name+' 非交易時段的正式收盤缺失或落後：'+published[file]+' / '+upstream);
      notes.push(name+'：'+session.phase+'，核對正式日資料 '+(published[file]||'缺值')+'；不要求今日盤中報價');
      if(name==='0050'&&quote?.available===false&&quote.reason&&!/尚無正式成交/.test(quote.reason))notes.push('0050 報價來源狀態：'+quote.reason+'；已另核對正式收盤，未將其標為即時');
      series.push({name:name+'（非交易時段）',kind:'confirmed-close-fallback',date:published[file]});
    }
  }
  return{session,errors,notes,series};
}

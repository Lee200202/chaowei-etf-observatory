// Yahoo Finance BZ=F (ICE Brent front-month, continuous) daily closes in USD/barrel.
// A daily bar is stamped at midnight New York time; the trading date is that New York date.
// The bar still in progress has no close (or carries the live quote time) and is left out.
export const YAHOO_BRENT_URL=range=>`https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?interval=1d&range=${range}`;
const nyParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function parseYahooDaily(json){
  const r=json?.chart?.result?.[0],m=r?.meta;
  if(!m||m.symbol!=='BZ=F'||m.currency!=='USD')throw Error('Yahoo BZ=F 格式異常');
  const t=r.timestamp||[],c=r.indicators?.quote?.[0]?.close||[],seen=new Set(),days=[];
  for(let i=0;i<t.length;i++){
    const v=Number(c[i]);if(!(c[i]!=null&&Number.isFinite(v)&&v>0))continue;
    const p=Object.fromEntries(nyParts.formatToParts(new Date(t[i]*1000)).map(x=>[x.type,x.value]));
    if(p.hour!=='00'||p.minute!=='00')continue;
    const date=`${p.year}-${p.month}-${p.day}`;if(seen.has(date))throw Error('Yahoo BZ=F 日期重複：'+date);seen.add(date);
    days.push({date,value:Math.round(v*100)/100});
  }
  return days.sort((a,b)=>a.date.localeCompare(b.date));
}

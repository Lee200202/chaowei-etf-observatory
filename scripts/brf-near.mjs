// 臺灣期貨交易所布蘭特原油期貨（BRF）近月結算價：FinMind TaiwanFuturesDaily 的列 → [{date,value,contract}]。
// 近月 = 每個交易日一般交易時段（position）有結算價的最近單一月份契約；盤後時段沒有結算價，價差單（202612/202701）不採用。
export const BRF_SOURCE='FinMind TaiwanFuturesDaily BRF（臺灣期貨交易所布蘭特原油期貨近月結算價）';

export function brfNearMonth(rows){
  const byDate=new Map();
  for(const r of rows){
    if(r.trading_session!=='position'||!/^\d{6}$/.test(String(r.contract_date))||!(Number(r.settlement_price)>0))continue;
    const best=byDate.get(r.date);
    if(!best||r.contract_date<best.contract)byDate.set(r.date,{date:r.date,value:Number(r.settlement_price),contract:r.contract_date});
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

// FINMIND_API_TOKEN is optional (the anonymous quota covers one request a day); it is only ever sent in the header.
export async function finmindBrf(start){
  const url=new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset','TaiwanFuturesDaily');url.searchParams.set('data_id','BRF');url.searchParams.set('start_date',start);
  const token=process.env.FINMIND_API_TOKEN?.trim(),headers=token?{Authorization:`Bearer ${token}`}:{};
  const res=await fetch(url,{headers,signal:AbortSignal.timeout(60000)}),body=await res.json().catch(()=>({}));
  if(!res.ok||body.status!==200||!Array.isArray(body.data))throw Error(`FinMind BRF: HTTP ${res.status} ${String(body.msg||'').slice(0,100)}`);
  return body.data;
}

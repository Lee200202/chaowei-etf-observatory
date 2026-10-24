const URL_='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
export function tdccDates(html){return [...html.matchAll(/<option value="(\d{8})"/g)].map(m=>m[1])}
export function parseTdcc(html,code,date){
  if(!html.includes('value="'+date+'" selected'))throw Error('TDCC 回傳日期不符 '+date);
  const rows=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>x[1].replace(/<[^>]*>/g,'').replace(/&[^;]+;/g,' ').trim()));
  const levels=new Map(rows.filter(r=>/^\d+$/.test(r[0])&&r.length===5).map(r=>[Number(r[0]),r]));
  const num=x=>Number(String(x).replaceAll(',','')),total=num(rows.find(r=>/合\s*計/.test(r[1]||''))?.[3]);if(!(total>0))throw Error('TDCC 沒有持有分級 '+code+' '+date);
  let big=0,count=0;for(const l of [12,13,14,15]){if(!levels.has(l))throw Error('TDCC 分級不足');big+=num(levels.get(l)[3]);count+=num(levels.get(l)[2])}
  const v=levels.get(15),round=x=>Math.round(x*100)/100;
  return[date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6),code,round(big/total*100),round(num(v[3])/total*100),count,num(v[2])];
}
export async function tdccHistoryRow(code,date){
  const r=await fetch(URL_,{signal:AbortSignal.timeout(25000)}),html=await r.text();if(!r.ok)throw Error('TDCC HTTP '+r.status);
  const token=html.match(/name="SYNCHRONIZER_TOKEN" value="([^"]+)/)?.[1];if(!token)throw Error('TDCC 查詢表單不存在');
  const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),body=new URLSearchParams({SYNCHRONIZER_TOKEN:token,SYNCHRONIZER_URI:'/portal/zh/smWeb/qryStock',method:'submit',firDate:tdccDates(html)[0],scaDate:date,sqlMethod:'StockNo',stockNo:code,stockName:''});
  const q=await fetch(URL_,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body,signal:AbortSignal.timeout(25000)});if(!q.ok)throw Error('TDCC query HTTP '+q.status);return parseTdcc(await q.text(),code,date);
}

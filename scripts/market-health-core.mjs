export const GAS_PUBLIC = 'https://script.google.com/macros/s/AKfycbwea2kGu7UX0RPfUYW2IaMmtar5_LitJth3mQ_c5uGOtgeihU_nmkM3uNw1CnddLdd6Kw/exec';
export function lastDate(data) {
  const rows=data.days || data.rows || [];
  return rows.map(r=>Array.isArray(r)?r[0]:r.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) || null;
}
export function businessAge(date, now=new Date()) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Infinity;
  const end=new Date(now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'})+'T00:00:00Z');
  const start=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(+start)||start.toISOString().slice(0,10)!==date)return Infinity;
  if (start>end) return Infinity;
  let age=0;
  for(let d=new Date(+start+86400000);d<=end;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6!==0)age++;
  return age;
}
export async function publicJson(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('HTTP '+response.status+' '+new URL(url).pathname);
  return response.json();
}

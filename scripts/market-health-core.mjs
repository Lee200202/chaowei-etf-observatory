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
// Network errors and 5xx/429 are retried once after a pause; a second failure is reported.
export async function publicJson(url, {retryDelay=15000}={}) {
  for(let attempt=0;;attempt++){
    let response;
    try{response=await fetch(url,{signal:AbortSignal.timeout(60000)})}
    catch(e){if(attempt)throw e;await new Promise(r=>setTimeout(r,retryDelay));continue}
    if(!response.ok){
      if(!attempt&&(response.status>=500||response.status===429)){await new Promise(r=>setTimeout(r,retryDelay));continue}
      throw Error('HTTP '+response.status+' '+new URL(url).pathname);
    }
    return response.json();
  }
}
// Daily publication is asynchronous. Only today's new official close can wait for
// the evening publisher; an older gap must still alert immediately.
export function publicationState(published, upstream, now=new Date()) {
  if(!published||!upstream)return 'missing';
  if(published>=upstream)return 'current';
  const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
  const hm=now.toLocaleTimeString('en-GB',{timeZone:'Asia/Taipei',hour12:false}).slice(0,5);
  return upstream===today&&businessAge(published,now)<=1&&hm<'22:00'?'awaiting-evening-publish':'stale';
}

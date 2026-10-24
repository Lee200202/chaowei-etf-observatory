/* Coordinates choose endpoints; prices/dates, never rectangle pixel area, determine returns. */
const ChartMeasurement=(()=>{
  const dateNumber=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?Date.parse(d+'T00:00:00Z'):NaN;
  function measure(series,a,b){
    if(!a||!b||!Number.isFinite(a.price)||!Number.isFinite(b.price)||a.price<=0||b.price<=0)return null;
    const i=series.findIndex(x=>x.date===a.date),j=series.findIndex(x=>x.date===b.date);
    if(i<0||j<0)return null;
    const from=Math.min(i,j),to=Math.max(i,j);let high=-Infinity,low=Infinity,volume=0;
    for(let k=from;k<=to;k++){high=Math.max(high,series[k].high);low=Math.min(low,series[k].low);volume+=Number.isFinite(series[k].volume)?series[k].volume:0}
    const days=(dateNumber(b.date)-dateNumber(a.date))/86400000;if(!Number.isFinite(days))return null;
    return{change:b.price-a.price,percent:(b.price/a.price-1)*100,bars:j-i,inclusive:Math.abs(j-i)+1,days,high,low,volume};
  }
  function risk(entry,stop,target,side='long'){
    if(![entry,stop,target].every(x=>Number.isFinite(x)&&x>0))return null;
    const sign=side==='short'?-1:1,loss=(entry-stop)*sign,gain=(target-entry)*sign;
    if(loss<=0||gain<=0)return null;
    return{loss,gain,r:gain/loss,lossPct:loss/entry*100,gainPct:gain/entry*100};
  }
  function normalize(list){return Array.isArray(list)?list.filter(x=>x&&/^[0-9A-Z]{4,6}$/.test(x.code)&&['D','W','M'].includes(x.interval)&&[x.a,x.b].every(p=>p&&Number.isFinite(dateNumber(p.date))&&Number.isFinite(p.price)&&p.price>0)).slice(-50).map(x=>({id:String(x.id||'').replace(/[^a-zA-Z0-9-]/g,'').slice(0,40),code:x.code,interval:x.interval,a:{date:x.a.date,price:x.a.price,source:['open','high','low','close','free'].includes(x.a.source)?x.a.source:'close'},b:{date:x.b.date,price:x.b.price,source:['open','high','low','close','free'].includes(x.b.source)?x.b.source:'close'},basis:'split',provisional:!!x.provisional})):[]}
  return{measure,risk,normalize};
})();

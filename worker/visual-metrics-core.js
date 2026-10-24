const VisualMetrics=(()=>{
  function range(rows,from,to){if(!rows.length)return null;let a=rows.findIndex(r=>r.time>=from),b=rows.length-1;while(b>=0&&rows[b].time>to)b--;return a>=0&&b>=a?{a,b}:null}
  function period(rows,a,b,navExtremes=false){a=Math.max(0,Math.ceil(a));b=Math.min(rows.length-1,Math.floor(b));if(b<a||!(rows[a]?.nav>0))return null;let peak=rows[a].nav,mdd=0,high=a,low=a;const key=navExtremes?'nav':'value';for(let i=a;i<=b;i++){peak=Math.max(peak,rows[i].nav);mdd=Math.max(mdd,1-rows[i].nav/peak);if(rows[i][key]>rows[high][key])high=i;if(rows[i][key]<rows[low][key])low=i}return{a,b,from:rows[a].time,to:rows[b].time,bars:b-a+1,ret:rows[b].nav/rows[a].nav-1,mdd,high,low,startValue:rows[a].value,endValue:rows[b].value}}
  function histogram(values,bins=10){const a=values.filter(Number.isFinite);if(!a.length)return null;const max=Math.max(...a,1e-9),width=max/bins,counts=Array(bins).fill(0);a.forEach(x=>counts[Math.min(bins-1,Math.max(0,Math.floor(x/width)))]++);return{counts,width,max,mean:a.reduce((s,v)=>s+v,0)/a.length,n:a.length}}
  function attribution(r){const price=r.equity-r.contributed-r.dividends-r.interest+r.fees;return{price,dividends:r.dividends,interest:r.interest,fees:-r.fees,net:r.equity-r.contributed}}
  function ratios(rows,key='alpha'){const usable=rows.filter(r=>Number.isFinite(r[key])),wins=usable.filter(r=>r[key]>1e-10).length,ties=usable.filter(r=>Math.abs(r[key])<=1e-10).length;return{total:usable.length,wins,ties,losses:usable.length-wins-ties,average:usable.length?usable.reduce((s,r)=>s+r[key],0)/usable.length:null}}
  function crossing(a,b,c,d){const x=a-b,y=c-d;return x*y<0?x/(x-y):null}
  return{range,period,histogram,attribution,ratios,crossing};
})();

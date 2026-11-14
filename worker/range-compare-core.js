/* Range comparison maths for the market page: TAIEX close vs market margin balance on shared trading days. */
const RangeCompare=(()=>{
  // Only days present in both series are compared; a missing margin day is skipped, never filled.
  function join(market,margin){
    const m=new Map((margin||[]).filter(x=>Number.isFinite(x.value)).map(x=>[x.date,x.value]));
    return(market||[]).filter(x=>Number.isFinite(x.index)&&!x.intraday&&m.has(x.date)).map(x=>({date:x.date,index:x.index,margin:m.get(x.date)}));
  }
  // Any two dated series ({date,value}), on the days both have: rows are {date,a,b}.
  function joinSeries(a,b){
    const m=new Map((b||[]).filter(x=>Number.isFinite(x.value)).map(x=>[x.date,x.value]));
    const seen=new Set();return(a||[]).filter(x=>Number.isFinite(x.value)&&!x.intraday&&m.has(x.date)&&!seen.has(x.date)&&seen.add(x.date)).map(x=>({date:x.date,a:x.value,b:m.get(x.date)})).sort((p,q)=>p.date<q.date?-1:1);
  }
  // The last `months` calendar months ending on the latest shared day (0 = everything).
  function windowRows(rows,months){
    if(!rows.length||!months)return rows.slice();
    const d=new Date(rows.at(-1).date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-months);const from=d.toISOString().slice(0,10);
    return rows.filter(x=>x.date>=from);
  }
  const argmax=(rows,key,from=0,to=rows.length-1)=>{let k=-1;for(let i=from;i<=to;i++)if(k<0||rows[i][key]>rows[k][key])k=i;return k};
  const argmin=(rows,key,from=0,to=rows.length-1)=>{let k=-1;for(let i=from;i<=to;i++)if(k<0||rows[i][key]<rows[k][key])k=i;return k};
  // Selections always run left to right: the start is the earlier day.
  function clampSel(n,a,b){
    if(n<2)return null;a=Math.max(0,Math.min(n-2,Math.round(a)));b=Math.max(a+1,Math.min(n-1,Math.round(b)));return{a,b};
  }
  // Presets: from the window's index high to the latest day, or to the lowest index after that high.
  function preset(rows,kind,key='index'){
    const n=rows.length;if(n<2)return null;
    let a=argmax(rows,key);if(a>=n-1)a=argmax(rows,key,0,n-2);
    const b=kind==='peakToLow'?argmin(rows,key,a+1):n-1;
    return clampSel(n,a,b);
  }
  // Start minus end, as in "49968 − 41513 = 8455 (跌 16.92%)"; pct is the signed change from start to end.
  function change(rows,sel,key){
    const s=rows[sel.a][key],e=rows[sel.b][key];return{start:s,end:e,diff:e-s,pct:s?e/s-1:null,from:rows[sel.a].date,to:rows[sel.b].date,days:sel.b-sel.a};
  }
  // How large the margin move was relative to the index move (same sign means margin followed the index).
  function ratio(a,b){return Number.isFinite(a.pct)&&Number.isFinite(b.pct)&&Math.abs(a.pct)>=1e-4?b.pct/a.pct:null}
  // Highest value inside the selection and the move from it to the end; null when the start itself is the high.
  function peakInside(rows,sel,key){const k=argmax(rows,key,sel.a,sel.b);if(k<=sel.a||k>=sel.b)return null;return change(rows,{a:k,b:sel.b},key)}
  return{join,joinSeries,windowRows,argmax,argmin,clampSel,preset,change,ratio,peakInside};
})();

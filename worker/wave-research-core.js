/* Deterministic, close-only swing research. A pivot becomes usable on confirmDate,
   never on the earlier extremeDate. Input is already adjusted for splits. */
const ChaoweiWave=(()=>{
  const defaults={minBars:10,reversal:3,large:10,fast:0.8,basis:'total',cutoff:''};
  const clamp=(v,lo,hi,fallback)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):fallback;
  function normalize(x={}){return{
    minBars:Math.round(clamp(x.minBars,2,120,defaults.minBars)),
    reversal:clamp(x.reversal,0.5,30,defaults.reversal),
    large:clamp(x.large,1,100,defaults.large),
    fast:clamp(x.fast,0.05,10,defaults.fast),
    basis:x.basis==='split'?'split':'total',
    cutoff:/^\d{4}-\d{2}-\d{2}$/.test(x.cutoff||'')?x.cutoff:''
  }}
  function priceSeries(rows,events=[],basis='total',adjustments=[]){
    if(basis==='split')return rows.map(b=>({...b,studyClose:b.close}));
    const div=new Map(events.filter(x=>Array.isArray(x)&&x.length>=2).map(([date,cash])=>{
      let factor=1;for(const a of adjustments)if(date<a.date)factor*=a.factor;
      return[date,Number(cash)/factor];
    }));
    let value=rows[0]?.close||0;
    return rows.map((b,i)=>{
      if(i)value*=((b.close+(div.get(b.date)||0))/rows[i-1].close);
      return{...b,studyClose:value};
    });
  }
  function detect(rows,input={}){
    const p=normalize(input),out=[];
    if(rows.length<2)return{pivots:out,segments:[],pending:null};
    let dir=0,start=0,low=0,high=0,candidate=0;
    const val=i=>rows[i].studyClose;
    for(let i=1;i<rows.length;i++){
      if(dir===0){
        if(val(i)<val(low))low=i;if(val(i)>val(high))high=i;
        if(i-low>=p.minBars&&val(i)>=val(low)*(1+p.reversal/100)){
          out.push({kind:'valley',index:low,date:rows[low].date,price:val(low),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          dir=1;candidate=-1;start=low;
        }else if(i-high>=p.minBars&&val(i)<=val(high)*(1-p.reversal/100)){
          out.push({kind:'peak',index:high,date:rows[high].date,price:val(high),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          dir=-1;candidate=-1;start=high;
        }
        continue;
      }
      // An extreme inside the minimum-spacing window cannot become the next
      // pivot. Begin tracking again at the first eligible bar, avoiding a
      // permanent stall after a short correction followed by a long trend.
      if(i-start<p.minBars)continue;
      if(candidate<0){candidate=i;continue}
      if(dir===1){
        if(val(i)>val(candidate))candidate=i;
        if(i>candidate&&val(i)<=val(candidate)*(1-p.reversal/100)){
          out.push({kind:'peak',index:candidate,date:rows[candidate].date,price:val(candidate),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          start=candidate;candidate=-1;dir=-1;
        }
      }else{
        if(val(i)<val(candidate))candidate=i;
        if(i>candidate&&val(i)>=val(candidate)*(1+p.reversal/100)){
          out.push({kind:'valley',index:candidate,date:rows[candidate].date,price:val(candidate),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          start=candidate;candidate=-1;dir=1;
        }
      }
    }
    const segments=[];
    for(let i=1;i<out.length;i++){
      const from=out[i-1],to=out[i],bars=to.index-from.index;
      if(bars<=0||from.kind===to.kind)continue;
      const change=(to.price/from.price-1)*100;
      // In a strong long-term trend a later trough can be above an earlier
      // peak. It is a rising baseline, not a negative pullback.
      if(Math.abs(change)<p.reversal||from.kind==='peak'&&change>=0||from.kind==='valley'&&change<=0)continue;
      segments.push({from,to,bars,change,speed:Math.abs(change)/bars,
        size:Math.abs(change)>=p.large?'大波':'小波',
        pace:Math.abs(change)/bars>=p.fast?'快速':'緩慢',
        availableDate:to.confirmDate});
    }
    return{pivots:out,segments,pending:dir?{direction:dir,extremeDate:rows[candidate<0?start:candidate].date,lastDate:rows.at(-1).date}:null};
  }
  function summary(segments,cutoff='',excluded=[]){
    const accepted=segments.filter(s=>!excluded.some(date=>date>=s.from.date&&date<=s.to.date));
    const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
    const make=list=>({count:list.length,up:list.filter(s=>s.change>0).length,down:list.filter(s=>s.change<0).length,
      large:list.filter(s=>s.size==='大波').length,
      avgBars:avg(list.map(s=>s.bars)),avgChange:avg(list.map(s=>Math.abs(s.change))),
      avgPullback:avg(list.filter(s=>s.change<0).map(s=>Math.abs(s.change))),
      avgPullbackSpeed:avg(list.filter(s=>s.change<0).map(s=>s.speed))});
    return{all:make(accepted),training:make(accepted.filter(s=>!cutoff||s.availableDate<cutoff)),
      testing:make(cutoff?accepted.filter(s=>s.availableDate>=cutoff):[]),excluded:segments.length-accepted.length};
  }
  return{defaults,normalize,priceSeries,detect,summary};
})();

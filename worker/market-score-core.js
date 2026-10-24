// Shared market-factor scoring. Reference samples always precede the measured observation.
const MarketScoring=(()=>{
  const clamp=x=>Math.max(0,Math.min(1,x));
  function cdf(z){const t=1/(1+0.2316419*Math.abs(z)),p=0.3989422804014327*Math.exp(-z*z/2)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return z>=0?1-p:p}
  function stats(values){const a=values.filter(Number.isFinite);if(a.length<2)return null;const mean=a.reduce((s,x)=>s+x,0)/a.length,sd=Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/(a.length-1));return{mean,sd,count:a.length}}
  function evaluate(values,{window=120,method='normal',zero=false,higherBetter=false,span=20}={}){
    const a=values.filter(Number.isFinite),value=a.at(-1),prior=a.slice(-Math.max(20,window)-1,-1),st=stats(prior);
    if(!st||prior.length<20||!Number.isFinite(value))return null;
    const center=zero?0:st.mean,scale=zero?Math.sqrt(prior.reduce((s,x)=>s+x*x,0)/prior.length):st.sd;
    let z=scale>0?(value-center)/scale:value===center?0:Math.sign(value-center)*Infinity;
    const half=zero?(scale||Math.abs(value)||1)*2:Math.abs(center)*Math.max(1,span)/100;
    const raw=half>0?0.5+(value-center)/(2*half):0.5;
    const r=method==='normal'?cdf(z):clamp(raw),core=5*(higherBetter?r:1-r),grade=Math.max(1,Math.min(5,Math.ceil(core)));
    return{value,mean:st.mean,center,sd:st.sd,scale,count:st.count,z,r,raw,core,grade,half,extended:5*(higherBetter?raw:1-raw),deviation:center?(value/center-1)*100:null,method};
  }
  return{cdf,stats,evaluate};
})();

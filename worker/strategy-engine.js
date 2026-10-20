/* ---------- Strategy engine v3 (pure: no DOM; also loaded by scripts/test-engine.mjs) ----------
   Capital model: every strategy receives the same cash flows (one lump at the start, or the same
   deposit on the first trading day of each month), so returns are comparable with 定期定額.
   Uninvested cash earns the parking yield; cash dividends are always credited (DRIP reinvests them).
   All orders fill at the day's close with fees and tax. Indicators at day i use bars up to i;
   the water-level range at day i uses bars before i only. */
const ChaoweiEngine=(()=>{
  const DAY=86400000;
  /* ---------- indicators ---------- */
  function sma(a,n){const out=new Float64Array(a.length).fill(NaN);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)out[i]=s/n}return out}
  function prepare(bars,dividends,macro){
    const n=bars.length,close=bars.map(b=>b.close),high=bars.map(b=>b.high),low=bars.map(b=>b.low),vol=bars.map(b=>b.volume);
    const ma20=sma(close,20),ma60=sma(close,60),ma120=sma(close,120),ma200=sma(close,200),volMa20=sma(vol,20);
    const bbUp=new Float64Array(n).fill(NaN),bbLo=new Float64Array(n).fill(NaN),bw=new Float64Array(n).fill(NaN),bwRank=new Float64Array(n).fill(NaN);
    for(let i=19;i<n;i++){let s=0;for(let j=i-19;j<=i;j++)s+=(close[j]-ma20[i])**2;const sd=Math.sqrt(s/20);bbUp[i]=ma20[i]+2*sd;bbLo[i]=ma20[i]-2*sd;bw[i]=(bbUp[i]-bbLo[i])/ma20[i]}
    for(let i=138;i<n;i++){let c=0;for(let j=i-119;j<=i;j++)if(bw[j]<=bw[i])c++;bwRank[i]=c/120}
    const rsi=new Float64Array(n).fill(NaN);let g=0,l=0;
    for(let i=1;i<n;i++){const ch=close[i]-close[i-1],u=Math.max(ch,0),d=Math.max(-ch,0);if(i<=14){g+=u/14;l+=d/14}else{g=(g*13+u)/14;l=(l*13+d)/14}if(i>=14)rsi[i]=l===0?(g===0?50:100):100-100/(1+g/l)}
    const atr=new Float64Array(n).fill(NaN),hh22=new Float64Array(n).fill(NaN);let a=0;
    for(let i=1;i<n;i++){const tr=Math.max(high[i]-low[i],Math.abs(high[i]-close[i-1]),Math.abs(low[i]-close[i-1]));a=i<=22?a+tr/22:(a*21+tr)/22;if(i>=22)atr[i]=a;if(i>=21){let m=-Infinity;for(let j=i-21;j<=i;j++)m=Math.max(m,high[j]);hh22[i]=m}}
    const sigma=new Float64Array(n).fill(NaN);
    for(let i=20;i<n;i++){let s=0,s2=0;for(let j=i-19;j<=i;j++){const r=Math.log(close[j]/close[j-1]);s+=r;s2+=r*r}const m=s/20;sigma[i]=Math.sqrt(Math.max(0,s2/20-m*m))*Math.sqrt(245)}
    const div=new Float64Array(n);const byDate=new Map(bars.map((b,i)=>[b.date,i]));
    for(const [date,amount] of dividends||[]){const i=byDate.get(date);if(i!=null)div[i]+=amount}
    const monthStart=bars.map((b,i)=>i===0||b.date.slice(0,7)!==bars[i-1].date.slice(0,7));
    return{bars,n,close,high,low,vol,ma20,ma60,ma120,ma200,volMa20,bbUp,bbLo,bw,bwRank,rsi,atr,hh22,sigma,div,monthStart,macro:macro||null,refCache:new Map(),scoreCache:new Map()};
  }
  // Reference high/low at day i from the window of bars before i (no look-ahead).
  function reference(ctx,window,anchorMode,anchorCount){
    const key=window+'|'+anchorMode+'|'+anchorCount;if(ctx.refCache.has(key))return ctx.refCache.get(key);
    const {n,bars}=ctx,W=window==='all'?Infinity:Number(window),hi=new Float64Array(n).fill(NaN),lo=new Float64Array(n).fill(NaN),need=W===Infinity?20:W;
    const byClose=anchorMode==='close',H=bars.map(b=>byClose?b.close:b.high),L=bars.map(b=>byClose?b.close:b.low);
    if(anchorMode!=='average'){
      const qh=[],ql=[];let x=0,y=0;
      for(let i=1;i<n;i++){const j=i-1;while(qh.length>x&&H[qh[qh.length-1]]<=H[j])qh.pop();qh.push(j);while(ql.length>y&&L[ql[ql.length-1]]>=L[j])ql.pop();ql.push(j);
        while(qh[x]<i-W)x++;while(ql[y]<i-W)y++;if(i>=need){hi[i]=H[qh[x]];lo[i]=L[ql[y]]}}
    }else{
      const k=Math.max(1,Math.min(20,Math.round(anchorCount)||5));
      for(let i=need;i<n;i++){const s=Math.max(0,i-W),hs=Float64Array.from(H.slice(s,i)).sort(),ls=Float64Array.from(L.slice(s,i)).sort(),kk=Math.min(k,hs.length);let p=0,q=0;for(let j=0;j<kk;j++){p+=hs[hs.length-1-j];q+=ls[j]}hi[i]=p/kk;lo[i]=q/kk}
    }
    const out={hi,lo};ctx.refCache.set(key,out);return out;
  }
  // Water-level score (0–5, higher = lower in the range) and its whole-number tier (1–5).
  function score(r,method){
    let raw;
    if(method!=='fib'||r<0||r>1)raw=5*(1-r);
    else{const x=[0,.236,.382,.618,.786,1],y=[5,4,3,2,1,0];for(let i=0;i<5;i++)if(r<=x[i+1]){raw=y[i]+(y[i+1]-y[i])*(r-x[i])/(x[i+1]-x[i]);break}}
    return{raw,core:Math.max(0,Math.min(5,raw)),grade:r<0?5:r>=1?1:Math.max(1,Math.min(5,Math.ceil(raw)))};
  }
  function water(ctx,ref){
    const key=ref.window+'|'+ref.anchorMode+'|'+ref.anchorCount+'|'+ref.method;if(ctx.scoreCache.has(key))return ctx.scoreCache.get(key);
    const {hi,lo}=reference(ctx,ref.window,ref.anchorMode,ref.anchorCount),n=ctx.n,core=new Float64Array(n).fill(NaN),grade=new Int8Array(n);
    for(let i=0;i<n;i++)if(hi[i]>lo[i]){const s=score((ctx.close[i]-lo[i])/(hi[i]-lo[i]),ref.method);core[i]=s.core;grade[i]=s.grade}
    const out={hi,lo,core,grade};ctx.scoreCache.set(key,out);return out;
  }

  /* ---------- simulation ---------- */
  function xirr(flows){
    if(flows.length<2)return null;const t0=flows[0][0];
    const f=r=>flows.reduce((s,[t,v])=>s+v/Math.pow(1+r,(t-t0)/(365*DAY)),0);
    let a=-0.99,b=10,fa=f(a),fb=f(b);if(!(fa*fb<0))return null;
    for(let k=0;k<200;k++){const m=(a+b)/2,fm=f(m);if(Math.abs(fm)<1e-7)return m;if(fa*fm<0){b=m;fb=fm}else{a=m;fa=fm}}
    return(a+b)/2;
  }
  function account(ctx,cfg){
    const fee=cfg.fee/100*cfg.discount/100,tax=cfg.tax/100;
    return{cash:0,shares:0,cost:0,fee,tax,fees:0,trades:[],divs:[],
      buy(i,amount,reason,kind){
        const c=ctx.close[i],spend=Math.min(amount,this.cash);if(!(spend>0))return 0;
        let sh=spend/(c*(1+fee));if(cfg.wholeShares)sh=Math.floor(sh);if(!(sh>0))return 0;
        const gross=sh*c,f=gross*fee;this.cash-=gross+f;this.shares+=sh;this.cost+=gross+f;this.fees+=f;
        this.trades.push({i,date:ctx.bars[i].date,type:'buy',kind:kind||'buy',price:c,shares:sh,amount:gross+f,reason});return sh;
      },
      sell(i,sh,reason,kind){
        sh=Math.min(sh,this.shares);if(cfg.wholeShares)sh=Math.floor(sh+1e-9);if(!(sh>0))return 0;
        const c=ctx.close[i],gross=sh*c,f=gross*(fee+tax),costPart=this.cost*sh/this.shares,net=gross-f,pnl=net-costPart;
        this.cash+=net;this.shares-=sh;this.cost-=costPart;this.fees+=f;if(this.shares<1e-9){this.shares=0;this.cost=0}
        this.trades.push({i,date:ctx.bars[i].date,type:'sell',kind:kind||'sell',price:c,shares:sh,amount:net,pnl,ret:pnl/costPart,reason});return net;
      },
      value(i){return this.cash+this.shares*ctx.close[i]},
      toWeight(i,w,reason){const c=ctx.close[i],total=this.value(i),cur=this.shares*c,target=total*w;
        if(target>cur)return this.buy(i,(target-cur),reason,'rebalance');if(target<cur)return this.sell(i,(cur-target)/c,reason,'rebalance');return 0}
    };
  }
  /* Runs one strategy (and the benchmarks with the same cash flows) from start to end (inclusive). */
  function run(ctx,cfg,start,end){
    end=end==null?ctx.n-1:end;start=Math.max(0,start);
    const strat=STRATEGIES[cfg.strategy]||STRATEGIES.classic,months=[];for(let i=start;i<=end;i++)if(i===start||ctx.monthStart[i])months.push(i);
    // One capital base C for everyone. N defaults to the number of months in the window ('auto'), so a
    // five-year test spreads 定期定額 over 60 months instead of spending C in the first year.
    // Pool mode (default): C is in the account on day one; 定期定額 invests C ÷ N on the first trading day
    // of each of the first N months; staged strategies split C by their number of stages.
    // Monthly mode: C ÷ N is deposited on each of those days instead (a salary), and buy-and-hold still
    // invests C on day one with its own cash flows, so its XIRR stays comparable.
    const auto=cfg.dcaPeriods==null||cfg.dcaPeriods==='auto',N=auto?months.length:Math.max(1,Math.round(Number(cfg.dcaPeriods)||12));
    const monthly=cfg.capitalMode==='monthly',lump=!monthly,base=cfg.capital/N,dcaMonths=new Set(months.slice(0,N));
    const inflowAt=monthly?new Map(months.slice(0,N).map(i=>[i,base])):new Map([[start,cfg.capital]]);
    const park=Math.pow(1+cfg.parking/100,1/365)-1,acc=account(ctx,cfg),state={};
    // Benchmarks: buy-and-hold (C invested on day one) and 定期定額 (C ÷ N per month), same fees and tax.
    const bh=account(ctx,cfg),dca=account(ctx,cfg);
    const flows=[],bhFlows=monthly?[[Date.parse(ctx.bars[start].date),-cfg.capital]]:flows,series=[],bhSeries=[],dcaSeries=[];
    let contributed=0,interest=0,dividends=0,nav=1,prevEq=0,peakNav=1,mdd=0,utilSum=0,days=0,lastT=Date.parse(ctx.bars[start].date),rets=[];
    let bhNav=1,bhPrev=0,bhPeak=1,bhMdd=0,dcaNav=1,dcaPrev=0,dcaPeak=1,dcaMdd=0;
    const helpers={base,months,lump,N,dcaMonths,water:cfg.ref?water(ctx,cfg.ref):null};
    strat.init?.(ctx,cfg,state,helpers);
    for(let i=start;i<=end;i++){
      const t=Date.parse(ctx.bars[i].date),dd=Math.round((t-lastT)/DAY);lastT=t;
      // Interest on parked cash for the calendar days since the previous bar.
      if(dd>0)for(const a of [acc,bh,dca]){const r=a.cash*(Math.pow(1+park,dd)-1);a.cash+=r;if(a===acc)interest+=r}
      const inflow=inflowAt.get(i)||0,bhIn=monthly?(i===start?cfg.capital:0):inflow;
      if(inflow){acc.cash+=inflow;dca.cash+=inflow;contributed+=inflow;flows.push([t,-inflow])}
      bh.cash+=bhIn;
      // Dividends on shares held before today's trades.
      if(ctx.div[i]>0)for(const a of [acc,bh,dca]){const d=a.shares*ctx.div[i];if(d>0){a.cash+=d;a.divs.push([t,d]);if(a===acc)dividends+=d;if(cfg.drip)a.buy(i,d,'配息再投入','drip')}}
      if(bhIn)bh.buy(i,bh.cash,'買進持有','bench');
      if(dcaMonths.has(i))dca.buy(i,base,'定期定額','bench');
      strat.day(i,ctx,cfg,acc,state,helpers,inflow);
      const eq=acc.value(i),c=ctx.close[i];
      // Time-weighted return strips out deposits, so drawdowns are not hidden by new money.
      if(prevEq>0)nav*=(eq-inflow)/prevEq;prevEq=eq;peakNav=Math.max(peakNav,nav);const ddown=nav/peakNav-1;mdd=Math.min(mdd,ddown);
      if(series.length)rets.push(nav/series.at(-1).nav-1);
      const bq=bh.value(i);if(bhPrev>0)bhNav*=(bq-bhIn)/bhPrev;bhPrev=bq;bhPeak=Math.max(bhPeak,bhNav);bhMdd=Math.min(bhMdd,bhNav/bhPeak-1);
      const dq=dca.value(i);if(dcaPrev>0)dcaNav*=(dq-inflow)/dcaPrev;dcaPrev=dq;dcaPeak=Math.max(dcaPeak,dcaNav);dcaMdd=Math.min(dcaMdd,dcaNav/dcaPeak-1);
      utilSum+=eq>0?acc.shares*c/eq:0;days++;
      series.push({time:ctx.bars[i].date,value:eq,nav,dd:ddown,exposure:eq>0?acc.shares*c/eq:0,contributed});
      bhSeries.push({time:ctx.bars[i].date,value:bq,dd:bhNav/bhPeak-1});dcaSeries.push({time:ctx.bars[i].date,value:dq,dd:dcaNav/dcaPeak-1});
    }
    const tEnd=Date.parse(ctx.bars[end].date),years=Math.max(1/365,(tEnd-Date.parse(ctx.bars[start].date))/(365.25*DAY));
    const summary=(a,navEnd,m,fl,paid)=>{const eq=a.value(end);return{equity:eq,ret:paid?eq/paid-1:0,xirr:xirr([...fl,[tEnd,eq]]),cagr:Math.pow(navEnd,1/years)-1,mdd:-m,fees:a.fees}};
    // Return on deployed capital: XIRR of the position alone (buys out, sales and dividends in, final
    // holding back), so cash waiting on the sidelines does not count. Answers "when it was invested, how
    // hard did the money work?" for strategies that sit mostly in cash.
    const sleeve=acc.trades.map(x=>[Date.parse(x.date),x.type==='buy'?-x.amount:x.amount]).concat(acc.divs);
    if(acc.shares>0)sleeve.push([tEnd,acc.shares*ctx.close[end]]);sleeve.sort((x,y)=>x[0]-y[0]);
    const s=summary(acc,nav,mdd,flows,contributed),mean=rets.reduce((x,y)=>x+y,0)/Math.max(1,rets.length),sd=Math.sqrt(rets.reduce((x,y)=>x+(y-mean)**2,0)/Math.max(1,rets.length-1));
    const sells=acc.trades.filter(x=>x.type==='sell'&&x.kind!=='rebalance');
    return{cfg,start:ctx.bars[start].date,end:ctx.bars[end].date,years,contributed,N,base,monthly,...s,roic:acc.trades.length?xirr(sleeve):null,
      calmar:s.mdd>0?s.cagr/s.mdd:null,sharpe:sd>0?(mean-park)/sd*Math.sqrt(245):null,utilization:utilSum/Math.max(1,days),
      interest,dividends,fees:acc.fees,trades:acc.trades,sells:sells.length,wins:sells.filter(x=>x.pnl>0).length,buys:acc.trades.filter(x=>x.type==='buy').length,
      shares:acc.shares,cost:acc.cost,cash:acc.cash,state,series,bh:{...summary(bh,bhNav,bhMdd,bhFlows,cfg.capital),series:bhSeries},dca:{...summary(dca,dcaNav,dcaMdd,flows,contributed),series:dcaSeries}};
  }

  /* ---------- strategies ---------- */
  const monthDay=(ctx,i,start)=>ctx.monthStart[i]||i===start;
  function classicDay(i,ctx,cfg,acc,st,h){
    const p=cfg.params,w=h.water,c=ctx.close[i],hi=w.hi[i],lo=w.lo[i],valid=hi>lo,maxBuys=p.entry==='fib'?p.levels.length:1+p.adds;
    // Tranche: an equal share of the cash still available for this round.
    const tranche=()=>acc.cash/Math.max(1,maxBuys-(st.buys||0));
    let bought=false;
    if(!st.buys){
      if(!valid)return;
      let why=null;
      if(p.entry==='drop'&&c<=hi*(1-p.drop/100))why='首次買進：較區間高點下跌 '+((1-c/hi)*100).toFixed(1)+'%';
      else if(p.entry==='fib'&&c<=hi-p.levels[0]*(hi-lo))why='首次買進：回檔到 '+(p.levels[0]*100).toFixed(1)+'% 位階';
      else if(p.entry==='grade'&&w.grade[i]>=p.buyGrade)why='首次買進：水位 '+w.grade[i]+' 分';
      if(why&&acc.buy(i,tranche(),why,'entry')){st.buys=1;st.hi=hi;st.lo=lo;st.last=c;st.entry=i;st.peak=c;st.stage=0;bought=true}
      return;
    }
    st.peak=Math.max(st.peak,c);
    if(p.entry==='drop'){while(st.buys<maxBuys&&c<=st.hi*(1-(p.drop+st.buys*p.step)/100)){if(!acc.buy(i,tranche(),'加碼：較區間高點下跌 '+(p.drop+st.buys*p.step)+'%','add'))break;st.buys++;bought=true}}
    else if(p.entry==='fib'){while(st.buys<maxBuys&&c<=st.hi-p.levels[st.buys]*(st.hi-st.lo)){if(!acc.buy(i,tranche(),'加碼：回檔到 '+(p.levels[st.buys]*100).toFixed(1)+'% 位階','add'))break;st.buys++;bought=true}}
    else if(st.buys<maxBuys&&c<=st.last*(1-p.step/100)&&w.grade[i]>=p.buyGrade){if(acc.buy(i,tranche(),'加碼：較上次買價再跌 '+p.step+'%','add')){st.buys++;st.last=c;bought=true}}
    if(bought||!acc.shares)return;
    const avg=acc.cost/acc.shares;let why=null;
    if(p.stop>0&&c<=avg*(1-p.stop/100))why='停損：低於平均成本 '+p.stop+'%';
    else if(p.maxDays>0&&i-st.entry>=p.maxDays)why='持有滿 '+p.maxDays+' 個交易日';
    else if(p.exit==='gain'&&c>=avg*(1+p.rise/100))why='獲利：高於平均成本 '+p.rise+'%';
    else if(p.exit==='high'&&c>=st.hi*(1+p.rise/100))why=p.rise?'突破進場前高點 '+p.rise+'%':'回到進場前高點';
    else if(p.exit==='grade'&&valid&&w.grade[i]<=p.sellGrade)why='水位回到 '+w.grade[i]+' 分';
    else if(p.exit==='fibext'&&c>=st.lo+p.fibExt*(st.hi-st.lo))why=p.fibExt===1?'回到區間高點':'到達 '+(p.fibExt*100).toFixed(1)+'% 擴展位';
    else if(p.exit==='trailing'){
      // Trailing exit only arms after the price has recovered the pre-entry high, so the bottom is not sold.
      if(c>=st.hi)st.armed=true;
      const chand=ctx.hh22[i]-p.atrMult*ctx.atr[i];
      if(st.armed&&(c<=st.peak*(1-p.trail/100)||(p.atrMult>0&&c<chand)))why='移動停利：自高點 '+st.peak.toFixed(2)+' 回落';
    }
    else if(p.exit==='pyramid'){
      if(st.stage===0&&c>=Math.max(avg*(1+p.rise/100),st.hi)){acc.sell(i,acc.shares*0.3,'分批停利一：賣出 30%','trim');st.stage=1;return}
      if(st.stage===1&&c>=st.lo+1.382*(st.hi-st.lo)){acc.sell(i,acc.shares*(0.3/0.7),'分批停利二：到 138.2% 擴展位再賣 30%','trim');st.stage=2;return}
      if(st.stage>=1&&c<ctx.ma120[i])why='底倉出場：跌破半年線（MA120）';
    }
    if(why){acc.sell(i,acc.shares,why,'exit');st.buys=0;st.armed=false}
  }
  const multByGrade=(p,g)=>p.mult[Math.max(1,Math.min(5,g))-1];
  // Two pots for the multiplier strategies: each scheduled month releases B = C ÷ N. A month with a
  // multiplier below 1 spends B × m and moves the rest into a reserve; a month above 1 spends B plus an
  // extra drawn from the reserve (B × (m − 1), or draw % of the reserve if larger). Spending can never
  // run ahead of the schedule, so the pot does not run dry in year one, and after the N months the
  // reserve is still there for low-water months. Sale proceeds (trims) also go to the reserve.
  function paced(i,acc,st,h,m,reason,draw){
    const B=h.dcaMonths.has(i)?h.base:0,reserve=st.reserve||0,regular=B*Math.min(1,Math.max(0,m));
    const extra=m>1?Math.min(reserve,Math.max(h.base*(m-1),reserve*(draw||0)/100)):0,before=acc.cash;
    if(regular+extra>0)acc.buy(i,regular+extra,reason+(extra>0.5?'（動用蓄水池 '+Math.round(extra)+' 元）':''),'dca');
    st.reserve=Math.max(0,reserve+B-(before-acc.cash));
  }
  const toReserve=(st,net)=>{st.reserve=(st.reserve||0)+(net||0)};
  const STRATEGIES={
    classic:{day:classicDay},
    dca:{day(i,ctx,cfg,acc,st,h){if(h.dcaMonths.has(i))acc.buy(i,h.base,'定期定額：C ÷ '+h.N,'dca')}},
    smart_dca_water:{day(i,ctx,cfg,acc,st,h){
      if(!monthDay(ctx,i,h.months[0]))return;const p=cfg.params,g=h.water.grade[i]||3,m=multByGrade(p,g);
      paced(i,acc,st,h,m,'潮位定投：水位 '+g+' 分 × '+m,g>=5?p.draw:0);
      if(p.trim&&g===1&&ctx.ma60[i]&&ctx.close[i]/ctx.ma60[i]-1>p.trimBias/100)toReserve(st,acc.sell(i,acc.shares*p.trimPct/100,'高檔減碼 '+p.trimPct+'%，轉入蓄水池','trim'));
    }},
    value_averaging:{day(i,ctx,cfg,acc,st,h){
      // After the N scheduled months no new installments are added; the target keeps only its monthly growth.
      if(!monthDay(ctx,i,h.months[0]))return;const p=cfg.params,g=p.growth/100;st.m=(st.m||0)+1;const k=Math.min(h.N,st.m);
      const target=(g>0?h.base*((Math.pow(1+g,k)-1)/g):h.base*k)*Math.pow(1+g,st.m-k),cur=acc.shares*ctx.close[i],gap=target-cur;
      if(gap>=0)paced(i,acc,st,h,Math.min(p.cap,gap/h.base),'定期定值：補到目標市值');
      else{if(h.dcaMonths.has(i))toReserve(st,h.base);if(p.allowSell)toReserve(st,acc.sell(i,-gap/ctx.close[i],'定期定值：超出目標的部分轉入蓄水池','trim'))}
    }},
    bias_tiered_dca:{day(i,ctx,cfg,acc,st,h){
      if(!monthDay(ctx,i,h.months[0])||!(ctx.ma60[i]>0))return;const b=(ctx.close[i]/ctx.ma60[i]-1)*100,t=cfg.params.tiers;
      const m=b>15?t[0]:b>=-5?t[1]:b>=-10?t[2]:b>=-15?t[3]:t[4];paced(i,acc,st,h,m,'乖離定投：MA60 乖離 '+b.toFixed(1)+'% × '+m);
    }},
    tech_bb_rsi_dca:{day(i,ctx,cfg,acc,st,h){
      const p=cfg.params;if(monthDay(ctx,i,h.months[0]))acc.buy(i,h.base*p.baseRatio,'技術存股：每月底倉','dca');
      const pb=(ctx.close[i]-ctx.bbLo[i])/(ctx.bbUp[i]-ctx.bbLo[i]);if(!Number.isFinite(pb)||!Number.isFinite(ctx.rsi[i]))return;
      if(i-(st.lastBuy??-99)>=5&&pb<p.pbLow&&ctx.rsi[i]<p.rsiLow){if(acc.buy(i,h.base*p.dipMult,'超賣加碼：%B '+pb.toFixed(2)+'、RSI '+ctx.rsi[i].toFixed(0),'add'))st.lastBuy=i}
      if(i-(st.lastSell??-99)>=5&&pb>p.pbHigh&&ctx.rsi[i]>p.rsiHigh&&acc.shares){acc.sell(i,acc.shares*p.trimPct/100,'過熱減碼 '+p.trimPct+'%','trim');st.lastSell=i}
    }},
    core_satellite:{init(ctx,cfg,st){st.sat=0;st.satShares=0;st.satCost=0;st.round={buys:0}},day(i,ctx,cfg,acc,st,h,inflow){
      // The satellite is a sub-ledger inside the same account: its cash and shares are tracked separately.
      const p=cfg.params,c=ctx.close[i],w=h.water;st.sat+=inflow*(1-p.core/100);
      if(monthDay(ctx,i,h.months[0])){const g=w.grade[i]||3,m=multByGrade(p,g),avail=acc.cash-st.sat;
        if(avail>0)acc.buy(i,Math.min(avail,h.base*(p.core/100)*m),'核心定投：水位 '+g+' 分','dca')}
      const r=st.round;
      if(!r.buys){if(w.grade[i]>=p.satGrade&&st.sat>0){const spent=st.sat/2,sh=acc.buy(i,Math.min(spent,acc.cash),'衛星進場：水位 '+w.grade[i]+' 分','add');if(sh){st.satShares+=sh;st.satCost+=acc.trades.at(-1).amount;st.sat-=acc.trades.at(-1).amount;r.buys=1;r.peak=c;r.hi=w.hi[i];r.last=c}}return}
      r.peak=Math.max(r.peak,c);
      if(r.buys<2&&c<=r.last*(1-p.step/100)&&st.sat>0){const sh=acc.buy(i,Math.min(st.sat,acc.cash),'衛星加碼','add');if(sh){st.satShares+=sh;st.satCost+=acc.trades.at(-1).amount;st.sat-=acc.trades.at(-1).amount;r.buys++;r.last=c}}
      if(c>=r.hi)r.armed=true;
      if(r.armed&&c<=r.peak*(1-p.trail/100)&&st.satShares>0){const net=acc.sell(i,st.satShares,'衛星移動停利出場','exit');
        // Satellite profit goes to the core pot; the original stake returns to the satellite pot.
        st.sat+=Math.min(net,st.satCost);st.satShares=0;st.satCost=0;st.round={buys:0}}
    }},
    rebalance_50_50:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,w=p.weight/100,band=p.band/100,cur=acc.value(i)>0?acc.shares*ctx.close[i]/acc.value(i):0;
      if(inflow||cur>w+band||cur<w-band)acc.toWeight(i,w,inflow?'入金後回到 '+p.weight+'%':'偏離 '+(cur*100).toFixed(0)+'%，再平衡回 '+p.weight+'%');
    }},
    dual_momentum:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,c=ctx.close[i];
      if(monthDay(ctx,i,h.months[0])&&i>=120){
        const mom=0.5*(c/ctx.close[i-60]-1)+0.5*(c/ctx.close[i-120]-1),hurdle=cfg.parking/100*0.5,okScore=!p.minScore||(h.water.core[i]>=p.minScore);
        const on=mom>hurdle&&c>ctx.ma120[i]&&okScore;
        if(on&&!st.on)acc.buy(i,acc.cash,'動能轉正：近 60／120 日 '+(mom*100).toFixed(1)+'%，站上 MA120','entry');
        if(!on&&st.on&&acc.shares)acc.sell(i,acc.shares,'動能轉弱或跌破 MA120，轉入停泊','exit');
        st.on=on;
      }
      if(st.on&&inflow&&acc.cash>0)acc.buy(i,acc.cash,'動能期間投入新入金','add');
    }},
    macro_regime:{day(i,ctx,cfg,acc,st,h){
      const p=cfg.params,c=ctx.close[i];if(!(ctx.ma200[i]>0)||i<220)return;
      const bull=c>ctx.ma200[i]&&ctx.ma200[i]>ctx.ma200[i-20];
      const macroOk=!p.macroFilter||!ctx.macro||!(ctx.macro[i]<p.macroMin);
      if(!acc.shares||acc.shares*c<acc.value(i)*0.05){
        if(bull){let hh=-Infinity;for(let j=i-19;j<=i;j++)hh=Math.max(hh,ctx.close[j]);
          if(macroOk&&(c<=ctx.ma20[i]*1.01||c<=hh*(1-p.pullback/100))){if(acc.buy(i,acc.cash,'多頭淺回檔買進（回到 MA20 或回落 '+p.pullback+'%）','entry')){st.peak=c;st.mode='bull'}}}
        else if(macroOk&&h.water.grade[i]>=5){if(acc.buy(i,acc.cash,'空頭深回檔：水位 5 分','entry')){st.peak=c;st.mode='bear';st.entry=c}}
        return;
      }
      st.peak=Math.max(st.peak||c,c);
      if(st.mode==='bull'&&c<=st.peak*(1-p.trail/100))acc.sell(i,acc.shares,'多頭移動停利：自高點回落 '+p.trail+'%','exit');
      else if(st.mode==='bear'&&(c>=ctx.ma60[i]&&c>st.entry||c<=st.entry*(1-p.stop/100)))acc.sell(i,acc.shares,c>=ctx.ma60[i]?'空頭反彈到 MA60 獲利了結':'空頭停損','exit');
    }},
    vol_targeting:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,s=ctx.sigma[i];if(!(s>0))return;
      const target=Math.max(p.minW/100,Math.min(1,p.target/100/s)),cur=acc.value(i)>0?acc.shares*ctx.close[i]/acc.value(i):0;
      if(inflow||Math.abs(cur-target)>p.band/100)acc.toWeight(i,target,'波動 '+(s*100).toFixed(0)+'%，部位調到 '+(target*100).toFixed(0)+'%');
    }},
    bb_squeeze:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,c=ctx.close[i];if(!Number.isFinite(ctx.bbUp[i]))return;
      if(!acc.shares){let squeezed=false;for(let j=Math.max(0,i-5);j<=i;j++)if(ctx.bwRank[j]<=p.squeeze/100)squeezed=true;
        if(squeezed&&c>ctx.bbUp[i]&&(!p.volume||ctx.vol[i]>ctx.volMa20[i]))acc.buy(i,acc.cash,'帶寬壓縮後突破上軌','entry');return}
      if(inflow&&acc.cash>0)acc.buy(i,acc.cash,'持有期間投入新入金','add');
      if(c<ctx.ma20[i])acc.sell(i,acc.shares,'收盤跌破 MA20','exit');
    }}
  };
  /* ---------- defaults and presets ---------- */
  const PARAMS={
    classic:{entry:'drop',drop:20,levels:[0.382,0.5,0.618],buyGrade:5,step:10,adds:3,exit:'gain',rise:20,sellGrade:1,fibExt:1,trail:10,atrMult:3,stop:0,maxDays:0},
    dca:{},
    smart_dca_water:{mult:[0.3,0.7,1,1.8,3],draw:30,trim:false,trimBias:25,trimPct:15},
    value_averaging:{growth:0.6,cap:3.5,allowSell:true},
    bias_tiered_dca:{tiers:[0.5,1,1.5,2.2,3.5]},
    tech_bb_rsi_dca:{baseRatio:0.6,dipMult:2,pbLow:0.15,rsiLow:35,pbHigh:1.05,rsiHigh:80,trimPct:10},
    core_satellite:{core:70,mult:[0.3,0.7,1,1.8,3],satGrade:4,step:8,trail:10},
    rebalance_50_50:{weight:50,band:10},
    dual_momentum:{minScore:0},
    macro_regime:{pullback:6,trail:10,stop:15,macroFilter:true,macroMin:1.5},
    vol_targeting:{target:18,minW:20,band:10},
    bb_squeeze:{squeeze:15,volume:true}
  };
  const P=(strategy,params)=>({strategy,params:{...PARAMS[strategy],...params}});
  const FAMILIES=[['swing','經典回檔波段'],['dca','智慧定期定額'],['trend','順勢動能'],['mix','配置雙軌']];
  const PRESETS=[
    {id:'drop20',family:'swing',name:'跌 20% 買、賺 20% 賣',...P('classic',{entry:'drop',drop:20,step:10,adds:3,exit:'gain',rise:20})},
    {id:'ladder10',family:'swing',name:'每跌 10% 分批承接',...P('classic',{entry:'drop',drop:10,step:10,adds:4,exit:'gain',rise:15})},
    {id:'backToHigh',family:'swing',name:'回到前高就賣',...P('classic',{entry:'drop',drop:15,step:10,adds:2,exit:'high',rise:0})},
    {id:'fib',family:'swing',name:'黃金分割分批',...P('classic',{entry:'fib',levels:[0.382,0.5,0.618],exit:'fibext',fibExt:1})},
    {id:'grade51',family:'swing',name:'水位 5 分買、1 分賣',...P('classic',{entry:'grade',buyGrade:5,step:10,adds:2,exit:'grade',sellGrade:1})},
    {id:'chandelier',family:'swing',name:'潮位抄底＋移動停利',...P('classic',{entry:'grade',buyGrade:4,step:8,adds:2,exit:'trailing',trail:10,atrMult:3})},
    {id:'pyramid',family:'swing',name:'金字塔分批停利',...P('classic',{entry:'drop',drop:12,step:8,adds:2,exit:'pyramid',rise:15})},
    {id:'dca',family:'dca',name:'定期定額（對照）',...P('dca',{})},
    {id:'smartDca',family:'dca',name:'潮位動態加權定投',...P('smart_dca_water',{})},
    {id:'va',family:'dca',name:'定期定值',...P('value_averaging',{})},
    {id:'bias',family:'dca',name:'均線乖離階梯定投',...P('bias_tiered_dca',{})},
    {id:'bbRsi',family:'dca',name:'布林 %B＋RSI 技術存股',...P('tech_bb_rsi_dca',{})},
    {id:'momentum',family:'trend',name:'雙動能趨勢',...P('dual_momentum',{})},
    {id:'regime',family:'trend',name:'多空體制切換',...P('macro_regime',{})},
    {id:'volTarget',family:'trend',name:'目標波動率控倉',...P('vol_targeting',{})},
    {id:'squeeze',family:'trend',name:'布林壓縮突破',...P('bb_squeeze',{})},
    {id:'coreSat',family:'mix',name:'70/30 核心衛星',...P('core_satellite',{})},
    {id:'rebalance',family:'mix',name:'50:50 動態再平衡',...P('rebalance_50_50',{})}
  ];
  return{prepare,reference,water,score,run,xirr,STRATEGIES,PARAMS,PRESETS,FAMILIES};
})();

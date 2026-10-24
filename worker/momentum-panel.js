/* Optional, reproducible price momentum versus TAIEX. Uses finalized daily bars only. */
settings.momentumEnabled=settings.momentumEnabled===true;
const momentumPanel=document.createElement('section');momentumPanel.className='momentum-panel';
momentumPanel.innerHTML='<button id="momentumToggle" class="pill chip" type="button" aria-expanded="false">動量共振 · 選用指標</button><div id="momentumBody" class="momentum-body hidden"></div>';
$('techRead').after(momentumPanel);
const momentumToggle=$('momentumToggle'),momentumBody=$('momentumBody');
let momentumQueued=false;
function momentumRender(){
  momentumToggle.setAttribute('aria-expanded',String(settings.momentumEnabled));
  momentumBody.classList.toggle('hidden',!settings.momentumEnabled);
  if(!settings.momentumEnabled)return;
  const etf=bars.filter(b=>!b.intraday),idx=new Map(market.filter(d=>!d.intraday&&Number.isFinite(d.index)).map(d=>[d.date,d.index]));
  const pair=etf.filter(b=>idx.has(b.date));
  if(pair.length<61){momentumBody.textContent='ETF 與大盤共同交易日不足 61 日，暫不計算。';return}
  const at=pair.at(-1),prev20=pair.at(-21),prev60=pair.at(-61);
  const ret=(now,was)=>(now/was-1)*100;
  const e20=ret(at.close,prev20.close),e60=ret(at.close,prev60.close),m20=ret(idx.get(at.date),idx.get(prev20.date)),m60=ret(idx.get(at.date),idx.get(prev60.date));
  const excess20=e20-m20,excess60=e60-m60;
  const latest40=pair.slice(-40),splitDate=(historyMeta?.adjustments||[]).some(a=>a.date>=latest40[0].date&&a.date<=at.date);
  const volNow=latest40.slice(-20).reduce((n,b)=>n+b.volume,0),volBefore=latest40.slice(0,20).reduce((n,b)=>n+b.volume,0),volRatio=!splitDate&&volBefore>0?volNow/volBefore:null;
  const checks=[e20>0,e60>0,excess20>0,excess60>0];const positives=checks.filter(Boolean).length;
  const state=positives===4?'價格動量共振':positives>=2?'方向分歧':'價格動量偏弱';
  const signed=x=>(x>0?'+':'')+fmt(x,1)+'%';
  momentumBody.replaceChildren();
  const head=document.createElement('div');head.className='momentum-head';head.innerHTML='<strong></strong><small></small>';
  head.querySelector('strong').textContent=state;head.querySelector('small').textContent=`截至 ${at.date} · 已收盤日 K`;
  momentumBody.append(head);
  const grid=document.createElement('div');grid.className='momentum-grid';
  for(const [label,er,mr,ex] of [['20 日',e20,m20,excess20],['60 日',e60,m60,excess60]]){
    const card=document.createElement('div');card.className='momentum-period';
    const title=document.createElement('b');title.textContent=label+'相對大盤';
    const big=document.createElement('strong');big.className=ex>0?'up':ex<0?'down':'';big.textContent=signed(ex);
    const detail=document.createElement('small');detail.textContent=`${selected} ${signed(er)} · 大盤 ${signed(mr)}`;
    card.append(title,big,detail);grid.append(card)
  }
  momentumBody.append(grid);
  const recent=pair.slice(-61),baseEtf=recent[0].close,baseMarket=idx.get(recent[0].date);
  const etfSeries=recent.map(b=>b.close/baseEtf*100),marketSeries=recent.map(b=>idx.get(b.date)/baseMarket*100);
  const minimum=Math.min(...etfSeries,...marketSeries),maximum=Math.max(...etfSeries,...marketSeries),span=maximum-minimum||1;
  const points=series=>series.map((value,i)=>`${(i*480/60).toFixed(1)},${(109-(value-minimum)/span*96).toFixed(1)}`).join(' ');
  const trend=document.createElement('div');trend.className='momentum-trend';trend.innerHTML=`<div class="momentum-legend"><span></span><span> 加權指數</span><small>61 個共同交易日 · 起點＝100</small></div><svg viewBox="0 0 480 120" preserveAspectRatio="none" role="img"><line x1="0" y1="60" x2="480" y2="60" stroke="currentColor" opacity=".12"/><polyline points="${points(marketSeries)}" fill="none" stroke="#8b98a8" stroke-width="2" vector-effect="non-scaling-stroke"/><polyline points="${points(etfSeries)}" fill="none" stroke="#c9413b" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
  trend.querySelector('span').textContent=' '+selected;trend.querySelector('svg').setAttribute('aria-label',`${selected} 與加權指數近 60 日相對走勢`);
  momentumBody.append(trend);
  const vol=document.createElement('p');vol.className='small';vol.textContent=volRatio==null?'20 日量能比：分割前後張數口徑不同，暫不比較。':`20 日量能比 ${fmt(volRatio,2)} 倍（近 20 日成交股數 ÷ 前 20 日）。`;
  momentumBody.append(vol);
  const caveat=document.createElement('p');caveat.className='small';caveat.textContent='四項條件：ETF 近 20／60 日上漲，且兩段報酬各高於大盤。相對報酬＝ETF 分割還原價漲跌％ − 加權價指數漲跌％。除息期間價格可能失真；這是歷史描述，不是交易訊號，也未納入水位分數。';
  momentumBody.append(caveat);
}
function momentumSchedule(){if(momentumQueued)return;momentumQueued=true;queueMicrotask(()=>{momentumQueued=false;momentumRender()})}
momentumToggle.addEventListener('click',()=>{settings.momentumEnabled=!settings.momentumEnabled;save();momentumRender()});
const momentumDrawChart=drawChart;drawChart=function(...args){const r=momentumDrawChart(...args);momentumSchedule();return r};
const momentumComputeMarket=computeMarket;computeMarket=function(...args){const r=momentumComputeMarket(...args);momentumSchedule();return r};
const momentumApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{momentumApplyProfile(profile);settings.momentumEnabled=settings.momentumEnabled===true;momentumRender()};
momentumRender();

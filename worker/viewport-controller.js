// Historical guide lines follow the rightmost visible bar; current cards and backtests keep their own dates.
(()=>{
  const tools=document.createElement('div');tools.className='viewport-tools';tools.innerHTML='<button class="pill mini" type="button" id="fitViewport">貼合畫面</button><button class="pill mini" type="button" id="latestViewport">回到最新區間</button><span class="small" id="viewportNote" aria-live="polite">圖上水位跟隨畫面最右側 K 棒。</span>';$('chartCard').querySelector('.level-tools').after(tools);
  let chart=null,frame=0,guard=false,bounds=null,key='',lines=[],source=null,ctx=null;
  function clear(){for(const line of lines)lwc?.s.candle.removePriceLine(line);lines=[]}
  function refresh(){
    frame=0;if(!lwc?.data.length){bounds=null;clear();return}const ts=lwc.main.timeScale(),r=ts.getVisibleLogicalRange(),safe=ViewportMath.clamp(r,lwc.data.length);if(!safe)return;
    if(!guard&&(Math.abs(safe.from-r.from)>.01||Math.abs(safe.to-r.to)>.01)){guard=true;ts.setVisibleLogicalRange(safe);guard=false}
    const daily=lwc.daily||bars;if(source!==daily){source=daily;ctx={n:daily.length,bars:daily,refCache:new Map()};key=''}
    const end=Math.max(0,Math.min(lwc.data.length-1,Math.floor(safe.to))),at=ViewportMath.anchor(daily,lwc.data,end),anchor=daily[at];if(!anchor)return;
    const next=[at,settings.window,settings.anchorMode,settings.anchorCount,settings.method,settings.showLevels].join('|');
    if(next!==key){key=next;clear();const ref=E.reference(ctx,settings.window,settings.anchorMode,settings.anchorCount),low=ref.lo[at],high=ref.hi[at];bounds=settings.showLevels&&Number.isFinite(low)&&Number.isFinite(high)&&high>low?{low,high}:null;
      if(bounds)for(const f of settings.method==='fib'?[0,.236,.382,.618,.786,1]:[0,.2,.4,.6,.8,1])lines.push(lwc.s.candle.createPriceLine({price:low+(high-low)*f,color:f===0||f===1?'#438d98':'#9abfc0',lineWidth:f===0||f===1?2:1,lineStyle:2,axisLabelVisible:true,title:`${Number((f*100).toFixed(1))}%`}));
    }
    lwc.visibleAnchor=end;updateLegend(end);const historical=at<daily.length-1;lwc.s.candle.applyOptions({lastValueVisible:!historical,priceLineVisible:!historical});if(historical)lwc.s.candle.applyOptions({title:''});else labelLastBar();
    $('viewportNote').textContent=`圖上錨點 ${anchor.date}${bounds?' · 前 '+(settings.window==='all'?at:settings.window)+' 交易日：'+fmt(bounds.low,2)+' 至 '+fmt(bounds.high,2):settings.showLevels?' · 前期資料不足，暫不畫水位線':' · 水位線未開啟'}${historical?'；上方卡片仍為最近報價。':'。'}`;
    $('viewportNote').dataset.anchor=anchor.date;$('viewportNote').dataset.low=bounds?.low??'';$('viewportNote').dataset.high=bounds?.high??'';
    lwc.main.priceScale('right').applyOptions({autoScale:true});
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(refresh)}
  function bind(){if(!lwc||chart===lwc.main)return;chart=lwc.main;chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);lwc.s.candle.applyOptions({autoscaleInfoProvider:original=>{const info=original();if(!info?.priceRange)return info;let{minValue:lo,maxValue:hi}=info.priceRange;if(bounds){lo=Math.min(lo,bounds.low);hi=Math.max(hi,bounds.high)}const pad=Math.max(hi-lo,Math.abs(hi)*.0001,.0001)*.06;return{priceRange:{minValue:lo-pad,maxValue:hi+pad}}}});chart.priceScale('right').applyOptions({scaleMargins:{top:0,bottom:0},autoScale:true})}
  function fit(){if(!lwc)return;bounds=null;key='';bind();refresh();lwc.main.priceScale('right').applyOptions({autoScale:true})}
  $('fitViewport').addEventListener('click',fit);$('latestViewport').addEventListener('click',()=>{setRange('1m');fit()});$('chart').addEventListener('dblclick',e=>{if(e.target.closest('.measure-surface'))return;fit()});
  const previous=drawChart;drawChart=function(...args){previous(...args);bind();key='';schedule()};
  window.chaoweiViewport={refresh:schedule};bind();schedule();
})();

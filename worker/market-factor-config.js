// Market factors have their own reference window, independent of the selected ETF's price window.
let bankDays=[],bankPosition=null;
settings.marketWindow=Math.max(20,Math.min(2400,Math.round(Number(settings.marketWindow)||120)));
settings.marketMethod=['mean','normal'].includes(settings.marketMethod)?settings.marketMethod:'normal';
settings.marketSpan=Math.max(1,Math.min(200,Number(settings.marketSpan)||20));
settings.bankRange=Number(settings.bankRange)||60;
const marketConfig=document.createElement('details');marketConfig.className='market-config';
marketConfig.innerHTML='<summary>原油・融資・官股的計分設定</summary><div class="controls"><label>參考筆數<select id="marketWindow"><option value="20">20 筆</option><option value="60">60 筆</option><option value="120">120 筆</option><option value="240">240 筆</option><option value="360">360 筆</option><option value="custom">自訂…</option></select></label><label>計分方式<select id="marketMethod"><option value="normal">常態分布（Z 分數）</option><option value="mean">均值比例五等分</option></select></label><label id="marketSpanWrap">均值上下範圍（%）<input id="marketSpan" type="number" min="1" max="200" step="1"></label></div><p class="small" id="marketMethodHelp"></p>';
$('factorRail').before(marketConfig);
function fillMarketConfig(){customOption($('marketWindow'),settings.marketWindow,settings.marketWindow+' 筆');$('marketWindow').value=settings.marketWindow;$('marketMethod').value=settings.marketMethod;$('marketSpan').value=settings.marketSpan;$('marketSpanWrap').classList.toggle('hidden',settings.marketMethod!=='mean');$('marketMethodHelp').textContent=settings.marketMethod==='normal'?'原油用前 N 筆標準差；融資與官股用前 N 筆的均方根衡量離零程度。均值／零軸為 2.5 分。常態模型 ±1／2／3σ 約涵蓋 68.27%／95.45%／99.73%，不是上漲機率；不足 N 用實際筆數，少於 20 筆停算。':'原油以歷史均值 ± 所選百分比切五段；融資增減與官股買賣超以零為中心、±2 倍歷史均方根切五段，顯示 0–5 連續分數；不足 N 用實際筆數。'}
function factorScore(values,zero=false,higherBetter=false){return MarketScoring.evaluate(values,{window:settings.marketWindow,method:settings.marketMethod,span:settings.marketSpan,zero,higherBetter})}
function signNum(v,d=1){return(v>0?'+':'')+fmt(v,d)}
function factorSpark(rows){const a=rows.slice(-30).map(x=>x.value),lo=Math.min(...a),hi=Math.max(...a),span=hi-lo||1;return a.length<2?'':`<svg viewBox="0 0 220 44" role="img" aria-label="近 30 筆走勢"><polyline points="${a.map((v,i)=>`${i*220/(a.length-1)},${40-(v-lo)/span*34}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>`}
function recomputeFactors(){computeMktMargin();computeBrent();computeBank();updateWeights();if(factorTrendKey)renderFactorTrend();if(btCtx){btCtx=null;btSchedule()}}
fillMarketConfig();
for(const id of ['marketWindow','marketMethod','marketSpan'])$(id).addEventListener('change',function(){
  if(id==='marketWindow'){let n=this.value;if(n==='custom'){n=prompt('參考筆數（20–2400）',settings.marketWindow);if(n===null){fillMarketConfig();return}}settings.marketWindow=Math.max(20,Math.min(2400,Math.round(Number(n)||120)))}
  if(id==='marketMethod')settings.marketMethod=this.value;
  if(id==='marketSpan')settings.marketSpan=Math.max(1,Math.min(200,Number(this.value)||20));
  fillMarketConfig();recomputeFactors();save();
});

if(shareView)for(const id of ['marketWindow','marketMethod','marketSpan'])$(id).disabled=true;

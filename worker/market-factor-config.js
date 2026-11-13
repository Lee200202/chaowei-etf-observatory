// Market factors have their own reference window, independent of the selected ETF's price window.
let bankDays=[],bankPosition=null,vixDays=[];
// Latest VIX for scoring: the delayed Yahoo quote while its session is open and fresh (refreshed every five minutes
// with the other live factors), otherwise the last daily close (Cboe, or a finished Yahoo session until Cboe arrives).
function vixLatest(){
  const d=vixDays.at(-1),q=typeof live!=='undefined'?live?.vixQuote:null,at=Date.parse(q?.time),end=Date.parse(q?.endTime),now=Date.now();
  if(q?.symbol==='^VIX'&&q.price>0&&/^\d{4}-\d{2}-\d{2}$/.test(q.date||'')&&(!d||q.date>d.date)&&Number.isFinite(at)&&at<=now+60000&&now<end&&now-at<45*60000)return{date:q.date,value:q.price,time:q.time,intraday:true};
  return d||null;
}
settings.marketWindow=Math.max(20,Math.min(2400,Math.round(Number(settings.marketWindow)||120)));
settings.marketMethod=['mean','normal'].includes(settings.marketMethod)?settings.marketMethod:'normal';
settings.marketSpan=Math.max(1,Math.min(200,Number(settings.marketSpan)||20));
settings.bankRange=[20,60,120,0].includes(settings.bankRange)?settings.bankRange:'ref';
const marketConfig=document.createElement('details');marketConfig.className='market-config';
marketConfig.innerHTML='<summary>觀測因子的計分設定（參考筆數與計分方式）</summary><div class="controls"><label>參考筆數<select id="marketWindow"><option value="30">30 筆</option><option value="60">60 筆</option><option value="120">120 筆</option><option value="240">240 筆</option><option value="600">600 筆</option></select></label><label>自訂參考筆數 <output id="marketLookbackValue"></output><input id="marketLookback" type="range" min="20" max="2400" step="1"></label><label>計分方式<select id="marketMethod"><option value="normal">常態分布（Z 分數）</option><option value="mean">均值比例五等分</option></select></label><label id="marketSpanWrap">均值上下範圍（%）<input id="marketSpan" type="number" min="1" max="200" step="1"></label></div><p class="small" id="marketMethodHelp"></p>';
$('factorRail').before(marketConfig);
function fillMarketConfig(){
  $('marketWindow').querySelectorAll('[data-custom]').forEach(option=>option.remove());
  customOption($('marketWindow'),settings.marketWindow,settings.marketWindow+' 筆');
  $('marketWindow').value=settings.marketWindow;$('marketLookback').value=settings.marketWindow;
  $('marketLookbackValue').value=settings.marketWindow+' 筆';
  $('marketMethod').value=settings.marketMethod;$('marketSpan').value=settings.marketSpan;
  $('marketSpanWrap').classList.toggle('hidden',settings.marketMethod!=='mean');
  $('marketMethodHelp').textContent='卡片走勢顯示最近 N 筆。六項市場分數以本次值之前的 N 筆作比較；VIX 分數用本站恐慌門檻，參考筆數控制走勢。資料不足時顯示實際筆數，其他因子少於 20 筆暫停計分。';
}
function setMarketLookback(value){
  const next=Math.max(20,Math.min(2400,Math.round(Number(value)||120)));
  if(next===marketN())return;
  settings.marketWindow=next;settings.factorRange='ref';settings.bankRange='ref';
  fillMarketConfig();recomputeFactors();save();
  document.dispatchEvent(new Event('market-lookback'));
}
function factorScore(values,zero=false,higherBetter=false){return MarketScoring.evaluate(values,{window:settings.marketWindow,method:settings.marketMethod,span:settings.marketSpan,zero,higherBetter})}
function signNum(v,d=1){return(v>0?'+':'')+fmt(v,d)}
function factorSpark(rows){const a=rows.slice(-30).map(x=>x.value),lo=Math.min(...a),hi=Math.max(...a),span=hi-lo||1;return a.length<2?'':`<svg viewBox="0 0 220 44" role="img" aria-label="近 30 筆走勢"><polyline points="${a.map((v,i)=>`${i*220/(a.length-1)},${40-(v-lo)/span*34}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>`}
function recomputeFactors(){computeMarket();computeFx();computeMktMargin();computeBrent();computeBank();updateWeights();if(factorTrendKey)renderFactorTrend();if(btCtx){btCtx=null;btSchedule()}}
fillMarketConfig();
for(const id of ['marketWindow','marketMethod','marketSpan'])$(id).addEventListener('change',function(){
  if(id==='marketWindow'){setMarketLookback(this.value);return}
  if(id==='marketMethod')settings.marketMethod=this.value;
  if(id==='marketSpan')settings.marketSpan=Math.max(1,Math.min(200,Number(this.value)||20));
  fillMarketConfig();recomputeFactors();save();
});

$('marketLookback').addEventListener('input',e=>setMarketLookback(e.target.value));
if(shareView)for(const id of ['marketLookback','marketWindow','marketMethod','marketSpan'])$(id).disabled=true;

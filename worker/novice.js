/* ---------- Beginner / expert mode for the backtest ---------- */
// Beginner mode hides the fine-tuning fields; the hidden values are pinned to the safe defaults
// (one installment per month, water levels synced with the observation settings above).
settings.uiMode=settings.uiMode==='expert'?'expert':'novice';
function applyUiMode(){
  const novice=settings.uiMode==='novice';document.body.classList.toggle('novice',novice);
  $('btMode').querySelectorAll('[data-mode]').forEach(b=>{const on=b.dataset.mode===settings.uiMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
  if(novice&&(settings.bt.dcaPeriods!=='auto'||!settings.bt.sync)){settings.bt.dcaPeriods='auto';settings.bt.sync=true;save();btFillForm();if(btResult)btSchedule()}
}
$('btMode').addEventListener('click',e=>{const t=e.target.closest('[data-mode]');if(!t)return;settings.uiMode=t.dataset.mode;save();applyUiMode()});
applyUiMode();

/* ---------- Plain-language scenarios for the observation window ---------- */
function markScenario(){$('scenarios').querySelectorAll('[data-win]').forEach(b=>b.classList.toggle('on',b.dataset.win===String(settings.window)))}
$('scenarios').addEventListener('click',e=>{
  const t=e.target.closest('[data-win]');if(!t)return;const sel=$('window');
  if(![...sel.options].some(o=>o.value===t.dataset.win))customOption(sel,t.dataset.win,t.dataset.win+' 交易日（自訂）');
  sel.value=t.dataset.win;sel.dispatchEvent(new Event('change',{bubbles:true}));markScenario();
});
$('window').addEventListener('change',()=>setTimeout(markScenario,0));
markScenario();

/* ---------- Weights: used in proportion, so any total works; live preview of the combined score ---------- */
const WEIGHT_LABELS=['本檔 ETF','大盤價格','大盤量能','布蘭特原油','美元／新台幣'];
const shareUpdateWeights=updateWeights;
updateWeights=function(){
  shareUpdateWeights();
  const w=settings.weights||[],sum=w.reduce((a,b)=>a+b,0),share=w.map(x=>sum>0?x/sum:0);
  ['oEtf','oIndex','oVolume','oBrent','oFx'].forEach((k,i)=>$(k).textContent=Math.round(share[i]*100)+'%');
  $('weightStatus').textContent=sum===100?'權重合計 100%':sum>0?`權重合計 ${sum}%，已依比例換算成 100%`:'請至少設定一項權重';
  $('weightBar').innerHTML=share.map((s,i)=>s>0?`<span class="w${i}" style="width:${(s*100).toFixed(2)}%" title="${WEIGHT_LABELS[i]} ${Math.round(s*100)}%">${s>=0.12?WEIGHT_LABELS[i]+' '+Math.round(s*100)+'%':''}</span>`:'').join('');
  const vs=marketPosition?.volumeScore??0,v=settings.volumeDirection==='low'?5-vs:vs;
  const ready=[!!position,!!marketPosition,!!marketPosition&&settings.volumeDirection!=='off'&&marketPosition.volumeGrade!=null,!!brentPosition,!!fxPosition];
  if(!position||sum<=0||share.some((s,i)=>s>0&&!ready[i])){
    $('combined').textContent='—';$('combinedExtra').textContent=sum<=0?'請至少設定一項權重':'資料不足或量能方向未設定';$('weightPreview').textContent='';return}
  const core=[position.core,marketPosition?.index.core||0,v||0,brentPosition?.core||0,fxPosition?.core||0].reduce((a,x,i)=>a+share[i]*x,0);
  const ext=[position.raw,marketPosition?.index.raw||0,v||0,brentPosition?.raw||0,fxPosition?.raw||0].reduce((a,x,i)=>a+share[i]*x,0);
  $('combined').textContent=fmt(core,1)+' / 5';$('combinedExtra').textContent='延伸綜合分 '+fmt(ext,1);
  const d=core-position.core;
  $('weightPreview').innerHTML=`📊 只看 ${selected}：<b>${fmt(position.core,1)}</b> 分 → 依你的權重：<b>${fmt(core,1)}</b> 分`+(Math.abs(d)>=0.05?`（${d>0?'偏向加碼':'偏向減碼'} ${fmt(Math.abs(d),1)} 分）`:'');
};
// The sliders were bound to the first version of updateWeights; run the current chain after them.
for(const id of ['wEtf','wIndex','wVolume','wBrent','wFx','volumeDirection','normalize'])$(id).addEventListener(id==='normalize'?'click':id==='volumeDirection'?'change':'input',()=>updateWeights());

/* ---------- Back to the observation area ---------- */
const toTop=document.createElement('button');toTop.type='button';toTop.className='to-top hidden';toTop.textContent='⬆ 回到上方觀測區';
toTop.addEventListener('click',()=>{const t=document.querySelector('.toolbar');window.scrollTo({top:t.getBoundingClientRect().top+scrollY-12,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})});
document.body.append(toTop);
// Shown once the price chart has scrolled out of view, hidden while a sheet is open.
// (A scroll check, not an IntersectionObserver: a jump straight past the chart never changes its intersection.)
const chartCard=document.querySelector('.chart-card');let toTopFrame=0;
const placeToTop=()=>{toTopFrame=0;toTop.classList.toggle('hidden',!chartCard||chartCard.getBoundingClientRect().bottom>0)};
window.addEventListener('scroll',()=>{if(!toTopFrame)toTopFrame=requestAnimationFrame(placeToTop)},{passive:true});placeToTop();

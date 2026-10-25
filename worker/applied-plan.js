/* ---------- Saved weight plan drives the main water level ----------
   「儲存並套用到水位」 keeps the current weights on this device. While a plan is applied, the top bar, the big water
   number and the gauge show that plan's weighted score, recomputed from the latest data on every refresh,
   instead of this ETF's own price position. Moving the sliders afterwards does not change the main screen until
   the plan is saved again. Scoring directions stay the global settings. A shared plan link shows its own weights. */
(()=>{
  const valid=p=>p&&Array.isArray(p.weights)&&p.weights.some(x=>Number(x)>0);
  if(!valid(settings.appliedPlan))delete settings.appliedPlan;
  const plan=()=>shareView?{weights:currentWeights(),name:'分享的方案'}:settings.appliedPlan||null;
  const box=document.createElement('div');box.className='applied-plan';box.innerHTML='<p class="small" id="appliedStatus" aria-live="polite"></p><div><button class="action" type="button" id="applyWeights">儲存並套用到水位</button><button class="pill" type="button" id="clearApplied">改回只看本檔</button></div>';
  $('weightPreview').after(box);
  const label=$('grade').closest('.water-copy').querySelector('.overline'),plainLabel=label.textContent;
  const note=document.createElement('p');note.className='small applied-note hidden';$('grade').after(note);
  const barLabel=$('barGrade').previousElementSibling,plainBar=barLabel?.textContent;
  const same=(a,b)=>JSON.stringify((a||[]).map(Number))===JSON.stringify((b||[]).map(Number));
  function status(){
    const p=settings.appliedPlan,changed=p&&!same(p.weights,currentWeights());
    $('appliedStatus').textContent=shareView?'檢視分享的方案：主畫面水位依這組權重計算。':p?`主畫面水位使用「${p.name}」（${p.savedAt} 儲存）`+(changed?'；目前滑桿與已套用的不同，按「儲存並套用到水位」更新。':'。'):'主畫面水位目前只看本檔價格位置；按下按鈕後改用這組權重，並隨最新資料更新。';
    $('clearApplied').hidden=!p||shareView;$('applyWeights').hidden=shareView;
  }
  function show(){
    frame=0;status();const p=plan();
    if(!p){label.textContent=plainLabel;if(barLabel)barLabel.textContent=plainBar;note.classList.add('hidden');return}
    const r=weightedScore(p.weights);
    if(r.value==null){label.textContent=plainLabel;if(barLabel)barLabel.textContent=plainBar;note.textContent='「'+p.name+'」部分因子資料不足，暫時顯示本檔價格水位。';note.classList.remove('hidden');return}
    const v=r.value,own=r.scores[0];
    $('grade').innerHTML=fmt(v,1)+'<small>/5</small>';$('barGrade').textContent=fmt(v,1)+' / 5';
    // The gauge fills like the price gauge: a high score (favourable) is a low water line.
    const cup=$('cupWater');cup.style.height=Math.max(0,Math.min(1,1-v/5))*100+'%';const [a,b]=tideColors(v);cup.style.setProperty('--w1',a);cup.style.setProperty('--w2',b);
    label.textContent='綜合水位 · 我的權重';if(barLabel)barLabel.textContent='我的水位';
    // The suggestion tag follows the plan score; the range sentence below still describes the ETF's own price.
    const tag=$('action-etf');if(tag&&typeof DM!=='undefined'){const act=DM.action(v);tag.className='direction-action '+act.kind;tag.textContent=act.text}
    const wt=$('waterText');if(wt&&wt.textContent&&!wt.textContent.startsWith('本檔價格'))wt.textContent='本檔價格'+wt.textContent;
    const ex=$('extended');if(ex&&ex.textContent.startsWith('水位'))ex.textContent='本檔價格位置'+ex.textContent.slice(2);
    note.textContent=`依「${p.name}」計算；本檔價格水位 ${Number.isFinite(own)?fmt(own,1):'—'} 分。`;note.classList.remove('hidden');
  }
  let frame=0;const schedule=()=>{if(!frame)frame=requestAnimationFrame(show)};
  // Every path that rewrites the ETF score is followed by the plan score.
  const rp=renderPosition;renderPosition=function(...a){const out=rp(...a);schedule();return out};
  const uw=updateWeights;updateWeights=function(...a){const out=uw(...a);schedule();return out};
  if(typeof refreshDirectionViews==='function'){const rd=refreshDirectionViews;refreshDirectionViews=function(...a){const out=rd(...a);schedule();return out}}
  function apply(name){settings.appliedPlan={weights:currentWeights(),name:name||'我的權重',savedAt:new Date().toISOString().slice(0,10)};save();schedule()}
  $('applyWeights').addEventListener('click',()=>apply(settings.appliedPlan?.name));
  $('clearApplied').addEventListener('click',()=>{delete settings.appliedPlan;save();renderPosition();if(typeof refreshDirectionViews==='function')refreshDirectionViews();schedule()});
  window.chaoweiPlanApplied=name=>{updateWeights();apply(name)};
  schedule();
})();

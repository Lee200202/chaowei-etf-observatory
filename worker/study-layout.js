(()=>{
  settings.studyMode=settings.studyMode==='full'?'full':'basic';
  const mode=document.createElement('div');mode.className='study-mode-bar';mode.innerHTML='<div class="segment" role="group" aria-label="研究檢視"><button type="button" data-study-mode="basic">基礎檢視</button><button type="button" data-study-mode="full">完整研究</button></div><button class="pill mini" id="quickTour" type="button">操作教學</button>';
  document.querySelector('.toolbar').after(mode);$('quickTour').addEventListener('click',startTour);
  const motion=$('motionToggle');mode.append(motion);motion.classList.add('pill','mini');
  const drawers=[];
  for(const [id,title]of [['measurePanel','區間量測'],['chipCard','法人與融資'],['holderCard','大戶持有分布'],['waveStudy','波段研究'],['weights','權重設定']]){const node=$(id),d=document.createElement('details');d.className='study-drawer';d.id='drawer-'+id;const s=document.createElement('summary');s.textContent=title;node.before(d);d.append(s,node);drawers.push(d)}
  const pin=document.querySelector('.wave-pin-panel');if(pin){const d=document.createElement('details');d.className='study-drawer';d.innerHTML='<summary>研究圖釘</summary>';pin.before(d);d.append(pin);drawers.push(d)}
  let lastMode='';
  function apply(){const basic=settings.studyMode!=='full';document.body.classList.toggle('basic-study',basic);mode.querySelectorAll('[data-study-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.studyMode==='basic')===basic)));if(lastMode!==settings.studyMode){drawers.forEach(d=>d.open=!basic);lastMode=settings.studyMode}if(basic)document.body.classList.add('novice');else applyUiMode()}
  mode.addEventListener('click',e=>{const b=e.target.closest('[data-study-mode]');if(b){settings.studyMode=b.dataset.studyMode;apply();save()}});
  const cards=[...$('factorRail').children].filter(el=>el.querySelector('.factor-direction'));
  function refreshMeta(card){const meta=card.querySelector('p[id$="Meta"]');if(!meta)return;const plain=card.querySelector('.factor-plain');plain.textContent=meta.textContent.split(' · ').slice(0,2).join(' · ')}
  for(const card of cards){const meta=card.querySelector('p[id$="Meta"]');if(!meta)continue;meta.classList.add('factor-detail');const plain=document.createElement('p');plain.className='factor-plain';meta.before(plain);const button=document.createElement('button');button.type='button';button.className='pill mini factor-detail-toggle';button.textContent='計算細節';button.setAttribute('aria-expanded','false');button.addEventListener('click',e=>{e.stopPropagation();const on=card.classList.toggle('details-open');button.setAttribute('aria-expanded',String(on));button.textContent=on?'收起細節':'計算細節'});card.append(button);new MutationObserver(()=>refreshMeta(card)).observe(meta,{childList:true,characterData:true,subtree:true});refreshMeta(card)}
  const intro=document.createElement('div');intro.className='first-visit';intro.innerHTML='<p>第一次使用？三步認識分數、市場方向與歷史驗證。</p><button class="pill mini" type="button" id="introStart">開始導覽</button><button class="pill mini" type="button" id="introLater">稍後</button>';mode.after(intro);
  function introState(){intro.classList.toggle('hidden',!!settings.tourDone||!!settings.quickTourDone||sessionStorage.getItem('chaowei-tour-deferred')==='yes')}
  $('introStart').addEventListener('click',()=>{intro.classList.add('hidden');startTour()});$('introLater').addEventListener('click',()=>{sessionStorage.setItem('chaowei-tour-deferred','yes');introState()});
  const aliases={method:'weights','wave-lab':'waveStudy',chips:'chipCard',backtest:'backtestCard'};
  function followHash(){const id=aliases[location.hash.slice(1)]||location.hash.slice(1),node=$(id);if(!node)return;let parent=node.closest('details.study-drawer');while(parent){parent.open=true;parent=parent.parentElement.closest('details.study-drawer')}if(id&&node.closest('.study-drawer'))requestAnimationFrame(()=>node.scrollIntoView({behavior:'instant',block:'start'}))}
  window.addEventListener('hashchange',followHash);
  const oldTour=endTour;endTour=function(){oldTour();settings.quickTourDone=true;save();introState()};
  const oldProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{oldProfile(p);settings.studyMode=settings.studyMode==='full'?'full':'basic';apply();introState();followHash()};
  apply();introState();followHash();
})();

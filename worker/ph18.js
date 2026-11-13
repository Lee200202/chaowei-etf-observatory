/* Keep guidance beside the relevant controls without repeating it on every card. */
(()=>{
  const guide=()=>{const a=document.createElement('a');a.href='#method-story';a.className='pill mini tide-card-guide';a.textContent='原理圖解';return a};
  $('matrixView').querySelector('.section-heading').append(guide());
  const heading=$('marketPage').querySelector('.section-heading'),actions=document.createElement('div');
  actions.className='tide-guide-actions';
  actions.append(heading.querySelector('a'),guide());
  heading.append(actions);
  heading.querySelector('.sub').textContent='點卡片看完整走勢與計分方式。';
  const scenario=$('scenarios'),custom=document.querySelector('.custom-observation'),choices=document.createElement('div');
  choices.className='observation-choices';
  scenario.before(choices);choices.append(scenario,custom);
  TideMotion.boot();
  const roots=[$('matrixCards'),$('factorRail'),document.querySelector('.etf-lookback-plot')].filter(Boolean);
  for(const root of roots){
    const bind=()=>ChartReadouts.bindMini(root);
    new MutationObserver(bind).observe(root,{childList:true,subtree:true});
    bind();
    root.addEventListener('click',e=>{
      const card=e.target.closest('.matrix-card,.factor');
      if(card&&Date.now()<Number(card.dataset.scrubUntil||0)){e.preventDefault();e.stopImmediatePropagation()}
    },true);
  }
})();

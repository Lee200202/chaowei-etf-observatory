/* Animate only named chart layers. All values, axes and hit tests remain in the native renderers. */
const TideMotion=(()=>{
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const disabled=()=>reduce.matches||document.hidden||document.body.classList.contains('motion-paused');
  const targets=new WeakMap(),visibleCards=new Set(),playing=new Map(),marked=new Set();
  const cardSelector='#matrixCards>.matrix-card,#factorRail>.factor,#researchPane0 .score-grid>.card,.purpose-deck>.purpose-door';
  let raf=0,velocity=0,lastY=scrollY;
  const asleep=()=>disabled()||innerWidth<1000||document.querySelector('dialog[open],#aiChatDrawer:not([hidden]),#siteMenu:not(.hidden)');
  function cancel(node){
    const running=playing.get(node);
    if(running){playing.delete(node);for(const animation of running)animation.cancel()}
  }
  function animate(node,parts,duration,easing){
    cancel(node);
    const animations=parts.map(([target,frames])=>target.animate(frames,{duration,easing}));
    if(!animations.length)return;
    playing.set(node,animations);
    Promise.allSettled(animations.map(a=>a.finished)).then(()=>{if(playing.get(node)===animations)playing.delete(node)});
  }
  function slot(card){
    const n=Array.prototype.indexOf.call(card.parentElement.children,card),k=n%7;
    return {direction:n%2?-1:1,row:card.matches('#matrixCards>*,#factorRail>*')?Math.floor(n/7)*3+(k<2?0:k<4?1:2):Math.floor(n/2)};
  }
  const surfaceFor=node=>node.querySelector('table tr:first-child td:nth-child(2) canvas');
  function play(node,state){
    if(disabled()||!node.isConnected||!state.pending)return;
    if(state.kind==='canvas'){
      const surface=surfaceFor(node);
      if(!surface)return;
      state.pending=false;
      animate(node,[[surface,[{scale:'1 .015',transformOrigin:'50% 100%',opacity:.4},{scale:'1 1',transformOrigin:'50% 100%',opacity:1}]]],920,'cubic-bezier(.18,.8,.28,1)');
      return;
    }
    state.pending=false;
    if(state.kind==='card'){
      const side=slot(node).direction,offset=innerWidth<600?24:68;
      animate(node,[[node,[{translate:(-side*offset)+'px '+(side>0?16:-12)+'px',opacity:.45},{translate:'0px 0px',opacity:1}]]],660,'cubic-bezier(.2,.75,.28,1)');
      return;
    }
    const parts=[...node.querySelectorAll('[data-tide-base]')].map(group=>{
      const y=Number(group.dataset.tideBase);
      const from='translateY('+y+'px) scaleY(.015) translateY('+(-y)+'px)';
      return [group,[{transform:from},{transform:'none'}]];
    });
    animate(node,parts,920,'cubic-bezier(.18,.86,.28,1.06)');
  }
  const io=new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries){
      const state=targets.get(target);if(!state)continue;
      state.visible=isIntersecting;
      if(state.kind==='card'){
        if(isIntersecting)visibleCards.add(target);
        else{visibleCards.delete(target);target.style.removeProperty('--tide-drift')}
      }else target.classList.toggle('tide-in-view',isIntersecting);
      if(isIntersecting)play(target,state);
      else cancel(target);
    }
  },{threshold:.10});
  function register(node,kind,key){
    const known=targets.get(node);
    if(known&&known.key===key)return;
    if(known){known.key=key;known.pending=true;if(known.visible)play(node,known);return}
    const state={kind,key,pending:!node.hasAttribute('data-tide-static'),visible:false};
    targets.set(node,state);marked.add(node);io.observe(node);
    if(kind==='canvas')for(const event of ['pointerdown','wheel','focusin'])node.addEventListener(event,()=>cancel(node),{passive:true});
  }
  function scan(node){
    if(!(node instanceof Element))return;
    if(node.matches(cardSelector))register(node,'card');
    if(node.matches('[data-tide-plot]'))register(node,'svg');
    for(const card of node.querySelectorAll(cardSelector))register(card,'card');
    for(const svg of node.querySelectorAll('[data-tide-plot]'))register(svg,'svg');
  }
  function tick(){
    raf=0;velocity*=.72;
    if(asleep()||Math.abs(velocity)<.25){velocity=0;for(const card of visibleCards)card.style.removeProperty('--tide-drift');return}
    for(const card of visibleCards){
      const {row}=slot(card);
      card.style.setProperty('--tide-drift',((row%2?-1:1)*velocity).toFixed(2)+'px');
    }
    raf=requestAnimationFrame(tick);
  }
  function reset(){
    for(const node of playing.keys())cancel(node);
    velocity=0;cancelAnimationFrame(raf);raf=0;
    for(const card of visibleCards)card.style.removeProperty('--tide-drift');
  }
  function boot(){
    scan(document.body);
    new MutationObserver(changes=>{
      let removed=false;
      for(const change of changes){
        if(change.removedNodes.length)removed=true;
        for(const node of change.addedNodes)scan(node);
      }
      if(removed)for(const node of marked)if(!node.isConnected){
        io.unobserve(node);marked.delete(node);visibleCards.delete(node);cancel(node);targets.get(node)?.dispose?.();targets.delete(node);
      }
    }).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('scroll',()=>{
      const delta=scrollY-lastY;lastY=scrollY;
      if(asleep()||Math.abs(delta)>innerHeight)return;
      velocity=Math.max(-18,Math.min(18,velocity+delta*.32));
      if(!raf&&Math.abs(velocity)>=.25)raf=requestAnimationFrame(tick);
    },{passive:true});
    new MutationObserver(()=>{if(disabled())reset()}).observe(document.body,{attributes:true,attributeFilter:['class']});
    window.addEventListener('chaowei-page-changed',()=>{
      for(const node of marked){
        const state=targets.get(node);
        if(node.closest('[hidden]')||node.hasAttribute('data-tide-static'))continue;
        state.pending=true;
        if(state.visible)play(node,state);
      }
    });
    document.addEventListener('visibilitychange',reset);reduce.addEventListener('change',reset);
  }
  function closeDot(node,chart,series,last,color){
    const state=targets.get(node);
    if(!state)return;
    if(!last){if(state.dot)state.dot.hidden=true;state.point=null;return}
    state.point=last;
    if(!state.dot){
      const dot=document.createElement('i');
      dot.className='tide-canvas-dot';dot.setAttribute('aria-hidden','true');dot.hidden=true;
      node.classList.add('tide-canvas-host');node.append(dot);state.dot=dot;
      const place=()=>{
        const point=state.point,surface=surfaceFor(node);
        if(!node.isConnected||!surface){dot.hidden=true;return}
        const x=point&&chart.timeScale().timeToCoordinate(point.time),y=point&&series.priceToCoordinate(point.value);
        dot.hidden=!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>surface.clientWidth||y>surface.clientHeight;
        if(dot.hidden)return;
        const box=node.getBoundingClientRect(),table=surface.closest('td').getBoundingClientRect();
        dot.style.left=(table.left-box.left+x)+'px';dot.style.top=(table.top-box.top+y)+'px';
      };
      const resize=new ResizeObserver(place);resize.observe(node);
      const scale=chart.timeScale();scale.subscribeVisibleLogicalRangeChange(place);
      state.place=place;state.dispose=()=>{resize.disconnect();try{scale.unsubscribeVisibleLogicalRangeChange(place)}catch{}};
    }
    state.dot.style.color=color;
    state.place();
  }
  return {boot,canvas:(node,key)=>{if(node)register(node,'canvas',key)},closeDot};
})();

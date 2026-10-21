/* Navigation and motion only. Market data and scoring remain in their own modules. */
(()=>{
  const $=id=>document.getElementById(id);
  const menu=$('siteMenu'),open=$('openSiteMenu'),close=$('closeSiteMenu');
  let returnFocus=null;
  function setMenu(shown){
    menu.classList.toggle('hidden',!shown);
    document.body.classList.toggle('menu-open',shown);
    open.setAttribute('aria-expanded',String(shown));
    if(shown){returnFocus=document.activeElement;close.focus();}
    else returnFocus?.focus?.({preventScroll:true});
  }
  open.addEventListener('click',()=>setMenu(true));
  close.addEventListener('click',()=>setMenu(false));
  menu.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');
    if(link){setMenu(false);return;}
    if(event.target.closest('[data-menu-account]')){setMenu(false);$('accountTop').click();}
  });
  document.addEventListener('keydown',event=>{
    if(menu.classList.contains('hidden'))return;
    if(event.key==='Escape'){event.preventDefault();setMenu(false);}
    if(event.key==='Tab'){
      const items=[...menu.querySelectorAll('a,button')].filter(el=>!el.disabled);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  let manualStory=()=>{};
  document.querySelectorAll('[data-rail]').forEach(button=>button.addEventListener('click',()=>{
    const rail=$(button.dataset.rail),card=rail.querySelector(':scope > *');
    const distance=card?card.getBoundingClientRect().width+16:rail.clientWidth*.8;
    if(rail.id==='storyRail')manualStory();
    rail.scrollBy({left:distance*Number(button.dataset.dir),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }));
  const rail=$('storyRail'),railHead=document.querySelector('.story-rail-head');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const tiles=[...rail.children];
  let storyVisible=false,storyPaused=false,storyIndex=0,manualUntil=0,autoMoving=false;
  const autoButton=document.createElement('button');
  autoButton.type='button';autoButton.className='pill story-arrow story-autoplay';
  railHead.querySelector('div').prepend(autoButton);
  const syncAutoplay=()=>{
    autoButton.textContent=storyPaused?'▶':'Ⅱ';
    autoButton.setAttribute('aria-label',storyPaused?'播放觀測卡輪播':'暫停觀測卡輪播');
    autoButton.setAttribute('aria-pressed',String(storyPaused));
    autoButton.classList.toggle('hidden',reduced.matches);
    railHead.querySelector('span').textContent=reduced.matches?'左右滑動，認識觀測方式':storyPaused?'輪播已暫停 · 可左右滑動':'自動輪播 · 也可左右滑動';
  };
  autoButton.addEventListener('click',()=>{storyPaused=!storyPaused;syncAutoplay()});
  const progress=document.createElement('div');
  progress.className='story-progress';progress.setAttribute('role','group');
  progress.setAttribute('aria-label','觀測卡片位置');
  const dots=tiles.map((_,i)=>{
    const dot=document.createElement('button');dot.type='button';
    dot.setAttribute('aria-label','顯示第 '+(i+1)+' 張觀測卡');
    dot.addEventListener('click',()=>{manualStory();goTo(i)});
    progress.append(dot);return dot;
  });
  rail.after(progress);
  const syncDots=()=>dots.forEach((dot,i)=>dot.setAttribute('aria-current',i===storyIndex?'true':'false'));
  function goTo(index,automatic=false){
    storyIndex=(index+tiles.length)%tiles.length;
    if(automatic){autoMoving=true;setTimeout(()=>{autoMoving=false},900)}
    rail.scrollTo({left:tiles[storyIndex].offsetLeft-tiles[0].offsetLeft,
      behavior:reduced.matches?'instant':'smooth'});
    syncDots();
  }
  syncDots();
  manualStory=()=>{manualUntil=Date.now()+12000};
  ['pointerdown','touchstart','wheel','keydown'].forEach(type=>rail.addEventListener(type,manualStory,{passive:true}));
  rail.addEventListener('focusin',manualStory);
  rail.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();manualStory();goTo(storyIndex+(event.key==='ArrowRight'?1:-1));
  });
  rail.addEventListener('scroll',()=>{
    if(autoMoving)return;
    const max=Math.max(0,rail.scrollWidth-rail.clientWidth);
    const positions=tiles.map(tile=>Math.min(max,tile.offsetLeft-tiles[0].offsetLeft));
    storyIndex=positions.reduce((best,p,i)=>Math.abs(p-rail.scrollLeft)<Math.abs(positions[best]-rail.scrollLeft)?i:best,0);
    syncDots();
  },{passive:true});
  reduced.addEventListener?.('change',syncAutoplay);
  syncAutoplay();
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{storyVisible=entries[0].isIntersecting},{threshold:.35});
    observer.observe(rail);
  }else storyVisible=true;
  setInterval(()=>{
    if(!storyVisible||document.hidden||storyPaused||reduced.matches||
       document.body.classList.contains('motion-paused')||Date.now()<manualUntil||
       rail.matches(':hover')||rail.contains(document.activeElement))return;
    if(tiles.length<2)return;
    goTo(storyIndex+1,true);
  },5000);
  const toggle=$('motionToggle');
  toggle.addEventListener('click',()=>{
    const paused=document.body.classList.toggle('motion-paused');
    toggle.setAttribute('aria-pressed',String(paused));
    toggle.setAttribute('aria-label',paused?'播放頁面動畫':'暫停頁面動畫');
    toggle.innerHTML=paused?'▷ <span>播放動態</span>':'Ⅱ <span>暫停動態</span>';
    if(paused)document.querySelectorAll('.reveal').forEach(el=>el.classList.add('is-visible'));
  });
  toggle.setAttribute('aria-label','暫停頁面動畫');
  if('IntersectionObserver' in window&&!reduced.matches){
    const groups=['.story-tile','.score-grid > .card','.method-steps details'];
    document.querySelectorAll('.story-rail-head,.section-heading,.search-launch,.quick.inline,.chart-card,.factor-card,.method-intro')
      .forEach(el=>el.classList.add('reveal'));
    groups.forEach(selector=>document.querySelectorAll(selector).forEach((el,i)=>{
      el.classList.add('reveal');el.style.setProperty('--reveal-delay',Math.min(i,3)*85+'ms');
    }));
    document.body.classList.add('js-motion');
    const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target);}
    }),{rootMargin:'0px 0px -8% 0px',threshold:.05});
    document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
  }
})();

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
  document.querySelectorAll('[data-rail]').forEach(button=>button.addEventListener('click',()=>{
    const rail=$(button.dataset.rail),card=rail.querySelector(':scope > *');
    const distance=card?card.getBoundingClientRect().width+16:rail.clientWidth*.8;
    rail.scrollBy({left:distance*Number(button.dataset.dir),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }));
  const toggle=$('motionToggle');
  toggle.addEventListener('click',()=>{
    const paused=document.body.classList.toggle('motion-paused');
    toggle.setAttribute('aria-pressed',String(paused));
    toggle.setAttribute('aria-label',paused?'播放背景動畫':'暫停背景動畫');
    toggle.innerHTML=paused?'▷ <span>播放動態</span>':'Ⅱ <span>暫停動態</span>';
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  if('IntersectionObserver' in window&&!reduced.matches){
    document.body.classList.add('js-motion');
    const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target);}
    }),{rootMargin:'0px 0px -8% 0px',threshold:.05});
    document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
  }
})();

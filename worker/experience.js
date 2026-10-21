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
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-rail]').forEach(button=>button.remove());
  function initRail({id,head,interval,label,dotsAfter}){
    const rail=$(id),nav=document.querySelector(head),tiles=[...rail.children];
    if(tiles.length<2)return;
    let visible=false,paused=false,index=0,manualUntil=0,frame=0,moving=false;
    const button=document.createElement('button');
    button.type='button';button.className='pill story-arrow story-autoplay';
    nav.querySelector('div').append(button);
    const caption=nav.querySelector('span');
    const syncButton=()=>{
      button.textContent=paused?'▶':'Ⅱ';
      button.setAttribute('aria-label',(paused?'播放':'暫停')+label+'輪播');
      button.setAttribute('aria-pressed',String(paused));
      button.classList.toggle('hidden',reduced.matches);
      caption.textContent=reduced.matches?'左右滑動探索':paused?'輪播已暫停 · 可左右滑動':'自動探索 · 可左右滑動';
    };
    button.addEventListener('click',()=>{paused=!paused;syncButton()});
    const progress=document.createElement('div');
    progress.className='story-progress'+(id==='factorRail'?' factor-progress':'');
    progress.setAttribute('role','group');
    progress.setAttribute('aria-label',label+'位置');
    const dots=tiles.map((_,i)=>{
      const dot=document.createElement('button');dot.type='button';
      dot.setAttribute('aria-label','顯示第 '+(i+1)+' 張'+label);
      dot.addEventListener('click',()=>{manual();goTo(i)});
      progress.append(dot);return dot;
    });
    (dotsAfter==='nav'?nav:rail).after(progress);
    const syncDots=()=>dots.forEach((dot,i)=>dot.setAttribute('aria-current',i===index?'true':'false'));
    const position=i=>tiles[i].offsetLeft-tiles[0].offsetLeft;
    const cancel=()=>{
      if(frame)cancelAnimationFrame(frame);
      frame=0;moving=false;rail.style.scrollSnapType='';
    };
    const manual=()=>{manualUntil=Date.now()+6500;cancel()};
    function goTo(next){
      index=(next+tiles.length)%tiles.length;syncDots();cancel();
      const target=position(index),start=rail.scrollLeft;
      if(reduced.matches||Math.abs(target-start)<1){rail.scrollTo({left:target,behavior:'instant'});return}
      const begun=performance.now(),duration=340;
      moving=true;rail.style.scrollSnapType='none';
      const step=now=>{
        const t=Math.min(1,(now-begun)/duration),ease=1-Math.pow(1-t,3);
        rail.scrollLeft=start+(target-start)*ease;
        if(t<1)frame=requestAnimationFrame(step);
        else{frame=0;rail.scrollLeft=target;rail.style.scrollSnapType='';requestAnimationFrame(()=>{moving=false})}
      };
      frame=requestAnimationFrame(step);
    }
    syncDots();syncButton();
    reduced.addEventListener?.('change',()=>{cancel();syncButton()});
    ['pointerdown','touchstart','wheel'].forEach(type=>rail.addEventListener(type,manual,{passive:true}));
    rail.addEventListener('focusin',manual);
    rail.addEventListener('keydown',event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
      event.preventDefault();manual();goTo(index+(event.key==='ArrowRight'?1:-1));
    });
    rail.addEventListener('scroll',()=>{
      if(moving)return;
      index=tiles.reduce((best,_,i)=>Math.abs(position(i)-rail.scrollLeft)<Math.abs(position(best)-rail.scrollLeft)?i:best,0);
      syncDots();
    },{passive:true});
    if('IntersectionObserver' in window){
      new IntersectionObserver(entries=>{visible=entries[0].isIntersecting},{threshold:.35}).observe(rail);
    }else visible=true;
    setInterval(()=>{
      if(!visible||document.hidden||paused||reduced.matches||
         document.body.classList.contains('motion-paused')||Date.now()<manualUntil||
         rail.matches(':hover')||rail.contains(document.activeElement))return;
      goTo(index+1);
    },interval);
  }
  initRail({id:'storyRail',head:'.story-rail-head',interval:3300,label:'觀測卡片',dotsAfter:'rail'});
  initRail({id:'factorRail',head:'.factor-rail-nav',interval:3800,label:'市場卡片',dotsAfter:'nav'});
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

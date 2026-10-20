/* ---------- Guided tour: shown once after a member's first sign-in, replayable from the display menu ---------- */
const TOUR_STEPS=[
  ['#openSearch','找一檔 ETF','輸入名稱、代號或追蹤指數（例如 0050、高股息），按 Enter 選第一筆。按鍵盤「/」也能叫出搜尋。'],
  ['.toolbar','看懂水位分數','分數 0–5：越接近 5 代表價格在區間低處、越適合加碼；越接近 0 代表在高處、宜減碼。往下捲時這一列會固定在上方。'],
  ['.view-card','設定觀察條件','觀察窗決定看多久的高低點，刻度方式與高低點算法決定怎麼分段。常用的組合按「＋ 收藏目前條件」，之後一鍵套用。'],
  ['#chartCard','價格走勢與技術面','滑鼠移到 K 棒看當天開高低收；滾輪縮放、拖曳平移。副圖可同時開 MACD、RSI、KD，圖下方的橫條可拖曳調整高度。'],
  ['.factor-card','市場的其他刻度','大盤、成交量、原油、匯率各自算分。原油越便宜分越高；台幣越升值分越低。每 5 分鐘自動更新。'],
  ['#backtestCard','回檔加碼回測','照 1 到 4 步設定「跌多少買、漲多少賣」，下方會算出報酬、最大回落，並和買進持有、定期定額比較；買賣點會標在 K 線上。'],
  ['.weights-card','我的權重方案','調整 ETF、大盤、量能、原油、匯率的比重，合計 100% 後得到綜合分數。設定會同步到你的 Google 帳號。']
];
let tourIndex=-1;
function tourEls(){
  let shade=$('tourShade');
  if(!shade){
    shade=document.createElement('div');shade.id='tourShade';shade.className='tour-shade hidden';
    shade.innerHTML='<div class="tour-spot" id="tourSpot"></div><div class="tour-card card" id="tourCard" role="dialog" aria-modal="true" aria-labelledby="tourTitle"><small id="tourCount"></small><h4 id="tourTitle"></h4><p id="tourText"></p><div class="tour-actions"><button class="pill mini" type="button" id="tourSkip">略過教學</button><span><button class="pill mini" type="button" id="tourPrev">上一步</button><button class="action tour-next" type="button" id="tourNext">下一步</button></span></div></div>';
    document.body.append(shade);
    $('tourSkip').addEventListener('click',()=>endTour());
    $('tourPrev').addEventListener('click',()=>showTourStep(tourIndex-1));
    $('tourNext').addEventListener('click',()=>tourIndex>=TOUR_STEPS.length-1?endTour():showTourStep(tourIndex+1));
    document.addEventListener('keydown',e=>{if(tourIndex<0)return;if(e.key==='Escape')endTour();if(e.key==='ArrowRight')$('tourNext').click();if(e.key==='ArrowLeft'&&tourIndex>0)showTourStep(tourIndex-1)});
    window.addEventListener('resize',()=>{if(tourIndex>=0)placeTour()});
    window.addEventListener('scroll',()=>{if(tourIndex>=0)placeTour()},{passive:true});
  }
  return shade;
}
function placeTour(){
  const step=TOUR_STEPS[tourIndex],target=document.querySelector(step[0]),spot=$('tourSpot'),card=$('tourCard');
  if(!target)return;
  const r=target.getBoundingClientRect(),pad=8,top=Math.max(4,r.top-pad),h=Math.min(r.height+pad*2,innerHeight-top-4);
  Object.assign(spot.style,{left:Math.max(4,r.left-pad)+'px',top:top+'px',width:Math.min(r.width+pad*2,innerWidth-8)+'px',height:Math.max(40,h)+'px'});
  // The card goes below the highlighted area when there is room, otherwise above it, otherwise at the bottom.
  const cw=Math.min(360,innerWidth-24),ch=card.offsetHeight||170,below=r.bottom+pad+12,above=r.top-pad-12-ch;
  const y=below+ch<innerHeight?below:above>8?above:innerHeight-ch-12;
  Object.assign(card.style,{width:cw+'px',left:Math.max(12,Math.min(innerWidth-cw-12,r.left))+'px',top:Math.max(8,y)+'px'});
}
function showTourStep(i){
  if(i<0||i>=TOUR_STEPS.length)return;
  tourIndex=i;const [sel,title,text]=TOUR_STEPS[i],target=document.querySelector(sel);
  $('tourCount').textContent=(i+1)+' / '+TOUR_STEPS.length;$('tourTitle').textContent=title;$('tourText').textContent=text;
  $('tourPrev').disabled=i===0;$('tourNext').textContent=i===TOUR_STEPS.length-1?'開始使用':'下一步';
  if(target){
    // Tall cards are aligned to their top edge (below the pinned summary bar); short ones are centred.
    const r=target.getBoundingClientRect(),bar=document.querySelector('.toolbar').getBoundingClientRect().height+16;
    const y=r.height>innerHeight*.6?r.top+scrollY-bar:r.top+scrollY-(innerHeight-r.height)/2;
    window.scrollTo({top:Math.max(0,sel==='.toolbar'?r.top+scrollY-120:y),behavior:'instant'});
  }
  requestAnimationFrame(placeTour);$('tourNext').focus({preventScroll:true});
}
function startTour(){closeDisplay?.();closeSearch?.();tourEls().classList.remove('hidden');document.body.classList.add('touring');showTourStep(0)}
function endTour(){
  tourIndex=-1;$('tourShade')?.classList.add('hidden');document.body.classList.remove('touring');
  if(!settings.tourDone){settings.tourDone=new Date().toISOString().slice(0,10);save()}
}
$('startTour').addEventListener('click',startTour);
// First sign-in: wait for the cloud profile to load (it may say the tour was already done on another device).
const tourSetMember=window.chaoweiSetMember;
window.chaoweiSetMember=signedIn=>{tourSetMember(signedIn);if(signedIn&&!settings.tourDone)setTimeout(()=>{if(isMember&&!settings.tourDone&&tourIndex<0)startTour()},1800)};

/* ---------- Tide-wave gauge colours: low tide (cheap) green, mid-tide blue, high tide (dear) coral ---------- */
function tideColors(score){
  // Three clear zones rather than a blend (mixing coral and blue reads as muddy purple); the CSS transition smooths changes.
  const s=Math.max(0,Math.min(5,score));
  return s>=3.5?['#34d399','#06b6d4']:s>1.5?['#38bdf8','#0e7490']:['#fb7185','#f59e0b'];
}
const tideRenderPosition=renderPosition;
renderPosition=function(){
  tideRenderPosition();
  const w=$('cupWater');if(!w)return;
  if(position){const [a,b]=tideColors(position.core);w.style.setProperty('--w1',a);w.style.setProperty('--w2',b)}
};

/* ---------- Tide radar inside the search sheet (precomputed daily for every ETF) ---------- */
let radar=null,radarFilter='all';
const RADAR_TESTS={low:x=>x.score>=4.5,bias:x=>x.bias60!=null&&x.bias60<=-10,rsi:x=>x.rsi!=null&&x.rsi<30,squeeze:x=>!!x.squeeze};
async function loadRadar(){if(radar)return radar;try{const r=await fetch('/api/radar'),d=await r.json();if(r.ok&&Array.isArray(d.rows))radar={...d,map:new Map(d.rows.map(x=>[x.code,x]))}}catch{}return radar}
const radarRenderList=renderList;
renderList=function(){
  radarRenderList();
  if(!radar)return;
  const rows=[...$('etfList').querySelectorAll('.etf-result')];let shown=0;
  for(const row of rows){
    const pick=row.querySelector('.candidate-pick'),code=pick.querySelector('strong').textContent.split(' · ')[0],x=radar.map.get(code);
    const ok=radarFilter==='all'||(x&&RADAR_TESTS[radarFilter](x));row.classList.toggle('hidden',!ok);if(ok)shown++;
    if(x&&x.score!=null&&!pick.querySelector('.radar-badge')){
      const b=document.createElement('span');b.className='radar-badge'+(x.score>=4?' hot':x.score<=1?' cold':'');
      b.textContent='水位 '+x.score.toFixed(1)+(radarFilter==='bias'?' · 乖離 '+x.bias60+'%':radarFilter==='rsi'?' · RSI '+x.rsi:'');pick.append(b);
    }
  }
  // Under a radar filter, the best candidates (highest water score) come first.
  if(radarFilter!=='all'){rows.filter(r=>!r.classList.contains('hidden')).sort((a,b)=>(radar.map.get(b.querySelector('strong').textContent.split(' · ')[0])?.score??-1)-(radar.map.get(a.querySelector('strong').textContent.split(' · ')[0])?.score??-1)).forEach(r=>$('etfList').append(r));
    $('searchCount').textContent='今日潮位雷達：符合 '+shown+' 檔（資料日 '+radar.latest+'）'}
};
$('radarChips').addEventListener('click',async e=>{const b=e.target.closest('[data-radar]');if(!b)return;radarFilter=b.dataset.radar;$('radarChips').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));await loadRadar();renderList()});
const radarOpenSearch=openSearch;
openSearch=function(){radarOpenSearch();loadRadar().then(()=>{if(!$('searchOverlay').classList.contains('hidden'))renderList()})};
for(const id of ['openSearch','openSearchTop'])$(id).addEventListener('click',()=>loadRadar().then(renderList));

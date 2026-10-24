/* Member-only local measurement. Pointer previews never fetch data or write cloud settings. */
(()=>{
  settings.chartMeasures=ChartMeasurement.normalize(settings.chartMeasures);
  settings.measureSnap=['close','ohlc','free'].includes(settings.measureSnap)?settings.measureSnap:'close';
  const panel=document.createElement('section');panel.className='measure-panel member-only';panel.id='measurePanel';
  panel.innerHTML=`<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員進階</span><h4>親手量出一段走勢</h4><p>登入後拖曳量測漲跌幅、K 棒與天數，保存並跨裝置同步。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>
  <div class="research-head"><div><p class="kicker teal">RANGE STUDIO</p><h4>區間量測</h4></div><button class="pill" type="button" id="measureToggle" aria-pressed="false"> 在圖上量測</button></div>
  <div class="controls"><label>端點價格<select id="measureSnap"><option value="close">吸附收盤價</option><option value="ohlc">吸附最近開高低收</option><option value="free">自由價格座標</option></select></label><span class="small" id="measureHint">開啟後拖出區間；也可依序點選起點、終點。</span></div>
  <details class="measure-help"><summary>如何量測？</summary><ol><li>先選日／週／月 K，放大到要研究的區段。</li><li>按「在圖上量測」，拖曳或點兩個端點。吸附模式使用該根 K 的實際價格；自由模式使用游標對應的價格。</li><li>核對下方起訖與漲跌幅，再按「儲存區間」。按 Esc 取消繪圖；量測完成後可繼續縮放、平移。</li></ol><p class="small">漲跌幅＝（終點價格 ÷ 起點價格 − 1）×100%。K 棒間隔＝兩端索引差；含首尾根數另列。日曆天數使用日期差，週末與休市日不等於交易日。矩形面積僅是視覺範圍，不是獲利金額。價格沿用圖表分割還原口徑；不含配息、費用或成交保證。含盤中價會明確標示暫定。</p></details>
  <details class="measure-manual"><summary>精確輸入起訖</summary><div class="measure-inputs"><label>起始 K 日期<input type="date" id="measureFrom"></label><label>起始價格<input type="number" id="measurePriceA" min="0.000001" step="any"></label><label>結束 K 日期<input type="date" id="measureTo"></label><label>結束價格<input type="number" id="measurePriceB" min="0.000001" step="any"></label></div><button class="pill mini" type="button" id="measureApply">計算此區間</button><p class="small">週／月 K 請選圖上該根 K 的起始交易日。自由模式才可自行輸入價格；日期必須落在實際已載入的 K 棒。</p></details>
  <div class="measure-reading" id="measureReading" aria-live="polite">尚未選取區間</div><div class="measure-actions"><button class="pill mini" type="button" id="measureSave" disabled>儲存區間</button><button class="pill mini" type="button" id="measureCancel">清除預覽</button><button class="pill mini" type="button" id="measureExport">匯出區間</button></div>
  <details class="measure-risk"><summary>風險報酬試算（不下單）</summary><div class="measure-inputs"><label>方向<select id="measureSide"><option value="long">做多假設</option><option value="short">做空假設</option></select></label><label>假設進場價<input type="number" step="any" id="measureEntry"></label><label>停損價<input type="number" step="any" id="measureStop"></label><label>目標價<input type="number" step="any" id="measureTarget"></label></div><p class="small" id="measureRiskReading">請輸入進場、停損與目標價。使用目前量測的時間區間顯示目標／停損帶。</p><p class="small">R＝目標價差 ÷ 停損價差，不代表成功機率；未計費用、滑價、借券或放空限制。</p></details>
  <div class="measure-list" id="measureList"></div>`;
  pinPanel.before(panel);
  const chart=$('chart'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),surface=document.createElement('div');
  svg.classList.add('measure-overlay');svg.setAttribute('aria-hidden','true');surface.className='measure-surface hidden';surface.setAttribute('aria-label','拖曳或點選兩個價格端點以量測');chart.append(svg,surface);
  let active=false,draft=null,complete=false,dragging=false,pointerStart=null,moveFrame=0,renderFrame=0,pending=null,bound=null,listKey='';
  const names={close:'收',open:'開',high:'高',low:'低',free:'自訂'};
  const list=()=>settings.chartMeasures.filter(x=>x.code===selected&&x.interval===interval);
  const current=()=>lwc?.data||[];
  function point(x,y){
    if(!current().length)return null;const logical=lwc.main.timeScale().coordinateToLogical(x),raw=lwc.s.candle.coordinateToPrice(y);if(logical==null||raw==null)return null;
    const bar=current()[Math.max(0,Math.min(current().length-1,Math.round(logical)))];let source=settings.measureSnap;
    if(source==='ohlc')source=['open','high','low','close'].reduce((a,b)=>Math.abs(bar[a]-raw)<=Math.abs(bar[b]-raw)?a:b);
    const price=source==='free'?Math.round(raw*1e6)/1e6:bar[source];return price>0?{date:bar.date,price,source}:null;
  }
  function mode(on){active=!!on&&isMember&&!shareView;surface.classList.toggle('hidden',!active);$('measureToggle').setAttribute('aria-pressed',String(active));$('measureToggle').textContent=active?' 取消繪圖':' 在圖上量測';$('measureHint').textContent=active?'拖曳兩端，或依序點選。Esc 取消；繪圖時暫停圖表平移。':'開啟後拖出區間；也可依序點選起點、終點。';if(active){chart.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});if(pinMode){pinMode=false;pinModeButton.setAttribute('aria-pressed','false')}}}
  function provisional(d){return [d.a,d.b].some(p=>liveQuote?.available&&p.date===liveQuote.date&&liveQuote.date>(bars.at(-1)?.date||''))}
  function fields(){if(!draft?.b)return;$('measureFrom').value=draft.a.date;$('measureTo').value=draft.b.date;$('measurePriceA').value=draft.a.price;$('measurePriceB').value=draft.b.price}
  function reading(){
    const m=draft?.b?ChartMeasurement.measure(current(),draft.a,draft.b):null;$('measureSave').disabled=!isMember||!m||!complete||shareView;
    if(!m){$('measureReading').textContent=draft?'已選起點；請選終點。':'尚未選取區間';return}
    $('measureReading').replaceChildren();const title=document.createElement('strong');title.className=m.percent>0?'price-up':m.percent<0?'price-down':'';title.textContent=`${signNum(m.percent,2)}% · ${signNum(m.change,4)} 元`;
    const ends=document.createElement('p');ends.className='small';ends.textContent=`${draft.a.date} ${names[draft.a.source]} ${fmt(draft.a.price,4)}  至  ${draft.b.date} ${names[draft.b.source]} ${fmt(draft.b.price,4)}`;
    const stats=document.createElement('p');stats.className='small';stats.textContent=`${m.bars} 根 K 間隔（含首尾 ${m.inclusive} 根） · ${m.days} 日曆天 · 區間高 ${fmt(m.high,4)}／低 ${fmt(m.low,4)} 元${provisional(draft)?' · 含盤中暫定價':''}`;
    $('measureReading').append(title,ends,stats);
  }
  function risk(){const e=Number($('measureEntry').value),s=Number($('measureStop').value),t=Number($('measureTarget').value),side=$('measureSide').value,r=ChartMeasurement.risk(e,s,t,side);$('measureRiskReading').textContent=r?`風險報酬 ${fmt(r.r,2)} R · 目標價差 ${fmt(r.gainPct,2)}% · 停損價差 ${fmt(r.lossPct,2)}%（未計成本）`:side==='long'?'做多：停損 < 進場 < 目標；三者都須為正價格。':'做空：目標 < 進場 < 停損；三者都須為正價格。';return r?{entry:e,stop:s,target:t,...r}:null}
  function shape(tag,attrs,text){const e=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;svg.append(e);return e}
  function draw(){
    renderFrame=0;svg.replaceChildren();if(!isMember||!lwc?.data.length)return;
    const w=Math.max(0,chart.clientWidth-72),h=chart.clientHeight;svg.setAttribute('viewBox',`0 0 ${chart.clientWidth} ${h}`);
    const drawBox=(d,preview=false)=>{
      const x1=lwc.main.timeScale().timeToCoordinate(d.a.date),x2=lwc.main.timeScale().timeToCoordinate(d.b.date),y1=lwc.s.candle.priceToCoordinate(d.a.price),y2=lwc.s.candle.priceToCoordinate(d.b.price);if([x1,x2,y1,y2].some(x=>x==null))return;
      const m=ChartMeasurement.measure(current(),d.a,d.b);if(!m)return;const color=m.change>=0?RISE:FALL,left=Math.max(0,Math.min(x1,x2)),right=Math.min(w,Math.max(x1,x2));if(right<left)return;
      shape('rect',{x:left,y:Math.min(y1,y2),width:Math.max(1,right-left),height:Math.max(1,Math.abs(y2-y1)),fill:color,'fill-opacity':preview?.13:.06,stroke:color,'stroke-width':preview?1.6:1,'stroke-dasharray':preview?'':'4 3'});
      if(preview){shape('line',{x1,y1,x2,y2,stroke:color,'stroke-width':1.4});for(const[x,y]of [[x1,y1],[x2,y2]])shape('circle',{cx:x,cy:y,r:4,fill:color,stroke:'white'});const tx=Math.min(w-168,Math.max(4,(left+right)/2-82)),ty=Math.min(h-38,Math.max(8,Math.min(y1,y2)-40));shape('rect',{x:Math.max(2,tx),y:ty,width:166,height:34,rx:12,fill:color});shape('text',{x:Math.max(2,tx)+83,y:ty+14,'text-anchor':'middle',fill:'white','font-size':11,'font-weight':700},`${signNum(m.percent,2)}% · ${m.bars} 根`);shape('text',{x:Math.max(2,tx)+83,y:ty+27,'text-anchor':'middle',fill:'white','font-size':10},`${m.days} 日曆天 · ${signNum(m.change,2)} 元`)}
    };
    for(const d of list().slice(-8))drawBox(d);
    if(draft?.b){const rr=risk();if(rr){const x1=lwc.main.timeScale().timeToCoordinate(draft.a.date),x2=lwc.main.timeScale().timeToCoordinate(draft.b.date);if(x1!=null&&x2!=null){const ye=lwc.s.candle.priceToCoordinate(rr.entry);for(const[p,label]of [[rr.target,'目標'],[rr.stop,'停損']]){const y=lwc.s.candle.priceToCoordinate(p),color=p>=rr.entry?RISE:FALL;if(y!=null&&ye!=null){shape('rect',{x:Math.max(0,Math.min(x1,x2)),y:Math.min(y,ye),width:Math.max(0,Math.min(w,Math.max(x1,x2))-Math.max(0,Math.min(x1,x2))),height:Math.abs(y-ye),fill:color,'fill-opacity':.09});shape('text',{x:Math.max(4,Math.min(x1,x2)+4),y:Math.min(h-4,Math.max(12,y)),fill:color,'font-size':11},`${label} ${fmt(p,2)}`)}}}}drawBox(draft,true)}
  }
  function schedule(){if(!renderFrame)renderFrame=requestAnimationFrame(draw)}
  function renderList(){
    const measures=list(),key=JSON.stringify([selected,interval,measures,isMember,shareView]);if(key===listKey)return;listKey=key;$('measureList').replaceChildren();
    const title=document.createElement('p');title.className='small';title.textContent=`此檔 ${interval} K 已存 ${measures.length} 段 · 圖上最多顯示最近 8 段 · 全帳號保留最近 50 段`;$('measureList').append(title);
    for(const d of measures.toReversed()){const row=document.createElement('div');row.className='measure-row';const text=document.createElement('span');text.textContent=`${d.a.date}  至  ${d.b.date} · ${signNum((d.b.price/d.a.price-1)*100,2)}%${d.provisional?'（盤中快照）':''}`;const view=document.createElement('button');view.className='pill mini';view.textContent='查看';view.type='button';view.addEventListener('click',()=>{draft=structuredClone(d);complete=true;fields();reading();const a=current().findIndex(x=>x.date===d.a.date),b=current().findIndex(x=>x.date===d.b.date);if(a>=0&&b>=0)lwc.main.timeScale().setVisibleLogicalRange({from:Math.min(a,b)-5,to:Math.max(a,b)+5});schedule()});const remove=document.createElement('button');remove.type='button';remove.className='pill mini';remove.textContent='移除';remove.disabled=shareView;remove.setAttribute('aria-label','移除量測 '+d.a.date+' 至 '+d.b.date);remove.addEventListener('click',()=>{settings.chartMeasures=settings.chartMeasures.filter(x=>x.id!==d.id);save();renderList();schedule()});row.append(text,view,remove);$('measureList').append(row)}
  }
  function sync(){if(bound!==lwc?.main&&lwc?.main){bound=lwc.main;bound.timeScale().subscribeVisibleLogicalRangeChange(schedule)}if(draft&&(draft.code!==selected||draft.interval!==interval)){draft=null;complete=false;mode(false)}renderList();reading();schedule()}
  $('measureToggle').addEventListener('click',()=>{if(!isMember){$('accountTop').click();return}if(!active){draft=null;complete=false;reading()}mode(!active);schedule()});
  pinModeButton.addEventListener('click',()=>{if(pinMode)mode(false)});
  $('measureSnap').value=settings.measureSnap;
  $('measureSnap').addEventListener('change',()=>{settings.measureSnap=$('measureSnap').value;$('measurePriceA').readOnly=$('measurePriceB').readOnly=settings.measureSnap!=='free';save()});$('measurePriceA').readOnly=$('measurePriceB').readOnly=settings.measureSnap!=='free';
  surface.addEventListener('pointerdown',e=>{if(!active||!isMember)return;e.preventDefault();surface.setPointerCapture(e.pointerId);dragging=true;pointerStart=[e.clientX,e.clientY];const r=chart.getBoundingClientRect(),p=point(e.clientX-r.left,e.clientY-r.top);if(!p)return;if(!draft||complete){draft={code:selected,interval,a:p,b:null};complete=false}else draft.b=p;reading();schedule()});
  surface.addEventListener('pointermove',e=>{if(!active||!draft||complete)return;const r=chart.getBoundingClientRect();pending=[e.clientX-r.left,e.clientY-r.top];if(moveFrame)return;moveFrame=requestAnimationFrame(()=>{moveFrame=0;const p=point(...pending);if(p){draft.b=p;reading();schedule()}})});
  surface.addEventListener('pointerup',e=>{if(!dragging)return;dragging=false;if(moveFrame){cancelAnimationFrame(moveFrame);moveFrame=0}const moved=pointerStart&&Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>4;if(moved||draft?.b){const r=chart.getBoundingClientRect(),p=point(e.clientX-r.left,e.clientY-r.top);if(p&&draft){draft.b=p;complete=true;mode(false);fields();reading();schedule()}}});
  surface.addEventListener('pointercancel',()=>{dragging=false;draft=null;complete=false;mode(false);reading();schedule()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){draft=null;complete=false;mode(false);reading();schedule()}});
  $('measureApply').addEventListener('click',()=>{if(!isMember)return;const p=(id,priceId)=>{const bar=current().find(b=>b.date===$(id).value);if(!bar)return null;const free=settings.measureSnap==='free';return{date:bar.date,price:free?Number($(priceId).value):bar.close,source:free?'free':'close'}};const a=p('measureFrom','measurePriceA'),b=p('measureTo','measurePriceB');if(!a||!b||!ChartMeasurement.measure(current(),a,b)){$('measureHint').textContent='請選實際已載入的 K 日期，且價格必須大於零。';return}draft={code:selected,interval,a,b};complete=true;mode(false);fields();reading();schedule()});
  $('measureSave').addEventListener('click',()=>{if(!isMember||!complete||!draft?.b||shareView)return;const d={...structuredClone(draft),id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),basis:'split',provisional:provisional(draft)};settings.chartMeasures=ChartMeasurement.normalize([...settings.chartMeasures,d]);save();draft=null;complete=false;reading();renderList();schedule();$('measureHint').textContent='已儲存；登入主網站時會同步到雲端。'});
  $('measureCancel').addEventListener('click',()=>{draft=null;complete=false;mode(false);reading();schedule()});
  $('measureExport').addEventListener('click',()=>{if(!isMember)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({code:selected,basis:'split',measurements:list()},null,2)],{type:'application/json'}));a.href=url;a.download=selected+'-measurements.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
  for(const id of ['measureEntry','measureStop','measureTarget','measureSide'])$(id).addEventListener('input',()=>{risk();schedule()});
  const prevDraw=drawChart;drawChart=function(...args){prevDraw(...args);sync()};
  const prevMember=window.chaoweiResearchMemberChanged;window.chaoweiResearchMemberChanged=signed=>{prevMember?.(signed);if(!signed){draft=null;complete=false;mode(false)}sync()};
  const prevProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{prevProfile(p);settings.chartMeasures=ChartMeasurement.normalize(settings.chartMeasures);settings.measureSnap=['close','ohlc','free'].includes(settings.measureSnap)?settings.measureSnap:'close';$('measureSnap').value=settings.measureSnap;$('measurePriceA').readOnly=$('measurePriceB').readOnly=settings.measureSnap!=='free';sync()};
  new ResizeObserver(schedule).observe(chart);sync();
})();

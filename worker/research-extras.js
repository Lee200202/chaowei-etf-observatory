/* Lightweight research notes and the selected ETF's official institutional snapshot. */
const PIN_LABEL={valley:'參考谷',peak:'參考峰',exclude:'略過'};
const PIN_COLOR={valley:'#168a83',peak:'#dc5b52',exclude:'#8496a0'};
settings.wavePins=Array.isArray(settings.wavePins)?settings.wavePins.filter(p=>p&&/^[0-9A-Z]{4,6}$/.test(p.code)&&['D','W','M'].includes(p.interval)&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&PIN_LABEL[p.kind]).slice(-300):[];

const pinPanel=document.createElement('section');
pinPanel.className='wave-pin-panel member-only';
pinPanel.innerHTML='<div class="research-head"><div><h4>圖釘標記</h4><p class="small">只整理研究樣本，不改評分或回測。</p></div><button class="pill chip" type="button" id="pinMode" aria-pressed="false"> 標記 K 棒</button></div><div class="pin-controls"><label>標記用途<select id="pinKind"><option value="valley">參考波谷</option><option value="peak">參考波峰</option><option value="exclude">略過此處</option></select></label><label>簡短備註<input id="pinNote" type="text" maxlength="40" placeholder="例如：除息、雜訊"></label><button class="pill mini" type="button" id="pinExport">匯出標記</button></div><p class="small" id="pinHint">開啟圖釘後，點選圖上的 K 棒；日、週、月分別標記。</p><div class="pin-list" id="pinList"></div>';
$('chartCard').querySelector('.chart-foot').after(pinPanel);
pinPanel.insertAdjacentHTML('afterbegin','<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員專屬</span><h4>標記你的參考波段</h4><p>登入後可在 K 線標出峰谷、略過雜訊，並同步到其他裝置。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>');
const pinModeButton=$('pinMode'),pinList=$('pinList'),pinHint=$('pinHint');
let pinMode=false;
pinModeButton.addEventListener('click',()=>{if(shareView||!isMember)return;pinMode=!pinMode;pinModeButton.setAttribute('aria-pressed',String(pinMode));pinHint.textContent=pinMode?'點選一根已收盤 K 棒即可記下此處。':'開啟圖釘後，點選圖上的 K 棒；日、週、月分別標記。'});
if(shareView){pinModeButton.disabled=true;$('pinExport').disabled=true}

const pinDate=t=>typeof t==='string'?t:t&&typeof t==='object'&&t.year?`${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`:null;
const currentPins=()=>settings.wavePins.filter(p=>p.code===selected&&p.interval===interval).sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind));
function renderPinList(){
  pinList.replaceChildren();
  const pins=currentPins();
  if(!pins.length){const empty=document.createElement('span');empty.className='small';empty.textContent='這個週期尚無標記';pinList.append(empty);return}
  for(const p of pins){
    const row=document.createElement('div');row.className='pin-row';
    const detail=document.createElement('span');detail.textContent=`${PIN_LABEL[p.kind]} · ${p.date} · ${fmt(p.price,2)} 元${p.note?' · '+p.note:''}`;
    const remove=document.createElement('button');remove.type='button';remove.className='pill mini';remove.textContent='移除';remove.setAttribute('aria-label',`移除 ${p.date} ${PIN_LABEL[p.kind]}`);
    remove.disabled=shareView;remove.addEventListener('click',()=>{settings.wavePins=settings.wavePins.filter(x=>!(x.code===p.code&&x.interval===p.interval&&x.date===p.date&&x.kind===p.kind));save();window.chaoweiPins.render()});
    row.append(detail,remove);pinList.append(row);
  }
}
window.chaoweiPins={
  onChartClick(p){
    if(!isMember||!pinMode||!lwc?.data.length)return;
    const date=pinDate(p?.time),bar=lwc.data.find(x=>x.date===date);
    if(!bar){pinHint.textContent='請點選有歷史 K 棒的位置。';return}
    if(liveQuote?.available&&liveQuote.date>bars.at(-1)?.date&&bar===lwc.data.at(-1)){
      pinHint.textContent='盤中 K 棒尚未收盤，請盤後再標記。';return;
    }
    const kind=$('pinKind').value,note=$('pinNote').value.trim(),price=kind==='peak'?bar.high:kind==='valley'?bar.low:bar.close;
    settings.wavePins=settings.wavePins.filter(x=>!(x.code===selected&&x.interval===interval&&x.date===date&&x.kind===kind));
    settings.wavePins.push({code:selected,interval,date,kind,price,note});
    settings.wavePins=settings.wavePins.slice(-300);$('pinNote').value='';save();this.render();
    pinHint.textContent=`已標記 ${date} ${PIN_LABEL[kind]}；可在下方移除或匯出。`;
  },
  render(){
    if(lwc?.s?.candle){
      const times=new Set(lwc.data.map(x=>x.date));
      const markers=[...(window.chaoweiWaveMarkers||[]).filter(p=>times.has(p.time)),...currentPins().filter(p=>times.has(p.date)).map(p=>({time:p.date,position:p.kind==='peak'?'aboveBar':'belowBar',color:PIN_COLOR[p.kind],shape:p.kind==='exclude'?'circle':p.kind==='peak'?'arrowDown':'arrowUp',text:`${PIN_LABEL[p.kind]} ${fmt(p.price,2)}`}))].sort((a,b)=>a.time.localeCompare(b.time));
      window.chaoweiResearchMarkers=markers;
      applyMarkers();
    }
    renderPinList();
  }
};
$('pinExport').addEventListener('click',()=>{
  if(!isMember)return;
  const pins=settings.wavePins.filter(p=>p.code===selected);
  const blob=new Blob([JSON.stringify({code:selected,exportedAt:new Date().toISOString(),pins},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${selected}-wave-pins.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const pinApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{pinApplyProfile(profile);settings.wavePins=Array.isArray(settings.wavePins)?settings.wavePins.filter(p=>p&&PIN_LABEL[p.kind]&&/^[0-9A-Z]{4,6}$/.test(p.code)).slice(-300):[];window.chaoweiPins.render()};
renderPinList();

const chipCard=document.createElement('section');
chipCard.className='chip-card card member-only';chipCard.id='chipCard';
chipCard.innerHTML='<div class="card-heading"><div><h3>ETF 法人與融資</h3><p class="small">證交所盤後資料 · ETF 本身</p></div><label class="chip-date">資料日<select id="chipDate" aria-label="法人籌碼日期"></select></label></div><div id="chipContents" class="chip-contents"><p class="small">讀取法人資料中…</p></div><p class="small chip-source">買賣超是當日交易，並非持有庫存；融資是餘額，不能直接視為買賣訊號。<a href="https://www.twse.com.tw/zh/trading/foreign/t86.html" target="_blank" rel="noopener">法人來源</a> · <a href="https://www.twse.com.tw/zh/trading/margin/mi-margn.html" target="_blank" rel="noopener">融資來源</a></p>';
$('chartCard').after(chipCard);
chipCard.insertAdjacentHTML('afterbegin','<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員專屬</span><h4>查看 ETF 法人籌碼</h4><p>登入後看外陸資持有單位與三大法人每日買賣超。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>');
let chipCode='',chipRows=[],chipGeneration=0;
const sharesToLots=n=>Number.isFinite(n)?`${fmt(n/1000,1)} 張`:'—';
function chipObservation(rows,date){const row=rows.find(r=>r[0]===date);return row?{date:row[0],row,values:row.slice(1,5).map(v=>Number.isFinite(v)?v/1000:null)}:null}
function chipReading(date,preview=false){
  const node=$('chipContents'),grid=node.querySelector('.chip-grid');if(!grid)return;const obs=chipObservation(chipRows,date),row=obs?.row;
  const caption=node.querySelector('.chip-inspect-date');if(caption)caption.textContent=date+' · '+(preview?'圖表預覽；權重日期維持 '+$('chipDate').value:'選定資料日');
  grid.classList.add('rd-flow-chart');grid.dataset.date=date;grid.replaceChildren();const max=Math.max(1,...(obs?.values||[]).filter(Number.isFinite).map(Math.abs));
  ['外陸資','投信','自營商','合計'].forEach((label,i)=>{const value=obs?.values[i],item=document.createElement('div');item.className='rd-flow-row';item.innerHTML='<span></span><div class="rd-flow-axis"><i></i></div><b></b>';item.firstChild.textContent=label;item.lastChild.textContent=Number.isFinite(value)?(value>0?'+':'')+fmt(value,1)+' 張':'未取得此日資料';item.lastChild.className=value>0?'up':value<0?'down':'';const bar=item.querySelector('i'),w=Number.isFinite(value)?Math.abs(value)/max*48:0;bar.style.width=w+'%';bar.style.left=(value>=0?50:50-w)+'%';bar.className=value>0?'rd-positive':'rd-negative';grid.append(item)});
  grid.setAttribute('role','img');grid.setAttribute('aria-label',date+' 三大法人每日買賣超，左賣超右買超，單位張');
  const heading=node.querySelector('.chip-summary');if(heading){heading.querySelector('strong').textContent=sharesToLots(row?.[5]);heading.querySelector('small').textContent=row?.[5]!=null&&row?.[6]>0?'約占已發行單位 '+fmt(row[5]/row[6]*100,2)+'%':'未取得此日持有資料'}
  const foot=node.querySelector('.chip-cumulative');if(foot){const past=chipRows.filter(r=>r[0]<=date).slice(-20);foot.textContent=obs?'近 '+past.length+' 個已取得交易日：外陸資累計 '+sharesToLots(past.reduce((v,r)=>v+r[1],0))+'。':'此日尚無已取得法人資料，不沿用其他日期的值。'}
  const margin=node.querySelector('.chip-daily-margin');if(margin)margin.textContent=date+' 融資餘額 '+(Number.isFinite(row?.[7])?fmt(row[7],0)+' 張':'未取得')+' · 融券餘額 '+(Number.isFinite(row?.[8])?fmt(row[8],0)+' 張':'未取得');
}
function renderChip(){
  const node=$('chipContents'),date=$('chipDate').value||chipRows.at(-1)?.[0],row=chipObservation(chipRows,date)?.row;
  node.replaceChildren();if(!row){node.textContent='這檔 ETF 尚無可用的法人快照。';return}
  const [day,foreignNet,trustNet,dealerNet,totalNet,foreignHeld,issued]=row;
  const heading=document.createElement('div');heading.className='chip-summary';
  const pct=foreignHeld!=null&&issued>0?foreignHeld/issued*100:null;
  heading.innerHTML='<span>外陸資持有 ETF 單位</span><strong></strong><small></small>';
  heading.querySelector('strong').textContent=sharesToLots(foreignHeld);
  heading.querySelector('small').textContent=pct==null?'未公布持有比例':`約占已發行單位 ${fmt(pct,2)}%`;
  node.append(heading);const caption=document.createElement('p');caption.className='small chip-inspect-date';caption.setAttribute('aria-live','polite');node.append(caption);
  const grid=document.createElement('div');grid.className='chip-grid';
  for(const [label,value] of [['外陸資買賣超',foreignNet],['投信買賣超',trustNet],['自營商買賣超',dealerNet],['三大法人合計',totalNet]]){
    const item=document.createElement('div');item.className='chip-item';
    const title=document.createElement('small');title.textContent=label;
    const amount=document.createElement('b');amount.textContent=(value>0?'+':'')+sharesToLots(value);amount.className=value>0?'up':value<0?'down':'';
    item.append(title,amount);grid.append(item);
  }
  node.append(grid);
  const prior=chipRows.filter(x=>x[0]<=day).slice(-20),sum=prior.reduce((n,x)=>n+x[1],0);
  const foot=document.createElement('p');foot.className='small chip-cumulative';foot.textContent=`近 ${prior.length} 個已取得交易日：外陸資累計買賣超 ${(sum>0?'+':'')+sharesToLots(sum)}。投信、政府持有多少單位未由此報表提供。`;
  node.append(foot);
  const range=[20,60,120].includes(settings.chipRange)?settings.chipRange:60,history=chipRows.filter(x=>x[0]<=day).slice(-range);
  const seg=document.createElement('div');seg.className='segment chip-range';seg.setAttribute('aria-label','趨勢期間');
  seg.innerHTML=[20,60,120].map(n=>`<button type="button" data-range="${n}" class="${n===range?'active':''}" aria-pressed="${n===range}">${n} 日</button>`).join('');
  seg.addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;settings.chipRange=Number(b.dataset.range);save();renderChip()});
  node.append(seg);
  const width=Math.max(280,Math.round(node.clientWidth||600));
  // 三大法人: stacked bars per day (buying above zero, selling below), the day's total as a line.
  const lots=v=>Number.isFinite(v)?v/1000:null;
  node.append(chipChart({title:'三大法人每日買賣超',unit:'張',width,dates:history.map(r=>r[0]),kind:'stack',
    series:[{name:'外陸資',color:'#d74640',data:history.map(r=>lots(r[1]))},{name:'投信',color:'#18a49b',data:history.map(r=>lots(r[2]))},{name:'自營商',color:'#e3a052',data:history.map(r=>lots(r[3]))}],
    line:{name:'合計',color:'var(--ink)',data:history.map(r=>lots(r[4]))},format:v=>fmt(v,1)+' 張',onInspect:(d,source)=>chipReading(source==='restore'?day:d,source!=='restore'&&d!==day)}));
  // 融資: balance as an area, the ETF close (split-adjusted) as a dashed line on its own right-hand scale.
  const closeBy=new Map(bars.map(b=>[b.date,b.close])),margin=history.map(r=>Number.isFinite(r[7])?r[7]:null);
  const firstM=margin.find(Number.isFinite),lastM=[...margin].reverse().find(Number.isFinite);
  node.append(chipChart({title:'融資餘額趨勢',unit:'張',width,dates:history.map(r=>r[0]),kind:'area',
    series:[{name:'融資餘額',color:'#0e7490',data:margin}],right:{name:`${selected} 收盤`,color:'#9aa5ab',data:history.map(r=>closeBy.get(r[0])??null)},
    note:Number.isFinite(firstM)&&Number.isFinite(lastM)?`區間變化 ${lastM>=firstM?'+':''}${fmt(lastM-firstM,0)} 張（${firstM?(lastM>=firstM?'+':'')+fmt((lastM/firstM-1)*100,1)+'%':'—'}）`:''}));
  const m=document.createElement('p');m.className='small chip-daily-margin';m.textContent=`${day} 融資餘額 ${Number.isFinite(row[7])?fmt(row[7],0)+' 張':'暫無資料'} · 融券餘額 ${Number.isFinite(row[8])?fmt(row[8],0)+' 張':'暫無資料'}`;node.append(m);
  chipReading(day);updateWeights();
}
/* Small SVG trend chart drawn at the card's real pixel width, so labels stay legible on phones.
   kind 'stack': series stacked above/below zero plus an optional total line; kind 'area': one filled line
   plus an optional dashed comparison line on its own right-hand scale. Hover or tap shows that day. */
function chipChart({title,unit,width,dates,kind,series,line,right,note,bands=[],format,periodLabel='個交易日',onInspect}){
  const NS='http://www.w3.org/2000/svg',wrap=document.createElement('div');wrap.className='chip-trend';
  const head=document.createElement('div');head.className='chip-trend-head';head.innerHTML=`<strong></strong><span></span>`;
  head.querySelector('strong').textContent=title;head.querySelector('span').textContent=`${dates[0]||'—'} 至 ${dates.at(-1)||'—'} · 單位：${unit}${note?' · '+note:''}`;wrap.append(head);
  const all=series.flatMap(s=>s.data).filter(Number.isFinite),valueText=format||(v=>fmt(v,0)+' 張');
  if(!all.length){const p=document.createElement('p');p.className='small';p.textContent='此期間尚無可用資料';wrap.append(p);return wrap}
  const W=width-34,H=width<480?170:200,L=width<480?46:58,R=right?(width<480?40:50):10,T=12,B=24,n=dates.length,step=(W-L-R)/Math.max(1,n);
  let lo,hi;
  if(kind==='stack'){lo=0;hi=0;dates.forEach((_,i)=>{let p=0,q=0;for(const s of series){const v=s.data[i];if(v>0)p+=v;else if(v<0)q+=v}hi=Math.max(hi,p,line?.data[i]??0);lo=Math.min(lo,q,line?.data[i]??0)})}
  else{const ref=[...all,...bands.map(b=>b.value)];lo=Math.min(...ref);hi=Math.max(...ref);const pad=(hi-lo)*0.12||Math.abs(hi)*0.05||1;lo-=pad;hi+=pad}
  const span=hi-lo||1,y=v=>T+(hi-v)/span*(H-T-B),x=i=>L+step*(i+0.5);
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${title}，${dates.length} ${periodLabel}`);
  const el=(tag,attrs,parent=svg)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent.append(e);return e};
  const short=v=>Math.abs(v)>=10000?fmt(v/10000,1)+'萬':fmt(v,Math.abs(v)>=100?0:Math.abs(v)>=10?1:2);
  // Gridlines with labels: top, middle, bottom (and zero for stacked bars).
  const ticks=kind==='stack'?[hi,0,lo].filter((v,i,a)=>a.indexOf(v)===i):[hi,(hi+lo)/2,lo];
  // A label too close to one already drawn (zero next to a small maximum) is skipped; zero wins.
  const drawn=[];for(const v of kind==='stack'?[0,hi,lo]:ticks){if(!ticks.includes(v))continue;el('line',{x1:L,x2:W-R,y1:y(v),y2:y(v),stroke:'var(--line)','stroke-dasharray':v===0?'':'3 4'});if(drawn.some(d=>Math.abs(d-y(v))<14))continue;drawn.push(y(v));const t=el('text',{x:L-6,y:y(v)+4,'text-anchor':'end',class:'chip-axis'});t.textContent=short(v)}
  if(kind==='stack'){
    const bw=Math.max(2,Math.min(18,step*0.68));
    dates.forEach((_,i)=>{let p=0,q=0;for(const s of series){const v=s.data[i];if(!Number.isFinite(v)||!v)continue;const from=v>0?p:q,to=from+v;el('rect',{x:x(i)-bw/2,y:y(Math.max(from,to)),width:bw,height:Math.max(1,Math.abs(y(from)-y(to))),fill:s.color,rx:Math.min(2,bw/3)});if(v>0)p=to;else q=to}});
    if(line){const pts=line.data.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:null).filter(Boolean);if(pts.length>1)el('polyline',{points:pts.join(' '),fill:'none',stroke:line.color,'stroke-width':1.6,'stroke-linejoin':'round',opacity:.75});
      if(n<=60)line.data.forEach((v,i)=>{if(Number.isFinite(v))el('circle',{cx:x(i),cy:y(v),r:2.2,fill:line.color})})}
  }else{
    const s=series[0],pts=s.data.map((v,i)=>Number.isFinite(v)?[x(i),y(v)]:null).filter(Boolean);
    if(pts.length>1){el('path',{d:`M${pts[0][0]},${H-B} `+pts.map(p=>`L${p[0]},${p[1]}`).join(' ')+` L${pts.at(-1)[0]},${H-B} Z`,fill:s.color,opacity:.14});el('polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none',stroke:s.color,'stroke-width':2.4,'stroke-linejoin':'round'})}
    for(const extra of series.slice(1)){const points=extra.data.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:null).filter(Boolean);if(points.length>1)el('polyline',{points:points.join(' '),fill:'none',stroke:extra.color,'stroke-width':2.2,'stroke-linejoin':'round'})}
    // Reference lines (for example the observation window's high and low).
    for(const b of bands){el('line',{x1:L,x2:W-R,y1:y(b.value),y2:y(b.value),stroke:s.color,'stroke-dasharray':'6 4',opacity:.7});const below=bands.length>1&&b.value===Math.min(...bands.map(x=>x.value)),t=el('text',{x:L+6,y:y(b.value)+(below?13:-5),class:'chip-axis chip-band'});t.textContent=b.label+' '+valueText(b.value)}
    if(right){const rv=right.data.filter(Number.isFinite);if(rv.length>1){const rl=Math.min(...rv),rh=Math.max(...rv),rs=rh-rl||1,ry=v=>T+(rh-v)/rs*(H-T-B);
      const rp=right.data.map((v,i)=>Number.isFinite(v)?`${x(i)},${ry(v)}`:null).filter(Boolean);el('polyline',{points:rp.join(' '),fill:'none',stroke:right.color,'stroke-width':1.6,'stroke-dasharray':'5 4'});
      for(const v of [rh,rl]){const t=el('text',{x:W-R+6,y:ry(v)+4,class:'chip-axis'});t.textContent=fmt(v,v>=100?0:1)}}}
  }
  // Month labels at the first data point of each month (every 2nd, 3rd… month when space is short); the year is
  // added on January and on the first label. A short tick marks every month.
  const starts=[];dates.forEach((d,i)=>{if(i===0||d.slice(0,7)!==dates[i-1].slice(0,7))starts.push(i)});
  // A partial first month (data starting near month end) would crowd the next label; label from the next month.
  const labelled=starts.length>1&&x(starts[1])-x(starts[0])<48?starts.slice(1):starts;
  const stride=Math.max(1,Math.ceil(labelled.length*46/Math.max(1,W-L-R)));let shown=0;
  for(const i of starts)el('line',{x1:x(i),x2:x(i),y1:H-B,y2:H-B+4,stroke:'var(--muted)',opacity:.5});
  labelled.forEach((i,k)=>{if(k%stride)return;
    const m=Number(dates[i].slice(5,7)),t=el('text',{x:x(i),y:H-6,'text-anchor':i===0?'start':'middle',class:'chip-axis'});
    t.textContent=!shown||m===1?dates[i].slice(0,4)+'/'+m:m+'月';shown++});
  const guide=el('line',{x1:0,x2:0,y1:T,y2:H-B,stroke:'var(--muted)','stroke-width':1,opacity:0});
  wrap.append(svg);
  const legend=document.createElement('p');legend.className='chip-legend';
  legend.innerHTML=[...series.map(s=>`<span style="color:${s.color}"> ${s.name}</span>`),line?`<span>━ ${line.name}</span>`:'',right?`<span style="color:${right.color}">┅ ${right.name}（右軸）</span>`:''].join('');wrap.append(legend);
  const tip=document.createElement('p');tip.className='chip-tip';tip.setAttribute('aria-live','polite');wrap.append(tip);
  const signed=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v,0):'—';
  let inspected=n-1,pinned=false;svg.setAttribute('tabindex','0');const show=(i,source='initial')=>{inspected=i;tip.textContent=`${dates[i]}　`+[...series.map(s=>`${s.name} ${Number.isFinite(s.data[i])?valueText(s.data[i]):'—'}`),line?`${line.name} ${valueText(line.data[i])}`:'',right&&Number.isFinite(right.data[i])?`${right.name} ${fmt(right.data[i],2)}`:''].filter(Boolean).join(' · ');guide.setAttribute('x1',x(i));guide.setAttribute('x2',x(i));guide.setAttribute('opacity',.45);if(source!=='initial')onInspect?.(dates[i],source)};
  const pick=e=>{const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*W/r.width;show(Math.max(0,Math.min(n-1,Math.floor((px-L)/step))),e.type==='pointerdown'?'select':'hover')};
  svg.addEventListener('pointermove',pick);svg.addEventListener('pointerdown',e=>{pinned=e.pointerType==='touch';pick(e)});svg.addEventListener('pointerleave',()=>{if(!pinned){guide.setAttribute('opacity',0);show(n-1,'restore')}});svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End','Escape'].includes(e.key)){e.preventDefault();if(e.key==='Escape'){pinned=false;show(n-1,'restore')}else{pinned=true;show(e.key==='Home'?0:e.key==='End'?n-1:Math.max(0,Math.min(n-1,inspected+(e.key==='ArrowLeft'?-1:1))),'keyboard')}}});
  show(n-1);return wrap;
}
// Charts are drawn at the card's pixel width; redraw when it changes.
let chipWidth=0;window.addEventListener('resize',()=>{const w=$('chipContents').clientWidth;if(chipRows.length&&Math.abs(w-chipWidth)>40){chipWidth=w;clearTimeout(window.__chipResize);window.__chipResize=setTimeout(renderChip,150)}});
async function loadChips(code){
  if(!isMember)return;
  const generation=++chipGeneration;chipCode=code;chipRows=[];$('chipDate').replaceChildren();$('chipContents').textContent='讀取法人資料中…';updateWeights();
  try{
    const response=await fetch(`/api/chips?code=${encodeURIComponent(code)}`),data=await response.json();
    if(generation!==chipGeneration||code!==selected)return;
    chipRows=Array.isArray(data.rows)?data.rows.filter(r=>Array.isArray(r)&&/^\d{4}-\d{2}-\d{2}$/.test(r[0])).sort((a,b)=>a[0].localeCompare(b[0])):[];
    for(const r of chipRows.toReversed())$('chipDate').add(new Option(r[0],r[0]));
    $('chipDate').disabled=!chipRows.length;renderChip();
  }catch{if(generation===chipGeneration)$('chipContents').textContent='法人快照暫時無法取得。'}
}
$('chipDate').addEventListener('change',()=>renderChip());
const researchLoadBars=loadBars;
loadBars=function(...args){if(selected!==chipCode)window.chaoweiWaveMarkers=[];if(isMember&&(selected!==chipCode||!chipRows.length))loadChips(selected);return researchLoadBars(...args)};
window.chaoweiResearchMemberChanged=signedIn=>{if(signedIn)loadChips(selected);else{chipRows=[];chipCode='';pinMode=false;pinModeButton.setAttribute('aria-pressed','false')}};

// Price crosshair previews the exact daily chip row; historical dates without data stay missing.
const chipLegend=updateLegend;let chipReadFrame=0,chipReadDate='';updateLegend=function(logical){const out=chipLegend(logical);if(!isMember||!chipRows.length||interval!=='D')return out;const i=Number.isFinite(logical)?Math.round(logical):-1,time=i>=0?lwc?.data?.[i]?.time:null,date=typeof time==='string'?time:$('chipDate').value;if(!date||date===chipReadDate)return out;chipReadDate=date;cancelAnimationFrame(chipReadFrame);chipReadFrame=requestAnimationFrame(()=>chipReading(date,date!==$('chipDate').value));return out};

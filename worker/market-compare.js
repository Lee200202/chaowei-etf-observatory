/* ---------- 大盤與融資：同一段區間對照（市場刻度卡片最下方） ---------- */
// Hover shows a vertical line on both charts. Double-click (double-tap) locks it as the start; moving right previews
// the end and a click (or lifting the finger after dragging) fixes it. The start is always the left end; Esc cancels.
(()=>{
  const RC=RangeCompare,RANGES=[['3m','3 個月',3],['6m','6 個月',6],['1y','1 年',12],['2y','2 年',24]];
  const SERIES=[{key:'index',tag:'A',title:'加權指數',unit:'點',line:'#0e7490',up:'漲',down:'跌'},{key:'margin',tag:'B',title:'融資餘額',unit:'億元',line:'#b4566e',up:'增幅',down:'減幅'}];
  const sec=document.createElement('section');sec.className='range-compare';sec.id='rangeCompare';
  sec.innerHTML='<div class="range-compare-head"><div><p class="kicker teal">RANGE COMPARE</p><h3>大盤與融資，同一段區間</h3><p class="small">滑鼠移到圖上會出現直線；在起點連點兩下定住，再往右移到終點點一下確認（手機：連點兩下後往右拖、放開）。Esc 取消。</p></div>'+
    '<div class="range-compare-tools"><div class="segment" role="group" aria-label="圖表期間" data-rc-ranges>'+RANGES.map(([id,label])=>`<button type="button" data-rc-range="${id}">${label}</button>`).join('')+'</div>'+
    '<div class="segment" role="group" aria-label="快速選取"><button type="button" data-rc-preset="peakToLatest">高點至最新</button><button type="button" data-rc-preset="peakToLow">高點至低點</button></div></div></div>'+
    '<div class="range-compare-result" aria-live="polite"></div><p class="rc-hint small" aria-live="polite"></p><div class="range-compare-charts"></div>'+
    '<div class="range-compare-sliders"><label><span>起點</span><input type="range" min="0" step="1" data-rc-end="a" aria-label="區間起點"><output></output></label><label><span>終點</span><input type="range" min="0" step="1" data-rc-end="b" aria-label="區間終點"><output></output></label></div>'+
    '<p class="small range-compare-note">加權指數用證交所收盤；融資餘額用證交所信用交易統計（上市融資金額）。只比對兩者都有資料的交易日，盤中暫值不納入。</p>';
  // Appended at the end of the market card: the slot right after the card rail is the carousel progress bar, hidden in grid view.
  $('market').append(sec);
  const charts=sec.querySelector('.range-compare-charts'),result=sec.querySelector('.range-compare-result'),plots={};
  for(const s of SERIES){
    const fig=document.createElement('figure');fig.className='rc-figure';
    fig.innerHTML=`<figcaption><b>${s.tag}　${s.title}</b><span>${s.unit}</span></figcaption><div class="rc-plot"><div class="rc-svg"></div><div class="rc-cross" hidden><span></span></div><div class="rc-hit" data-rc-plot="${s.key}" aria-hidden="true"></div></div><p class="rc-ends"></p>`;
    charts.append(fig);plots[s.key]={fig,host:fig.querySelector('.rc-svg'),hit:fig.querySelector('.rc-hit'),ends:fig.querySelector('.rc-ends'),cross:fig.querySelector('.rc-cross')};
  }
  const H=250,PAD={l:10,r:80,t:34,b:26};
  let rows=[],view=[],sel=null,picking=null,before=null,frame=0,lastWidth=0,lastTap={t:0,x:0};
  const hint=sec.querySelector('.rc-hint');
  const rangeKey=()=>RANGES.some(r=>r[0]===settings.compareRange)?settings.compareRange:'6m';
  const md=d=>Number(d.slice(5,7))+'/'+d.slice(8,10);
  const num=(v,s)=>fmt(v,s.key==='index'?2:1);
  // Keep the chosen days when data refreshes or the window changes, as long as both are still on screen.
  function rebuild(){
    const keep=sel&&view.length?[view[sel.a]?.date,view[sel.b]?.date]:null;
    rows=RC.join(market,marginDays);view=RC.windowRows(rows,RANGES.find(r=>r[0]===rangeKey())[2]);
    const a=keep?view.findIndex(x=>x.date===keep[0]):-1,b=keep?view.findIndex(x=>x.date===keep[1]):-1;
    sel=a>=0&&b>a?{a,b}:RC.preset(view,'peakToLatest');paint();
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint()})}
  function svgFor(s,w){
    const n=view.length,pw=w-PAD.l-PAD.r,ph=H-PAD.t-PAD.b,vals=view.map(x=>x[s.key]);let lo=Math.min(...vals),hi=Math.max(...vals);const pad=(hi-lo)*.08||Math.abs(hi)*.01||1;lo-=pad;hi+=pad;
    const X=i=>PAD.l+(n>1?i*pw/(n-1):0),Y=v=>PAD.t+(hi-v)/(hi-lo)*ph,c=RC.change(view,sel,s.key),tone=c.diff>0?RISE:c.diff<0?FALL:'#7a8a85';
    const pts=(from,to)=>view.slice(from,to+1).map((x,k)=>X(from+k).toFixed(1)+','+Y(x[s.key]).toFixed(1)).join(' ');
    const hiI=RC.argmax(view,s.key),loI=RC.argmin(view,s.key),xa=X(sel.a),xb=X(sel.b),ya=Y(c.start),yb=Y(c.end);
    // Month ticks, thinned so labels never overlap on a phone.
    const months=[];view.forEach((x,i)=>{if(i&&x.date.slice(0,7)!==view[i-1].date.slice(0,7))months.push(i)});const step=Math.max(1,Math.ceil(months.length/Math.max(2,Math.floor(pw/70))));
    const ticks=months.filter((_,k)=>k%step===0).map(i=>{const d=view[i].date,label=d.slice(5,7)==='01'?d.slice(0,4):Number(d.slice(5,7))+'月';return`<line x1="${X(i)}" x2="${X(i)}" y1="${PAD.t}" y2="${PAD.t+ph}" class="rc-grid"/><text x="${X(i)}" y="${H-8}" text-anchor="middle" class="rc-tick">${label}</text>`}).join('');
    const pin=(i,label,cls)=>`<circle cx="${X(i)}" cy="${Y(view[i][s.key])}" r="3" class="${cls}"/><text x="${Math.min(X(i),PAD.l+pw)}" y="${Y(view[i][s.key])+(cls==='rc-hi'?-7:13)}" text-anchor="${X(i)>PAD.l+pw*.8?'end':X(i)<PAD.l+pw*.2?'start':'middle'}" class="rc-pin">${label}</text>`;
    return`<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="${s.title}：${c.from} ${num(c.start,s)} ${s.unit}，${c.to} ${num(c.end,s)} ${s.unit}">`+
      `<rect x="${xa}" y="${PAD.t}" width="${Math.max(1,xb-xa)}" height="${ph}" fill="${tone}" opacity=".09"/>${ticks}`+
      [hiI,loI].filter(i=>!(xb>PAD.l+pw-50&&Math.abs(Y(vals[i])-yb)<16)).map(i=>`<text x="${w-PAD.r+6}" y="${Y(vals[i])+4}" class="rc-axis">${fmt(vals[i],0)}</text>`).join('')+
      `<polyline points="${pts(0,n-1)}" fill="none" stroke="${s.line}" stroke-width="1.6" opacity=".45"/>`+
      `<polyline points="${pts(sel.a,sel.b)}" fill="none" stroke="${tone}" stroke-width="2.6" stroke-linejoin="round"/>`+
      `<line x1="${xa}" x2="${xb}" y1="${ya}" y2="${ya}" stroke="${tone}" stroke-dasharray="4 4" opacity=".75"/><line x1="${xb}" x2="${xb}" y1="${ya}" y2="${yb}" stroke="${tone}" stroke-width="2"/>`+
      (hiI===sel.a||hiI===sel.b?'':pin(hiI,'高 '+md(view[hiI].date),'rc-hi'))+(loI===sel.a||loI===sel.b?'':pin(loI,'低 '+md(view[loI].date),'rc-lo'))+
      `<line x1="${xa}" x2="${xa}" y1="${PAD.t}" y2="${PAD.t+ph}" class="rc-edge${picking!=null?' locked':''}"/><line x1="${xb}" x2="${xb}" y1="${PAD.t}" y2="${PAD.t+ph}" class="rc-edge${picking!=null?' preview':''}"/>`+
      `<circle cx="${xa}" cy="${ya}" r="5.5" fill="var(--paper)" stroke="${s.line}" stroke-width="2.4"/><circle cx="${xb}" cy="${yb}" r="5.5" fill="${tone}" stroke="var(--paper)" stroke-width="2"/>${values(s,c,{w,pw,ph,xa,xb,ya,yb,tone,hiI,loI})}</svg>`;
  }
  // Values on the chart: start above its point, end beside its point (in the right gutter when at the right edge),
  // and the change beside the vertical drop line (on a narrow chart, in the strip above the plot). Text carries a paper halo so it stays readable over the lines.
  function values(s,c,{w,pw,ph,xa,xb,ya,yb,tone,hiI,loI}){
    const right=PAD.l+pw,halo='stroke="var(--paper)" stroke-width="4" paint-order="stroke" stroke-linejoin="round"';
    const lab=(x,y,anchor,text,cls,fill)=>`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="${cls}"${fill?` fill="${fill}"`:''} ${halo}>${text}</text>`;
    const startTag=(hiI===sel.a?'高 ':loI===sel.a?'低 ':'')+md(c.from)+' '+num(c.start,s),endTag=(hiI===sel.b?'高 ':loI===sel.b?'低 ':'')+md(c.to)+' '+num(c.end,s);
    const X0=i=>PAD.l+(view.length>1?i*pw/(view.length-1):0),crowded=hiI!==sel.a&&hiI!==sel.b&&Math.abs(X0(hiI)-xa)<110,sy=!crowded&&ya-12>12?ya-12:Math.min(PAD.t+ph-4,ya+20),sAnchor=xa<PAD.l+70?'start':xa>right-70?'end':'middle';
    const gutter=xb>right-50,ey=Math.min(PAD.t+ph-4,Math.max(PAD.t+10,yb+(c.diff<0?16:-10)));
    const pct=c.pct==null?'':`（${c.pct>0?'+':c.pct<0?'−':''}${fmt(Math.abs(c.pct)*100,2)}%）`,chg=(c.diff>0?'+':c.diff<0?'−':'')+num(Math.abs(c.diff),s)+pct;
    const room=xb-xa>130&&Math.abs(yb-ya)>30,cy=room?(ya+yb)/2+4:14;
    return lab(sAnchor==='start'?Math.max(PAD.l,xa-4):sAnchor==='end'?xa+4:xa,sy,sAnchor,startTag,'rc-val')+
      (gutter?lab(w-PAD.r+6,yb+4,'start',num(c.end,s),'rc-val',tone)+lab(xb-8,ey,'end',md(c.to),'rc-val'):lab(xb+9,yb+4,'start',endTag,'rc-val',tone))+
      lab(room?xb-8:w-4,cy,'end',chg,'rc-chg',tone);
  }
  // "49,968 − 41,513 = 8,455（跌 16.92%）" for a fall; a rise reads end − start.
  function sentence(s,c){
    const pct=c.pct==null?'—':fmt(Math.abs(c.pct)*100,2)+'%',word=c.diff>0?s.up:c.diff<0?s.down:'持平',cls=c.diff>0?'up':c.diff<0?'down':'';
    const expr=c.diff<0?`${num(c.start,s)} − ${num(c.end,s)} = `:`${num(c.end,s)} − ${num(c.start,s)} = `;
    return`${expr}<strong class="${cls}">${num(Math.abs(c.diff),s)} ${s.unit}</strong>（${word} <strong class="${cls}">${pct}</strong>）`;
  }
  function paint(){
    sec.querySelectorAll('[data-rc-range]').forEach(b=>{const on=b.dataset.rcRange===rangeKey();b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
    if(view.length<2||!sel){result.innerHTML='<p class="small">指數與融資資料讀取中，或共同交易日不足兩天。</p>';for(const s of SERIES){plots[s.key].host.innerHTML='';plots[s.key].ends.textContent=''}return}
    const live=sel,cs=SERIES.map(s=>RC.change(view,live,s.key)),max=Math.max(...cs.map(c=>Math.abs(c.pct||0)),.0001);
    result.innerHTML=`<p class="rc-period">${cs[0].from} → ${cs[0].to}<span>${cs[0].days} 個交易日</span></p>`+SERIES.map((s,k)=>{const c=cs[k];return`<div class="rc-row"><span class="rc-tag">${s.tag}</span><div><b>${s.title}</b><p>${sentence(s,c)}</p>${(()=>{const p=RC.peakInside(view,live,s.key);return p?`<small class="rc-peak">區間內最高 ${md(p.from)} ${num(p.start,s)}，至終點 ${sentence(s,p)}</small>`:''})()}</div><i class="rc-bar" aria-hidden="true"><i class="${c.diff>=0?'up-bg':'down-bg'}" style="width:${(Math.abs(c.pct||0)/max*100).toFixed(1)}%"></i></i></div>`}).join('')+
      (()=>{const r=RC.ratio(cs[0],cs[1]);return r==null?'':`<p class="small rc-ratio">融資變動幅度約為指數的 <b>${fmt(Math.abs(r),2)}</b> 倍${r<0?'，兩者方向相反':''}。</p>`})();
    hint.textContent=picking!=null?`起點已定住：${view[picking].date}。往右移到終點後點一下確認，Esc 取消。`:'';sec.classList.toggle('rc-picking',picking!=null);
    for(const [k,s] of SERIES.entries()){const p=plots[s.key],w=Math.max(260,Math.round(p.host.clientWidth||charts.clientWidth/2||520)),c=cs[k];
      p.host.innerHTML=svgFor(s,w);p.hit.style.left=PAD.l+'px';p.hit.style.right=PAD.r+'px';
      p.ends.innerHTML=`<span>起 ${md(c.from)}　${num(c.start,s)}</span><span class="${c.diff>0?'up':c.diff<0?'down':''}">終 ${md(c.to)}　${num(c.end,s)}</span>`}
    const [ia,ib]=sec.querySelectorAll('[data-rc-end]');for(const input of [ia,ib]){input.max=String(view.length-1)}ia.value=String(sel.a);ib.value=String(sel.b);
    ia.nextElementSibling.textContent=view[sel.a].date;ib.nextElementSibling.textContent=view[sel.b].date;lastWidth=charts.clientWidth;
  }
  const at=(e,hit)=>{const r=hit.getBoundingClientRect(),n=view.length;return Math.max(0,Math.min(n-1,Math.round((e.clientX-r.left)/Math.max(1,r.width)*(n-1))))};
  // Crosshair: one vertical line per chart at the same trading day, with that day's value.
  function cross(i){for(const sr of SERIES){const p=plots[sr.key],c=p.cross;if(i==null||view.length<2){c.hidden=true;continue}
    const pw=p.host.clientWidth-PAD.l-PAD.r,x=PAD.l+i*pw/(view.length-1),label=c.firstChild;c.hidden=false;c.style.left=x+'px';
    label.textContent=md(view[i].date)+'　'+num(view[i][sr.key],sr);label.classList.toggle('flip',x>p.host.clientWidth*.6)}}
  function lockStart(i){const n=view.length;if(n<2)return;before=sel;picking=Math.min(i,n-2);sel={a:picking,b:picking+1};paint()}
  function commit(i){const n=view.length;sel=RC.clampSel(n,picking,i);picking=null;before=null;paint()}
  function preview(i){if(picking==null)return;const b=Math.max(picking+1,Math.min(view.length-1,i));if(b!==sel.b){sel={a:picking,b};schedule()}}
  charts.addEventListener('pointermove',e=>{const hit=e.target.closest('[data-rc-plot]');if(!hit||view.length<2)return;const i=at(e,hit);cross(i);preview(i)});
  charts.addEventListener('pointerleave',()=>{if(picking==null)cross(null)});
  charts.addEventListener('dblclick',e=>{const hit=e.target.closest('[data-rc-plot]');if(!hit)return;e.preventDefault();lockStart(at(e,hit));cross(at(e,hit))});
  // A double-tap is detected by hand: two taps within 350 ms and 30 px. While a start is locked, a tap or the end of
  // a drag to its right fixes the end; a tap left of the start does nothing, since the start stays on the left.
  charts.addEventListener('pointerup',e=>{const hit=e.target.closest('[data-rc-plot]');if(!hit||view.length<2)return;const i=at(e,hit);
    if(e.pointerType!=='mouse'){const now=e.timeStamp;if(now-lastTap.t<350&&Math.abs(e.clientX-lastTap.x)<30){lastTap={t:0,x:0};lockStart(i);cross(i);return}lastTap={t:now,x:e.clientX}}
    cross(i);if(picking!=null&&i>picking)commit(i)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking!=null){picking=null;sel=before||sel;before=null;cross(null);paint()}});
  // Sliders give keyboard and fine-touch control; the start can never pass the end.
  sec.querySelector('.range-compare-sliders').addEventListener('input',e=>{const input=e.target.closest('[data-rc-end]');if(!input||!sel)return;const v=Number(input.value),n=view.length;
    sel=input.dataset.rcEnd==='a'?RC.clampSel(n,Math.min(v,sel.b-1),sel.b):RC.clampSel(n,sel.a,Math.max(v,sel.a+1));paint()});
  sec.querySelector('.range-compare-tools').addEventListener('click',e=>{const r=e.target.closest('[data-rc-range]'),p=e.target.closest('[data-rc-preset]');
    if(r){settings.compareRange=r.dataset.rcRange;save();rebuild()}if(p){sel=RC.preset(view,p.dataset.rcPreset);paint()}});
  const prev=computeMktMargin;computeMktMargin=function(...a){const out=prev(...a);clearTimeout(window.__rcRebuild);window.__rcRebuild=setTimeout(rebuild,60);return out};
  window.addEventListener('resize',()=>{if(Math.abs(charts.clientWidth-lastWidth)>30){clearTimeout(window.__rcResize);window.__rcResize=setTimeout(paint,120)}});
  rebuild();
})();

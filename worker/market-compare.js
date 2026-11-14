/* ---------- 任兩張市場卡片：同一段區間對照（市場刻度卡片最下方） ---------- */
// Two transparent boxes start empty. Drag any market card's "拖到下方比較" handle into box A or B (or tap the handle to
// fill the next empty box); once both are filled, the two series are compared on the days both have data.
// Hover shows a vertical line on both charts. Double-click (double-tap) locks it as the start; moving right previews
// the end and a click (or tap) fixes it. The start is always the left end; Esc cancels.
// Each chart zooms (wheel, + / −) and pans (drag) on its own over the whole shared history; the selection is by date.
const CompareSeries={
  index:{title:'加權指數',unit:'點',line:'#0e7490',digits:2,mode:'pct',up:'漲',down:'跌',rows:()=>market.filter(x=>!x.intraday).map(x=>({date:x.date,value:x.index}))},
  volume:{title:'大盤成交股數',unit:'億股',line:'#4f8fa0',digits:1,mode:'pct',up:'增',down:'減',rows:()=>market.filter(x=>!x.intraday).map(x=>({date:x.date,value:x.volume/1e8}))},
  brent:{title:'布蘭特原油',unit:'美元／桶',line:'#c98a2b',digits:2,mode:'pct',up:'漲',down:'跌',rows:()=>oilDays},
  fx:{title:'美元／新台幣',unit:'新台幣',line:'#7c6bb0',digits:3,mode:'pct',up:'升',down:'降',rows:()=>fx},
  margin:{title:'融資餘額',unit:'億元',line:'#b4566e',digits:1,mode:'pct',up:'增幅',down:'減幅',rows:()=>marginDays},
  // Daily net flows only make sense summed: the difference between two days is the net over the interval.
  bank:{title:'八大官股累計淨額',unit:'億元',line:'#16867d',digits:2,mode:'diff',up:'區間淨買超',down:'區間淨賣超',rows:()=>{let s=0;return bankDays.map(x=>({date:x.date,value:s+=x.value}))}},
  vix:{title:'恐慌指數 VIX',unit:'點',line:'#8563af',digits:2,mode:'pct',up:'升',down:'降',rows:()=>vixDays},
  // Ratios move in percentage points; the retail ratio also crosses zero, so a relative % would mislead.
  pcr:{title:'選擇權 PCR（未平倉）',unit:'個百分點',valueUnit:'%',line:'#a0527a',digits:2,mode:'points',up:'上升',down:'下降',rows:()=>pcrDays.map(x=>({date:x.date,value:x.oiRatio}))},
  retail:{title:'散戶多空比',unit:'個百分點',valueUnit:'%',line:'#3f7f8c',digits:2,mode:'points',up:'上升',down:'下降',rows:()=>retailDays.map(x=>({date:x.date,value:x.ratio}))}
};
(()=>{
  const RC=RangeCompare,RANGES=[['3m','3 個月',3],['6m','6 個月',6],['1y','1 年',12],['2y','2 年',24],['all','全部',0]];
  const slots={a:null,b:null},SLOTS=[{key:'a',tag:'A'},{key:'b',tag:'B'}];
  const spec=k=>({...CompareSeries[slots[k]],key:k,tag:k.toUpperCase()});
  const sec=document.createElement('section');sec.className='range-compare';sec.id='rangeCompare';
  sec.innerHTML='<div class="range-compare-head"><div><p class="kicker teal">RANGE COMPARE</p><h3>任選兩張卡片，同一段區間</h3><p class="small">把上方任兩張市場卡片的「拖到下方比較」拖進 A、B 兩個框（或點一下該按鈕，依序放入），就會比對同一段區間的漲跌幅度。圖上滑鼠移動會出現直線；在起點連點兩下定住，再往右移到終點點一下確認，Esc 取消。每張圖可各自用滾輪或「＋／－」縮放、按住拖曳左右移動。</p></div></div>'+
    '<div class="rc-slots" role="group" aria-label="比較框">'+SLOTS.map(s=>`<div class="rc-slot" data-slot="${s.key}"><span class="rc-slot-tag">${s.tag}</span><div class="rc-slot-body"></div><button type="button" class="pill mini rc-slot-clear" data-slot-clear="${s.key}" hidden>移除</button></div>`).join('')+'</div>'+
    '<div class="rc-body"><div class="range-compare-tools"><div class="segment" role="group" aria-label="兩張圖一起顯示的期間" data-rc-ranges>'+RANGES.map(([id,label])=>`<button type="button" data-rc-range="${id}">${label}</button>`).join('')+'</div>'+
    '<div class="segment" role="group" aria-label="快速選取"><button type="button" data-rc-preset="peakToLatest">A 高點至最新</button><button type="button" data-rc-preset="peakToLow">A 高點至低點</button></div></div>'+
    '<div class="range-compare-result" aria-live="polite"></div><p class="rc-hint small" aria-live="polite"></p><div class="range-compare-charts"></div>'+
    '<div class="range-compare-sliders"><label><span>起點</span><input type="range" min="0" step="1" data-rc-end="a" aria-label="區間起點"><output></output></label><label><span>終點</span><input type="range" min="0" step="1" data-rc-end="b" aria-label="區間終點"><output></output></label></div>'+
    '<p class="small range-compare-note">只比對兩者都有資料的日期（不同來源的交易日不一定相同，缺的日子跳過、不補值），盤中暫值不納入。比率類（PCR、散戶多空比）以「百分點」表示變化；八大官股以區間累計淨額比較。</p></div>';
  // Appended at the end of the market card: the slot right after the card rail is the carousel progress bar, hidden in grid view.
  $('market').append(sec);
  const charts=sec.querySelector('.range-compare-charts'),result=sec.querySelector('.range-compare-result'),plots={};
  for(const s of SLOTS){
    const fig=document.createElement('figure');fig.className='rc-figure';
    fig.innerHTML=`<figcaption><b></b><span class="rc-span"></span><span class="rc-zoom" role="group" aria-label="${s.tag} 縮放"><button type="button" data-rc-zoom="in" data-rc-chart="${s.key}" aria-label="${s.tag} 放大">＋</button><button type="button" data-rc-zoom="out" data-rc-chart="${s.key}" aria-label="${s.tag} 縮小">－</button><button type="button" data-rc-zoom="reset" data-rc-chart="${s.key}">重設</button></span></figcaption><div class="rc-plot"><div class="rc-svg"></div><div class="rc-cross" hidden><span></span></div><div class="rc-hit" data-rc-plot="${s.key}" aria-hidden="true"></div></div><p class="rc-ends"></p>`;
    charts.append(fig);plots[s.key]={fig,title:fig.querySelector('figcaption b'),host:fig.querySelector('.rc-svg'),hit:fig.querySelector('.rc-hit'),ends:fig.querySelector('.rc-ends'),cross:fig.querySelector('.rc-cross'),span:fig.querySelector('.rc-span')};
  }
  const H=250,PAD={l:10,r:80,t:34,b:26},MIN_SPAN=15;
  let view=[],sel=null,vp={},picking=null,before=null,frame=0,lastWidth=0,lastTap={t:0,x:0},pan=null,SERIES=[];
  const hint=sec.querySelector('.rc-hint');
  const rangeKey=()=>RANGES.some(r=>r[0]===settings.compareRange)?settings.compareRange:'6m';
  const md=d=>Number(d.slice(5,7))+'/'+d.slice(8,10);
  const ymd=d=>d.slice(0,4)+'/'+md(d);
  const num=(v,s)=>fmt(v,s.digits)+(s.valueUnit||'');
  const axis=v=>fmt(v,Math.abs(v)>=1000?0:Math.abs(v)>=100?1:2);
  const ready=()=>!!(slots.a&&slots.b);
  const clampVp=(from,to)=>{const n=view.length,span=Math.max(Math.min(MIN_SPAN,n-1),Math.min(n-1,Math.round(to-from)));from=Math.round(from);from=Math.max(0,Math.min(n-1-span,from));return{from,to:from+span}};
  // The window buttons put both charts on the last N months; each chart can then zoom and pan by itself.
  function windowVp(){const w=RC.windowRows(view,RANGES.find(r=>r[0]===rangeKey())[2]),from=Math.max(0,view.length-w.length);return clampVp(from,view.length-1)}
  function setBoth(v){for(const s of SLOTS)vp[s.key]={...v}}
  // Keep the chosen days and each chart's visible dates when data refreshes.
  function rebuild(reset=false){
    if(!ready()){view=[];sel=null;paint();return}
    SERIES=SLOTS.map(s=>spec(s.key));
    const keepSel=!reset&&sel&&view.length?[view[sel.a]?.date,view[sel.b]?.date]:null,keepVp=reset?{}:Object.fromEntries(Object.entries(vp).map(([k,v])=>[k,[view[v.from]?.date,view[v.to]?.date]]));
    view=RC.joinSeries(CompareSeries[slots.a].rows(),CompareSeries[slots.b].rows());if(view.length<2){sel=null;paint();return}
    const find=d=>view.findIndex(x=>x.date===d);
    if(Object.keys(keepVp).length&&keepVp.a?.[0])for(const s of SLOTS){const [f,t]=keepVp[s.key]||[];const a=find(f),b=find(t);vp[s.key]=a>=0&&b>a?clampVp(a,b===view.length-2?view.length-1:b):windowVp()}else setBoth(windowVp());
    const a=keepSel?find(keepSel[0]):-1,b=keepSel?find(keepSel[1]):-1;sel=a>=0&&b>a?{a,b}:presetIn('peakToLatest');paint();
  }
  // Presets look inside chart A's visible window, at A's own high.
  function presetIn(kind){const v=vp.a||windowVp(),p=RC.preset(view.slice(v.from,v.to+1),kind,'a');return p?{a:p.a+v.from,b:p.b+v.from}:null}
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint()})}
  let lastPlotKey;
  function svgFor(s,w,rise){
    const {from,to}=vp[s.key],n=to-from+1,pw=w-PAD.l-PAD.r,ph=H-PAD.t-PAD.b,seg=view.slice(from,to+1),vals=seg.map(x=>x[s.key]);let lo=Math.min(...vals),hi=Math.max(...vals);const pad=(hi-lo)*.08||Math.abs(hi)*.01||1;lo-=pad;hi+=pad;
    const X=i=>PAD.l+(n>1?(i-from)*pw/(n-1):0),Y=v=>PAD.t+(hi-v)/(hi-lo)*ph,c=RC.change(view,sel,s.key),tone=c.diff>0?RISE:c.diff<0?FALL:'#7a8a85';
    const pts=(a,b)=>view.slice(a,b+1).map((x,k)=>X(a+k).toFixed(1)+','+Y(x[s.key]).toFixed(1)).join(' ');
    const hiI=from+RC.argmax(seg,s.key),loI=from+RC.argmin(seg,s.key),inA=sel.a>=from&&sel.a<=to,inB=sel.b>=from&&sel.b<=to;
    const sa=Math.max(sel.a,from),sb=Math.min(sel.b,to),overlap=sa<sb,xa=X(sel.a),xb=X(sel.b),ya=Y(c.start),yb=Y(c.end);
    // Ticks: months on short spans, years once the view covers more than about two years; thinned for phone widths.
    const years=n>520,marks=[];seg.forEach((x,k)=>{if(k&&x.date.slice(0,years?4:7)!==seg[k-1].date.slice(0,years?4:7))marks.push(from+k)});const step=Math.max(1,Math.ceil(marks.length/Math.max(2,Math.floor(pw/70))));
    const ticks=marks.filter((_,k)=>k%step===0).map(i=>{const d=view[i].date,label=years||d.slice(5,7)==='01'?d.slice(0,4):Number(d.slice(5,7))+'月';return`<line x1="${X(i)}" x2="${X(i)}" y1="${PAD.t}" y2="${PAD.t+ph}" class="rc-grid"/><text x="${X(i)}" y="${H-8}" text-anchor="middle" class="rc-tick">${label}</text>`}).join('');
    const zero=lo<0&&hi>0?`<line x1="${PAD.l}" x2="${PAD.l+pw}" y1="${Y(0)}" y2="${Y(0)}" class="rc-zero"/>`:'';
    const pin=(i,label,cls)=>`<circle cx="${X(i)}" cy="${Y(view[i][s.key])}" r="3" class="${cls}"/><text x="${Math.min(X(i),PAD.l+pw)}" y="${Y(view[i][s.key])+(cls==='rc-hi'?-7:13)}" text-anchor="${X(i)>PAD.l+pw*.8?'end':X(i)<PAD.l+pw*.2?'start':'middle'}" class="rc-pin">${label}</text>`;
    const tail=to===view.length-1&&typeof tideTail==='function'?tideTail(X(to),Y(vals.at(-1)),s.line):'';
    return`<svg data-tide-plot ${rise?'':'data-tide-static'} viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="${s.title}：顯示 ${view[from].date} 至 ${view[to].date}；選取 ${c.from} ${num(c.start,s)}，${c.to} ${num(c.end,s)}">`+
      (overlap?`<rect x="${X(sa)}" y="${PAD.t}" width="${Math.max(1,X(sb)-X(sa))}" height="${ph}" fill="${tone}" opacity=".09"/>`:'')+ticks+zero+
      [hiI,loI].filter(i=>!(inB&&xb>PAD.l+pw-50&&Math.abs(Y(view[i][s.key])-yb)<16)).map(i=>`<text x="${w-PAD.r+6}" y="${Y(view[i][s.key])+4}" class="rc-axis">${axis(view[i][s.key])}</text>`).join('')+
      `<g data-tide-base="${H-PAD.b}"><polyline points="${pts(from,to)}" fill="none" stroke="${s.line}" stroke-width="1.6" opacity=".45"/>`+
      (overlap?`<polyline points="${pts(sa,sb)}" fill="none" stroke="${tone}" stroke-width="2.6" stroke-linejoin="round"/>`:'')+`${tail}</g>`+
      (inA&&inB?`<line x1="${xa}" x2="${xb}" y1="${ya}" y2="${ya}" stroke="${tone}" stroke-dasharray="4 4" opacity=".75"/><line x1="${xb}" x2="${xb}" y1="${ya}" y2="${yb}" stroke="${tone}" stroke-width="2"/>`:'')+
      (hiI===sel.a||hiI===sel.b?'':pin(hiI,'高 '+md(view[hiI].date),'rc-hi'))+(loI===sel.a||loI===sel.b?'':pin(loI,'低 '+md(view[loI].date),'rc-lo'))+
      (inA?`<line x1="${xa}" x2="${xa}" y1="${PAD.t}" y2="${PAD.t+ph}" class="rc-edge${picking!=null?' locked':''}"/><circle cx="${xa}" cy="${ya}" r="5.5" fill="var(--paper)" stroke="${s.line}" stroke-width="2.4"/>`:'')+
      (inB?`<line x1="${xb}" x2="${xb}" y1="${PAD.t}" y2="${PAD.t+ph}" class="rc-edge${picking!=null?' preview':''}"/><circle cx="${xb}" cy="${yb}" r="5.5" fill="${tone}" stroke="var(--paper)" stroke-width="2"/>`:'')+
      values(s,c,{w,pw,ph,xa,xb,ya,yb,tone,hiI,loI,inA,inB,X})+'</svg>';
  }
  function change(s,c){const pct=s.mode==='pct'&&c.pct!=null?`（${c.pct>0?'+':c.pct<0?'−':''}${fmt(Math.abs(c.pct)*100,2)}%）`:'';return(c.diff>0?'+':c.diff<0?'−':'')+fmt(Math.abs(c.diff),s.digits)+(s.mode==='points'?' 百分點':'')+pct}
  // Values on the chart: start above its point, end beside its point (in the right gutter when at the right edge),
  // and the change beside the vertical drop line (on a narrow chart, in the strip above the plot). Text carries a paper halo so it stays readable over the lines.
  function values(s,c,{w,pw,ph,xa,xb,ya,yb,tone,hiI,loI,inA,inB,X}){
    const right=PAD.l+pw,halo='stroke="var(--paper)" stroke-width="4" paint-order="stroke" stroke-linejoin="round"';
    const lab=(x,y,anchor,text,cls,fill)=>`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="${cls}"${fill?` fill="${fill}"`:''} ${halo}>${text}</text>`;
    const startTag=(hiI===sel.a?'高 ':loI===sel.a?'低 ':'')+md(c.from)+' '+num(c.start,s),endTag=(hiI===sel.b?'高 ':loI===sel.b?'低 ':'')+md(c.to)+' '+num(c.end,s);
    const crowded=hiI!==sel.a&&hiI!==sel.b&&Math.abs(X(hiI)-xa)<110,sy=!crowded&&ya-12>12?ya-12:Math.min(PAD.t+ph-4,ya+20),sAnchor=xa<PAD.l+70?'start':xa>right-70?'end':'middle';
    const gutter=xb>right-50,ey=Math.min(PAD.t+ph-4,Math.max(PAD.t+10,yb+(c.diff<0?16:-10)));
    const room=inA&&inB&&xb-xa>130&&Math.abs(yb-ya)>30,cy=room?(ya+yb)/2+4:14;
    return(inA?lab(sAnchor==='start'?Math.max(PAD.l,xa-4):sAnchor==='end'?xa+4:xa,sy,sAnchor,startTag,'rc-val'):'')+
      (inB?(gutter?lab(w-PAD.r+6,yb+4,'start',num(c.end,s),'rc-val',tone)+lab(xb-8,ey,'end',md(c.to),'rc-val'):lab(xb+9,yb+4,'start',endTag,'rc-val',tone)):'')+
      lab(room?xb-8:w-4,cy,'end',change(s,c),'rc-chg',tone);
  }
  // "49,968 − 41,513 = 8,455（跌 16.92%）" for a fall; a rise reads end − start. Ratios read in percentage points.
  function sentence(s,c){
    const word=c.diff>0?s.up:c.diff<0?s.down:'持平',cls=c.diff>0?'up':c.diff<0?'down':'';
    const expr=c.diff<0?`${num(c.start,s)} − ${num(c.end,s)} = `:`${num(c.end,s)} − ${num(c.start,s)} = `;
    if(s.mode!=='pct')return`${expr}<strong class="${cls}">${fmt(Math.abs(c.diff),s.digits)} ${s.unit}</strong>（${word}）`;
    const pct=c.pct==null?'—':fmt(Math.abs(c.pct)*100,2)+'%';
    return`${expr}<strong class="${cls}">${fmt(Math.abs(c.diff),s.digits)} ${s.unit}</strong>（${word} <strong class="${cls}">${pct}</strong>）`;
  }
  function paintSlots(){
    for(const box of sec.querySelectorAll('.rc-slot')){
      const k=box.dataset.slot,id=slots[k],body=box.querySelector('.rc-slot-body');
      box.classList.toggle('filled',!!id);box.querySelector('.rc-slot-clear').hidden=!id;
      body.innerHTML=id?`<b>${CompareSeries[id].title}</b><small>拖入其他卡片可替換</small>`:`<b>拖曳卡片到這裡</b><small>${k==='a'?'第一張':'第二張'}卡片</small>`;
    }
    sec.classList.toggle('rc-ready',ready());
    document.querySelectorAll('#factorRail [data-trend]').forEach(card=>{const k=Object.keys(slots).find(x=>slots[x]===card.dataset.trend);card.dataset.compareSlot=k?k.toUpperCase():'';const g=card.querySelector('.compare-grip');if(g)g.textContent=k?'已放入 '+k.toUpperCase():'拖到下方比較'});
  }
  function paint(){
    paintSlots();
    if(!ready()){result.innerHTML='';hint.textContent='';return}
    const win=view.length>1?windowVp():null;
    sec.querySelectorAll('[data-rc-range]').forEach(b=>{const on=b.dataset.rcRange===rangeKey()&&!!win&&SLOTS.every(s=>vp[s.key]?.from===win.from&&vp[s.key]?.to===win.to);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
    for(const s of SERIES)plots[s.key].title.textContent=s.tag+'　'+s.title;
    if(view.length<2||!sel){result.innerHTML='<p class="small">資料讀取中，或兩張卡片的共同日期不足兩天。</p>';for(const s of SLOTS){plots[s.key].host.innerHTML='';plots[s.key].ends.textContent=''}return}
    // Bars compare the two moves on one scale, so they appear only when both read in % (a percentage-point or net-flow
    // change has no common scale with a % move).
    const bars=SERIES.every(s=>s.mode==='pct'),live=sel,cs=SERIES.map(s=>RC.change(view,live,s.key)),bar=(s,c)=>s.mode==='pct'?Math.abs(c.pct||0):0,max=Math.max(...SERIES.map((s,k)=>bar(s,cs[k])),.0001);
    result.innerHTML=`<p class="rc-period">${cs[0].from} → ${cs[0].to}<span>${cs[0].days} 個共同日期</span></p>`+SERIES.map((s,k)=>{const c=cs[k];return`<div class="rc-row"><span class="rc-tag">${s.tag}</span><div><b>${s.title}</b><p>${sentence(s,c)}</p>${(()=>{const p=RC.peakInside(view,live,s.key);return p?`<small class="rc-peak">區間內最高 ${md(p.from)} ${num(p.start,s)}，至終點 ${sentence(s,p)}</small>`:''})()}</div>${bars?`<i class="rc-bar" aria-hidden="true"><i class="${c.diff>=0?'up-bg':'down-bg'}" style="width:${(bar(s,c)/max*100).toFixed(1)}%"></i></i>`:'<i aria-hidden="true"></i>'}</div>`}).join('')+
      (()=>{if(SERIES.some(s=>s.mode!=='pct'))return'';const r=RC.ratio(cs[0],cs[1]);return r==null?'':`<p class="small rc-ratio">B 的變動幅度約為 A 的 <b>${fmt(Math.abs(r),2)}</b> 倍${r<0?'，兩者方向相反':''}。</p>`})();
    result.classList.toggle('rc-nobar',!bars);
    hint.textContent=picking!=null?`起點已定住：${view[picking].date}。往右移到終點後點一下確認，Esc 取消。`:'';sec.classList.toggle('rc-picking',picking!=null);
    const key=[slots.a,slots.b,view.length,view[0].date,view.at(-1).date].join('|'),rise=key!==lastPlotKey;
    lastPlotKey=key;
    for(const [k,s] of SERIES.entries()){const p=plots[s.key],w=Math.max(260,Math.round(p.host.clientWidth||charts.clientWidth/2||520)),c=cs[k],v=vp[s.key];
      p.host.innerHTML=svgFor(s,w,rise);p.hit.style.left=PAD.l+'px';p.hit.style.right=PAD.r+'px';
      const where=sel.b<v.from?'◀ 選取區間在左側':sel.a>v.to?'選取區間在右側 ▶':sel.a<v.from?'◀ 起點在左側':sel.b>v.to?'終點在右側 ▶':'';p.span.textContent=`${ymd(view[v.from].date)} – ${ymd(view[v.to].date)}`+(where?' · '+where:'');
      p.ends.innerHTML=`<span>起 ${md(c.from)}　${num(c.start,s)}</span><span class="${c.diff>0?'up':c.diff<0?'down':''}">終 ${md(c.to)}　${num(c.end,s)}</span>`}
    const [ia,ib]=sec.querySelectorAll('[data-rc-end]');for(const input of [ia,ib]){input.max=String(view.length-1)}ia.value=String(sel.a);ib.value=String(sel.b);
    ia.nextElementSibling.textContent=view[sel.a].date;ib.nextElementSibling.textContent=view[sel.b].date;lastWidth=charts.clientWidth;
  }
  // Pointer x to a day inside that chart's own visible window.
  const at=(e,hit)=>{const v=vp[hit.dataset.rcPlot],r=hit.getBoundingClientRect(),n=v.to-v.from;return Math.max(v.from,Math.min(v.to,v.from+Math.round((e.clientX-r.left)/Math.max(1,r.width)*n)))};
  // Crosshair: one vertical line per chart at the same day (when that day is inside the chart's view).
  function cross(i){for(const sr of SERIES){const p=plots[sr.key],c=p.cross,v=vp[sr.key];if(i==null||view.length<2||!v||i<v.from||i>v.to){c.hidden=true;continue}
    const pw=p.host.clientWidth-PAD.l-PAD.r,x=PAD.l+(i-v.from)*pw/Math.max(1,v.to-v.from),label=c.firstChild;c.hidden=false;c.style.left=x+'px';
    label.textContent=md(view[i].date)+'　'+num(view[i][sr.key],sr);label.classList.toggle('flip',x>p.host.clientWidth*.6)}}
  function lockStart(i){const n=view.length;if(n<2)return;before=sel;picking=Math.min(i,n-2);sel={a:picking,b:picking+1};paint()}
  function commit(i){const n=view.length;sel=RC.clampSel(n,picking,i);picking=null;before=null;paint()}
  function preview(i){if(picking==null)return;const b=Math.max(picking+1,Math.min(view.length-1,i));if(b!==sel.b){sel={a:picking,b};schedule()}}
  // Zoom one chart around a day, keeping that day under the pointer.
  function zoom(key,factor,anchor){const v=vp[key],span=v.to-v.from,next=Math.max(Math.min(MIN_SPAN,view.length-1),Math.min(view.length-1,Math.round(span*factor)));if(next===span)return;
    const at=anchor??Math.round((v.from+v.to)/2),ratio=span?(at-v.from)/span:.5;vp[key]=clampVp(at-ratio*next,at-ratio*next+next);schedule()}
  charts.addEventListener('wheel',e=>{const hit=e.target.closest('[data-rc-plot]');if(!hit||view.length<2)return;e.preventDefault();zoom(hit.dataset.rcPlot,e.deltaY<0?.8:1.25,at(e,hit))},{passive:false});
  // Dragging pans that chart; a press that does not move stays a click (end point) or part of a double-click (start).
  charts.addEventListener('pointerdown',e=>{const hit=e.target.closest('[data-rc-plot]');if(!hit||view.length<2||e.button>0)return;const key=hit.dataset.rcPlot;pan={key,x:e.clientX,v:{...vp[key]},moved:false,id:e.pointerId,hit}});
  charts.addEventListener('pointermove',e=>{const hit=e.target.closest('[data-rc-plot]');
    if(pan&&e.pointerId===pan.id){const dx=e.clientX-pan.x;if(!pan.moved&&Math.abs(dx)>5){pan.moved=true;try{pan.hit.setPointerCapture(e.pointerId)}catch{}pan.hit.classList.add('panning')}
      if(pan.moved){const r=pan.hit.getBoundingClientRect(),span=pan.v.to-pan.v.from,shift=Math.round(-dx/Math.max(1,r.width)*span);vp[pan.key]=clampVp(pan.v.from+shift,pan.v.to+shift);schedule();return}}
    if(!hit||view.length<2)return;const i=at(e,hit);cross(i);preview(i)});
  charts.addEventListener('pointerleave',()=>{if(picking==null&&!pan)cross(null)});
  charts.addEventListener('dblclick',e=>{const hit=e.target.closest('[data-rc-plot]');if(!hit)return;e.preventDefault();lockStart(at(e,hit));cross(at(e,hit))});
  // A double-tap is detected by hand: two taps within 350 ms and 30 px. While a start is locked, a tap or click
  // to its right fixes the end; one to its left does nothing, since the start stays on the left.
  const release=e=>{const p=pan;pan=null;if(p){p.hit.classList.remove('panning');if(p.moved)return}
    const hit=e.target.closest('[data-rc-plot]');if(!hit||view.length<2||e.type==='pointercancel')return;const i=at(e,hit);
    if(e.pointerType!=='mouse'){const now=e.timeStamp;if(now-lastTap.t<350&&Math.abs(e.clientX-lastTap.x)<30){lastTap={t:0,x:0};lockStart(i);cross(i);return}lastTap={t:now,x:e.clientX}}
    cross(i);if(picking!=null&&i>picking)commit(i)};
  charts.addEventListener('pointerup',release);charts.addEventListener('pointercancel',release);
  charts.addEventListener('click',e=>{const b=e.target.closest('[data-rc-zoom]');if(!b||view.length<2)return;const key=b.dataset.rcChart;
    if(b.dataset.rcZoom==='reset'){vp[key]=windowVp();schedule()}else zoom(key,b.dataset.rcZoom==='in'?.6:1.6)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking!=null){picking=null;sel=before||sel;before=null;cross(null);paint()}});
  // Sliders give keyboard and fine-touch control; the start can never pass the end.
  sec.querySelector('.range-compare-sliders').addEventListener('input',e=>{const input=e.target.closest('[data-rc-end]');if(!input||!sel)return;const v=Number(input.value),n=view.length;
    sel=input.dataset.rcEnd==='a'?RC.clampSel(n,Math.min(v,sel.b-1),sel.b):RC.clampSel(n,sel.a,Math.max(v,sel.a+1));paint()});
  sec.querySelector('.range-compare-tools').addEventListener('click',e=>{const r=e.target.closest('[data-rc-range]'),p=e.target.closest('[data-rc-preset]');if(!ready()||view.length<2)return;
    if(r){settings.compareRange=r.dataset.rcRange;save();setBoth(windowVp());const q=presetIn('peakToLatest');if(q&&!(sel.a>=vp.a.from&&sel.b<=vp.a.to))sel=q;paint()}if(p){const q=presetIn(p.dataset.rcPreset);if(q){sel=q;paint()}}});

  /* ---- Filling the boxes: drag a card's handle down into A or B, or tap the handle ---- */
  // Not saved: the boxes start empty on every visit, so the comparison appears only when the reader asks for it.
  function assign(slot,id){
    if(!CompareSeries[id])return;
    const other=slot==='a'?'b':'a';if(slots[other]===id)slots[other]=slots[slot];
    slots[slot]=id;picking=null;rebuild(true);
    if(ready())requestAnimationFrame(()=>sec.querySelector('.rc-slots').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));
  }
  // A tap fills the next empty box; once both are full, it replaces B.
  function nextSlot(id){return slots.a===id||slots.b===id?null:!slots.a?'a':'b'}
  sec.querySelector('.rc-slots').addEventListener('click',e=>{const b=e.target.closest('[data-slot-clear]');if(b){slots[b.dataset.slotClear]=null;rebuild(true)}});
  function grips(){
    for(const card of document.querySelectorAll('#factorRail [data-trend]')){
      if(card.querySelector('.compare-grip')||!CompareSeries[card.dataset.trend])continue;
      const g=document.createElement('button');g.type='button';g.className='compare-grip';g.textContent='拖到下方比較';
      g.setAttribute('aria-label',(card.querySelector('h4')?.textContent||'')+'：加入下方區間比較（拖曳到 A 或 B 框，或點一下依序放入）');
      card.append(g);
    }
    paintSlots();
  }
  let drag=null;
  function slotAt(x,y){const el=document.elementFromPoint(x,y);return el?.closest?.('.rc-slot')||null}
  function moveGhost(e){
    drag.ghost.style.transform=`translate(${e.clientX+12}px,${e.clientY+12}px)`;
    const over=slotAt(e.clientX,e.clientY);sec.querySelectorAll('.rc-slot').forEach(b=>b.classList.toggle('drop-over',b===over));
    // Near the window edge the page scrolls, so a card at the top can reach the boxes below.
    const edge=80,v=innerHeight;drag.vy=e.clientY>v-edge?Math.min(24,(e.clientY-(v-edge))/3):e.clientY<edge?-Math.min(24,(edge-e.clientY)/3):0;drag.last=e;
  }
  function tick(){if(!drag)return;if(drag.active&&drag.vy){scrollBy(0,drag.vy);if(drag.last)moveGhost(drag.last)}drag.raf=requestAnimationFrame(tick)}
  document.addEventListener('pointerdown',e=>{
    const g=e.target.closest?.('.compare-grip');if(!g||e.button>0)return;
    e.preventDefault();e.stopPropagation();
    drag={id:g.closest('[data-trend]').dataset.trend,x:e.clientX,y:e.clientY,active:false,pointer:e.pointerId,vy:0};try{g.setPointerCapture(e.pointerId)}catch{}
    drag.raf=requestAnimationFrame(tick);
  },true);
  document.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.pointer)return;
    if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){
      drag.active=true;sec.classList.add('rc-dragging');document.body.classList.add('compare-dragging');
      const ghost=document.createElement('div');ghost.className='compare-ghost';ghost.textContent=CompareSeries[drag.id].title;document.body.append(ghost);drag.ghost=ghost;
    }
    if(drag.active){e.preventDefault();moveGhost(e)}
  },{passive:false});
  const endDrag=e=>{
    if(!drag||e.pointerId!==drag.pointer)return;const d=drag;drag=null;cancelAnimationFrame(d.raf);
    sec.classList.remove('rc-dragging');document.body.classList.remove('compare-dragging');sec.querySelectorAll('.rc-slot').forEach(b=>b.classList.remove('drop-over'));d.ghost?.remove();
    if(e.type==='pointercancel')return;
    if(d.active){const box=slotAt(e.clientX,e.clientY);if(box)assign(box.dataset.slot,d.id);return}
    const slot=nextSlot(d.id);if(slot)assign(slot,d.id);else sec.querySelector('.rc-slots').scrollIntoView({behavior:'smooth',block:'start'});
  };
  document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
  // Keyboard: Enter or Space on the handle behaves like a tap.
  document.addEventListener('keydown',e=>{const g=e.target.closest?.('.compare-grip');if(!g||!['Enter',' '].includes(e.key))return;e.preventDefault();e.stopPropagation();const id=g.closest('[data-trend]').dataset.trend,slot=nextSlot(id);if(slot)assign(slot,id)},true);
  // The handle never opens the card's detail dialog.
  document.addEventListener('click',e=>{if(e.target.closest?.('.compare-grip')){e.stopPropagation();e.preventDefault()}},true);

  // Any refreshed series rebuilds the comparison (kept dates stay chosen).
  const later=()=>{if(!ready())return;clearTimeout(window.__rcRebuild);window.__rcRebuild=setTimeout(()=>rebuild(),80)};
  {const prev=computeMktMargin;computeMktMargin=function(...a){const out=prev(...a);later();return out}}
  {const prev=computeBrent;computeBrent=function(...a){const out=prev(...a);later();return out}}
  {const prev=computeBank;computeBank=function(...a){const out=prev(...a);later();return out}}
  {const prev=computeFx;computeFx=function(...a){const out=prev(...a);later();return out}}
  for(const ev of ['vix-updated','sentiment-updated','market-lookback'])document.addEventListener(ev,later);
  window.addEventListener('resize',()=>{if(Math.abs(charts.clientWidth-lastWidth)>30){clearTimeout(window.__rcResize);window.__rcResize=setTimeout(paint,120)}});
  new MutationObserver(grips).observe($('factorRail'),{childList:true});
  grips();rebuild();
})();

/* PCR and retail long/short detail views inside the market card dialog: sub-indicators, ranges, a low-to-high gauge
   with a plain reading, the TAIEX coloured by the ratio, and daily bars against a reader-set red/green line. */
(()=>{
  const SC=SentimentCore,rail=$('factorRail');
  // The two TAIFEX cards sit after VIX, the other sentiment reading.
  rail.append($('pcrTile'),$('retailTile'));
  const view=settings.sentimentView&&typeof settings.sentimentView==='object'?settings.sentimentView:{};
  for(const key of ['pcr','retail']){const v=view[key]||{};view[key]={metric:SC.METRICS[key].some(m=>m.id===v.metric)?v.metric:SC.METRICS[key][0].id,range:SC.RANGES.some(r=>r[0]===v.range)?v.range:'3m'}}
  settings.sentimentView=view;
  const NAMES={pcr:{primary:'未平倉 PCR',days:()=>pcrDays,thresholdKey:'pcrThreshold',unit:'%'},retail:{primary:'散戶多空比',days:()=>retailDays,thresholdKey:'retailThreshold',unit:'%'}};
  const md=d=>Number(d.slice(5,7))+'/'+d.slice(8,10);
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const base=renderFactorTrend;
  renderFactorTrend=function(...args){const key=factorTrendKey;if(key!=='pcr'&&key!=='retail'){trendPanel.classList.remove('sentiment-trend');return base(...args)}paint(key)};
  let hoverIndex=null;
  function paint(key){
    const v=view[key],m=SC.metric(key,v.metric),all=NAMES[key].days(),rows=SC.range(all,v.range),threshold=Number(settings[NAMES[key].thresholdKey]);
    trendPanel.replaceChildren();trendPanel.classList.add('sentiment-trend');
    const head=document.createElement('div');head.className='factor-trend-head sentiment-head';
    head.innerHTML=`<div class="segment" role="group" aria-label="指標">${SC.METRICS[key].map(x=>`<button type="button" data-smetric="${x.id}" class="${x.id===m.id?'active':''}" aria-pressed="${x.id===m.id}">${x.label}</button>`).join('')}</div>`+
      `<div class="segment" role="group" aria-label="區間">${SC.RANGES.map(([id,label])=>`<button type="button" data-srange="${id}" class="${id===v.range?'active':''}" aria-pressed="${id===v.range}">${label}</button>`).join('')}</div>`;
    head.addEventListener('click',e=>{const a=e.target.closest('[data-smetric]'),b=e.target.closest('[data-srange]');if(a)v.metric=a.dataset.smetric;if(b)v.range=b.dataset.srange;if(a||b){hoverIndex=null;save();paint(key)}});
    trendPanel.append(head);
    if(rows.length<2){const p=document.createElement('p');p.className='small';p.textContent='期交所資料讀取中，或所選區間資料不足。';trendPanel.append(p);return}
    const values=rows.map(r=>r[m.id]),z=SC.zone(values),lo=values.indexOf(z.low),hi=values.indexOf(z.high),last=rows.at(-1);
    const score=$(key+'Score')?.textContent||'—';
    // Gauge: the range's low on the left, its high on the right, today's value as the marker.
    const gauge=document.createElement('section');gauge.className='sentiment-gauge';
    gauge.innerHTML=`<div class="sg-top"><div><small>${esc(m.long)} · ${last.date}</small><strong class="sg-value">${m.format(z.last)}</strong></div>`+
      `<div class="sg-zone sg-${z.segment}"><small>位於所選區間</small><b>${z.label}</b></div><div class="sg-score"><small>水位（0–5 分）</small><b>${esc(score)}</b></div></div>`+
      `<div class="sg-rail" role="img" aria-label="${esc(m.long)}：區間低 ${m.format(z.low)}，高 ${m.format(z.high)}，目前 ${m.format(z.last)}，${z.label}"><i class="sg-low"></i><i class="sg-mid"></i><i class="sg-high"></i><b style="left:${(z.pos*100).toFixed(1)}%"></b></div>`+
      `<div class="sg-ends"><span>低 ${m.format(z.low)}<small>${md(rows[lo].date)}</small></span><span>均值 ${m.format(z.mean)}</span><span>高 ${m.format(z.high)}<small>${md(rows[hi].date)}</small></span></div>`+
      `<p class="sg-reading">${esc(SC.reading(key,m.id,z))}</p><p class="small sg-caveat">以上是市場常見解讀，只描述目前在所選區間的相對位置，不是預測或投資建議。水位分數依「參考筆數」與計分方向計算，可在上方設定調整。</p>`;
    trendPanel.append(gauge);
    // Threshold: ratios use the reader's line; counts use the range average; the institutional net uses zero.
    const tools=document.createElement('div');tools.className='sentiment-tools';
    const ratioLine=m.threshold==='user';
    tools.innerHTML=`<label>紅綠分界<input type="number" step="${key==='pcr'?1:0.5}" value="${threshold}" data-sthreshold aria-label="${NAMES[key].primary}紅綠分界">${NAMES[key].unit}</label>`+
      `<p class="small">加權指數線：每日${NAMES[key].primary}高於或等於分界畫紅色，低於畫綠色。${ratioLine?'下方長條同一條分界。':m.threshold==='zero'?'下方長條以零為界：正值紅、負值綠。':'下方長條以區間均值為界：高於均值紅、低於綠。'}</p>`;
    tools.querySelector('input').addEventListener('change',e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||key==='pcr'&&n<=0)return;settings[NAMES[key].thresholdKey]=n;save();paint(key)});
    trendPanel.append(tools);
    trendPanel.append(charts(key,rows,m,threshold));
  }
  function charts(key,rows,m,threshold){
    const wrap=document.createElement('section');wrap.className='sentiment-charts';
    const W=Math.max(280,Math.round(trendPanel.clientWidth||640)),phone=innerWidth<600,HA=phone?220:270,HB=phone?160:200,P={l:10,r:phone?54:70,t:12,b:24},pw=W-P.l-P.r;
    const idx=new Map(market.filter(x=>!x.intraday).map(x=>[x.date,x.index])),primary=key==='pcr'?'oiRatio':'ratio';
    const X=i=>P.l+(rows.length>1?i*pw/(rows.length-1):pw/2);
    // Chart A: TAIEX close, each segment coloured by that day's primary ratio against the line.
    const ix=rows.map(r=>idx.get(r.date)),iv=ix.filter(Number.isFinite);
    let a='';
    if(iv.length>1){
      let lo=Math.min(...iv),hi=Math.max(...iv);const pad=(hi-lo)*.08||hi*.01;lo-=pad;hi+=pad;const Y=v=>P.t+(hi-v)/(hi-lo)*(HA-P.t-P.b);
      let segs='';for(let i=1;i<rows.length;i++){if(!Number.isFinite(ix[i])||!Number.isFinite(ix[i-1]))continue;segs+=`<line x1="${X(i-1).toFixed(1)}" y1="${Y(ix[i-1]).toFixed(1)}" x2="${X(i).toFixed(1)}" y2="${Y(ix[i]).toFixed(1)}" stroke="${SC.side(rows[i][primary],threshold)==='rise'?RISE:FALL}" stroke-width="2.2" stroke-linecap="round"/>`}
      const dots=rows.length<=70?rows.map((r,i)=>Number.isFinite(ix[i])?`<circle cx="${X(i).toFixed(1)}" cy="${Y(ix[i]).toFixed(1)}" r="2.4" fill="${SC.side(r[primary],threshold)==='rise'?RISE:FALL}"/>`:'').join(''):'';
      const hiI=ix.indexOf(Math.max(...iv)),loI=ix.indexOf(Math.min(...iv));
      a=`<svg class="sc-plot" data-tide-plot viewBox="0 0 ${W} ${HA}" width="${W}" height="${HA}" role="img" aria-label="加權指數，依${NAMES[key].primary}著色：紅＝高於或等於 ${threshold}${NAMES[key].unit}，綠＝低於">`+
        ticks(rows,X,HA,P)+`<g data-tide-base="${HA-P.b}">${segs}${dots}</g>`+
        `<text x="${W-P.r+6}" y="${Y(ix[hiI])+4}" class="rc-axis">${fmt(ix[hiI],0)}</text><text x="${W-P.r+6}" y="${Y(ix[loI])+4}" class="rc-axis">${fmt(ix[loI],0)}</text>`+
        `<line class="sc-cross" x1="0" x2="0" y1="${P.t}" y2="${HA-P.b}" visibility="hidden"/></svg>`;
    }else a='<p class="small">加權指數資料讀取中。</p>';
    // Chart B: the selected metric as daily bars against its line.
    const vals=rows.map(r=>r[m.id]),line=SC.line(m,vals,threshold),lo=Math.min(0,...vals,line),hi=Math.max(0,...vals,line),Y=v=>P.t+(hi-v)/((hi-lo)||1)*(HB-P.t-P.b),bw=Math.max(1,pw/rows.length*.72);
    const barsSvg=rows.map((r,i)=>{const v=r[m.id],y0=Y(0),y=Y(v);return`<rect x="${(X(i)-bw/2).toFixed(1)}" y="${Math.min(y,y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.6,Math.abs(y0-y)).toFixed(1)}" fill="${SC.side(v,line)==='rise'?RISE:FALL}" opacity=".85"/>`}).join('');
    const lineLabel=m.threshold==='mean'?'均值 '+m.format(line):m.threshold==='zero'?'零軸':'分界 '+m.format(line);
    const b=`<svg class="sc-plot" viewBox="0 0 ${W} ${HB}" width="${W}" height="${HB}" role="img" aria-label="${m.long}每日長條，${lineLabel}以上紅色、以下綠色">`+ticks(rows,X,HB,P)+barsSvg+
      `<line x1="${P.l}" x2="${P.l+pw}" y1="${Y(line).toFixed(1)}" y2="${Y(line).toFixed(1)}" class="sc-line"/><text x="${W-P.r+6}" y="${Y(line)+4}" class="rc-axis sc-line-label">${lineLabel}</text>`+
      `<text x="${W-P.r+6}" y="${Y(Math.max(...vals))+4}" class="rc-axis">${m.format(Math.max(...vals))}</text>`+
      `<line class="sc-cross" x1="0" x2="0" y1="${P.t}" y2="${HB-P.b}" visibility="hidden"/></svg>`;
    wrap.innerHTML=`<div class="sc-readout" aria-live="off"></div><figure class="sc-figure"><figcaption><b>加權指數</b><span>線段顏色＝當日${NAMES[key].primary}${'與分界 '+threshold+NAMES[key].unit}比較</span><span class="sc-legend"><i class="up-bg"></i>高於或等於<i class="down-bg"></i>低於</span></figcaption>${a}</figure>`+
      `<figure class="sc-figure"><figcaption><b>${esc(m.long)}</b><span>每日長條 · ${lineLabel}</span></figcaption>${b}</figure><div class="sc-hit" aria-hidden="true"></div>`;
    const readout=wrap.querySelector('.sc-readout');
    const show=i=>{const r=rows[i];if(!r)return;const parts=[`<strong>${r.date}</strong>`,Number.isFinite(ix[i])?`加權指數 ${fmt(ix[i],2)}`:'加權指數 —'];
      parts.push(`${NAMES[key].primary} <span class="${SC.side(r[primary],threshold)==='rise'?'up':'down'}">${SC.metric(key,primary).format(r[primary])}</span>`);
      if(m.id!==primary)parts.push(`${m.label} ${m.format(r[m.id])}`);
      if(key==='pcr')parts.push(`賣權 ${fmt(r.putOi,0)}／買權 ${fmt(r.callOi,0)} 口`);else parts.push(`法人多 ${fmt(r.long,0)}／空 ${fmt(r.short,0)} 口`);
      readout.innerHTML=parts.join('<span class="sc-sep">·</span>');
      wrap.querySelectorAll('.sc-cross').forEach(l=>{l.setAttribute('x1',X(i));l.setAttribute('x2',X(i));l.setAttribute('visibility',i===rows.length-1&&hoverIndex==null?'hidden':'visible')})};
    show(hoverIndex??rows.length-1);
    // Pointer anywhere over the two plots picks the day under it; leaving returns to the latest day.
    const pick=e=>{const svg=e.target.closest?.('svg.sc-plot');if(!svg)return null;const box=svg.getBoundingClientRect(),x=(e.clientX-box.left)*W/box.width;return Math.max(0,Math.min(rows.length-1,Math.round((x-P.l)/Math.max(1,pw)*(rows.length-1))))};
    wrap.addEventListener('pointermove',e=>{const i=pick(e);if(i==null)return;hoverIndex=i;show(i)});
    wrap.addEventListener('pointerleave',()=>{hoverIndex=null;show(rows.length-1)});
    wrap.querySelector('.sc-hit').remove();
    return wrap;
  }
  function ticks(rows,X,H,P){
    const long=rows.length>520,marks=[];rows.forEach((r,i)=>{if(i&&r.date.slice(0,long?4:7)!==rows[i-1].date.slice(0,long?4:7))marks.push(i)});
    if(rows.length<=12)return rows.map((r,i)=>i%2?'':`<text x="${X(i)}" y="${H-7}" text-anchor="middle" class="rc-tick">${md(r.date)}</text>`).join('');
    const step=Math.max(1,Math.ceil(marks.length/Math.max(2,Math.floor((X(rows.length-1)-X(0))/70))));
    return marks.filter((_,k)=>k%step===0).map(i=>{const d=rows[i].date,label=long||d.slice(5,7)==='01'?d.slice(0,4):Number(d.slice(5,7))+'月';return`<line x1="${X(i)}" x2="${X(i)}" y1="${P.t}" y2="${H-P.b}" class="rc-grid"/><text x="${X(i)}" y="${H-7}" text-anchor="middle" class="rc-tick">${label}</text>`}).join('');
  }
  window.addEventListener('resize',()=>{if(factorTrendKey==='pcr'||factorTrendKey==='retail'){clearTimeout(window.__sentResize);window.__sentResize=setTimeout(()=>paint(factorTrendKey),150)}});
})();

/* The overview heading wraps between its two phrases, never inside one (phones put "9 / 9" beside it). */
(()=>{
  const h=document.querySelector('#marketOverview h3');
  if(h&&h.textContent.trim()==='背景不同，讀數各有節奏。')h.innerHTML='<span class="phrase">背景不同，</span><span class="phrase">讀數各有節奏。</span>';
})();

/* PCR and the retail long/short ratio in the ETF page's weighted score. They are appended after every existing factor
   (including 籌碼共振), so a saved weight plan keeps its meaning and simply gives the two new factors no weight. Each
   score follows the direction chosen in the card dialog; no data means the combined score pauses, never a zero. */
(()=>{
  const list=$('weights').querySelector('.weights');
  for(const f of [{id:'wPcr',setting:'pcrWeight',label:'選擇權 PCR（未平倉）',name:'選擇權 PCR',key:'pcr'},{id:'wRetail',setting:'retailWeight',label:'散戶多空比（小台）',name:'散戶多空比',key:'retail'}]){
    const row=document.createElement('div');row.className='weight';
    row.innerHTML=`<label for="${f.id}">${f.label}</label><input id="${f.id}" type="range" min="0" max="100" step="1" value="0"><input class="w-num" type="number" min="0" max="100" step="1" data-for="${f.id}" aria-label="${f.label}權重數值"><output id="o${f.id.slice(1)}">0%</output>`;
    list.append(row);f.row=row;f.score=()=>directionScore(f.key);
    settings[f.setting]=Math.max(0,Math.min(100,Number(settings[f.setting])||0));
    const num=row.querySelector('.w-num');$(f.id).value=settings[f.setting];num.value=settings[f.setting];$(f.id).disabled=shareView;num.disabled=shareView;
    $(f.id).addEventListener('input',()=>{num.value=$(f.id).value;updateWeights()});
    num.addEventListener('input',e=>{$(f.id).value=Math.max(0,Math.min(100,Number(e.target.value)||0));updateWeights()});
    const wrap=document.createElement('div');wrap.className='weight-direction';makeDirection(f.key,wrap);row.append(wrap);
    EXTRA_FACTORS.push(f);
  }
  updateWeights();
})();

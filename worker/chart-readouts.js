/* Directional labels preserve missing values and the original measurement unit. */
const MarketReadout=(()=>{
  const words={flow:['買超','賣超','買賣持平'],cumulative:['區間累計買超','區間累計賣超','區間累計持平'],margin:['融資增加','融資減少','融資持平'],pnl:['獲利','虧損','損益兩平'],comparison:['領先定投','落後定投','與定投持平']};
  function state(value,domain='flow',unit='億元',decimals=2){
    if(!Number.isFinite(value))return{label:'未取得資料',color:'var(--muted)',className:''};
    const rounded=Number(value.toFixed(decimals))||0,sign=Math.sign(rounded),labels=words[domain]||words.flow;
    return{label:labels[sign>0?0:sign<0?1:2]+' '+(sign>0?'+':'')+rounded.toLocaleString('zh-TW',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})+(unit?' '+unit:''),color:sign>0?'#f43f5e':sign<0?'#10b981':'var(--muted)',className:sign>0?'up':sign<0?'down':''};
  }
  function cleanText(value){return String(value??'').replace(/[\p{Emoji_Presentation}\uFE0F\u200D]/gu,'').replace(/[\u2728\u2B50\u2726\u2727\u2605\u2606]/gu,'')}
  return{state,cleanText};
})();

/* Readouts are separate from animated plot layers and use the renderer's real coordinates. */
const ChartReadouts=(()=>{
  const miniData=new Map(),groups=new Map();let serial=0;
  function hud(host,{mini=false,native=false}={}){
    host.classList.add('readout-host');if(native)host.classList.add('native-readout-host');
    const header=document.createElement('div'),float=document.createElement('div');
    header.className='chart-live-readout'+(mini?' mini-live-readout':'');
    header.id='chartReadout'+(++serial);header.setAttribute('aria-live','off');
    float.className='chart-floating-readout';float.hidden=true;
    if(mini)header.hidden=true;
    host.prepend(header);host.append(float);
    function fill(node,date,rows){
      const time=document.createElement('strong');time.textContent=date;node.replaceChildren(time);
      for(const row of rows){const line=document.createElement('span');line.textContent=(row.label?row.label+'　':'')+row.value;if(row.color)line.style.color=row.color;node.append(line)}
    }
    return{header,show(date,rows,point){
      header.hidden=false;header.dataset.date=date;fill(header,date,rows);fill(float,date,rows);
      if(!point||mini){float.hidden=true;return}
      float.hidden=false;
      const width=host.clientWidth,w=Math.min(float.offsetWidth||230,Math.max(80,width-16));
      float.style.maxWidth=Math.max(80,width-16)+'px';
      float.style.left=Math.max(8,Math.min(width-w-8,point.x+18+w<width?point.x+18:point.x-w-18))+'px';
      float.style.top=Math.max(4,Math.min(host.clientHeight-float.offsetHeight-4,point.y+18))+'px';
    },hide(){float.hidden=true},
    // Large charts: the readout overlays the chart's top band, so it is shown only while the crosshair is on the chart.
    clear(){float.hidden=true;header.hidden=true}};
  }
  function svg({host,plot,dates,x,height,read,group,onInspect,bars=[],mini=false}){
    const panel=hud(host,{mini}),NS='http://www.w3.org/2000/svg',line=document.createElementNS(NS,'line');
    line.setAttribute('class','readout-crosshair');line.setAttribute('y1',0);line.setAttribute('y2',height);line.setAttribute('visibility','hidden');plot.append(line);
    plot.setAttribute('tabindex','0');plot.setAttribute('aria-describedby',panel.header.id);
    let index=dates.length-1,previous=[],start=null,horizontal=false;
    function show(i,source='initial',point){
      index=Math.max(0,Math.min(dates.length-1,i));
      const date=dates[index];if(!date)return;
      panel.show(date,read(index),point);line.setAttribute('x1',x(index));line.setAttribute('x2',x(index));line.setAttribute('visibility','visible');
      for(const bar of previous)bar.classList.remove('readout-active-bar');
      previous=bars[index]||[];for(const bar of previous)bar.classList.add('readout-active-bar');
      if(source!=='initial'&&source!=='sync')onInspect?.(date,source);
      if(group&&source!=='initial'&&source!=='sync'){
        for(const entry of groups.get(group)||[]){if(!entry.host.isConnected){groups.get(group).delete(entry);continue}if(entry.host!==host)entry.inspect(date)}
      }
    }
    if(group){if(!groups.has(group))groups.set(group,new Set());groups.get(group).add({host,inspect(date){const i=dates.indexOf(date);if(i>=0)show(i,'sync')}})}
    function inspect(event,source){
      const box=plot.getBoundingClientRect(),hostBox=host.getBoundingClientRect(),px=(event.clientX-box.left)*plot.viewBox.baseVal.width/box.width;
      const first=x(0),step=dates.length>1?x(1)-first:1;
      show(Math.round((px-first)/step),source,{x:event.clientX-hostBox.left,y:event.clientY-hostBox.top});
    }
    plot.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};horizontal=false;inspect(e,'select')});
    plot.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch'&&!start)return;
      if(start&&Math.abs(e.clientX-start.x)>8&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)){
        horizontal=true;plot.setPointerCapture(e.pointerId);
        const card=host.closest('.matrix-card,.factor');if(card)card.dataset.scrubUntil=String(Date.now()+600);
      }
      if(e.pointerType==='touch'&&start&&!horizontal&&Math.abs(e.clientY-start.y)>8)return;
      inspect(e,'hover');
    });
    for(const type of ['pointerup','pointercancel'])plot.addEventListener(type,()=>{start=null;horizontal=false;if(type==='pointercancel')panel.hide()});
    // A mini plot's strip returns to the latest point when the pointer leaves, so it never sticks on an old day.
    plot.addEventListener('pointerleave',()=>{panel.hide();if(mini)show(dates.length-1,'sync')});
    plot.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End','Escape'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();
      show(e.key==='Home'?0:e.key==='End'||e.key==='Escape'?dates.length-1:index+(e.key==='ArrowLeft'?-1:1),'keyboard');
    });
    show(index);return panel;
  }
  // Charts with a synced crosshair (price, volume, indicators, backtest panes) are shown by the hovered chart only, so
  // when one readout clears, every large-chart readout clears with it instead of staying over the other charts' top band.
  const nativePanels=new Set();
  function native(host,chart,read){
    const panel=hud(host,{native:true});nativePanels.add(panel);
    const inspect=p=>{if(!p.time||!p.point){for(const other of nativePanels){if(other.header.isConnected)other.clear();else nativePanels.delete(other)}return}const date=typeof p.time==='string'?p.time:[p.time.year,String(p.time.month).padStart(2,'0'),String(p.time.day).padStart(2,'0')].join('-');const rows=read(date);if(rows?.length)panel.show(date,rows,p.point)};
    chart.subscribeCrosshairMove(inspect);
    return()=>{chart.unsubscribeCrosshairMove(inspect);nativePanels.delete(panel);panel.header.remove();host.querySelectorAll('.chart-floating-readout').forEach(n=>n.remove())};
  }
  function equity(host,chart,getResult){
    let source=null,index=new Map();
    return native(host,chart,date=>{
      const r=getResult();if(!r)return[];
      if(source!==r){source=r;index=new Map(r.series.map((p,i)=>[p.time,i]))}
      const i=index.get(date);if(i==null)return[];
      const a=r.series[i]?.value,d=r.dca.series[i]?.value,h=r.bh?.series[i]?.value,rows=[
        {label:'策略資產',value:fmt(a,2)+' 元'},{label:'定投資產',value:fmt(d,2)+' 元'}
      ];
      if(Number.isFinite(h))rows.push({label:'買進持有',value:fmt(h,2)+' 元'});
      const gap=MarketReadout.state(Number.isFinite(a)&&Number.isFinite(d)?a-d:null,'comparison','元',2);
      rows.push({value:gap.label,color:gap.color});return rows;
    });
  }
  function candles(host,chart,getRows){
    return native(host,chart,date=>{
      const rows=getRows(),i=rows.findIndex(b=>b.date===date),b=rows[i];if(!b)return[];
      const previous=rows[i-1],change=previous?b.close-previous.close:null;
      return[{label:'開／高',value:fmt(b.open,2)+'／'+fmt(b.high,2)},{label:'低／收',value:fmt(b.low,2)+'／'+fmt(b.close,2)},
        {label:'漲跌',value:change==null?'未取得比較日':(change>0?'+':'')+fmt(change,2)+'（'+fmt(change/previous.close*100,2)+'%）',color:change>0?'#f43f5e':change<0?'#10b981':null},
        {label:'成交量',value:fmt(b.volume/1000,1)+' 張'}];
    });
  }
  function registerMini(key,data){miniData.set(key,data);if(miniData.size>100)miniData.delete(miniData.keys().next().value)}
  function bindMini(root){
    for(const plot of root.querySelectorAll('svg[data-readout-key]:not([data-readout-bound])')){
      const data=miniData.get(plot.dataset.readoutKey);if(!data)continue;
      plot.dataset.readoutBound='true';miniData.delete(plot.dataset.readoutKey);
      const host=plot.parentElement,dates=data.rows.map(r=>r[0]),key=plot.closest('[data-trend]')?.dataset.trend,domain=key==='bank'?'flow':key==='margin'?'margin':null;
      svg({host,plot,dates,mini:true,x:i=>6+288*i/(dates.length-1),height:90,read:i=>{
        const value=data.rows[i][1],state=domain?MarketReadout.state(value,domain):null;
        return[{label:domain?'':'數值',value:state?.label||data.format(value),color:state?.color}];
      }});
    }
  }
  return{hud,svg,native,equity,candles,registerMini,bindMini};
})();

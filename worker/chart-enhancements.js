// Kept inside the client closure so the chart and data loaders share one state.
let chartRange=3,zoomBars=750,panOffset=0,loadedMonths=0,historyBusyGeneration=null,requestedMonths=0,rangeAwaitingHistory=false;
let showBollinger=false,showMACD=false,historyGeneration=0,historyMissing=0;

renderList=function(){
  const q=$('search').value.trim().toLocaleLowerCase('zh-TW');
  const matches=catalog.filter(e=>(type==='all'||e.type===type)&&(!q||`${e.code} ${e.name}`.toLocaleLowerCase('zh-TW').includes(q)));
  $('catalogNote').textContent=`證交所上市 ETF 名錄共 ${catalog.length} 檔；目前符合 ${matches.length} 檔。搜尋可輸入名稱或代號。`;
  $('etfList').replaceChildren();
  for(const e of matches.slice(0,q?60:24)){
    const b=document.createElement('button');b.type='button';b.className=e.code===selected?'selected':'';
    const strong=document.createElement('strong');strong.textContent=`${e.code} · ${e.name}`;
    const small=document.createElement('small');small.textContent=`${e.type==='active'?'主動型':'被動型'} · ${e.listingDate||'上市日期待查'}`;
    b.append(strong,small);b.addEventListener('click',()=>{selected=e.code;renderList();loadBars();$('etfName').scrollIntoView({behavior:'smooth',block:'center'})});$('etfList').append(b);
  }
  if(!matches.length)$('etfList').textContent='沒有符合的 ETF；請確認名稱或代號';
  else if(matches.length>(q?60:24)){const p=document.createElement('p');p.className='small';p.textContent=`顯示前 ${q?60:24} 檔，繼續輸入名稱或代號可縮小範圍。`;$('etfList').append(p)}
};
$('search').addEventListener('input',renderList);

const originalComputeFx=computeFx;
computeFx=function(){
  originalComputeFx();
  if(!fxPosition||!bars.length)return;
  const age=(Date.parse(bars.at(-1).date)-Date.parse(fxPosition.last.date))/86400000;
  if(age>14){fxPosition=null;$('fxScore').textContent='逾期';$('fxMeta').textContent='央行資料停留在 '+fx.at(-1).date+'，暫停計分'}
  else if(window.CHAOWEI_STATIC)$('fxMeta').textContent+=' · 每日快照';
};

function listingMonths(code){
  const e=catalog.find(x=>x.code===code),d=e?.listingDate;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return 120;
  const now=new Date(Date.now()+28800000),start=new Date(d+'T00:00:00Z');
  return Math.max(1,Math.min(120,(now.getUTCFullYear()-start.getUTCFullYear())*12+now.getUTCMonth()-start.getUTCMonth()+1));
}
function mergeBars(rows){const byDate=new Map([...bars,...rows].map(x=>[x.date,x]));bars=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))}
async function ensureHistory(months,code=selected,generation=historyGeneration){
  requestedMonths=Math.max(requestedMonths,Math.min(months,listingMonths(code)));
  if(!loadedMonths)return;
  if(historyBusyGeneration===generation)return;
  historyBusyGeneration=generation;
  try{
    while(loadedMonths<requestedMonths&&code===selected&&generation===historyGeneration){
      const count=Math.min(24,requestedMonths-loadedMonths),offset=loadedMonths;
      notice(`正在載入 ${code} 較早的歷史日 K（${offset+1}–${offset+count} 個月）…`);
      const res=await fetch(`/api/bars?code=${encodeURIComponent(code)}&offset=${offset}&count=${count}`),data=await res.json();
      if(code!==selected||generation!==historyGeneration)return;
      if(!res.ok)throw Error(data.error||`歷史分頁 HTTP ${res.status}`);
      mergeBars(data.bars);loadedMonths+=count;historyMissing+=data.missingMonths||0;
      computePosition();renderPosition();drawChart();updateWeights();
    }
    if(code===selected&&generation===historyGeneration){
      if(rangeAwaitingHistory){rangeAwaitingHistory=false;setRange(chartRange)}
      if(historyMissing)notice(`已載入 ${bars.length} 個交易日；${historyMissing} 個月份讀取失敗，長期水位可能不完整。`);
      else $('status').classList.add('hidden');
      drawChart();
    }
  }catch(e){if(code===selected&&generation===historyGeneration)notice(`較早歷史資料讀取未完成：${e.message}。現有 ${bars.length} 筆仍可檢視。`)}
  finally{if(historyBusyGeneration===generation)historyBusyGeneration=null}
}
loadBars=async function(){
  const code=selected,generation=++historyGeneration;
  bars=[];position=null;loadedMonths=0;historyMissing=0;requestedMonths=0;rangeAwaitingHistory=false;panOffset=0;
  renderPosition();drawChart();notice(`正在讀取 ${code} 的證交所日 K…`);
  try{
    const count=Math.min(36,listingMonths(code));
    const res=await fetch(`/api/bars?code=${encodeURIComponent(code)}&count=${count}`),data=await res.json();
    if(code!==selected||generation!==historyGeneration)return;
    if(!res.ok)throw Error(data.error||'資料讀取失敗');
    bars=data.bars;loadedMonths=count;historyMissing=data.missingMonths||0;
    if(!bars.length)throw Error('證交所尚無可用的上市後日 K');
    let autoWindow=null;
    if(!shareView&&settings.window!=='all'&&bars.length-1<Number(settings.window)){
      const old=settings.window,next=[600,400,200,120,60].find(n=>n<=bars.length-1);
      settings.window=next?String(next):'all';$('window').value=settings.window;save();
      autoWindow=`${code} 上市後只有 ${bars.length} 個交易日；觀察窗已由 ${old} 日改為 ${next||'已取得全部'}。`;
    }
    computePosition();computeBrent();computeFx();renderPosition();setRange(chartRange);updateWeights();
    if(autoWindow)notice(autoWindow);
    else if(historyMissing)notice(`近期資料有 ${historyMissing} 個月份讀取失敗，請稍後重試。`);
    else $('status').classList.add('hidden');
    if(listingMonths(code)>36)void ensureHistory(Math.max(60,requestedMonths),code,generation);
  }catch(e){if(code!==selected||generation!==historyGeneration)return;bars=[];position=null;renderPosition();drawChart();updateWeights();notice(`歷史行情暫時無法取得：${e.message}`)}
};

function setRange(years){
  chartRange=years;panOffset=0;
  const all=aggregate(bars,interval),last=all.at(-1);
  if(last){const d=new Date(last.date+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-years);zoomBars=Math.max(20,all.filter(x=>x.date>=d.toISOString().slice(0,10)).length)}
  $('rangeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active',Number(b.dataset.range)===years));
  drawChart();
}
function ema(values,period){const a=2/(period+1),out=[];let prior=null;for(const v of values){prior=prior===null?v:prior+a*(v-prior);out.push(prior)}return out}
function technical(all){
  const close=all.map(x=>x.close),ma=Array(all.length).fill(null),upper=Array(all.length).fill(null),lower=Array(all.length).fill(null);
  for(let i=19;i<all.length;i++){const window=close.slice(i-19,i+1),mean=window.reduce((a,b)=>a+b,0)/20,sd=Math.sqrt(window.reduce((a,b)=>a+(b-mean)**2,0)/20);ma[i]=mean;upper[i]=mean+2*sd;lower[i]=mean-2*sd}
  const e12=ema(close,12),e26=ema(close,26),dif=e12.map((v,i)=>i<25?null:v-e26[i]),signal=Array(all.length).fill(null),hist=Array(all.length).fill(null);let prev=null;
  for(let i=25;i<all.length;i++){prev=prev===null?dif[i]:prev+(2/10)*(dif[i]-prev);signal[i]=prev;hist[i]=dif[i]-prev}
  return{ma,upper,lower,dif,signal,hist};
}
function linePoints(series,start,end,x,y){const pts=[];for(let i=start;i<end;i++)if(Number.isFinite(series[i]))pts.push(`${x(i)},${y(series[i])}`);return pts.join(' ')}
drawChart=function(){
  const all=aggregate(bars,interval),node=$('chart'),macdNode=$('macdChart');
  if(!all.length){node.textContent='尚未取得 K 線資料';macdNode.classList.add('hidden');return}
  const end=Math.max(1,all.length-panOffset),start=Math.max(0,end-zoomBars),vis=all.slice(start,end),tech=technical(all);
  const W=900,H=310,left=38,right=10,step=(W-left-right)/vis.length,x=i=>left+(i-start+.5)*step;
  const plot=vis.flatMap((b,i)=>showBollinger?[b.low,b.high,tech.lower[start+i],tech.upper[start+i]]:[b.low,b.high]).filter(Number.isFinite);
  let lo=Math.min(...plot),hi=Math.max(...plot),span=hi-lo||1;lo-=span*.08;hi+=span*.08;
  const y=v=>18+(hi-v)/(hi-lo)*258;
  let svg='<svg viewBox="0 0 900 310" preserveAspectRatio="none" aria-hidden="true">';
  for(let g=0;g<4;g++){const gy=25+g*76;svg+=`<line x1="0" y1="${gy}" x2="900" y2="${gy}" stroke="var(--line)" stroke-dasharray="4 5"/><text x="4" y="${gy-6}" fill="var(--muted)" font-size="10">${fmt(hi-(hi-lo)*g/4,1)}</text>`}
  if(vis.length>220){const points=vis.map((b,i)=>`${x(start+i)},${y(b.close)}`).join(' ');svg+=`<polyline points="${points}" fill="none" stroke="#19a7a8" stroke-width="2.4"/>`}
  else for(let i=0;i<vis.length;i++){const b=vis[i],xx=x(start+i),color=b.close>=b.open?'#19a7a8':'#eb8c78',top=y(Math.max(b.open,b.close)),bottom=y(Math.min(b.open,b.close)),width=Math.max(2,Math.min(12,step*.58));svg+=`<line x1="${xx}" y1="${y(b.high)}" x2="${xx}" y2="${y(b.low)}" stroke="${color}" stroke-width="2"/><rect x="${xx-width/2}" y="${top}" width="${width}" height="${Math.max(2,bottom-top)}" fill="${color}" rx="1"/>`}
  if(showBollinger){for(const [series,color] of [[tech.upper,'#926ac9'],[tech.lower,'#926ac9']])svg+=`<polyline points="${linePoints(series,start,end,x,y)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 3"/>`}
  if(showMA||showBollinger)svg+=`<polyline points="${linePoints(tech.ma,start,end,x,y)}" fill="none" stroke="#e6a94d" stroke-width="2.5"/>`;
  svg+=`<text x="18" y="302" fill="var(--muted)" font-size="11">${vis[0].date}</text><text x="780" y="302" fill="var(--muted)" font-size="11">${vis.at(-1).date}</text></svg>`;
  node.innerHTML=svg;node.setAttribute('aria-label',`${selected} ${interval==='D'?'日':interval==='W'?'週':'月'} K，${vis[0].date} 至 ${vis.at(-1).date}`);
  $('chartCaption').textContent=`顯示 ${vis.length} 根、已取得 ${all.length} 根 K · ${vis[0].date} 至 ${vis.at(-1).date} · ${vis.length>220?'長區間以收盤線呈現':'紅跌綠漲 K 線'} · ${selected==='0050'?'0050 分割前價格已除以 4；':''}未納入配息再投入。`;
  if(showMACD){
    macdNode.classList.remove('hidden');const values=[...tech.dif.slice(start,end),...tech.signal.slice(start,end),...tech.hist.slice(start,end)].filter(Number.isFinite),bound=Math.max(.01,...values.map(Math.abs)),my=v=>73-v/bound*58;
    let m='<svg viewBox="0 0 900 150" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="73" x2="900" y2="73" stroke="var(--line)"/>';
    const width=Math.max(1,Math.min(7,step*.7));for(let i=start;i<end;i++)if(Number.isFinite(tech.hist[i])){const val=tech.hist[i],top=Math.min(73,my(val));m+=`<rect x="${x(i)-width/2}" y="${top}" width="${width}" height="${Math.max(1,Math.abs(my(val)-73))}" fill="${val>=0?'#19a7a8':'#eb8c78'}"/>`}
    m+=`<polyline points="${linePoints(tech.dif,start,end,x,my)}" fill="none" stroke="#e6a94d" stroke-width="2"/><polyline points="${linePoints(tech.signal,start,end,x,my)}" fill="none" stroke="#926ac9" stroke-width="2"/><text x="14" y="143" fill="var(--muted)" font-size="11">MACD：黃線 DIF · 紫線訊號 · 柱狀圖差值</text></svg>`;
    macdNode.innerHTML=m;macdNode.setAttribute('aria-label',`MACD，${vis[0].date} 至 ${vis.at(-1).date}`);
  }else macdNode.classList.add('hidden');
};
$('rangeSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-range]');if(!b)return;const years=Number(b.dataset.range);setRange(years);rangeAwaitingHistory=years*12>loadedMonths&&years*12<=listingMonths(selected);if(years>3)void ensureHistory(years*12)});
$('intervalSeg').addEventListener('click',()=>setTimeout(()=>setRange(chartRange),0));
$('zoomIn').addEventListener('click',()=>{zoomBars=Math.max(20,Math.round(zoomBars*.65));drawChart()});
$('zoomOut').addEventListener('click',()=>{zoomBars=Math.min(Math.max(20,aggregate(bars,interval).length),Math.round(zoomBars*1.55));drawChart()});
function pan(direction){panOffset=Math.max(0,Math.min(Math.max(0,aggregate(bars,interval).length-zoomBars),panOffset+direction*Math.max(1,Math.round(zoomBars*.25))));drawChart()}
$('panLeft').addEventListener('click',()=>pan(1));$('panRight').addEventListener('click',()=>pan(-1));
$('chart').addEventListener('wheel',e=>{e.preventDefault();zoomBars=e.deltaY<0?Math.max(20,Math.round(zoomBars*.8)):Math.min(aggregate(bars,interval).length,Math.round(zoomBars*1.25));drawChart()},{passive:false});
let dragX=null;$('chart').addEventListener('pointerdown',e=>{dragX=e.clientX;$('chart').classList.add('dragging');$('chart').setPointerCapture(e.pointerId)});
$('chart').addEventListener('pointermove',e=>{if(dragX===null)return;const delta=e.clientX-dragX;if(Math.abs(delta)<15)return;dragX=e.clientX;panOffset=Math.max(0,Math.min(Math.max(0,aggregate(bars,interval).length-zoomBars),panOffset+Math.round(delta/$('chart').clientWidth*zoomBars)));drawChart()});
$('chart').addEventListener('pointerup',()=>{dragX=null;$('chart').classList.remove('dragging')});
for(const [id,label] of [['bollinger','布林通道'],['macd','MACD']])$(id).addEventListener('click',function(){if(id==='bollinger')showBollinger=!showBollinger;else showMACD=!showMACD;const on=id==='bollinger'?showBollinger:showMACD;this.setAttribute('aria-pressed',String(on));this.textContent=`${on?'✓':'＋'} ${label}`;drawChart()});

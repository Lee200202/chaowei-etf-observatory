/* ---------- Market-wide margin balance (TWSE 信用交易統計) as a market factor ---------- */
// Scored from the daily balance change, centred on zero; rising leverage lowers the score.
let marginDays=[],mktMarginPosition=null;
{
  const tile=document.createElement('div');tile.className='factor';
  tile.innerHTML='<span class="factor-icon">▤</span><h4>大盤融資 · 每日增減</h4><strong id="mktMarginScore">—</strong><p id="mktMarginMeta">讀取證交所盤後資料中</p><div class="factor-spark" id="marginSpark"></div>';
  $('refreshClock').closest('.factor').before(tile);
}
function computeMktMargin(){
  const usable=marginDays,last=usable.at(-1),deltas=usable.slice(1).map((x,i)=>x.value-usable[i].value),s=factorScore(deltas,true);
  if(!last||!s){mktMarginPosition=null;$('mktMarginScore').textContent='—';$('mktMarginMeta').textContent=last?'每日增減樣本不足 21 日':'全市場融資資料暫不可用';return}
  const age=bars.length?(Date.parse(bars.at(-1).date)-Date.parse(last.date))/86400000:0;
  if(age>10){mktMarginPosition=null;$('mktMarginScore').textContent='逾期';$('mktMarginMeta').textContent=last.date+' 之後沒有新資料，暫停計分';return}
  mktMarginPosition={...s,last};
  $('mktMarginScore').textContent=fmt(s.core,1)+' / 5';
  $('mktMarginMeta').textContent=`${last.date} · 餘額 ${fmt(last.value,1)} 億元 · 增減 ${signNum(deltas.at(-1))} 億 · 零軸 Z ${fmt(s.z,2)}`;
  $('marginSpark').innerHTML=factorSpark(marginDays);
}
async function loadMktMargin(){
  try{const r=await fetch('/api/margin'),d=await r.json();if(!r.ok||!Array.isArray(d.rows))throw Error(d.error||'讀取失敗');
    // Margin amount is reported in thousand TWD; 1 億 = 100,000 thousand.
    const rows=d.rows.filter(x=>Number.isFinite(x[3])).map(x=>({date:x[0],value:x[3]/1e5,lots:x[1],short:x[2]}));
    // History is filled newest first; use only the unbroken recent stretch (no gap over 14 calendar days).
    let from=0;for(let i=rows.length-1;i>0;i--)if(Date.parse(rows[i].date)-Date.parse(rows[i-1].date)>14*86400000){from=i;break}
    marginDays=rows.slice(from);}
  catch(e){marginDays=[];$('mktMarginMeta').textContent='資料暫不可用：'+e.message}
  computeMktMargin();updateWeights();if(factorTrendKey==='margin')renderFactorTrend();
}
const mmComputeMarket=computeMarket;computeMarket=function(){mmComputeMarket();computeMktMargin()};

/* ---------- Brent spot in USD/barrel, via FinMind CrudeOilPrices ---------- */
var oilDays=[];
computeBrent=function(){
  const usable=oilDays,last=usable.at(-1),s=factorScore(usable.map(x=>x.value));
  if(!last||!s){brentPosition=null;$('brentScore').textContent='—';$('brentMeta').textContent=last?'觀察窗資料不足':'讀取 FinMind 布蘭特現貨中';return}
  const age=bars.length?(Date.parse(bars.at(-1).date)-Date.parse(last.date))/86400000:0;
  if(age>14){brentPosition=null;$('brentScore').textContent='逾期';$('brentMeta').textContent=last.date+' 之後沒有新現貨資料，暫停計分';return}
  brentPosition={...s,last};
  $('brentScore').textContent=fmt(s.core,1)+' / 5';$('brentMeta').textContent=`${fmt(last.value,2)} 美元／桶 · ${last.date} · 均值 ${fmt(s.mean,2)} · 偏離 ${signNum(s.deviation)}%`;
  $('oilSpark').innerHTML=factorSpark(oilDays);
};
async function loadOil(){
  try{const res=await fetch('/api/oil'),d=await res.json();if(!res.ok||d.unit!=='USD/barrel'||!d.days?.length)throw Error(d.error||'原油格式異常');
    oilDays=mergeDays(oilDays,d.days)}
  catch(e){brentPosition=null;$('brentScore').textContent='—';$('brentMeta').textContent='FinMind 原油資料暫不可用：'+e.message;updateWeights();return}
  computeBrent();updateWeights();if(factorTrendKey==='brent')renderFactorTrend();
  // The backtest's oil-and-FX filter reads the same series; rebuild it once the closes arrive.
  if(btCtx){btCtx=null;btSchedule()}
}
setInterval(()=>{if(!document.hidden){loadOil();loadMktMargin();loadBanks()}},300000);

/* ---------- Tap a factor tile: its trend as a line chart ---------- */
// The observation window's high and low are drawn as dashed lines, so the score above can be read off the chart.
const FACTOR_TRENDS={
  index:{title:'台灣加權指數',unit:'點',color:'#0e7490',data:()=>market.map(x=>[x.date,x.index]),fmt:v=>fmt(v,0)+' 點'},
  volume:{title:'大盤成交股數',unit:'億股',color:'#6aa9b8',data:()=>market.map(x=>[x.date,x.volume/1e8]),fmt:v=>fmt(v,1)+' 億股'},
  brent:{title:'FinMind 布蘭特現貨',unit:'美元／桶',color:'#c98a2b',data:()=>oilDays.map(x=>[x.date,x.value]),fmt:v=>fmt(v,2)+' 美元／桶'},
  fx:{title:'美元／新台幣（央行收盤）',unit:'新台幣',color:'#7c6bb0',data:()=>fx.map(x=>[x.date,x.value]),fmt:v=>fmt(v,3)},
  margin:{title:'大盤融資每日增減（零軸）',unit:'億元',color:'#b4566e',data:()=>marginDays.slice(1).map((x,i)=>[x.date,x.value-marginDays[i].value]),fmt:v=>signNum(v)+' 億元',bars:true}
};
const FACTOR_RANGES=[['3m','3 個月',3],['6m','6 個月',6],['1y','1 年',12],['3y','3 年',36],['5y','5 年',60],['all','全部',0]];
let factorTrendKey=null;
const trendPanel=document.createElement('div');trendPanel.className='factor-trend hidden';trendPanel.id='factorTrend';trendPanel.setAttribute('aria-live','polite');
$('market').querySelector('.factor-rail-nav').after(trendPanel);
const tileFor={index:'indexScore',volume:'volumeScore',brent:'brentScore',fx:'fxScore',margin:'mktMarginScore'};
// The oil card says plainly what it measures.
$('brentScore').closest('.factor').querySelector('h4').textContent='布蘭特原油 · 現貨';
{const note=document.createElement('p');note.className='factor-note';note.textContent='FinMind · 日資料，有發布延遲';$('brentScore').before(note);$('brentMeta').insertAdjacentHTML('afterend','<div class="factor-spark" id="oilSpark"></div><p class="small oil-future" id="oilFutureMeta">盤中期貨參考：等待 Yahoo 報價</p>')}
for(const [key,id] of Object.entries(tileFor)){
  const tile=$(id).closest('.factor');tile.dataset.trend=key;tile.tabIndex=0;tile.setAttribute('role','button');tile.setAttribute('aria-expanded','false');
  tile.setAttribute('aria-label',FACTOR_TRENDS[key].title+'：查看趨勢圖');
  const hint=document.createElement('span');hint.className='factor-more';hint.textContent='看趨勢 ›';tile.append(hint);
}
function openFactorTrend(key){
  factorTrendKey=factorTrendKey===key?null:key;
  $('market').querySelectorAll('[data-trend]').forEach(t=>{const on=t.dataset.trend===factorTrendKey;t.classList.toggle('active',on);t.setAttribute('aria-expanded',String(on))});
  trendPanel.classList.toggle('hidden',!factorTrendKey);if(factorTrendKey)renderFactorTrend();
}
$('factorRail').addEventListener('click',e=>{if(e.target.closest('select'))return;const t=e.target.closest('[data-trend]');if(t)openFactorTrend(t.dataset.trend)});
$('factorRail').addEventListener('keydown',e=>{const t=e.target.closest('[data-trend]');if(t&&(e.key==='Enter'||e.key===' ')&&e.target===t){e.preventDefault();openFactorTrend(t.dataset.trend)}});
function renderFactorTrend(){
  const key=factorTrendKey;if(!key)return;const def=FACTOR_TRENDS[key],range=FACTOR_RANGES.some(r=>r[0]===settings.factorRange)?settings.factorRange:'1y';
  const all=def.data().filter(x=>Number.isFinite(x[1]));trendPanel.replaceChildren();
  const head=document.createElement('div');head.className='factor-trend-head';
  head.innerHTML=`<div class="segment" role="group" aria-label="趨勢期間">${FACTOR_RANGES.map(([id,label])=>`<button type="button" data-frange="${id}" class="${id===range?'active':''}" aria-pressed="${id===range}">${label}</button>`).join('')}</div><button class="pill mini" type="button" data-fclose>收合</button>`;
  head.addEventListener('click',e=>{const b=e.target.closest('[data-frange]');if(b){settings.factorRange=b.dataset.frange;save();renderFactorTrend()}if(e.target.closest('[data-fclose]'))openFactorTrend(key)});
  trendPanel.append(head);
  if(all.length<2){const p=document.createElement('p');p.className='small';p.textContent='資料讀取中或暫不可用。';trendPanel.append(p);return}
  const months=FACTOR_RANGES.find(r=>r[0]===range)[2];let rows=all;
  if(months){const d=new Date(all.at(-1)[0]+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-months);const from=d.toISOString().slice(0,10);rows=all.filter(x=>x[0]>=from)}
  // Observation-window high/low used by the score (bars before the last one, same as the tile).
  const n=settings.window==='all'?all.length-1:Number(settings.window),win=all.slice(Math.max(0,all.length-1-n),-1).map(x=>x[1]);
  const s=key==='brent'?brentPosition:key==='margin'?mktMarginPosition:null;
  const bands=s?(settings.marketMethod==='normal'?[{value:s.center,label:key==='margin'?'零軸':'均值'},...[-3,-2,-1,1,2,3].map(n=>({value:s.center+n*s.scale,label:(n>0?'+':'')+n+'σ'}))]:[{value:s.center,label:key==='margin'?'零軸':'均值'},...[-1,-.6,-.2,.2,.6,1].map(n=>({value:s.center+n*s.half,label:'五等分'}))]):win.length>=20?[{value:Math.max(...win),label:'觀察窗高點'},{value:Math.min(...win),label:'觀察窗低點'}]:[];
  const first=rows[0][1],last=rows.at(-1)[1];
  trendPanel.append(chipChart({title:def.title,unit:def.unit,width:Math.max(280,Math.round(trendPanel.clientWidth||600)),dates:rows.map(x=>x[0]),kind:def.bars?'stack':'area',
    series:def.bars?[{name:'增加',color:RISE,data:rows.map(x=>Math.max(0,x[1]))},{name:'減少',color:FALL,data:rows.map(x=>Math.min(0,x[1]))}]:[{name:def.title,color:def.color,data:rows.map(x=>x[1])}],bands,format:def.fmt,
    right:def.right?(()=>{const r=def.right();return{name:r.name,color:r.color,data:rows.map(x=>r.byDate.get(x[0])??null)}})():undefined,
    note:def.bars?'零軸為基準':`區間 ${last>=first?'+':''}${fmt((last/first-1)*100,1)}%`}));
  if(s){const p=document.createElement('p');p.className='small';const k=key==='brent'?'oil':key,display=polarityReady?directionScore(k):s.core;p.textContent=`前 ${s.count} 筆參考，本次值不放入均值與標準差。${key==='margin'?'以零軸衡量每日增減。':`均值 ${fmt(s.mean,2)}、標準差 ${fmt(s.sd,2)} 美元。`} Z＝${fmt(s.z,2)}，依所選方向 ${fmt(display,2)} 分。`;trendPanel.append(p)}
}
let factorWidth=0;window.addEventListener('resize',()=>{const w=trendPanel.clientWidth;if(factorTrendKey&&Math.abs(w-factorWidth)>40){factorWidth=w;clearTimeout(window.__factorResize);window.__factorResize=setTimeout(renderFactorTrend,150)}});
// Keep an open chart current when the window, Brent or FX data change.
const ftApplyLive=applyLive;applyLive=function(){ftApplyLive();if(live?.oil?.unit==='USD/barrel'&&live.oil.days?.length)oilDays=mergeDays(oilDays,live.oil.days);computeBrent();const q=live?.oilFuture;$('oilFutureMeta').textContent=q?`Yahoo 期貨 BZ=F ${fmt(q.price,2)} 美元 · ${new Date(q.time).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（延遲行情；5 分鐘檢查）`:'盤中期貨參考暫不可用；現貨日資料照常計分';if(factorTrendKey)renderFactorTrend();updateWeights()};
$('window').addEventListener('change',()=>setTimeout(()=>{if(factorTrendKey)renderFactorTrend()},0));
loadMktMargin();loadOil();

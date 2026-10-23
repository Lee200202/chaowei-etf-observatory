/* ---------- Market-wide margin balance (TWSE 信用交易統計) as a market factor ---------- */
// Scored like the other factors: today's margin amount within the observation window. By default a lower
// balance (less retail leverage) scores higher; the direction is the user's choice.
let marginDays=[],mktMarginPosition=null;
settings.mktMarginDirection=settings.mktMarginDirection==='high'?'high':'low';
{
  const tile=document.createElement('div');tile.className='factor';
  tile.innerHTML='<span class="factor-icon">▤</span><h4>大盤融資餘額 · 證交所</h4><select id="mktMarginDirection" class="factor-dir" aria-label="大盤融資計分方向"><option value="low">融資越低分越高（預設）</option><option value="high">融資越高分越高</option></select><strong id="mktMarginScore">—</strong><p id="mktMarginMeta">讀取全市場融資餘額中</p>';
  $('refreshClock').closest('.factor').before(tile);
  $('mktMarginDirection').value=settings.mktMarginDirection;
  $('mktMarginDirection').addEventListener('click',e=>e.stopPropagation());
  $('mktMarginDirection').addEventListener('change',function(){settings.mktMarginDirection=this.value;save();computeMktMargin();updateWeights()});
}
function computeMktMargin(){
  const usable=bars.length?marginDays.filter(x=>x.date<=bars.at(-1).date):marginDays,n=settings.window==='all'?usable.length-1:Number(settings.window);
  const prior=usable.slice(Math.max(0,usable.length-1-n),-1),last=usable.at(-1);
  if(!last||prior.length<20||settings.window!=='all'&&prior.length<n){mktMarginPosition=null;$('mktMarginScore').textContent='—';$('mktMarginMeta').textContent=last?'觀察窗資料不足':'全市場融資資料暫不可用';return}
  const age=bars.length?(Date.parse(bars.at(-1).date)-Date.parse(last.date))/86400000:0;
  if(age>10){mktMarginPosition=null;$('mktMarginScore').textContent='逾期';$('mktMarginMeta').textContent=last.date+' 之後沒有新資料，暫停計分';return}
  const range=scalarRange(prior.map(x=>x.value));if(!range){mktMarginPosition=null;return}
  const r=(last.value-range.low)/(range.high-range.low),s=scoreFor(settings.mktMarginDirection==='low'?r:1-r,settings.method),prev=usable.at(-2);
  mktMarginPosition={...s,last,r};
  $('mktMarginScore').textContent=fmt(s.core,1)+' / 5';
  $('mktMarginMeta').textContent=`${fmt(last.value,1)} 億元 · ${last.date.slice(5)}`+(prev?` · 較前日 ${last.value>=prev.value?'+':''}${fmt(last.value-prev.value,1)} 億`:'');
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

/* ---------- Tap a factor tile: its trend as a line chart ---------- */
// The observation window's high and low are drawn as dashed lines, so the score above can be read off the chart.
const FACTOR_TRENDS={
  index:{title:'台灣加權指數',unit:'點',color:'#0e7490',data:()=>market.map(x=>[x.date,x.index]),fmt:v=>fmt(v,0)+' 點'},
  volume:{title:'大盤成交股數',unit:'億股',color:'#6aa9b8',data:()=>market.map(x=>[x.date,x.volume/1e8]),fmt:v=>fmt(v,1)+' 億股'},
  brent:{title:'布蘭特原油（EIA 現貨）',unit:'美元／桶',color:'#c98a2b',data:()=>brent.map(x=>[x.date,x.value]),fmt:v=>fmt(v,2)+' 美元'},
  fx:{title:'美元／新台幣（央行收盤）',unit:'新台幣',color:'#7c6bb0',data:()=>fx.map(x=>[x.date,x.value]),fmt:v=>fmt(v,3)},
  margin:{title:'大盤融資餘額',unit:'億元',color:'#b4566e',data:()=>marginDays.map(x=>[x.date,x.value]),fmt:v=>fmt(v,1)+' 億元'}
};
const FACTOR_RANGES=[['3m','3 個月',3],['6m','6 個月',6],['1y','1 年',12],['3y','3 年',36],['5y','5 年',60],['all','全部',0]];
let factorTrendKey=null;
const trendPanel=document.createElement('div');trendPanel.className='factor-trend hidden';trendPanel.id='factorTrend';trendPanel.setAttribute('aria-live','polite');
$('market').querySelector('.factor-rail-nav').after(trendPanel);
const tileFor={index:'indexScore',volume:'volumeScore',brent:'brentScore',fx:'fxScore',margin:'mktMarginScore'};
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
  const bands=win.length>=20?[{value:Math.max(...win),label:'觀察窗高點'},{value:Math.min(...win),label:'觀察窗低點'}]:[];
  const first=rows[0][1],last=rows.at(-1)[1];
  trendPanel.append(chipChart({title:def.title,unit:def.unit,width:Math.max(280,Math.round(trendPanel.clientWidth||600)),dates:rows.map(x=>x[0]),kind:'area',
    series:[{name:def.title,color:def.color,data:rows.map(x=>x[1])}],bands,format:def.fmt,
    note:`區間 ${last>=first?'+':''}${fmt((last/first-1)*100,1)}%`}));
}
let factorWidth=0;window.addEventListener('resize',()=>{const w=trendPanel.clientWidth;if(factorTrendKey&&Math.abs(w-factorWidth)>40){factorWidth=w;clearTimeout(window.__factorResize);window.__factorResize=setTimeout(renderFactorTrend,150)}});
// Keep an open chart current when the window, Brent or FX data change.
const ftApplyLive=applyLive;applyLive=function(){ftApplyLive();if(factorTrendKey)renderFactorTrend()};
$('window').addEventListener('change',()=>setTimeout(()=>{if(factorTrendKey)renderFactorTrend()},0));
loadMktMargin();

// Kept inside the client closure so the chart and data loaders share one state.
// Chart: TradingView Lightweight Charts 4.1.3 (same version as the Stock site); SVG close line if the CDN fails.
let chartRange='1',historyMeta=null,historyGeneration=0,lwc=null,liveQuote=null,quoteDisabled=false;
settings.overlays=Object.assign({ma5:false,ma20:false,ma60:false,boll:false},settings.overlays||{});
settings.osc=['none','macd','rsi','kd'].includes(settings.osc)?settings.osc:'none';
settings.anchorMode=['wick','close','average'].includes(settings.anchorMode)?settings.anchorMode:'wick';
settings.anchorCount=Math.max(1,Math.min(20,Math.round(Number(settings.anchorCount)||5)));
settings.showLevels=settings.showLevels!==false;
const RISE='#e5484d',FALL='#12a06b',COLORS={ma5:'#3b82f6',ma20:'#e6a23c',ma60:'#8b5cf6',boll:'#14b8a6',dif:'#e6a23c',dea:'#8b5cf6',rsi:'#0ea5b7',k:'#e6a23c',d:'#3b82f6'};
const POPULAR=['0050','0056','00878','006208','00919','009816','00981A','00631L'];
settings.watchlist=Array.isArray(settings.watchlist)?[...new Set(settings.watchlist.filter(x=>typeof x==='string'&&/^[0-9A-Z]{4,6}$/.test(x)))].slice(0,50):POPULAR.slice();
const ivName=()=>({D:'日',W:'週',M:'月'})[interval];
const lots=v=>fmt(v/1000,0)+' 張';

/* ---------- ETF search ---------- */
const sortKey=e=>[e.type==='active'?1:0,parseInt(e.code.replace(/\D/g,''),10)||0,e.code];
function sortCatalog(){catalog.sort((a,b)=>{const x=sortKey(a),y=sortKey(b);return x[0]-y[0]||x[1]-y[1]||x[2].localeCompare(y[2])})}
let lastFocus=null;
function openSearch(){lastFocus=document.activeElement;$('searchOverlay').classList.remove('hidden');document.body.classList.add('searching');renderList();setTimeout(()=>{$('search').focus();$('search').select()},30)}
// After a pick, focus must not jump back to the opener: the same Enter press would "click" it and reopen the sheet.
function closeSearch(restore=true){if($('searchOverlay').classList.contains('hidden'))return;$('searchOverlay').classList.add('hidden');document.body.classList.remove('searching');if(restore)lastFocus?.focus?.({preventScroll:true});else document.activeElement?.blur?.()}
function pick(code){selected=code;closeSearch(false);renderList();loadBars();const t=document.querySelector('.toolbar');window.scrollTo({top:t.getBoundingClientRect().top+scrollY-12,behavior:'instant'})}
function renderQuick(){
  for(const id of ['quickPicks','quickInline']){
    const box=$(id);box.replaceChildren();
    for(const code of settings.watchlist){const e=catalog.find(x=>x.code===code);if(!e)continue;const b=document.createElement('button');b.type='button';b.className='pill mini'+(code===selected?' on':'');b.textContent=`${code} ${e.name}`;b.addEventListener('click',()=>pick(code));box.append(b)}
    if(!box.children.length){const p=document.createElement('span');p.className='small';p.textContent='點候選卡片上的☆建立追蹤清單';box.append(p)}
  }
}
for(const id of ['openSearch','openSearchTop'])$(id).addEventListener('click',openSearch);
$('backToSearch').addEventListener('click',e=>{e.preventDefault();openSearch()});
$('closeSearch').addEventListener('click',closeSearch);
$('searchOverlay').addEventListener('click',e=>{if(e.target===$('searchOverlay'))closeSearch()});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeSearch();closeDisplay();closeAccount()}
  else if(e.key==='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||'')){e.preventDefault();openSearch()}
});
function closeDisplay(){$('displayMenu').classList.add('hidden');$('themeTop').setAttribute('aria-expanded','false')}
$('themeTop').addEventListener('click',e=>{e.stopPropagation();const open=$('displayMenu').classList.toggle('hidden')===false;$('themeTop').setAttribute('aria-expanded',String(open))});
$('displayMenu').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',closeDisplay);
renderList=function(){
  if(catalog.length&&!catalog.sorted){sortCatalog();catalog.sorted=true}
  const q=$('search').value.trim().toLocaleLowerCase('zh-TW');
  const matches=catalog.filter(e=>(type==='all'||type==='watch'&&settings.watchlist.includes(e.code)||e.type===type)&&(!q||`${e.code} ${e.name} ${e.note||''}`.toLocaleLowerCase('zh-TW').includes(q)));
  // Exact code hits first, so typing 0050 does not bury 0050 under 00500-style codes.
  if(q)matches.sort((a,b)=>(b.code.toLowerCase()===q)-(a.code.toLowerCase()===q)||(b.code.toLowerCase().startsWith(q))-(a.code.toLowerCase().startsWith(q)));
  $('catalogNote').textContent=`證交所上市 ETF 名錄共 ${catalog.length} 檔，含 009816 等新掛牌商品。按搜尋列或「/」鍵開啟全螢幕搜尋。`;
  $('searchCount').textContent=`共 ${catalog.length} 檔，符合 ${matches.length} 檔${q?`「${$('search').value.trim()}」`:''}`;
  $('etfList').replaceChildren();
  const limit=q?150:catalog.length;
  for(const e of matches.slice(0,limit)){
    const row=document.createElement('div');row.className='etf-result';
    const b=document.createElement('button');b.type='button';b.className='candidate-pick'+(e.code===selected?' selected':'');
    const strong=document.createElement('strong');strong.textContent=`${e.code} · ${e.name}`;
    const small=document.createElement('small');small.textContent=`${e.type==='active'?'主動型':'被動型'} · ${e.listingDate?e.listingDate+' 上市':'上市日期待查'}`;
    b.append(strong,small);
    if(e.note&&e.note!=='主動管理'){const idx=document.createElement('small');idx.className='index';idx.textContent=e.note;b.append(idx)}
    b.addEventListener('click',()=>pick(e.code));
    const star=document.createElement('button');star.type='button';star.className='watch-star';star.setAttribute('aria-label',settings.watchlist.includes(e.code)?`取消追蹤 ${e.code}`:`追蹤 ${e.code}`);star.setAttribute('aria-pressed',String(settings.watchlist.includes(e.code)));star.textContent=settings.watchlist.includes(e.code)?'★':'☆';
    star.addEventListener('click',()=>{settings.watchlist=settings.watchlist.includes(e.code)?settings.watchlist.filter(x=>x!==e.code):[...settings.watchlist,e.code].slice(0,50);save();renderList()});
    row.append(b,star);$('etfList').append(row);
  }
  if(!matches.length)$('etfList').textContent='沒有符合的 ETF；請確認名稱或代號';
  else if(matches.length>limit){const p=document.createElement('p');p.className='small more';p.textContent=`顯示前 ${limit} 檔，繼續輸入可縮小範圍。`;$('etfList').append(p)}
  renderQuick();
};
$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){const first=$('etfList').querySelector('.candidate-pick');if(first){e.preventDefault();first.click()}}});

function openAccount(){closeDisplay();$('accountOverlay').classList.remove('hidden');document.body.classList.add('account-open');$('googleSignIn').focus()}
function closeAccount(){$('accountOverlay').classList.add('hidden');document.body.classList.remove('account-open')}
for(const id of ['accountTop','memberStart'])$(id).addEventListener('click',openAccount);
$('closeAccount').addEventListener('click',closeAccount);
$('accountOverlay').addEventListener('click',e=>{if(e.target===$('accountOverlay'))closeAccount()});
window.chaoweiApplyProfile=profile=>{if(!profile||typeof profile!=='object')return;
  if(profile.settings&&typeof profile.settings==='object')Object.assign(settings,profile.settings);
  settings.watchlist=Array.isArray(settings.watchlist)?[...new Set(settings.watchlist.filter(x=>typeof x==='string'&&/^[0-9A-Z]{4,6}$/.test(x)))].slice(0,50):POPULAR.slice();
  prefs();renderList();computePosition();renderPosition();computeMarket();computeBrent();computeFx();updateWeights();drawChart(true);save();
};

const originalComputeFx=computeFx;
computeFx=function(){
  originalComputeFx();
  if(!fxPosition||!bars.length)return;
  const age=(Date.parse(bars.at(-1).date)-Date.parse(fxPosition.last.date))/86400000;
  if(age>14){fxPosition=null;$('fxScore').textContent='逾期';$('fxMeta').textContent='央行資料停留在 '+fx.at(-1).date+'，暫停計分'}
  else if(window.CHAOWEI_STATIC)$('fxMeta').textContent+=' · 每日快照';
};

/* ---------- Summary numbers in the sticky toolbar ---------- */
const originalRenderPosition=renderPosition;
renderPosition=function(){
  originalRenderPosition();
  const last=bars.at(-1),adj=historyMeta?.adjustments||[];
  $('etfMeta').textContent=`${selected} · 證交所上市${historyMeta?.first?` · 資料起於 ${historyMeta.first}`:''}`;
  $('source').textContent=adj.length?`證交所 · 已還原分割（${adj.map(a=>`${a.date} ×${a.factor>=1?a.factor:'1/'+Math.round(1/a.factor)}`).join('、')}）`:'來源：證交所';
  const anchorName={wick:'最高／最低價',close:'收盤極值',average:`高低價各 ${settings.anchorCount} 筆平均`}[settings.anchorMode];
  $('anchorSummary').textContent=position?`${position.count} 日 · ${anchorName} · ${settings.method==='fib'?'黃金分割':'等距刻度'}`:`基準：${anchorName}`;
  $('barPrice').textContent=last?fmt(last.close,2):'—';
  $('barGrade').textContent=position?position.grade+' / 5':'—';
  $('barDate').textContent=last?last.date.slice(5):'—';
  const provisional=liveQuote?.available&&last&&liveQuote.date>last.date;
  $('liveSource').classList.toggle('hidden',!provisional);
  $('priceLabel').textContent=provisional?'最新成交價':'最近收盤價';
  if(provisional){
    const time=liveQuote.time?new Date(liveQuote.time).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}):'時間待確認';
    $('price').textContent=fmt(liveQuote.price,2)+' 元';
    $('asof').textContent=`報價日期：${liveQuote.date} ${time} · 正式成交`;
    $('liveSource').textContent=`富果行情 API · 每 5 分鐘檢查 · 當日 K 為盤中暫值`;
    $('quoteStatus').textContent='盤中參考';
    $('barPrice').textContent=fmt(liveQuote.price,2);
    $('barDate').textContent=liveQuote.date.slice(5);
  }
  const prev=bars.at(-2),reference=provisional?(liveQuote.previousClose||last.close):prev?.close;
  const value=provisional?liveQuote.price:last?.close;
  for(const id of ['price','barPrice']){
    $(id).classList.toggle('price-up',Number.isFinite(value)&&Number.isFinite(reference)&&value>reference);
    $(id).classList.toggle('price-down',Number.isFinite(value)&&Number.isFinite(reference)&&value<reference);
  }
};

function anchorRange(prior){
  if(!prior.length)return null;
  const count=settings.anchorCount;
  let low,high;
  if(settings.anchorMode==='average'){
    const n=Math.min(count,prior.length);
    low=prior.map(b=>b.low).sort((a,b)=>a-b).slice(0,n).reduce((a,b)=>a+b,0)/n;
    high=prior.map(b=>b.high).sort((a,b)=>b-a).slice(0,n).reduce((a,b)=>a+b,0)/n;
  }else{
    const key=settings.anchorMode==='close'?'close':null;
    low=Math.min(...prior.map(b=>key?b[key]:b.low));
    high=Math.max(...prior.map(b=>key?b[key]:b.high));
  }
  return Number.isFinite(low)&&Number.isFinite(high)&&high>low?{low,high}:null;
}
function scalarRange(values){
  if(values.length<2)return null;
  const ordered=[...values].sort((a,b)=>a-b);
  const n=settings.anchorMode==='average'?Math.min(settings.anchorCount,ordered.length):1;
  const low=ordered.slice(0,n).reduce((a,b)=>a+b,0)/n;
  const high=ordered.slice(-n).reduce((a,b)=>a+b,0)/n;
  return Number.isFinite(low)&&Number.isFinite(high)&&high>low?{low,high}:null;
}
computePosition=function(){
  const last=bars.at(-1);
  const provisional=liveQuote?.available&&last&&liveQuote.date>last.date;
  const n=settings.window==='all'?bars.length-(provisional?0:1):Number(settings.window);
  const prior=provisional?bars.slice(-n):bars.slice(-1-n,-1);
  if(!last||prior.length<20||settings.window!=='all'&&prior.length<n){position=null;return}
  const range=anchorRange(prior);
  if(!range){position=null;return}
  const price=provisional?liveQuote.price:last.close;
  const r=(price-range.low)/(range.high-range.low);
  position={...scoreFor(r,settings.method),r,...range,count:prior.length,
    last:provisional?{...last,date:liveQuote.date,close:price}:last,intraday:!!provisional};
};

async function loadQuote(){
  if(!window.CHAOWEI_QUOTE||quoteDisabled)return;
  const code=selected;
  try{
    const quote=await window.CHAOWEI_QUOTE(code);
    if(code!==selected)return;
    if(quote?.reason==='盤中報價尚未啟用')quoteDisabled=true;
    liveQuote=quote?.available?quote:null;
  }catch{if(code!==selected)return;liveQuote=null}
  if(!bars.length)return;
  computePosition();renderPosition();drawChart(true);updateWeights();
}
setInterval(()=>{if(!document.hidden)loadQuote()},300000);

/* ---------- Data loading ---------- */
// A short-history ETF narrows the window only for itself; the user's own choice comes back for the next ETF.
if(!settings.preferredWindow)settings.preferredWindow=settings.window;
$('window').addEventListener('change',function(){settings.preferredWindow=this.value;save()});
function autoWindow(code){
  if(shareView)return '';
  const want=settings.preferredWindow||settings.window;
  if(want==='all'||bars.length-1>=Number(want)){if(settings.window!==want){settings.window=want;$('window').value=want;save()}return ''}
  const next=[2400,1200,600,400,240,200,120,60].find(n=>n<=bars.length-1);
  settings.window=next?String(next):'all';$('window').value=settings.window;save();
  return `${code} 上市後只有 ${bars.length} 個交易日；本檔觀察窗暫由 ${want} 日改為 ${next?next+' 日':'已取得全部'}，換回其他 ETF 時恢復 ${want} 日。`;
}
loadBars=async function(keepView=false){
  const code=selected,generation=++historyGeneration;
  if(!keepView){bars=[];position=null;historyMeta=null;liveQuote=null;renderPosition();drawChart();notice(`正在讀取 ${code} 的歷史日 K…`)}
  try{
    const res=await fetch(`/api/history?code=${encodeURIComponent(code)}`),data=await res.json();
    if(code!==selected||generation!==historyGeneration)return;
    if(!res.ok)throw Error(data.error||'資料讀取失敗');
    if(keepView&&bars.length&&data.latest===bars.at(-1)?.date)return;
    bars=data.bars;historyMeta=data;
    const auto=autoWindow(code);
    computePosition();computeBrent();computeFx();renderPosition();drawChart(keepView);updateWeights();
    const years=((Date.parse(data.latest)-Date.parse(data.first))/31557600000).toFixed(1);
    $('historyNote').textContent=`${data.first} 至 ${data.latest} · ${bars.length.toLocaleString()} 個交易日（約 ${years} 年）${data.live?` · 含證交所當月補充 ${data.live} 日`:''}`;
    if(auto)notice(auto);else if(data.liveNote)notice(data.liveNote);else $('status').classList.add('hidden');
    loadQuote();
  }catch(e){if(code!==selected||generation!==historyGeneration||keepView)return;bars=[];position=null;renderPosition();drawChart();updateWeights();notice(`歷史行情暫時無法取得：${e.message}`)}
};

/* ---------- Indicators ---------- */
function sma(values,n){const out=Array(values.length).fill(null);let sum=0;for(let i=0;i<values.length;i++){sum+=values[i];if(i>=n)sum-=values[i-n];if(i>=n-1)out[i]=sum/n}return out}
function ema(values,period){const a=2/(period+1),out=[];let prior=null;for(const v of values){if(v==null){out.push(null);continue}prior=prior===null?v:prior+a*(v-prior);out.push(prior)}return out}
function technical(all){
  const close=all.map(x=>x.close),len=all.length,ma5=sma(close,5),ma20=sma(close,20),ma60=sma(close,60),upper=Array(len).fill(null),lower=Array(len).fill(null);
  for(let i=19;i<len;i++){let s=0;for(let j=i-19;j<=i;j++)s+=(close[j]-ma20[i])**2;const sd=Math.sqrt(s/20);upper[i]=ma20[i]+2*sd;lower[i]=ma20[i]-2*sd}
  const e12=ema(close,12),e26=ema(close,26),dif=close.map((_,i)=>i<25?null:e12[i]-e26[i]),dea=ema(dif,9),hist=dif.map((v,i)=>v==null||dea[i]==null?null:(v-dea[i])*2);
  const rsi=Array(len).fill(null);let gain=0,loss=0;
  for(let i=1;i<len;i++){const ch=close[i]-close[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=14){gain+=g/14;loss+=l/14}else{gain=(gain*13+g)/14;loss=(loss*13+l)/14}if(i>=14)rsi[i]=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss)}
  const kk=Array(len).fill(null),dd=Array(len).fill(null);let k=50,d=50;
  for(let i=8;i<len;i++){let hi=-Infinity,lo=Infinity;for(let j=i-8;j<=i;j++){hi=Math.max(hi,all[j].high);lo=Math.min(lo,all[j].low)}const rsv=hi===lo?50:(close[i]-lo)/(hi-lo)*100;k=k*2/3+rsv/3;d=d*2/3+k/3;kk[i]=k;dd[i]=d}
  return{ma5,ma20,ma60,upper,lower,dif,dea,hist,rsi,k:kk,d:dd,volMa20:sma(all.map(x=>x.volume),20)};
}

/* ---------- Chart ---------- */
function themeColors(){const dark=document.body.classList.contains('dark');return{text:dark?'#a5c0c1':'#617982',grid:dark?'#24434b':'#e7efef',border:dark?'#34525a':'#dce8e8',bg:'transparent'}}
function chartOptions(){
  const c=themeColors();
  return{autoSize:true,layout:{background:{type:'solid',color:c.bg},textColor:c.text,fontFamily:'-apple-system,BlinkMacSystemFont,"Noto Sans TC","Microsoft JhengHei",sans-serif'},
    grid:{vertLines:{color:c.grid},horzLines:{color:c.grid}},rightPriceScale:{borderColor:c.border,minimumWidth:72},
    timeScale:{borderColor:c.border,rightOffset:3,minBarSpacing:0.05,fixLeftEdge:true},
    crosshair:{mode:0},localization:{locale:'zh-TW',dateFormat:'yyyy-MM-dd'},
    handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:false}},kineticScroll:{touch:true,mouse:false}};
}
function buildCharts(){
  if(lwc||!window.LightweightCharts)return lwc;
  // Volume sits in its own pane (as on the Stock site) so the price axis never labels the volume area.
  const L=window.LightweightCharts,main=L.createChart($('chart'),{...chartOptions(),timeScale:{...chartOptions().timeScale,visible:false}}),vol=L.createChart($('volChart'),chartOptions()),osc=L.createChart($('oscChart'),chartOptions());
  const line=(chart,color,extra={})=>chart.addLineSeries({color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,...extra});
  const s={
    candle:main.addCandlestickSeries({upColor:RISE,downColor:FALL,borderUpColor:RISE,borderDownColor:FALL,wickUpColor:RISE,wickDownColor:FALL,priceFormat:{type:'price',precision:2,minMove:0.01}}),
    volume:vol.addHistogramSeries({priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false}),
    ma5:line(main,COLORS.ma5),ma20:line(main,COLORS.ma20),ma60:line(main,COLORS.ma60),
    bollUp:line(main,COLORS.boll,{lineStyle:2,lineWidth:1.5}),bollLow:line(main,COLORS.boll,{lineStyle:2,lineWidth:1.5}),
    hist:osc.addHistogramSeries({priceLineVisible:false,lastValueVisible:false}),dif:line(osc,COLORS.dif),dea:line(osc,COLORS.dea),
    rsi:line(osc,COLORS.rsi,{lastValueVisible:true}),k:line(osc,COLORS.k,{lastValueVisible:true}),d:line(osc,COLORS.d,{lastValueVisible:true})
  };
  main.priceScale('right').applyOptions({scaleMargins:{top:.05,bottom:.05}});
  vol.priceScale('right').applyOptions({scaleMargins:{top:.12,bottom:0}});
  lwc={L,main,vol,osc,s,guides:[],syncing:false,data:[],tech:null};
  // Keep the volume and indicator panes aligned bar-for-bar with the price pane.
  const panes=[main,vol,osc];
  for(const from of panes)from.timeScale().subscribeVisibleLogicalRangeChange(r=>{
    if(!r||lwc.syncing)return;lwc.syncing=true;
    for(const to of panes)if(to!==from&&!(to===osc&&$('oscChart').classList.contains('hidden')))to.timeScale().setVisibleLogicalRange(r);
    lwc.syncing=false;
  });
  main.subscribeCrosshairMove(p=>{updateLegend(p?.logical);showTip(p)});
  vol.subscribeCrosshairMove(p=>{updateLegend(p?.logical);showTip(p&&p.point?{...p,point:{x:p.point.x,y:$('chart').clientHeight-10}}:p)});
  osc.subscribeCrosshairMove(p=>updateLegend(p?.logical));
  return lwc;
}
function seriesData(all,values){return all.map((b,i)=>values[i]==null?{time:b.date}:{time:b.date,value:values[i]})}
function setVisible(range){
  if(!lwc||!lwc.data.length)return;
  const all=lwc.data,n=all.length;let from=0;
  if(range!=='all'){const months=/m$/.test(range)?Number(range.slice(0,-1)):Math.round(Number(range)*12),d=new Date(all.at(-1).date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-months);const start=d.toISOString().slice(0,10);from=all.findIndex(b=>b.date>=start);if(from<0)from=0}
  lwc.main.timeScale().setVisibleLogicalRange({from:Math.max(-0.5,from-0.5),to:n-1+3});
}
function setRange(range){chartRange=String(range);$('rangeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.range===chartRange));if(lwc)setVisible(chartRange);else drawChart()}
function applyOverlayButtons(){document.querySelectorAll('[data-overlay]').forEach(b=>b.setAttribute('aria-pressed',String(!!settings.overlays[b.dataset.overlay])));$('oscSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.osc===settings.osc))}
drawChart=function(keepView=false){
  const last=bars.at(-1),provisional=liveQuote?.available&&last&&liveQuote.date>last.date;
  const quoteBar=provisional?{
    date:liveQuote.date,open:liveQuote.open||liveQuote.price,
    high:Math.max(liveQuote.high||liveQuote.price,liveQuote.price,liveQuote.open||liveQuote.price),
    low:Math.min(liveQuote.low||liveQuote.price,liveQuote.price,liveQuote.open||liveQuote.price),
    close:liveQuote.price,volume:liveQuote.volumeShares||0
  }:null;
  const all=aggregate(withVolumeBasis(quoteBar?[...bars,quoteBar]:bars),interval);
  if(!buildCharts())return drawSvgFallback(all);
  const {main,osc,s}=lwc,tech=technical(all),ov=settings.overlays;
  const old=keepView?main.timeScale().getVisibleLogicalRange():null;
  lwc.data=all;lwc.tech=tech;
  s.candle.setData(all.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close})));
  s.volume.setData(all.map(b=>({time:b.date,value:b.volume/1000,color:b.close>=b.open?'rgba(229,72,77,.45)':'rgba(18,160,107,.45)'})));
  for(const k of ['ma5','ma20','ma60']){s[k].setData(seriesData(all,tech[k]));s[k].applyOptions({visible:!!ov[k]})}
  s.bollUp.setData(seriesData(all,tech.upper));s.bollLow.setData(seriesData(all,tech.lower));
  s.bollUp.applyOptions({visible:!!ov.boll});s.bollLow.applyOptions({visible:!!ov.boll});
  if(ov.boll&&!ov.ma20)s.ma20.applyOptions({visible:true,color:COLORS.boll,lineStyle:2});else s.ma20.applyOptions({color:COLORS.ma20,lineStyle:0});
  // Oscillator pane.
  const o=settings.osc;$('oscChart').classList.toggle('hidden',o==='none');$('oscLegend').classList.toggle('hidden',o==='none');
  for(const g of lwc.guides)g.series.removePriceLine(g.line);lwc.guides=[];
  s.hist.setData(o==='macd'?all.map((b,i)=>tech.hist[i]==null?{time:b.date}:{time:b.date,value:tech.hist[i],color:tech.hist[i]>=0?'rgba(229,72,77,.6)':'rgba(18,160,107,.6)'}):[]);
  s.dif.setData(o==='macd'?seriesData(all,tech.dif):[]);s.dea.setData(o==='macd'?seriesData(all,tech.dea):[]);
  s.rsi.setData(o==='rsi'?seriesData(all,tech.rsi):[]);
  s.k.setData(o==='kd'?seriesData(all,tech.k):[]);s.d.setData(o==='kd'?seriesData(all,tech.d):[]);
  const guide=(series,price,title)=>lwc.guides.push({series,line:series.createPriceLine({price,color:'#9fb3b6',lineWidth:1,lineStyle:2,axisLabelVisible:false,title})});
  if(o==='rsi'){guide(s.rsi,70,'70');guide(s.rsi,30,'30')}
  if(o==='kd'){guide(s.k,80,'80');guide(s.k,20,'20')}
  if(o==='macd')guide(s.dif,0,'');
  if(settings.showLevels&&position){
    const fractions=settings.method==='fib'?[0,.236,.382,.618,.786,1]:[0,.2,.4,.6,.8,1];
    for(const f of fractions){
      const price=position.low+(position.high-position.low)*f;
      lwc.guides.push({series:s.candle,line:s.candle.createPriceLine({price,color:f===0||f===1?'#438d98':'#9abfc0',lineWidth:f===0||f===1?2:1,lineStyle:2,axisLabelVisible:true,title:`${Number((f*100).toFixed(1))}%`})});
    }
  }
  if(old)main.timeScale().setVisibleLogicalRange(old);else setVisible(chartRange);
  requestAnimationFrame(()=>{const r=main.timeScale().getVisibleLogicalRange();if(!r)return;lwc.vol.timeScale().setVisibleLogicalRange(r);if(o!=='none')osc.timeScale().setVisibleLogicalRange(r)});
  $('chartCaption').textContent=`${ivName()} K · ${all.length.toLocaleString()} 根${provisional?' · 末根暫值':''} · 紅漲綠跌 · 量：張${volumeAdjusted()?'（分割前已換算）':(historyMeta?.adjustments||[]).length?'（分割前為原始張數）':''} · 滾輪縮放、拖曳平移 · 未含息`;
  $('chart').setAttribute('aria-label',all.length?`${selected} ${ivName()} K，${all[0].date} 至 ${all.at(-1).date}`:'尚未取得 K 線資料');
  updateLegend(null);renderTechRead(provisional?all.slice(0,-1):all,provisional?technical(all.slice(0,-1)):tech);
};
function updateLegend(logical){
  if(!lwc)return;const all=lwc.data,t=lwc.tech;if(!all.length){$('chartLegend').textContent='—';return}
  const i=Number.isFinite(logical)?Math.max(0,Math.min(all.length-1,Math.round(logical))):all.length-1,b=all[i],prev=all[i-1];
  const chg=prev?b.close-prev.close:null,pct=prev?chg/prev.close*100:null,cls=chg>0?'up':chg<0?'down':'';
  const item=(label,val,color)=>`<span${color?` style="--c:${color}"`:''} class="${color?'dot':''}"><small>${label}</small>${val}</span>`;
  let h=item('日期',b.date)+item('開',fmt(b.open,2))+item('高',fmt(b.high,2))+item('低',fmt(b.low,2))+`<span class="${cls}"><small>收</small>${fmt(b.close,2)}${chg==null?'':` <em>${chg>=0?'+':''}${fmt(chg,2)}（${chg>=0?'+':''}${fmt(pct,2)}%）</em>`}</span>`+item('量',lots(b.volume));
  for(const k of ['ma5','ma20','ma60'])if(settings.overlays[k]&&t[k][i]!=null)h+=item(k.toUpperCase(),fmt(t[k][i],2),COLORS[k]);
  if(settings.overlays.boll&&t.upper[i]!=null)h+=item('布林上／下',`${fmt(t.upper[i],2)}／${fmt(t.lower[i],2)}`,COLORS.boll);
  $('chartLegend').innerHTML=h;
  const o=settings.osc;let oh='';
  if(o==='macd')oh=item('DIF',fmt(t.dif[i],3),COLORS.dif)+item('DEA',fmt(t.dea[i],3),COLORS.dea)+item('柱',fmt(t.hist[i],3));
  if(o==='rsi')oh=item('RSI14',fmt(t.rsi[i],1),COLORS.rsi);
  if(o==='kd')oh=item('K9',fmt(t.k[i],1),COLORS.k)+item('D9',fmt(t.d[i],1),COLORS.d);
  $('oscLegend').innerHTML=oh;
}
// Floating box at the cursor: the day's five price figures (open, high, low, close, change) and volume.
function showTip(p){
  const tip=$('chartTip'),box=$('chart');
  if(!lwc||!p||!p.point||!Number.isFinite(p.logical)||p.point.x<0||p.point.y<0){tip.classList.add('hidden');return}
  const all=lwc.data,i=Math.round(p.logical);if(i<0||i>=all.length){tip.classList.add('hidden');return}
  const b=all[i],prev=all[i-1],chg=prev?b.close-prev.close:null,pct=prev?chg/prev.close*100:null,cls=chg>0?'up':chg<0?'down':'';
  const sign=v=>v>0?'+':'';
  tip.innerHTML=`<b>${b.date}${interval==='D'?'':` 起${ivName()} K`}</b><dl><dt>開盤</dt><dd>${fmt(b.open,2)}</dd><dt>最高</dt><dd>${fmt(b.high,2)}</dd><dt>最低</dt><dd>${fmt(b.low,2)}</dd><dt>收盤</dt><dd class="${cls}">${fmt(b.close,2)}</dd><dt>漲跌</dt><dd class="${cls}">${chg==null?'—':`${sign(chg)}${fmt(chg,2)}（${sign(chg)}${fmt(pct,2)}%）`}</dd><dt>成交量${volumeAdjusted()?'（換算）':''}</dt><dd>${lots(b.volume)}</dd></dl>`;
  tip.classList.remove('hidden');
  const w=tip.offsetWidth,h=tip.offsetHeight,W=box.clientWidth,H=box.clientHeight;
  let x=p.point.x+16;if(x+w>W-60)x=p.point.x-w-16;
  tip.style.left=Math.max(4,x)+'px';tip.style.top=Math.max(4,Math.min(H-h-4,p.point.y-h/2))+'px';
}
function lastCross(a,b){for(let i=a.length-1;i>0;i--){if(a[i]==null||b[i]==null||a[i-1]==null||b[i-1]==null)return null;const now=a[i]-b[i],before=a[i-1]-b[i-1];if(now>=0&&before<0)return{up:true,ago:a.length-1-i};if(now<0&&before>=0)return{up:false,ago:a.length-1-i}}return null}
function renderTechRead(all,t){
  const box=$('techRead'),n=all.length-1;
  if(n<60){box.innerHTML=all.length?`<p class="small">資料少於 60 根${ivName()} K，技術面讀數待資料累積後顯示。</p>`:'';return}
  const c=all[n].close,u=ivName(),rows=[];
  const slope=t.ma20[n]-t.ma20[n-5],trend=c>t.ma20[n]&&c>t.ma60[n]?'收盤在 MA20 與 MA60 之上':c<t.ma20[n]&&c<t.ma60[n]?'收盤在 MA20 與 MA60 之下':'收盤介於 MA20 與 MA60 之間';
  rows.push(['趨勢',slope>0?'均線上彎':'均線下彎',`${trend}；MA20 較 5 ${u}前${slope>0?'上升':'下降'} ${fmt(Math.abs(slope/t.ma20[n-5]*100),2)}%。`]);
  const pb=(c-t.lower[n])/(t.upper[n]-t.lower[n]),bw=(t.upper[n]-t.lower[n])/t.ma20[n],past=[];for(let i=Math.max(19,n-119);i<=n;i++)past.push((t.upper[i]-t.lower[i])/t.ma20[i]);
  const bwRank=past.filter(x=>x<=bw).length/past.length;
  rows.push(['布林通道',`%B ${fmt(pb,2)}`,`收盤位於通道${pb>1?'上軌之外':pb<0?'下軌之外':pb>=.8?'上緣附近':pb<=.2?'下緣附近':'中段'}；通道寬度 ${fmt(bw*100,1)}%，在近 ${past.length} ${u}中屬${bwRank<=.2?'偏窄（波動收斂）':bwRank>=.8?'偏寬（波動擴大）':'一般'}。`]);
  const mc=lastCross(t.dif,t.dea);
  rows.push(['MACD',t.hist[n]>=0?'柱狀體為正':'柱狀體為負',`DIF ${fmt(t.dif[n],3)}、DEA ${fmt(t.dea[n],3)}；${mc?`${mc.ago===0?'本':mc.ago+' '}${u}${mc.ago===0?'':'前'}出現${mc.up?'黃金交叉':'死亡交叉'}`:'近期無交叉'}；DIF 位於零軸${t.dif[n]>=0?'之上':'之下'}。`]);
  const r=t.rsi[n];rows.push(['RSI 14',fmt(r,1),r>=70?'位於 70 以上的偏熱區。':r<=30?'位於 30 以下的偏冷區。':`位於 30–70 中性區，${r>=50?'漲幅略占上風':'跌幅略占上風'}。`]);
  const kc=lastCross(t.k,t.d);rows.push(['KD 9',`K ${fmt(t.k[n],1)}／D ${fmt(t.d[n],1)}`,`${t.k[n]>=80?'K 值在 80 以上高檔':t.k[n]<=20?'K 值在 20 以下低檔':'K 值在中段'}；${kc?`${kc.ago===0?'本'+u:kc.ago+' '+u+'前'} K ${kc.up?'向上':'向下'}穿越 D`:'近期無交叉'}。`]);
  const vr=all[n].volume/t.volMa20[n];rows.push(['量能',`${fmt(vr,2)} 倍`,`最新成交 ${lots(all[n].volume)}，為 20 ${u}均量的 ${fmt(vr,2)} 倍（${vr>=1.5?'明顯放量':vr<=.6?'明顯縮量':'接近均量'}）。`]);
  const active=new Set(['趨勢','量能']);
  if(settings.overlays.boll)active.add('布林通道');
  if(settings.osc==='macd')active.add('MACD');
  if(settings.osc==='rsi')active.add('RSI 14');
  if(settings.osc==='kd')active.add('KD 9');
  box.innerHTML=`<div class="tech-head"><h4>技術面讀數</h4><span class="small">${all[n].date} · ${u} K</span></div><div class="tech-grid">${rows.filter(([k])=>active.has(k)).map(([k,v,d])=>`<div class="tech-item"><small>${k}</small><b>${v}</b><details><summary>判讀</summary><p>${d}</p></details></div>`).join('')}</div>`;
}
function drawSvgFallback(all){
  const node=$('chart');$('techRead').innerHTML='';
  if(!all.length){node.textContent='尚未取得 K 線資料';return}
  const vis=all.slice(-250),W=900,H=310,lo=Math.min(...vis.map(x=>x.low)),hi=Math.max(...vis.map(x=>x.high)),x=i=>10+i*(W-20)/Math.max(1,vis.length-1),y=v=>15+(hi-v)/(hi-lo||1)*(H-40);
  node.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${vis.map((b,i)=>`${x(i)},${y(b.close)}`).join(' ')}" fill="none" stroke="#19a7aa" stroke-width="2"/></svg>`;
  $('chartCaption').textContent=`圖表元件未載入，暫以最近 ${vis.length} 根收盤線顯示（${vis[0].date} 至 ${vis.at(-1).date}）。`;
}

/* ---------- Controls ---------- */
$('rangeSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-range]');if(b)setRange(b.dataset.range)});
$('anchorMode').addEventListener('change',function(){settings.anchorMode=this.value;updateAnchorControls();refreshAnchors()});
$('anchorCount').addEventListener('change',function(){settings.anchorCount=Math.max(1,Math.min(20,Math.round(Number(this.value)||5)));this.value=settings.anchorCount;refreshAnchors()});
$('showLevels').addEventListener('click',function(){settings.showLevels=!settings.showLevels;updateAnchorControls();drawChart(true);save()});
function updateAnchorControls(){
  settings.anchorMode=['wick','close','average'].includes(settings.anchorMode)?settings.anchorMode:'wick';
  settings.anchorCount=Math.max(1,Math.min(20,Math.round(Number(settings.anchorCount)||5)));
  settings.showLevels=settings.showLevels!==false;
  $('anchorMode').value=settings.anchorMode;$('anchorCount').value=settings.anchorCount;
  $('anchorCountWrap').classList.toggle('hidden',settings.anchorMode!=='average');
  $('showLevels').setAttribute('aria-pressed',String(settings.showLevels));
  for(const id of ['anchorMode','anchorCount','showLevels'])$(id).disabled=shareView;
}
function refreshAnchors(){computePosition();renderPosition();computeMarket();computeBrent();computeFx();updateWeights();drawChart(true);save()}
updateAnchorControls();
$('window').addEventListener('change',()=>drawChart(true));
$('method').addEventListener('change',()=>drawChart(true));
$('intervalSeg').addEventListener('click',()=>setTimeout(()=>setRange(chartRange),0));
function zoom(f){if(!lwc)return;const ts=lwc.main.timeScale(),r=ts.getVisibleLogicalRange();if(!r)return;const n=lwc.data.length,span=Math.max(15,Math.min(n+5,(r.to-r.from)*f)),to=Math.min(n+3,r.to);ts.setVisibleLogicalRange({from:to-span,to})}
function pan(dir){if(!lwc)return;const ts=lwc.main.timeScale(),r=ts.getVisibleLogicalRange();if(!r)return;const step=(r.to-r.from)*.3*dir;ts.setVisibleLogicalRange({from:r.from+step,to:r.to+step})}
$('zoomIn').addEventListener('click',()=>zoom(.6));$('zoomOut').addEventListener('click',()=>zoom(1.6));
$('panLeft').addEventListener('click',()=>pan(-1));$('panRight').addEventListener('click',()=>pan(1));
document.querySelectorAll('[data-overlay]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.overlay;settings.overlays[k]=!settings.overlays[k];applyOverlayButtons();save();drawChart(true)}));
$('oscSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-osc]');if(!b)return;settings.osc=b.dataset.osc;applyOverlayButtons();save();drawChart(true)});
const originalPrefs=prefs;
prefs=function(){originalPrefs();if(lwc){lwc.main.applyOptions({...chartOptions(),timeScale:{...chartOptions().timeScale,visible:false}});lwc.vol.applyOptions(chartOptions());lwc.osc.applyOptions(chartOptions())}};

/* ---------- Volume basis: exchange-reported lots, or converted across splits ---------- */
// Bollinger bands are opt-in; earlier test builds may have saved them as on.
if(settings.overlayRev!==2){settings.overlays.boll=false;settings.overlayRev=2}
settings.volumeBasis=settings.volumeBasis==='adjusted'?'adjusted':'raw';
$('volumeBasis').value=settings.volumeBasis;
$('volumeBasis').addEventListener('change',function(){settings.volumeBasis=this.value==='adjusted'?'adjusted':'raw';save();drawChart(true)});
function volumeAdjusted(){return settings.volumeBasis==='adjusted'&&(historyMeta?.adjustments||[]).length>0}
// A 1→4 split (factor 4) means one old lot equals four of today's lots, so earlier volume is multiplied by 4.
function withVolumeBasis(list){
  if(!volumeAdjusted())return list;
  const adj=historyMeta.adjustments;
  return list.map(b=>{let f=1;for(const a of adj)if(b.date<a.date)f*=a.factor;return f===1?b:{...b,volume:b.volume*f}});
}
applyOverlayButtons();

/* ---------- Live market factors (every five minutes) ---------- */
let live=null,liveAt=null,intradayProfile=null;
function mergeDays(base,extra){const m=new Map(base.map(x=>[x.date,x]));for(const x of extra||[])if(x&&x.date&&Number.isFinite(x.value))m.set(x.date,x);return[...m.values()].sort((a,b)=>a.date.localeCompare(b.date))}
const hhmm=d=>d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'});
async function loadIntradayProfile(){try{const r=await fetch('/api/intraday-profile'),d=await r.json();if(r.ok&&Array.isArray(d.days))intradayProfile=d}catch{}}
function applyLive(){
  if(live?.brent?.days?.length&&brent.length){brent=mergeDays(brent,live.brent.days);brentSnapshot=false}
  if(live?.fx?.days?.length&&fx.length)fx=mergeDays(fx,live.fx.days);
  computeMarket();computeBrent();computeFx();updateWeights();
}
function renderLiveMeta(){
  if(!liveAt)return;
  $('refreshClock').textContent=hhmm(liveAt);
  const parts=[];
  if(live?.intraday)parts.push('大盤盤中 '+live.intraday.time.slice(0,5));
  if(live?.brent)parts.push('EIA 公布至 '+live.brent.latest);
  if(live?.fx)parts.push('央行公布至 '+live.fx.latest);
  if(live?.errors?.length)parts.push('部分來源暫不可用：'+live.errors.join('；'));
  $('liveMeta').textContent=parts.join(' · ')||'等待下一次更新';
}
async function loadLive(){
  if(!window.CHAOWEI_LIVE){$('liveMeta').textContent='此版本未連接即時市場資料';return}
  try{live=await window.CHAOWEI_LIVE();liveAt=new Date()}
  catch(e){$('liveMeta').textContent='即時市場資料暫不可用：'+e.message+'；暫用每日快照';return}
  if(live?.intraday&&!intradayProfile)await loadIntradayProfile();
  applyLive();renderLiveMeta();
}
const baseLoadBrent=loadBrent,baseLoadFx=loadFx;
loadBrent=async function(){await baseLoadBrent();applyLive()};
loadFx=async function(){await baseLoadFx();applyLive()};
// Intraday: the provisional TAIEX joins the index range; turnover is compared only with past days at the same time of day.
const baseComputeMarket=computeMarket;
computeMarket=function(){
  const li=live?.intraday;
  if(!li||!market.length||!(li.index>0)||li.date<=market.at(-1).date){baseComputeMarket();return}
  const saved=market;
  market=[...saved,{date:li.date,index:li.index,volume:li.lots*1000,value:(li.valueMillion||0)*1e6,intraday:true}];
  try{baseComputeMarket()}finally{market=saved}
  if(!marketPosition)return;
  $('indexMeta').textContent=$('indexMeta').textContent.replace(li.date,'盤中 '+li.time.slice(0,5));
  const t=String(li.volumeTime||li.time),mins=Number(t.slice(0,2))*60+Number(t.slice(3,5)),m=Math.floor(mins/5)*5;
  const mark=String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0');
  const idx=intradayProfile?.marks?.indexOf(mark)??-1;
  const n=settings.window==='all'?Infinity:Number(settings.window);
  const prior=(intradayProfile?.days||[]).filter(([d])=>d<li.date).slice(-n).map(([,l])=>l[idx]).filter(Number.isFinite);
  const today=li.marks?.[mark]??li.lots;
  if(idx<0||prior.length<20||!(today>0)){
    marketPosition.volumeGrade=null;$('volumeScore').textContent='—';
    $('volumeMeta').textContent='盤中 '+t.slice(0,5)+' 累計 '+fmt(li.lots*1000/1e8,2)+' 億股 · 同時段歷史不足，暫不計分';return;
  }
  const rank=prior.filter(v=>v<=today).length/prior.length,grade=Math.max(1,Math.min(5,Math.ceil(rank*5)));
  marketPosition.volumeGrade=grade;marketPosition.rank=rank;
  $('volumeScore').textContent=grade+' / 5';
  $('volumeMeta').textContent='盤中 '+mark.slice(0,2)+':'+mark.slice(2)+' 累計 '+fmt(today*1000/1e8,2)+' 億股 · 與前 '+prior.length+' 日同時段比第 '+Math.round(rank*100)+' 百分位';
};
const baseComputeBrent=computeBrent;
computeBrent=function(){baseComputeBrent();if(brentPosition&&live?.brent&&liveAt)$('brentMeta').textContent+=' · '+hhmm(liveAt)+' 讀取 EIA'};
const liveComputeFx=computeFx;
computeFx=function(){liveComputeFx();if(fxPosition&&live?.fx&&liveAt)$('fxMeta').textContent=$('fxMeta').textContent.replace(' · 每日快照','')+' · '+hhmm(liveAt)+' 讀取央行'};
const baseUpdateWeights=updateWeights;
updateWeights=function(){baseUpdateWeights();if(Number($('wVolume').value)>0&&settings.volumeDirection!=='off'&&marketPosition&&marketPosition.volumeGrade==null){$('combined').textContent='—';$('combinedExtra').textContent='盤中同時段量能資料不足，暫不計算綜合分'}};
loadLive();
setInterval(()=>{if(!document.hidden)loadLive()},300000);

/* ---------- Pullback backtest: buy on drawdowns, sell on gains, markers on the chart ---------- */
const BT_DEFAULT={mode:'pct',drop:20,step:10,adds:3,sellMode:'cost',rise:20,fibWindow:240,levels:[0.382,0.5,0.618],fibSell:1,amount:100000,period:'5',markers:true};
settings.bt=Object.assign({},BT_DEFAULT,settings.bt||{});
let btResult=null,btBarsRef=null;
const clampNum=(v,lo,hi,d)=>{const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d};
function btConfigFromForm(){
  const levels=[...document.querySelectorAll('.bt-levels input:checked')].map(x=>Number(x.value)).sort((a,b)=>a-b);
  settings.bt={mode:settings.bt.mode,drop:clampNum($('btDrop').value,1,90,20),step:clampNum($('btStep').value,1,50,10),adds:Math.round(clampNum($('btAdds').value,0,10,3)),
    sellMode:$('btSellMode').value==='high'?'high':'cost',rise:clampNum($('btRise').value,1,300,20),fibWindow:Math.round(clampNum($('btFibWindow').value,20,2400,240)),
    levels:levels.length?levels:[0.382],fibSell:[1,1.272,1.618].includes(Number($('btFibSell').value))?Number($('btFibSell').value):1,
    amount:Math.round(clampNum($('btAmount').value,1000,1e9,100000)),period:$('btPeriod').value,markers:settings.bt.markers};
  save();
}
function btFillForm(){
  const c=settings.bt;
  $('btDrop').value=c.drop;$('btStep').value=c.step;$('btAdds').value=c.adds;$('btSellMode').value=c.sellMode;$('btRise').value=c.rise;
  $('btFibWindow').value=c.fibWindow;$('btFibSell').value=String(c.fibSell);$('btAmount').value=c.amount;$('btPeriod').value=c.period;
  document.querySelectorAll('.bt-levels input').forEach(x=>{x.checked=c.levels.includes(Number(x.value))});
  $('btModeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.mode===c.mode));
  $('btPct').classList.toggle('hidden',c.mode!=='pct');$('btFib').classList.toggle('hidden',c.mode!=='fib');
  $('btMarkers').setAttribute('aria-pressed',String(!!c.markers));
}
function btStartIndex(period){
  if(period==='all'||!bars.length)return 0;
  const d=new Date(bars.at(-1).date+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-Number(period));
  const start=d.toISOString().slice(0,10),i=bars.findIndex(b=>b.date>=start);return i<0?0:i;
}
// Trades fill at the signal day's close; fractional shares, no fees, taxes or dividends.
function backtest(cfg,start){
  const trades=[];let shares=0,cost=0,buys=0,spent=0,proceeds=0,peakCapital=0,refHigh=null,anchorHi=null,anchorLo=null,best=0,mdd=0;
  const buy=(b,reason)=>{const sh=cfg.amount/b.close;shares+=sh;cost+=cfg.amount;spent+=cfg.amount;buys++;peakCapital=Math.max(peakCapital,cost);trades.push({date:b.date,type:'buy',price:b.close,shares:sh,amount:cfg.amount,reason})};
  const sell=(b,reason)=>{const amt=shares*b.close,pnl=amt-cost;proceeds+=amt;trades.push({date:b.date,type:'sell',price:b.close,shares,amount:amt,pnl,ret:pnl/cost,reason});shares=0;cost=0;buys=0};
  for(let i=start;i<bars.length;i++){
    const b=bars[i],c=b.close;
    if(cfg.mode==='pct'){
      if(!buys){
        refHigh=refHigh==null?c:Math.max(refHigh,c);
        if(c<=refHigh*(1-cfg.drop/100)){anchorHi=refHigh;buy(b,'自高點 '+fmt(anchorHi,2)+' 下跌 '+fmt((1-c/anchorHi)*100,1)+'%')}
      }else{
        while(buys<=cfg.adds&&c<=anchorHi*(1-(cfg.drop+buys*cfg.step)/100))buy(b,'再跌至 −'+fmt(cfg.drop+(buys)*cfg.step,0)+'% 加碼');
        const target=cfg.sellMode==='cost'?cost/shares*(1+cfg.rise/100):anchorHi*(1+cfg.rise/100);
        if(c>=target){sell(b,cfg.sellMode==='cost'?'高於平均成本 '+fmt(cfg.rise,0)+'%':'突破前高 '+fmt(anchorHi,2)+' 的 '+fmt(cfg.rise,0)+'%');refHigh=c}
      }
    }else{
      if(!buys){
        if(i-start<20&&i<cfg.fibWindow)continue;
        let hi=-Infinity,lo=Infinity;for(let j=Math.max(0,i-cfg.fibWindow);j<i;j++){hi=Math.max(hi,bars[j].high);lo=Math.min(lo,bars[j].low)}
        if(hi>lo&&c<=hi-cfg.levels[0]*(hi-lo)){anchorHi=hi;anchorLo=lo;buy(b,'回檔至 '+fmt(cfg.levels[0]*100,1)+'% 位階')}
      }else{
        while(buys<cfg.levels.length&&c<=anchorHi-cfg.levels[buys]*(anchorHi-anchorLo))buy(b,'回檔至 '+fmt(cfg.levels[buys]*100,1)+'% 位階加碼');
        if(c>=anchorLo+cfg.fibSell*(anchorHi-anchorLo))sell(b,cfg.fibSell===1?'回到區間高點':'突破 '+fmt(cfg.fibSell*100,1)+'% 擴展位');
      }
    }
    const pnl=proceeds+shares*c-spent;best=Math.max(best,pnl);if(peakCapital>0)mdd=Math.max(mdd,(best-pnl)/peakCapital);
  }
  const last=bars.at(-1),first=bars[start],pnl=proceeds+shares*last.close-spent,years=Math.max(1/365,(Date.parse(last.date)-Date.parse(first.date))/31557600000);
  const ret=peakCapital?pnl/peakCapital:0,sells=trades.filter(t=>t.type==='sell');
  return{trades,spent,proceeds,shares,openCost:cost,openValue:shares*last.close,pnl,peakCapital,ret,annual:peakCapital&&ret>-1?Math.pow(1+ret,1/years)-1:0,mdd,
    hold:last.close/first.close-1,start:first.date,end:last.date,wins:sells.filter(t=>t.pnl>0).length,sells:sells.length,buys:trades.length-sells.length};
}
const pctText=v=>(v>0?'+':'')+fmt(v*100,1)+'%';
function renderBacktest(){
  if(!bars.length||bars.length<30){$('btResult').innerHTML='<p class="small">需要至少 30 個交易日才能回測。</p>';$('btGrid').innerHTML='';$('btTrades').innerHTML='';btResult=null;return}
  const cfg=settings.bt,start=btStartIndex(cfg.period),r=backtest(cfg,start);btResult=r;btBarsRef=bars;
  const cls=v=>v>0?'up':v<0?'down':'';
  const tiles=[['回測期間',r.start+' 至 '+r.end],['買進／賣出',r.buys+' 次／'+r.sells+' 次'+(r.sells?'（獲利 '+r.wins+' 次）':'')],
    ['最高同時投入',fmt(r.peakCapital,0)+' 元'],['損益',`<span class="${cls(r.pnl)}">${(r.pnl>0?'+':'')+fmt(r.pnl,0)} 元</span>`],
    ['報酬率（以最高投入計）',`<span class="${cls(r.ret)}">${pctText(r.ret)}</span>`],['年化報酬',`<span class="${cls(r.annual)}">${pctText(r.annual)}</span>`],
    ['最大回落（占投入）','−'+fmt(r.mdd*100,1)+'%'],['同期間買進持有',`<span class="${cls(r.hold)}">${pctText(r.hold)}</span>`]];
  const openNote=r.shares>0?`<p class="small">期末仍持有 ${fmt(r.shares,0)} 股（成本 ${fmt(r.openCost,0)} 元、市值 ${fmt(r.openValue,0)} 元），已計入損益。</p>`:'';
  $('btResult').innerHTML=(r.buys?'':'<p class="small">回測期間沒有觸發買進條件，可放寬下跌幅度或拉長期間。</p>')+`<div class="bt-tiles">${tiles.map(([k,v])=>`<div class="bt-tile"><small>${k}</small><b>${v}</b></div>`).join('')}</div>${openNote}`;
  // Sensitivity grid: how the return changes with the entry drop and the exit gain.
  let rows,cols,label,make;
  if(cfg.mode==='pct'){rows=[10,15,20,25,30];cols=[10,20,30,50];label=['首次買進：下跌','賣出：上漲'];make=(a,b)=>({...cfg,drop:a,rise:b})}
  else{rows=[0.236,0.382,0.5,0.618];cols=[1,1.272,1.618];label=['首次買進位階','賣出位置'];make=(a,b)=>({...cfg,levels:[a,...cfg.levels.filter(x=>x>a)],fibSell:b})}
  const fmtRow=v=>cfg.mode==='pct'?v+'%':fmt(v*100,1)+'%',fmtCol=v=>cfg.mode==='pct'?v+'%':fmt(v*100,1)+'%';
  const isCur=(a,b)=>cfg.mode==='pct'?a===cfg.drop&&b===cfg.rise:a===cfg.levels[0]&&b===cfg.fibSell;
  let g=`<table><thead><tr><th>${label[0]} ＼ ${label[1]}</th>${cols.map(c=>`<th>${fmtCol(c)}</th>`).join('')}</tr></thead><tbody>`;
  for(const a of rows){g+=`<tr><th>${fmtRow(a)}</th>`;for(const b of cols){const x=backtest(make(a,b),start);g+=`<td class="${cls(x.ret)}${isCur(a,b)?' current':''}" title="買 ${x.buys} 次、賣 ${x.sells} 次">${x.buys?pctText(x.ret):'未觸發'}</td>`}g+='</tr>'}
  $('btGrid').innerHTML=g+'</tbody></table><p class="small">報酬率以「最高同時投入資金」計算，其他設定（加碼、投入金額、期間）沿用上方。框起來的是目前設定。</p>';
  $('btTrades').innerHTML=r.trades.length?`<table><thead><tr><th>日期</th><th>動作</th><th>價格</th><th>股數</th><th>金額</th><th>原因</th><th>損益</th></tr></thead><tbody>${r.trades.map(t=>`<tr><td>${t.date}</td><td class="${t.type==='buy'?'buy':'sell'}">${t.type==='buy'?'買進':'賣出'}</td><td>${fmt(t.price,2)}</td><td>${fmt(t.shares,0)}</td><td>${fmt(t.amount,0)}</td><td>${t.reason}</td><td class="${t.pnl?cls(t.pnl):''}">${t.type==='sell'?(t.pnl>0?'+':'')+fmt(t.pnl,0)+'（'+pctText(t.ret)+'）':''}</td></tr>`).join('')}</tbody></table>`:'<p class="small">沒有交易。</p>';
  applyMarkers();
}
/* ---------- Member-only cards: backtest and weight plans unlock with Google sign-in ---------- */
let isMember=false;
window.chaoweiSetMember=signedIn=>{
  isMember=!!signedIn;document.body.classList.toggle('member',isMember);
  // Blurred content must not be reachable by keyboard or screen reader either.
  document.querySelectorAll('.member-only').forEach(card=>{for(const el of card.children)if(!el.classList.contains('member-lock'))el.inert=!isMember});
  applyMarkers();updateWeights();
};
document.querySelectorAll('[data-open-account]').forEach(b=>b.addEventListener('click',openAccount));
window.chaoweiSetMember(false);
function applyMarkers(){
  if(!lwc)return;
  if(!isMember||!btResult||!settings.bt.markers||!lwc.data.length){lwc.s.candle.setMarkers([]);return}
  const dates=lwc.data.map(b=>b.date),markers=[];
  for(const t of btResult.trades){
    let lo=0,hi=dates.length-1,at=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(dates[mid]<=t.date){at=mid;lo=mid+1}else hi=mid-1}
    if(at<0)continue;
    markers.push(t.type==='buy'?{time:dates[at],position:'belowBar',color:'#0e7490',shape:'arrowUp',text:'買'}:{time:dates[at],position:'aboveBar',color:'#c2410c',shape:'arrowDown',text:'賣'});
  }
  markers.sort((a,b)=>a.time.localeCompare(b.time));
  lwc.s.candle.setMarkers(markers);
}
const btDrawChart=drawChart;
drawChart=function(keepView){btDrawChart(keepView);if(bars.length&&btBarsRef!==bars)renderBacktest();else applyMarkers()};
$('btModeSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(!b)return;settings.bt.mode=b.dataset.mode;btFillForm();btConfigFromForm();renderBacktest()});
for(const id of ['btDrop','btStep','btAdds','btSellMode','btRise','btFibWindow','btFibSell','btAmount','btPeriod'])$(id).addEventListener('change',()=>{btConfigFromForm();btFillForm();renderBacktest()});
document.querySelectorAll('.bt-levels input').forEach(x=>x.addEventListener('change',()=>{btConfigFromForm();btFillForm();renderBacktest()}));
$('btMarkers').addEventListener('click',()=>{settings.bt.markers=!settings.bt.markers;save();btFillForm();applyMarkers()});
btFillForm();

/* ---------- Daily change next to the latest close, and on the chart's price label ---------- */
function dayChange(){
  const last=bars.at(-1);if(!last)return null;
  const provisional=liveQuote?.available&&liveQuote.date>last.date;
  const value=provisional?liveQuote.price:last.close,ref=provisional?(liveQuote.previousClose||last.close):bars.at(-2)?.close;
  return Number.isFinite(value)&&ref>0?{chg:value-ref,pct:(value-ref)/ref*100}:null;
}
const changeText=d=>(d.chg>0?'+':'')+fmt(d.chg,2)+'（'+(d.pct>0?'+':'')+fmt(d.pct,2)+'%）';
function renderChange(){
  const d=dayChange();
  for(const id of ['priceChange','barChange']){
    const el=$(id);el.classList.remove('up','down');
    if(!d){el.textContent=id==='barChange'?'—':'';continue}
    if(d.chg)el.classList.add(d.chg>0?'up':'down');
    el.textContent=(id==='priceChange'?(d.chg>0?'▲ ':d.chg<0?'▼ ':'')+'較前一交易日 ':'')+changeText(d);
  }
}
const changeRenderPosition=renderPosition;
renderPosition=function(){changeRenderPosition();renderChange()};
function labelLastBar(){
  if(!lwc)return;const all=lwc.data,b=all.at(-1),p=all.at(-2);
  lwc.s.candle.applyOptions({title:b&&p&&p.close>0?(b.close>=p.close?'+':'')+fmt((b.close-p.close)/p.close*100,2)+'%':''});
}

/* ---------- One crosshair across price, volume and indicator panes ---------- */
function syncCrosshair(){
  if(!lwc||lwc.crossSynced)return;lwc.crossSynced=true;
  const {main,vol,osc,s}=lwc,panes=[main,vol,osc];
  const target=chart=>{
    if(chart===main)return{series:s.candle,val:i=>lwc.data[i]?.close};
    if(chart===vol)return{series:s.volume,val:i=>lwc.data[i]?lwc.data[i].volume/1000:null};
    const o=settings.osc;if(o==='none')return null;
    const key=o==='macd'?'dif':o==='rsi'?'rsi':'k';return{series:s[key],val:i=>lwc.tech?.[key]?.[i]};
  };
  for(const from of panes)from.subscribeCrosshairMove(p=>{
    for(const to of panes){
      if(to===from)continue;const t=target(to);if(!t)continue;
      const i=p&&p.time&&Number.isFinite(p.logical)?Math.round(p.logical):-1,v=i>=0?t.val(i):null;
      if(v==null||!Number.isFinite(v))to.clearCrosshairPosition();else to.setCrosshairPosition(v,p.time,t.series);
    }
  });
}
const crossDrawChart=drawChart;
drawChart=function(keepView){crossDrawChart(keepView);syncCrosshair();labelLastBar()};

/* ---------- Favourites: up to ten saved condition sets for members, one click to apply ---------- */
settings.favorites=Array.isArray(settings.favorites)?settings.favorites.filter(f=>f&&typeof f.name==='string'&&f.s&&typeof f.s==='object').slice(0,10):[];
function favSnapshot(){return{window:settings.window,preferredWindow:settings.preferredWindow||settings.window,method:settings.method,anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,basis:$('basis').value,bt:{...settings.bt}}}
function favLabel(s){
  const a={wick:'最高最低',close:'收盤極值',average:'平均 '+s.anchorCount+' 筆'}[s.anchorMode]||'';
  const bt=s.bt?.mode==='fib'?'黃金分割回測':'跌 '+s.bt?.drop+'% 買／漲 '+s.bt?.rise+'% 賣';
  return (s.window==='all'?'全部':s.window+' 日')+' · '+(s.method==='fib'?'黃金分割':'等距')+' · '+a+' · '+bt;
}
const favSame=(a,b)=>JSON.stringify({...a,bt:{...a.bt,markers:0}})===JSON.stringify({...b,bt:{...b.bt,markers:0}});
function renderFavs(){
  const box=$('favList'),cur=favSnapshot();box.replaceChildren();
  settings.favorites.forEach((f,i)=>{
    const chip=document.createElement('span');chip.className='fav-chip'+(favSame(f.s,cur)?' on':'');
    const go=document.createElement('button');go.type='button';go.textContent=f.name;go.title=favLabel(f.s);go.addEventListener('click',()=>applyFav(f));
    const del=document.createElement('button');del.type='button';del.className='fav-del';del.textContent='×';del.setAttribute('aria-label','刪除收藏「'+f.name+'」');
    del.addEventListener('click',()=>{settings.favorites.splice(i,1);save();renderFavs()});
    chip.append(go,del);box.append(chip);
  });
  $('favAdd').disabled=settings.favorites.length>=10;
  $('favAdd').textContent=settings.favorites.length>=10?'已達 10 組上限':'＋ 收藏目前條件';
}
function applyFav(f){
  const s=f.s;
  Object.assign(settings,{window:s.window,preferredWindow:s.preferredWindow||s.window,method:s.method,anchorMode:s.anchorMode,anchorCount:s.anchorCount});
  if(s.bt)settings.bt=Object.assign({},BT_DEFAULT,s.bt);
  $('window').value=settings.window;$('method').value=settings.method;if(s.basis&&!$('basis').querySelector(`option[value="${s.basis}"]`)?.disabled)$('basis').value=s.basis;
  updateAnchorControls();btFillForm();
  const auto=autoWindow(selected);
  computePosition();renderPosition();computeMarket();computeBrent();computeFx();updateWeights();
  btBarsRef=null;drawChart(true);save();renderFavs();
  notice(auto||'已套用收藏「'+f.name+'」：'+favLabel(s));
}
$('favAdd').addEventListener('click',()=>{
  if(!isMember){openAccount();return}
  if(settings.favorites.length>=10){notice('我的最愛最多 10 組，請先刪除不用的條件。');return}
  const s=favSnapshot(),name=$('favName').value.trim()||favLabel(s).split(' · ').slice(0,2).join(' · ');
  settings.favorites.push({name,s,savedAt:new Date().toISOString()});$('favName').value='';save();renderFavs();
});
for(const id of ['window','method','anchorMode','anchorCount','basis'])$(id).addEventListener('change',()=>setTimeout(renderFavs,0));
const favApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{favApplyProfile(profile);
  settings.favorites=Array.isArray(settings.favorites)?settings.favorites.filter(f=>f&&typeof f.name==='string'&&f.s).slice(0,10):[];
  settings.bt=Object.assign({},BT_DEFAULT,settings.bt||{});btFillForm();btBarsRef=null;renderFavs();drawChart(true)};
renderFavs();

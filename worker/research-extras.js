/* Lightweight research notes and the selected ETF's official institutional snapshot. */
const PIN_LABEL={valley:'參考谷',peak:'參考峰',exclude:'略過'};
const PIN_COLOR={valley:'#168a83',peak:'#dc5b52',exclude:'#8496a0'};
settings.wavePins=Array.isArray(settings.wavePins)?settings.wavePins.filter(p=>p&&/^[0-9A-Z]{4,6}$/.test(p.code)&&['D','W','M'].includes(p.interval)&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&PIN_LABEL[p.kind]).slice(-300):[];

const pinPanel=document.createElement('section');
pinPanel.className='wave-pin-panel member-only';
pinPanel.innerHTML='<div class="research-head"><div><h4>圖釘標記</h4><p class="small">只整理研究樣本，不改評分或回測。</p></div><button class="pill chip" type="button" id="pinMode" aria-pressed="false">📌 標記 K 棒</button></div><div class="pin-controls"><label>標記用途<select id="pinKind"><option value="valley">參考波谷</option><option value="peak">參考波峰</option><option value="exclude">略過此處</option></select></label><label>簡短備註<input id="pinNote" type="text" maxlength="40" placeholder="例如：除息、雜訊"></label><button class="pill mini" type="button" id="pinExport">匯出標記</button></div><p class="small" id="pinHint">開啟圖釘後，點選圖上的 K 棒；日、週、月分別標記。</p><div class="pin-list" id="pinList"></div>';
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
      const markers=[...(window.chaoweiWaveMarkers||[]).filter(p=>times.has(p.time)),...currentPins().filter(p=>times.has(p.date)).map(p=>({time:p.date,position:p.kind==='peak'?'aboveBar':'belowBar',color:PIN_COLOR[p.kind],shape:p.kind==='exclude'?'circle':p.kind==='peak'?'arrowDown':'arrowUp',text:PIN_LABEL[p.kind]}))].sort((a,b)=>a.time.localeCompare(b.time));
      lwc.s.candle.setMarkers(markers);
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
chipCard.innerHTML='<div class="card-heading"><div><h3>ETF 法人籌碼</h3><p class="small">證交所盤後資料 · ETF 本身</p></div><label class="chip-date">資料日<select id="chipDate" aria-label="法人籌碼日期"></select></label></div><div id="chipContents" class="chip-contents"><p class="small">讀取法人資料中…</p></div><p class="small chip-source">買賣超是當日交易，並非持有庫存；外陸資持有數另列。<a href="https://www.twse.com.tw/zh/trading/foreign/t86.html" target="_blank" rel="noopener">交易來源</a> · <a href="https://www.twse.com.tw/zh/trading/foreign/mi-qfiis.html" target="_blank" rel="noopener">持有來源</a></p>';
$('chartCard').after(chipCard);
chipCard.insertAdjacentHTML('afterbegin','<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員專屬</span><h4>查看 ETF 法人籌碼</h4><p>登入後看外陸資持有單位與三大法人每日買賣超。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>');
let chipCode='',chipRows=[],chipGeneration=0;
const sharesToLots=n=>Number.isFinite(n)?`${fmt(n/1000,1)} 張`:'—';
function renderChip(){
  const node=$('chipContents'),date=$('chipDate').value,row=chipRows.find(x=>x[0]===date)||chipRows.at(-1);
  node.replaceChildren();if(!row){node.textContent='這檔 ETF 尚無可用的法人快照。';return}
  const [day,foreignNet,trustNet,dealerNet,totalNet,foreignHeld,issued]=row;
  const heading=document.createElement('div');heading.className='chip-summary';
  const pct=foreignHeld!=null&&issued>0?foreignHeld/issued*100:null;
  heading.innerHTML='<span>外陸資持有 ETF 單位</span><strong></strong><small></small>';
  heading.querySelector('strong').textContent=sharesToLots(foreignHeld);
  heading.querySelector('small').textContent=pct==null?'未公布持有比例':`約占已發行單位 ${fmt(pct,2)}%`;
  node.append(heading);
  const grid=document.createElement('div');grid.className='chip-grid';
  for(const [label,value] of [['外陸資買賣超',foreignNet],['投信買賣超',trustNet],['自營商買賣超',dealerNet],['三大法人合計',totalNet]]){
    const item=document.createElement('div');item.className='chip-item';
    const title=document.createElement('small');title.textContent=label;
    const amount=document.createElement('b');amount.textContent=(value>0?'+':'')+sharesToLots(value);amount.className=value>0?'up':value<0?'down':'';
    item.append(title,amount);grid.append(item);
  }
  node.append(grid);
  const prior=chipRows.filter(x=>x[0]<=day).slice(-20),sum=prior.reduce((n,x)=>n+x[1],0);
  const foot=document.createElement('p');foot.className='small';foot.textContent=`近 ${prior.length} 個已取得交易日：外陸資累計買賣超 ${(sum>0?'+':'')+sharesToLots(sum)}。投信、政府持有多少單位未由此報表提供。`;
  node.append(foot);
}
async function loadChips(code){
  if(!isMember)return;
  const generation=++chipGeneration;chipCode=code;chipRows=[];$('chipDate').replaceChildren();$('chipContents').textContent='讀取法人資料中…';
  try{
    const response=await fetch(`/api/chips?code=${encodeURIComponent(code)}`),data=await response.json();
    if(generation!==chipGeneration||code!==selected)return;
    chipRows=Array.isArray(data.rows)?data.rows.filter(r=>Array.isArray(r)&&/^\d{4}-\d{2}-\d{2}$/.test(r[0])).sort((a,b)=>a[0].localeCompare(b[0])):[];
    for(const r of chipRows.toReversed())$('chipDate').add(new Option(r[0],r[0]));
    $('chipDate').disabled=!chipRows.length;renderChip();
  }catch{if(generation===chipGeneration)$('chipContents').textContent='法人快照暫時無法取得。'}
}
$('chipDate').addEventListener('change',renderChip);
const researchLoadBars=loadBars;
loadBars=function(...args){if(selected!==chipCode)window.chaoweiWaveMarkers=[];if(isMember&&(selected!==chipCode||!chipRows.length))loadChips(selected);return researchLoadBars(...args)};
window.chaoweiResearchMemberChanged=signedIn=>{if(signedIn)loadChips(selected);else{chipRows=[];chipCode='';pinMode=false;pinModeButton.setAttribute('aria-pressed','false')}};

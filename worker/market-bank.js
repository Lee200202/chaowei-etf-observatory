// HiStock market-wide daily bank flows. Read the existing 23:15 store, never scrape once per visitor.
const bankTile=document.createElement('div');bankTile.className='factor';bankTile.innerHTML='<span class="factor-icon"></span><h4>八大官股 · 全市場</h4><strong id="bankScore">—</strong><p id="bankMeta">讀取 HiStock 日資料中</p><div class="factor-spark" id="bankSpark"></div><small>買超加分、賣超減分 · 平日約 23:15 單次擷取</small>';$('refreshClock').closest('.factor').before(bankTile);
const bankPanel=document.createElement('section');bankPanel.className='bank-market-trend';bankPanel.id='bankMarketTrend';trendPanel.after(bankPanel);
function computeBank(){
  const last=bankDays.at(-1),s=factorScore(bankDays.map(x=>x.value),true,true);bankPosition=s?{...s,last}:null;
  $('bankScore').textContent=s?fmt(s.core,1)+' / 5':'—';$('bankMeta').textContent=last?`${last.date} · ${last.value>=0?'買超':'賣超'} ${fmt(Math.abs(last.value),2)} 億元 · ${bankDays.length} 日`:'HiStock 資料暫不可用';
  const a=bankDays.slice(-30),max=Math.max(...a.map(x=>Math.abs(x.value)),1);
  $('bankSpark').innerHTML=`<svg viewBox="0 0 220 52" role="img" aria-label="八大官股近 30 日長條圖"><line x1="0" x2="220" y1="26" y2="26" stroke="currentColor" opacity=".25"/>${a.map((x,i)=>`<rect x="${i*220/a.length}" y="${x.value>=0?26-x.value/max*23:26}" width="${220/a.length*.7}" height="${Math.max(.5,Math.abs(x.value)/max*23)}" fill="${x.value>=0?RISE:FALL}" rx="1"/>`).join('')}</svg>`;
  renderBankTrend();
}
function renderBankTrend(){
  bankPanel.replaceChildren();
  const head=document.createElement('div');head.className='factor-trend-head';
  head.innerHTML='<h4>八大行庫每日淨額</h4><p class="small">與上方累計圖共用日期範圍及游標。</p>';
  bankPanel.append(head);
  const a=bankVisibleDays();
  if(!a.length){bankPanel.append(document.createTextNode('正在讀取 HiStock 全市場資料…'));return}
  bankPanel.append(chipChart({title:'HiStock 八大行庫每日淨額',unit:'億元',domain:'flow',syncGroup:'bank',width:Math.max(280,bankPanel.clientWidth||600),height:innerWidth<600?290:390,dates:a.map(x=>x.date),kind:'stack',series:[{name:'每日淨額',color:RISE,colorBySign:true,data:a.map(x=>x.value)}],format:v=>signNum(v,2)+' 億元'}));
  const p=document.createElement('p');p.className='small';p.textContent=`HiStock 同一來源，共 ${bankDays.length} 日；正值買超、負值賣超，零軸為中性。平日約 23:15 單次更新，失敗保留原資料。這是全市場公股券商交易淨額，不是 ETF 或政府持有庫存。`;bankPanel.append(p);
}
function bankVisibleDays(){
  const range=FACTOR_RANGES.find(row=>row[0]===settings.factorRange)||FACTOR_RANGES[0],months=range[2];
  if(range[0]==='ref')return bankDays.slice(-marketN());
  if(months<0)return bankDays.slice(months);
  if(!months||!bankDays.length)return bankDays;
  const d=new Date(bankDays.at(-1).date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-months);
  return bankDays.filter(row=>row.date>=d.toISOString().slice(0,10));
}
async function loadBanks(){
  try{const r=await fetch('/api/bank'),d=await r.json();if(r.ok&&d.rows?.length)bankDays=d.rows.map(x=>({date:x[0],value:x[1],index:x[2]}))}catch{}
  computeBank();updateWeights();
  if(window.CHAOWEI_BANK)try{const d=await window.CHAOWEI_BANK();if(d.rows?.length){bankDays=mergeDays(bankDays,d.rows.map(x=>({date:x[0],value:x[1],index:x[2]})));computeBank();updateWeights()}}catch{}
}
const marketApplyProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{marketApplyProfile(p);settings.marketWindow=Math.max(20,Math.min(2400,Number(settings.marketWindow)||120));settings.marketMethod=settings.marketMethod==='mean'?'mean':'normal';fillMarketConfig();recomputeFactors();document.dispatchEvent(new Event('market-lookback'))};
window.addEventListener('resize',()=>{clearTimeout(window.__bankResize);window.__bankResize=setTimeout(renderBankTrend,150)});
loadBanks();

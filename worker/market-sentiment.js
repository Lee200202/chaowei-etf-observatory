/* ---------- TAIFEX sentiment cards: options PCR and the mini-TAIEX retail long/short ratio ---------- */
// The card shows only what the other cards show; the formula, sources and counts live in the card dialog.
// Daily files from the evening/afternoon CI refresh, topped up every five minutes by the Apps Script live bundle,
// which reads TAIFEX directly (a day TAIFEX has published shows up before the next CI run).
var pcrDays=[],retailDays=[],pcrPosition=null,retailPosition=null,taifexCheckedAt=null;
settings.pcrThreshold=Number.isFinite(Number(settings.pcrThreshold))&&Number(settings.pcrThreshold)>0?Number(settings.pcrThreshold):100;
settings.retailThreshold=Number.isFinite(Number(settings.retailThreshold))?Number(settings.retailThreshold):0;
{
  const pcrTile=document.createElement('div');pcrTile.className='factor sentiment-factor';pcrTile.id='pcrTile';
  pcrTile.innerHTML='<span class="factor-icon"></span><h4>選擇權 PCR · 未平倉</h4><strong id="pcrScore">—</strong><p id="pcrMeta">讀取期交所臺指選擇權資料中</p>';
  const retailTile=document.createElement('div');retailTile.className='factor sentiment-factor';retailTile.id='retailTile';
  retailTile.innerHTML='<span class="factor-icon"></span><h4>散戶多空比 · 小台</h4><strong id="retailScore">—</strong><p id="retailMeta">讀取期交所小台與三大法人資料中</p>';
  $('refreshClock').closest('.factor').before(pcrTile,retailTile);
}
function sentimentAge(last){return bars.length&&last?(Date.parse(bars.at(-1).date)-Date.parse(last.date))/86400000:0}
function computePcr(){
  const last=pcrDays.at(-1),s=factorScore(pcrDays.map(x=>x.oiRatio));
  if(!last||!s){pcrPosition=null;$('pcrScore').textContent='—';$('pcrMeta').textContent=last?'參考資料不足 21 日':'期交所 PCR 暫不可用';return}
  if(sentimentAge(last)>10){pcrPosition=null;$('pcrScore').textContent='逾期';$('pcrMeta').textContent=last.date+' 之後沒有新資料，暫停計分';return}
  pcrPosition={...s,last};
  $('pcrMeta').textContent=`${last.date} · 未平倉 PCR ${fmt(last.oiRatio,2)}% · 賣權 ${fmt(last.putOi,0)} 口／買權 ${fmt(last.callOi,0)} 口`;
}
function computeRetail(){
  const last=retailDays.at(-1),s=factorScore(retailDays.map(x=>x.ratio));
  if(!last||!s){retailPosition=null;$('retailScore').textContent='—';$('retailMeta').textContent=last?'參考資料不足 21 日':'期交所散戶多空比暫不可用';return}
  if(sentimentAge(last)>10){retailPosition=null;$('retailScore').textContent='逾期';$('retailMeta').textContent=last.date+' 之後沒有新資料，暫停計分';return}
  retailPosition={...s,last};
  $('retailMeta').textContent=`${last.date} · 散戶${last.ratio>=0?'淨多':'淨空'} ${fmt(Math.abs(last.ratio),2)}% · 法人淨 ${signNum(last.net,0)} 口`;
}
function paintSentiment(){computePcr();computeRetail();updateWeights();if(factorTrendKey==='pcr'||factorTrendKey==='retail')renderFactorTrend();document.dispatchEvent(new Event('sentiment-updated'))}
let sentimentLoading=false;
async function loadSentiment(){
  if(sentimentLoading)return;sentimentLoading=true;
  const files=Promise.allSettled([fetch('/api/pcr').then(r=>r.json()),fetch('/api/retail').then(r=>r.json())]).then(([p,r])=>{
    if(p.status==='fulfilled'&&Array.isArray(p.value?.days))pcrDays=SentimentCore.merge(SentimentCore.pcrRows(p.value),pcrDays.filter(x=>x.live));
    if(r.status==='fulfilled'&&Array.isArray(r.value?.days))retailDays=SentimentCore.merge(SentimentCore.retailRows(r.value),retailDays.filter(x=>x.live));
    paintSentiment();
  });
  const live=(async()=>{
    if(!window.CHAOWEI_TAIFEX)return;
    const d=await window.CHAOWEI_TAIFEX();if(!d||d.error)return;
    // Live rows win over the file for the same date (TAIFEX may revise a day's counts after publication).
    if(d.pcr?.length)pcrDays=SentimentCore.merge(pcrDays,SentimentCore.pcrRows({days:d.pcr}).map(x=>({...x,live:true})));
    if(d.retail?.length)retailDays=SentimentCore.merge(retailDays,SentimentCore.retailRows({days:d.retail}).map(x=>({...x,live:true})));
    taifexCheckedAt=d.checkedAt||null;paintSentiment();
  })();
  await Promise.allSettled([files,live]);sentimentLoading=false;
}
FACTOR_TRENDS.pcr={title:'選擇權 PCR（未平倉 Put/Call 比）',unit:'%',color:'#a0527a',data:()=>pcrDays.map(x=>[x.date,x.oiRatio]),fmt:v=>fmt(v,2)+'%'};
FACTOR_TRENDS.retail={title:'散戶多空比（小型臺指期貨）',unit:'%',color:'#3f7f8c',data:()=>retailDays.map(x=>[x.date,x.ratio]),fmt:v=>signNum(v,2)+'%'};
for(const [key,id] of [['pcr','pcrTile'],['retail','retailTile']]){
  const tile=$(id);tile.dataset.trend=key;tile.tabIndex=0;tile.setAttribute('role','button');tile.setAttribute('aria-expanded','false');
  tile.setAttribute('aria-label',FACTOR_TRENDS[key].title+'：查看解讀與趨勢圖');
  const hint=document.createElement('span');hint.className='factor-more';hint.textContent='看解讀 ›';tile.append(hint);
}
const sentimentRecompute=recomputeFactors;recomputeFactors=function(){sentimentRecompute();computePcr();computeRetail();updateWeights()};
setInterval(()=>{if(!document.hidden)loadSentiment()},300000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadSentiment()});
window.addEventListener('chaowei-snapshot-updated',e=>{if(/options-pcr|retail-ratio/.test(e.detail?.path||''))loadSentiment()});
loadSentiment();

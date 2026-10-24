/* Member research: transparent swing rules and descriptive train/test split. */
settings.waveStudy=settings.waveStudy&&typeof settings.waveStudy==='object'?settings.waveStudy:{};
const waveCard=document.createElement('section');
waveCard.className='wave-study card member-only';waveCard.id='waveStudy';
waveCard.innerHTML=`<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員專屬</span><h4>研究 ETF 波段</h4><p>登入後調整轉折、拉回速度與大小波定義；保存圖釘和研究設定。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>
<div class="card-heading"><div><p class="kicker teal">WAVE LAB</p><h3>波段研究</h3><p class="small" id="waveSubtitle">用已確認收盤資料，拆解漲跌與時間。</p></div><button class="pill mini" type="button" id="waveMarks" aria-pressed="false">顯示自動轉折</button></div>
<div class="wave-settings">
<label>價格口徑<select id="waveBasis"><option value="total">分割＋配息還原</option><option value="split">僅分割還原</option></select></label>
<label>峰谷最短間隔<input id="waveMinBars" type="number" min="2" max="120" step="1" inputmode="numeric"><span class="wave-unit">根 K 棒</span></label>
<label>確認反向幅度<input id="waveReversal" type="number" min="0.5" max="30" step="0.5" inputmode="decimal"><span class="wave-unit">%</span></label>
<label>大波界線<input id="waveLarge" type="number" min="1" max="100" step="1" inputmode="decimal"><span class="wave-unit">%</span></label>
<label>快速拉回門檻<input id="waveFast" type="number" min="0.05" max="10" step="0.05" inputmode="decimal"><span class="wave-unit">%／根 K</span></label>
<label>測試期起日<input id="waveCutoff" type="date"><span class="wave-unit">留白＝全段研究</span></label>
</div>
<p class="small wave-rule">拉回速度＝峰到谷的跌幅絕對值 ÷ 經過的 K 棒數。日、週、月各有獨立設定；自動峰谷以收盤極值判定，達到反向幅度後才確認，確認日之前不可拿它做交易訊號。開啟圖上轉折後，標籤顯示該根 K 棒的收盤價；同畫面最多標示 24 個，放大或左右移動可查看其他波段。</p>
<div class="wave-summary" id="waveSummary" aria-live="polite">讀取波段資料中…</div>
<details class="wave-details"><summary>查看完整波與計算說明</summary><p class="small">谷 至 峰是上漲段；峰 至 谷是拉回段。大／小波依每段絕對漲跌幅分類；「快速」依每根 K 的平均跌幅分類。訓練／測試按轉折確認日切開，只描述歷史分布；交易策略仍用下方獨立回測工具。手動圖釘可標除息等雜訊，不會悄悄改動網站的 0–5 分或交易結果。</p><div class="wave-table-wrap"><table class="wave-table"><thead><tr><th>期間</th><th>類型</th><th>幅度</th><th>時間</th><th>速度</th><th>確認日</th></tr></thead><tbody id="waveRows"></tbody></table></div></details>`;
chipCard.after(waveCard);
let waveDividends=null,waveDivPromise=null,waveLastKey='',waveShowMarks=false,wavePivots=[];
const waveControl={basis:'waveBasis',minBars:'waveMinBars',reversal:'waveReversal',large:'waveLarge',fast:'waveFast',cutoff:'waveCutoff'};
function waveParams(){
  const base=interval==='W'?{minBars:3,reversal:5,large:12,fast:1.5}:interval==='M'?{minBars:2,reversal:8,large:18,fast:3}:ChaoweiWave.defaults;
  return ChaoweiWave.normalize({...base,...settings.waveStudy[interval]});
}
function wavePopulate(){const p=waveParams();for(const [key,id] of Object.entries(waveControl))$(id).value=p[key]??'';waveLastKey=interval}
function waveSave(){const raw={};for(const [key,id] of Object.entries(waveControl))raw[key]=$(id).value;settings.waveStudy[interval]=ChaoweiWave.normalize(raw);save();window.chaoweiWave.render()}
for(const [key,id] of Object.entries(waveControl)){
  $(id).addEventListener('change',waveSave);
  if(key!=='cutoff')$(id).addEventListener('input',waveSave);
}
function waveEnsureDividends(){
  if(waveDivPromise)return waveDivPromise;
  waveDivPromise=fetch('/api/dividends').then(r=>{if(!r.ok)throw Error('配息資料讀取失敗');return r.json()}).then(d=>{waveDividends=d;window.chaoweiWave.render();return d}).catch(e=>{waveDivPromise=null;$('waveSubtitle').textContent='配息資料暫不可用：'+e.message;return null});
  return waveDivPromise;
}
function waveRender(){
  if(waveLastKey!==interval)wavePopulate();
  if(!isMember){wavePivots=[];window.chaoweiWaveMarkers=[];return}
  if(!bars.length){wavePivots=[];window.chaoweiWaveMarkers=[];$('waveSummary').textContent='等待這檔 ETF 的日 K 資料。';return}
  const p=waveParams();
  if(p.basis==='total'&&!waveDividends){$('waveSummary').textContent='讀取配息資料後計算含息波段…';waveEnsureDividends();return}
  const events=waveDividends?.events?.[selected]||[];
  const adjusted=ChaoweiWave.priceSeries(bars,events,p.basis,historyMeta?.adjustments||[]);
  const series=aggregate(adjusted,interval);
  // The displayed weekly/monthly bar starts on its first trading day; its study
  // close belongs to the last trading day in that group, exactly like close.
  if(interval!=='D'){
    const key=date=>{if(interval==='M')return date.slice(0,7);const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)};
    const last=new Map(adjusted.map(b=>[key(b.date),b]));
    for(const bar of series){const ending=last.get(key(bar.date));bar.studyClose=ending?.studyClose??bar.close;bar.endDate=ending?.date||bar.date}
    // The last period is still forming. Keep it on the chart, but do not use
    // its temporary close to confirm a historical weekly/monthly pivot.
    series.pop();
  }
  const result=ChaoweiWave.detect(series,p);
  const excluded=currentPins().filter(x=>x.kind==='exclude').map(x=>x.date);
  const stat=ChaoweiWave.summary(result.segments,p.cutoff,excluded);
  const accepted=result.segments.filter(s=>!excluded.some(date=>date>=s.from.date&&date<=s.to.date));
  const pivot=result.pivots.at(-1),last=series.at(-1),latestChange=pivot&&last?((last.studyClose??last.close)/pivot.price-1)*100:null;
  waveBridgeData={code:selected,interval,params:p,segments:accepted,latestChange,lastDate:last?.endDate||last?.date,pivotDate:pivot?.date};
  wavePivots=[...new Map(accepted.flatMap(s=>[s.from,s.to]).map(x=>[x.date,x])).values()];
  const f=n=>n==null?'—':fmt(n,1),unit=ivName()+' K';
  const box=$('waveSummary');box.replaceChildren();
  const grid=document.createElement('div');grid.className='wave-metrics';
  for(const [label,value,note] of [
    ['已確認波段',String(stat.all.count),`${series[0]?.date||'—'} 至 ${series.at(-1)?.date||'—'}`],
    ['平均波長',`${f(stat.all.avgBars)} 根`,unit],
    ['平均漲跌幅',`${f(stat.all.avgChange)}%`,'每段絕對幅度'],
    ['平均拉回',`${f(stat.all.avgPullback)}%`,`${f(stat.all.avgPullbackSpeed)}%／根 ${unit}`]
  ]){const card=document.createElement('div');card.className='wave-metric';const a=document.createElement('small'),b=document.createElement('strong'),c=document.createElement('span');a.textContent=label;b.textContent=value;c.textContent=note;card.append(a,b,c);grid.append(card)}
  box.append(grid);
  const split=document.createElement('p');split.className='small wave-split';split.textContent=p.cutoff?`訓練期 ${stat.training.count} 段 · 測試期 ${stat.testing.count} 段（按確認日 ${p.cutoff} 分界） · 大波 ${stat.all.large} 段${stat.excluded?` · 略過 ${stat.excluded} 段`:''}。這是描述統計，尚非策略報酬。`:`大波 ${stat.all.large} 段 · 小波 ${stat.all.count-stat.all.large} 段${stat.excluded?` · 略過 ${stat.excluded} 段`:''}。可設定測試期起日，檢查較晚時段。`;
  box.append(split);
  $('waveRows').replaceChildren();for(const s of result.segments.slice(-100).reverse()){
    const tr=document.createElement('tr');const row=[`${s.from.date}  至  ${s.to.date}`,`${s.change>0?'上漲':'拉回'} · ${s.size}`,`${s.change>0?'+':''}${fmt(s.change,2)}%`,`${s.bars} 根 ${unit}`,`${fmt(s.speed,2)}%／根 · ${s.pace}`,s.availableDate];
    for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td)}$('waveRows').append(tr)
  }
  waveRefreshMarkers();
  if(typeof refreshWaveBridge==='function')refreshWaveBridge();
}
function waveRefreshMarkers(){
  if(!isMember||!waveShowMarks||!lwc?.data?.length){window.chaoweiWaveMarkers=[];window.chaoweiPins.render();return}
  const list=lwc.data,range=lwc.main.timeScale().getVisibleLogicalRange();
  const first=Math.max(0,Math.floor(range?.from??list.length-65)),last=Math.min(list.length-1,Math.ceil(range?.to??list.length-1));
  const prices=new Map(list.slice(first,last+1).map(b=>[b.date,b.close]));
  window.chaoweiWaveMarkers=wavePivots.filter(x=>prices.has(x.date)).slice(-24).map(x=>({time:x.date,position:x.kind==='peak'?'aboveBar':'belowBar',shape:x.kind==='peak'?'arrowDown':'arrowUp',color:x.kind==='peak'?'#d74640':'#139264',text:`${x.kind==='peak'?'峰':'谷'} ${fmt(prices.get(x.date),2)}`}));
  window.chaoweiPins.render();
}
window.chaoweiWave={render:waveRender,refreshMarkers:waveRefreshMarkers};
$('waveMarks').addEventListener('click',()=>{waveShowMarks=!waveShowMarks;$('waveMarks').setAttribute('aria-pressed',String(waveShowMarks));$('waveMarks').textContent=waveShowMarks?'隱藏自動轉折':'顯示自動轉折';waveRender()});
const waveMemberChanged=window.chaoweiResearchMemberChanged;
window.chaoweiResearchMemberChanged=signedIn=>{waveMemberChanged?.(signedIn);if(signedIn){waveEnsureDividends();waveRender()}else{window.chaoweiWaveMarkers=[];window.chaoweiPins.render()}};
const waveApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{waveApplyProfile(profile);settings.waveStudy=settings.waveStudy&&typeof settings.waveStudy==='object'?settings.waveStudy:{};wavePopulate();waveRender()};
wavePopulate();
// These cards are inserted after the base member gate initializes.
window.chaoweiSetMember(false);

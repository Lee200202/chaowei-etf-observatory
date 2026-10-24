/* Official weekly TDCC holder distribution for the selected ETF. */
const holderCard=document.createElement('section');holderCard.className='holder-card card member-only';holderCard.id='holderCard';
holderCard.innerHTML='<div class="card-heading"><div><h3>ETF 大戶持有分布</h3><p class="small">集保結算所每週資料 · ETF 本身</p></div></div><div id="holderContents" class="holder-contents"><p class="small">讀取集保資料中…</p></div><p class="small">持有 400 張以上的集保戶比例，不等於法人或八大官股持股，也不是每日買賣超。<a target="_blank" rel="noopener noreferrer">集保來源 ↗</a></p>';
holderCard.querySelector('a').href='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
chipCard.after(holderCard);
holderCard.insertAdjacentHTML('afterbegin','<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員專屬</span><h4>查看大戶持有分布</h4><p>登入後查看 ETF 集保戶 400 張以上與千張以上的持有比例。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>');
let holderPromise,holderPromiseAt=0,holderGeneration=0,holderRowsByCode=new Map(),holderCompleted=new Set(),holderLoading=new Set();
settings.holderRange=['3m','6m','1y','2y','all'].includes(settings.holderRange)?settings.holderRange:'1y';
function renderHolders(code,rows,status=''){
  const node=$('holderContents');node.replaceChildren();if(!rows.length){node.textContent=status||'集保目前沒有這檔 ETF 的持有分布。';return}
  const last=rows.at(-1),grid=document.createElement('div');grid.className='holder-grid';
  for(const [label,pct,count,color]of[['400 張以上',last[2],last[4],'#0e7490'],['1,000 張以上',last[3],last[5],'#e3a052']]){const item=document.createElement('div');item.className='holder-stat';const h=document.createElement('span');h.textContent=label;const b=document.createElement('strong');b.textContent=fmt(pct,2)+'%';const track=document.createElement('div');track.className='holder-meter';const fill=document.createElement('i');fill.style.width=Math.max(0,Math.min(100,pct))+'%';fill.style.background=color;track.append(fill);const detail=document.createElement('small');detail.textContent=`${fmt(count,0)} 戶 · ${last[0]}`;item.append(h,b,track,detail);grid.append(item)}node.append(grid);
  const controls=document.createElement('div');controls.className='segment';controls.setAttribute('role','group');controls.setAttribute('aria-label','集保歷史期間');
  for(const [id,label]of[['3m','3 個月'],['6m','6 個月'],['1y','1 年'],['2y','2 年'],['all','全部']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=settings.holderRange===id?'active':'';b.setAttribute('aria-pressed',String(settings.holderRange===id));b.addEventListener('click',()=>{settings.holderRange=id;save();renderHolders(code,rows,status)});controls.append(b)}node.append(controls);
  const months={ '3m':3,'6m':6,'1y':12,'2y':24},m=months[settings.holderRange],from=new Date(last[0]+'T00:00:00Z');if(m)from.setUTCMonth(from.getUTCMonth()-m);const visible=m?rows.filter(r=>r[0]>=from.toISOString().slice(0,10)):rows;
  if(visible.length>=2)node.append(chipChart({title:'大戶持有比例',unit:'%',width:Math.max(280,node.clientWidth||600),dates:visible.map(r=>r[0]),kind:'area',periodLabel:'週快照',series:[{name:'400 張以上',color:'#0e7490',data:visible.map(r=>r[2])},{name:'1,000 張以上',color:'#e3a052',data:visible.map(r=>r[3])}],format:v=>fmt(v,2)+'%'}));
  const note=document.createElement('p');note.className='small';note.textContent=`已取得 ${rows.length} 週，${rows[0][0]} 至 ${last[0]}。官網提供約一年歷史；選兩年僅顯示實際已累積資料，不補造缺週。`+(status?' '+status:'');node.append(note);
  if(window.CHAOWEI_HOLDERS){const b=document.createElement('button');b.className='pill mini';b.type='button';b.textContent=holderLoading.has(code)?'歷史讀取中…':'補齊官網一年歷史';b.disabled=holderLoading.has(code);b.addEventListener('click',()=>completeHolderHistory(code,holderGeneration));node.append(b)}
}
async function completeHolderHistory(code,gen){
  if(!isMember||!window.CHAOWEI_HOLDERS||holderLoading.has(code))return;holderLoading.add(code);let rows=holderRowsByCode.get(code)||[],status='';
  try{
  for(let k=0;k<8;k++){if(gen!==holderGeneration||code!==selected||!isMember)return;renderHolders(code,rows,`正在補齊歷史（第 ${k+1} 批）…`);
    try{const d=await window.CHAOWEI_HOLDERS(code);if(gen!==holderGeneration||code!==selected)return;const map=new Map(rows.map(r=>[r[0],r]));(d.rows||[]).forEach(r=>{if(r[1]===code)map.set(r[0],r)});rows=[...map.values()].sort((a,b)=>a[0].localeCompare(b[0]));holderRowsByCode.set(code,rows);status=d.error?'歷史讀取暫停：'+d.error:'';renderHolders(code,rows,status);if(d.error||!d.hasMore){if(!d.error)holderCompleted.add(code);return}}
    catch{status='歷史來源暫時無法連線，已保留現有資料。';return}
  }
  }finally{holderLoading.delete(code);if(gen===holderGeneration&&code===selected&&isMember)renderHolders(code,rows,status)}
}
async function loadHolders(code){
  if(!isMember||holderLoading.has(code))return;
  const gen=++holderGeneration,node=$('holderContents');node.textContent='讀取集保資料中…';
  try{
    if(!holderPromise||Date.now()-holderPromiseAt>300000){holderPromiseAt=Date.now();holderPromise=fetch('/api/holders').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()}).catch(e=>{holderPromise=null;throw e})}
    const d=await holderPromise;if(gen!==holderGeneration||code!==selected)return;
    const map=new Map((holderRowsByCode.get(code)||[]).map(r=>[r[0],r]));(d.rows||[]).filter(r=>r[1]===code&&/^\d{4}-\d{2}-\d{2}$/.test(r[0])).forEach(r=>map.set(r[0],r));const rows=[...map.values()].sort((a,b)=>a[0].localeCompare(b[0]));
    holderRowsByCode.set(code,rows);renderHolders(code,rows);if(rows.length<40&&!holderCompleted.has(code))completeHolderHistory(code,gen);return;
  }catch{if(gen===holderGeneration)node.textContent='集保資料暫時無法取得。'}
}
const holdersLoadBars=loadBars;loadBars=function(...args){if(isMember)loadHolders(selected);return holdersLoadBars(...args)};
const holdersMemberChanged=window.chaoweiResearchMemberChanged;
window.chaoweiResearchMemberChanged=signedIn=>{holdersMemberChanged?.(signedIn);if(signedIn)loadHolders(selected);else holderGeneration++};

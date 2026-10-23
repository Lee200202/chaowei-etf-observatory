/* Official weekly TDCC holder distribution for the selected ETF. */
const holderCard=document.createElement('section');holderCard.className='holder-card card member-only';holderCard.id='holderCard';
holderCard.innerHTML='<div class="card-heading"><div><h3>ETF 大戶持有分布</h3><p class="small">集保結算所每週資料 · ETF 本身</p></div></div><div id="holderContents" class="holder-contents"><p class="small">讀取集保資料中…</p></div><p class="small">持有 400 張以上的集保戶比例，不等於法人或八大官股持股，也不是每日買賣超。<a target="_blank" rel="noopener noreferrer">集保來源 ↗</a></p>';
holderCard.querySelector('a').href='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
chipCard.after(holderCard);
holderCard.insertAdjacentHTML('afterbegin','<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員專屬</span><h4>查看大戶持有分布</h4><p>登入後查看 ETF 集保戶 400 張以上與千張以上的持有比例。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>');
let holderPromise,holderGeneration=0;
async function loadHolders(code){
  if(!isMember)return;
  const gen=++holderGeneration,node=$('holderContents');node.textContent='讀取集保資料中…';
  try{
    holderPromise??=fetch('/api/holders').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()}).catch(e=>{holderPromise=null;throw e});
    const d=await holderPromise;if(gen!==holderGeneration||code!==selected)return;
    const rows=(d.rows||[]).filter(r=>r[1]===code&&/^\d{4}-\d{2}-\d{2}$/.test(r[0])).sort((a,b)=>a[0].localeCompare(b[0]));
    node.replaceChildren();if(!rows.length){node.textContent='集保開放資料目前沒有這檔 ETF 的持有分布。';return}
    const last=rows.at(-1),grid=document.createElement('div');grid.className='holder-grid';
    for(const [label,pct,count,color] of [['400 張以上',last[2],last[4],'#0e7490'],['1,000 張以上',last[3],last[5],'#e3a052']]){
      const item=document.createElement('div');item.className='holder-stat';
      const h=document.createElement('span');h.textContent=label;const b=document.createElement('strong');b.textContent=fmt(pct,2)+'%';
      const track=document.createElement('div');track.className='holder-meter';const fill=document.createElement('i');fill.style.width=Math.max(0,Math.min(100,pct))+'%';fill.style.background=color;track.append(fill);
      const detail=document.createElement('small');detail.textContent=`${fmt(count,0)} 戶 · ${last[0]}`;item.append(h,b,track,detail);grid.append(item)
    }
    node.append(grid);
    if(rows.length>=2){node.append(chipChart({title:'400 張以上持有比例',unit:'%',width:Math.max(280,node.clientWidth||600),dates:rows.map(r=>r[0]),kind:'area',series:[{name:'400 張以上',color:'#0e7490',data:rows.map(r=>r[2])}],format:v=>fmt(v,2)+'%'}))}
    else{const p=document.createElement('p');p.className='small';p.textContent='目前只有一週快照；後續每週追加後顯示趨勢。';node.append(p)}
  }catch{if(gen===holderGeneration)node.textContent='集保資料暫時無法取得。'}
}
const holdersLoadBars=loadBars;loadBars=function(...args){if(isMember)loadHolders(selected);return holdersLoadBars(...args)};
const holdersMemberChanged=window.chaoweiResearchMemberChanged;
window.chaoweiResearchMemberChanged=signedIn=>{holdersMemberChanged?.(signedIn);if(signedIn)loadHolders(selected);else holderGeneration++};

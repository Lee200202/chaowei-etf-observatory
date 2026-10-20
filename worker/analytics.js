/* ---------- Homepage search field and popular searches ---------- */
// Typing in the homepage field opens the full search with the same text.
$('homeSearch').addEventListener('focus',()=>{openSearch();setTimeout(()=>{if($('homeSearch').value){$('search').value=$('homeSearch').value;$('homeSearch').value='';renderList()}},40)});
$('homeSearch').addEventListener('input',()=>{$('search').value=$('homeSearch').value;$('homeSearch').value='';openSearch();renderList()});
let popular=null;
async function loadPopular(){
  if(popular||!window.CHAOWEI_POPULAR)return popular;
  try{const d=await window.CHAOWEI_POPULAR();popular=(d&&Array.isArray(d.codes)?d.codes:[]).filter(c=>catalog.some(x=>x.code===c))}catch{popular=[]}
  return popular;
}
function renderHot(){
  // Shown while the search box is empty: what visitors looked at most in the last 30 days.
  const q=$('search').value.trim(),list=(popular&&popular.length>=3?popular:POPULAR).slice(0,8);
  $('hotSearches').classList.toggle('hidden',!!q);
  $('hotList').innerHTML=list.map(c=>{const e=catalog.find(x=>x.code===c);return e?`<button class="pill mini" type="button" data-hot="${c}">${c} ${e.name}</button>`:''}).join('');
  $('hotNote').textContent=popular&&popular.length>=3?'近 30 天最多人查看':'常用 ETF（熱門資料累積中）';
}
$('hotList').addEventListener('click',e=>{const b=e.target.closest('[data-hot]');if(b){$('search').value='';pick(b.dataset.hot)}});
const hotRenderList=renderList;
renderList=function(){hotRenderList();renderHot()};
const hotOpenSearch=openSearch;
openSearch=function(){hotOpenSearch();renderHot();loadPopular().then(renderHot)};
for(const id of ['openSearch','openSearchTop'])$(id).addEventListener('click',()=>{renderHot();loadPopular().then(renderHot)});

/* ---------- Anonymous usage events: one row per event in the cloud spreadsheet ---------- */
settings.usage=settings.usage!==false;$('usageOptIn').checked=settings.usage;
$('usageOptIn').addEventListener('change',function(){settings.usage=this.checked;save()});
const rid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g,'').slice(0,36);
let visitorId,sessionId;
try{visitorId=localStorage.getItem('chaowei-vid')||rid();localStorage.setItem('chaowei-vid',visitorId)}catch{visitorId=rid()}
try{sessionId=sessionStorage.getItem('chaowei-sid')||rid();sessionStorage.setItem('chaowei-sid',sessionId)}catch{sessionId=rid()}
let sentCount=0;const queue=[];let flushTimer=0;
function track(type,data={}){
  if(!settings.usage||!window.CHAOWEI_LOG||sentCount>=300)return;
  queue.push({type,vid:visitorId,sid:sessionId,device:matchMedia('(max-width: 760px)').matches?'mobile':'desktop',host:window.CHAOWEI_HOST==='apps-script'?'gas':'pages',member:typeof isMember!=='undefined'&&isMember,...data});sentCount++;
  clearTimeout(flushTimer);flushTimer=setTimeout(flushEvents,1500);
}
function flushEvents(){if(!queue.length)return;window.CHAOWEI_LOG(queue.splice(0,20));if(queue.length)flushTimer=setTimeout(flushEvents,500)}
// Searches: the settled query after typing stops, not every keystroke.
let searchTimer=0,lastQuery='';
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const q=$('search').value.trim();if(q&&q!==lastQuery){lastQuery=q;track('search',{query:q})}},1200)});
// Selections and time spent on each ETF.
let viewing=null,viewStart=0,visibleSince=Date.now(),activeMs=0;
const pickTracked=pick;
pick=function(code){track('select',{code,query:$('search').value.trim()});pickTracked(code)};
function endView(){if(viewing&&viewStart){const s=(Date.now()-viewStart)/1000;if(s>=3)track('view',{code:viewing,seconds:s})}viewing=null;viewStart=0}
const trackLoadBars=loadBars;
loadBars=async function(keepView){if(!keepView&&viewing!==selected){endView();viewing=selected;viewStart=Date.now()}return trackLoadBars(keepView)};
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){activeMs+=Date.now()-visibleSince;endView();track('leave',{seconds:activeMs/1000,code:selected});flushEvents()}
  else{visibleSince=Date.now();if(selected){viewing=selected;viewStart=Date.now()}}
});
window.addEventListener('pagehide',()=>{if(!document.hidden){activeMs+=Date.now()-visibleSince;endView();track('leave',{seconds:activeMs/1000,code:selected})}flushEvents()});
track('visit',{code:selected});

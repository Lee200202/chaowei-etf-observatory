// Public market snapshots only. Identity, tokens and intraday quotes never enter this database.
function installChaoweiSnapshotCache(){
  const memory=new Map(),pending=new Map(),checked=new Map();let database,lastPrune=0;
  const stats={hits:0,network:0,lastSource:'',lastMs:0,background:'',storage:'opening'};
  function open(){if(!database)database=new Promise(resolve=>{try{const r=indexedDB.open('chaowei-public-snapshots',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'path'});r.onsuccess=()=>{stats.storage='ready';resolve(r.result)};r.onerror=r.onblocked=()=>{stats.storage='unavailable';resolve(null)}}catch{stats.storage='unavailable';resolve(null)}});return database}
  async function read(path){const begun=performance.now();return Promise.race([(async()=>{const db=await open();if(!db)return null;return new Promise(resolve=>{try{const r=db.transaction('snapshots').objectStore('snapshots').get(path);r.onsuccess=()=>{emit('chaowei-cache-storage',{path,read:r.result?'hit':'miss',ms:performance.now()-begun});resolve(r.result||null)};r.onerror=()=>{emit('chaowei-cache-storage',{path,read:'error'});resolve(null)}}catch{resolve(null)}})})(),new Promise(resolve=>setTimeout(()=>resolve(null),300))]).then(record=>{stats.lastMs=performance.now()-begun;return record})}
  async function store(record){const db=await open();if(!db)return;try{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(record);tx.onerror=()=>{stats.background='本機快取未寫入，行情仍可使用'};
    // Prune once in the background, rather than copying every stored snapshot on every write.
    if(Date.now()-lastPrune>300000){lastPrune=Date.now();setTimeout(()=>{try{const s=db.transaction('snapshots','readwrite').objectStore('snapshots'),r=s.getAll();r.onsuccess=()=>{const all=r.result.sort((a,b)=>b.at-a.at);let bytes=0;for(let i=0;i<all.length;i++){bytes+=all[i].bytes||0;if(i>=60||bytes>20*1024*1024)s.delete(all[i].path)}}}catch{}},1000)}
  }catch{}}
  const emit=(type,detail)=>window.dispatchEvent(new CustomEvent(type,{detail}));
  function revalidate(path,fetcher){
    if(pending.has(path))return pending.get(path);if(Date.now()-(checked.get(path)||0)<300000&&memory.has(path))return Promise.resolve(memory.get(path));
    const task=(async()=>{try{const data=await fetcher();if(!data||data.error)throw Error(data?.error||'空白資料');const signature=JSON.stringify(data),old=memory.get(path),changed=old&&old.signature!==signature,record={path,data,signature,bytes:signature.length*2,at:Date.now()};memory.set(path,record);checked.set(path,Date.now());stats.network++;stats.background='已核對';store(record);emit('chaowei-cache-status',{path,source:'network',checked:true});if(changed)emit('chaowei-snapshot-updated',{path});return record}catch(e){stats.background='背景核對未完成，沿用標示日期的快取';emit('chaowei-cache-status',{path,source:'stale',error:true});throw e}finally{pending.delete(path)}})();pending.set(path,task);return task;
  }
  async function load(path,fetcher){
    const begun=performance.now();let record=memory.get(path),source='memory',failed=false;
    if(record)revalidate(path,fetcher).catch(()=>{});
    else{
      // Start both immediately: slow or blocked IndexedDB must not delay a faster network response.
      const disk=read(path).then(record=>{if(!record)throw Error('cache miss');if(!memory.has(path))memory.set(path,record);return{record,source:'indexeddb'}});
      const network=revalidate(path,fetcher).then(record=>({record,source:'network'})).catch(e=>{failed=true;throw e});
      try{({record,source}=await Promise.any([disk,network]))}catch(e){throw e.errors?.at(-1)||e}
    }
    stats.lastSource=source;stats.lastMs=performance.now()-begun;if(source!=='network')stats.hits++;emit('chaowei-cache-status',{path,source:failed?'stale':source,readSource:source,ms:stats.lastMs,storage:stats.storage});
    return source==='network'?record.data:{...record.data,_snapshotCache:{source,at:record.at}};
  }
  window.CHAOWEI_SNAPSHOT_CACHE={load,stats};
}

// Firestore rejects undefined fields. Clean only the user's plain settings before adding serverTimestamp().
function sanitizeCloudPayload(value){
  const path=new WeakSet();
  function clean(x,depth=0){
    if(x===undefined||typeof x==='function'||typeof x==='symbol'||depth>30)return undefined;
    if(x===null||typeof x==='string'||typeof x==='boolean')return x;
    if(typeof x==='number')return Number.isFinite(x)?x:null;
    if(x instanceof Date)return Number.isFinite(x.getTime())?x.toISOString():null;
    if(typeof x!=='object'||path.has(x))return undefined;
    path.add(x);let out;
    if(Array.isArray(x))out=x.map(v=>clean(v,depth+1)??null);
    else{out={};for(const[k,v]of Object.entries(x)){if(!k.trim()||['__proto__','prototype','constructor'].includes(k))continue;const y=clean(v,depth+1);if(y!==undefined)out[k]=y}}
    path.delete(x);return out;
  }
  return clean(value)??null;
}

// Shared by GitHub Pages and Apps Script.
// Long history comes from the daily snapshot files (one request per ETF); TWSE is asked live
// at most once per series, only when the snapshot is behind the latest expected trading day.
function installChaoweiApi(base,serverFallback){
  const nativeFetch=window.fetch.bind(window),memo=new Map();
  const response=data=>({ok:!data.error,status:data.error?503:200,json:async()=>data});
  const n=v=>{const x=Number(String(v??'').replaceAll(',',''));return Number.isFinite(x)?x:null};
  const roc=s=>{const m=String(s).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);return m?`${Number(m[1])+1911}-${m[2]}-${m[3]}`:null};
  const taipei=()=>new Date(Date.now()+28800000);
  // TWSE publishes the day's table after the 13:30 close; before 14:30 the previous weekday is the newest.
  function expectedLatest(){const d=taipei();if(d.getUTCHours()*60+d.getUTCMinutes()<870)d.setUTCDate(d.getUTCDate()-1);while(d.getUTCDay()===0||d.getUTCDay()===6)d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
  async function getJson(url,ttl=600000,cache='no-cache'){
    const hit=memo.get(url);if(hit&&Date.now()-hit.time<ttl)return hit.promise;
    const promise=nativeFetch(url,{cache}).then(async r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()});
    memo.set(url,{time:Date.now(),promise});promise.catch(()=>memo.delete(url));return promise;
  }
  // One small manifest revalidates daily snapshots. Versioned files then use the browser's
  // persistent HTTP cache across ETF switches and page reloads, without stale deployments.
  let versionPromise,versionAt=0;
  async function version(){
    if(!versionPromise||Date.now()-versionAt>300000){versionAt=Date.now();versionPromise=getJson(base+'data/history/_meta.json',300000).then(m=>encodeURIComponent(m.updated||m.latest||'0')).catch(()=>null)}
    return versionPromise;
  }
  async function remoteFile(path){
    try{const v=await version();return await getJson(base+path+(v?'?v='+v:''),600000,v?'force-cache':'no-cache')}
    catch(e){if(serverFallback)return serverFallback(path);throw e}
  }
  // Chip snapshots can change without the history manifest changing. Revalidate this small
  // per-ETF file so a returning visitor does not keep an older institutional/margin row.
  async function remoteFreshFile(path){
    try{return await getJson(base+path,300000,'no-cache')}
    catch(e){if(serverFallback)return serverFallback(path);throw e}
  }
  const file=path=>window.CHAOWEI_SNAPSHOT_CACHE?window.CHAOWEI_SNAPSHOT_CACHE.load(path,()=>remoteFile(path)):remoteFile(path);
  const freshFile=path=>window.CHAOWEI_SNAPSHOT_CACHE?window.CHAOWEI_SNAPSHOT_CACHE.load(path,()=>remoteFreshFile(path)):remoteFreshFile(path);
  const liveHistory=new Map(),liveChecked=new Map();
  async function twseMonth(report,code){
    const month=taipei().toISOString().slice(0,7).replace('-','')+'01';
    // HtmlService treats // inside a template literal as a comment when sanitizing inline JS.
    const url='https://www.twse.com.tw/exchangeReport/'+report+'?response=json&date='+month+(code?'&stockNo='+code:'');
    const data=await getJson(url,300000);
    if(data.stat!=='OK'&&!/查無|很抱歉|沒有符合/.test(data.stat||''))throw Error(data.stat||'資料格式異常');
    return Array.isArray(data.data)?data.data:[];
  }
  async function history(code){
    if(!/^[0-9A-Z]{4,6}$/.test(code||''))return{error:'代號格式錯誤'};
    let snap=null,snapError='';
    try{snap=await file(`data/history/${code}.json`)}catch(e){snapError=e.message}
    const bars=(snap?.rows||[]).map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
    let live=0,liveNote='';const supplemental=liveHistory.get(code)||[];
    for(const b of supplemental)if(!bars.length||b.date>bars.at(-1).date){bars.push(b);live++}
    if((!bars.length||bars.at(-1).date<expectedLatest())&&Date.now()-(liveChecked.get(code)||0)>300000){
      liveChecked.set(code,Date.now());
      const supplement=async()=>{
      const added=[];
      try{
        const last=bars.at(-1);
        for(const r of await twseMonth('STOCK_DAY',code)){
          const date=roc(r[0]),volume=n(r[1]),open=n(r[3]),high=n(r[4]),low=n(r[5]),close=n(r[6]);
          if(!date||![volume,open,high,low,close].every(Number.isFinite)||last&&date<=last.date)continue;
          // An unadjusted split day must not be glued to adjusted history.
          if(last&&(close/last.close>1.8||close/last.close<0.55)){liveNote='最新交易日疑似分割，待快照校正後顯示';break}
          added.push({date,open,high,low,close,volume});
        }
      }catch(e){liveNote='證交所即時補充暫不可用：'+e.message}
      if(added.length){liveHistory.set(code,[...(liveHistory.get(code)||[]),...added]);window.dispatchEvent(new CustomEvent('chaowei-history-live',{detail:{code}}))}
      };
      if(bars.length)supplement();else{await supplement();for(const b of liveHistory.get(code)||[]){bars.push(b);live++}}
    }
    if(!bars.length)return{error:snapError?`歷史快照讀取失敗（${snapError}）`:'證交所尚無可用的上市後日 K'};
    return{code,bars,latest:bars.at(-1).date,first:bars[0].date,source:snap?.source||'TWSE STOCK_DAY',
      basis:snap?.basis||'raw-price',adjustments:snap?.adjustments||[],snapshotLatest:snap?.latest||null,live,liveNote,cache:snap?._snapshotCache||null};
  }
  async function market(){
    const snap=await file('data/history/market.json').catch(()=>null);
    const days=(snap?.rows||[]).map(([date,volume,value,index])=>({date,volume,value,index}));
    let live=0;for(const d of liveHistory.get('market')||[])if(!days.length||d.date>days.at(-1).date){days.push(d);live++}
    if((!days.length||days.at(-1).date<expectedLatest())&&Date.now()-(liveChecked.get('market')||0)>300000){
      liveChecked.set('market',Date.now());const supplement=async()=>{const added=[];try{for(const r of await twseMonth('FMTQIK')){const date=roc(r[0]),volume=n(r[1]),value=n(r[2]),index=n(r[4]);if(date&&[volume,value,index].every(Number.isFinite)&&(!days.length||date>days.at(-1).date))added.push({date,volume,value,index})}}catch{}if(added.length){liveHistory.set('market',added);window.dispatchEvent(new CustomEvent('chaowei-snapshot-updated',{detail:{path:'data/history/market.json'}}))}};
      if(days.length)supplement();else{await supplement();for(const d of liveHistory.get('market')||[]){days.push(d);live++}}
    }
    if(!days.length)return{error:'大盤資料暫不可用'};
    return{days,latest:days.at(-1).date,source:'TWSE FMTQIK',live};
  }
  async function api(path,params){
    // Listings can change while the historical K-line manifest does not.
    if(path==='/api/etfs')return freshFile('etf-catalog.json');
    if(path==='/api/brent')return file('data/brent.json');
    if(path==='/api/oil')return freshFile('data/oil-spot.json');
    if(path==='/api/bank')return freshFile('data/history/histock-bank.json');
    if(path==='/api/fx')return file('data/fx.json');
    if(path==='/api/history')return history(params.get('code'));
    if(path==='/api/market')return market();
    if(path==='/api/intraday-profile')return file('data/history/intraday-volume.json');
    if(path==='/api/dividends')return file('data/history/dividends.json');
    if(path==='/api/margin')return file('data/history/margin.json');
    if(path==='/api/holders')return freshFile('data/history/holders.json');
    if(path==='/api/chips'){
      const code=params.get('code');
      if(!/^[0-9A-Z]{4,6}$/.test(code||''))return{error:'代號格式錯誤'};
      return freshFile(`data/chips/${code}.json`).catch(()=>({code,rows:[],source:null,latest:null}));
    }
    if(path==='/api/radar')return file('data/history/radar.json');
    return{error:'未知 API'};
  }
  window.fetch=(input,options)=>{const url=new URL(input,location.href);if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);return api(url.pathname,url.searchParams).then(response).catch(e=>response({error:e.message}))};
}

// Read-only quote bridge. The Fugle key stays in Apps Script Script Properties.
function installChaoweiQuote(appsScriptUrl){
  if(window.google?.script?.run){
    window.CHAOWEI_QUOTE=code=>new Promise((resolve,reject)=>
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getQuote(code));
    return;
  }
  let sequence=0;
  window.CHAOWEI_QUOTE=code=>new Promise((resolve,reject)=>{
    const callback=`__cwq_${Date.now().toString(36)}${(++sequence).toString(36).padStart(8,'0')}`;
    const script=document.createElement('script');
    const url=new URL(appsScriptUrl);
    url.searchParams.set('api','quote');url.searchParams.set('code',code);url.searchParams.set('callback',callback);
    let done=false;
    const finish=(error,data,timedOut=false)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(timedOut){window[callback]=()=>{delete window[callback];script.remove()};script.onload=()=>{delete window[callback];script.remove()}}
      else{delete window[callback];script.remove()}
      error?reject(error):resolve(data);
    };
    window[callback]=data=>finish(null,data);
    script.onerror=()=>{if(done){delete window[callback];script.remove()}else finish(Error('Apps Script 報價連線失敗'))};
    const timer=setTimeout(()=>finish(Error('Apps Script 報價逾時'),null,true),12000);
    script.src=url.toString();document.head.append(script);
  });
}

// Firebase configuration is a public web-app identifier, never a server secret.
function installChaoweiIdentity(host){
  window.chaoweiGetIdToken=()=>Promise.resolve(null);
  const $=id=>document.getElementById(id);
  const status=t=>{$('accountStatus').textContent=t};
  if(host==='apps-script'){
    $('googleSignIn').classList.add('hidden');$('accountMainLink').classList.remove('hidden');
    status('請在主網站登入；Apps Script 鏡像提供行情與評分。');$('displaySyncNote').textContent='此外觀儲存在目前瀏覽器；帳號同步請到主網站。';return;
  }
  const config={apiKey:'AIzaSyBSMEMIDfBUSVSPwQUdbs6mEV-SXkBHbbs',authDomain:'chaowei-etf-observatory.firebaseapp.com',projectId:'chaowei-etf-observatory',appId:'1:342380543762:web:f27d15c89c70fe94b57dcb'};
  const base='https://www.gstatic.com/firebasejs/13.0.0/';
  let auth,db,user=null,api,plans=[],saveTimer=0,applying=false,ready=false;
  window.chaoweiGetIdToken=()=>user?user.getIdToken():Promise.resolve(null);
  const retry=document.createElement('button');retry.type='button';retry.className='pill mini hidden';retry.id='retryCloudSync';retry.textContent='重新同步雲端';$('accountStatus').after(retry);
  retry.addEventListener('click',()=>write(getLocal()));
  const profileRef=()=>api.doc(db,'users',user.uid);
  const safeSettings=s=>({window:s.window,method:s.method,anchorMode:s.anchorMode,anchorCount:s.anchorCount,showLevels:s.showLevels!==false,font:s.font,dark:!!s.dark,weights:s.weights,volumeDirection:s.volumeDirection,watchlist:s.watchlist,overlays:s.overlays,osc:s.osc,oscs:s.oscs,ind:s.ind,chartType:s.chartType,colorScheme:s.colorScheme,tourDone:s.tourDone,uiMode:s.uiMode,marginWeight:s.marginWeight,marginDirection:s.marginDirection,chipRange:s.chipRange,mktMarginWeight:s.mktMarginWeight,bankWeight:s.bankWeight,marketWindow:s.marketWindow,marketMethod:s.marketMethod,marketSpan:s.marketSpan,bankRange:s.bankRange,holderRange:s.holderRange,chartMeasures:s.chartMeasures,measureSnap:s.measureSnap,studyMode:s.studyMode,holdout:s.holdout,strategyBoard:s.strategyBoard,showDailyScore:s.showDailyScore,quickTourDone:s.quickTourDone,factorModes:s.factorModes,marketView:s.marketView,chipResonance:s.chipResonance,chipResonanceWeight:s.chipResonanceWeight,mktMarginDirection:s.mktMarginDirection,factorRange:s.factorRange,fxDirection:s.fxDirection,paneHeights:s.paneHeights,volumeBasis:s.volumeBasis,momentumEnabled:s.momentumEnabled===true,bt:s.bt,favorites:s.favorites,preferredWindow:s.preferredWindow,wavePins:Array.isArray(s.wavePins)?s.wavePins.slice(-300):[],waveStudy:s.waveStudy&&typeof s.waveStudy==='object'?s.waveStudy:{}});
  const getLocal=()=>{try{return safeSettings(JSON.parse(localStorage.getItem('chaowei-settings')||'{}'))}catch{return {}}};
  const showPlans=()=>{const list=$('planList');list.replaceChildren(new Option('選擇方案',''));plans.forEach((p,i)=>list.add(new Option(p.name,String(i))))};
  const write=async settings=>{
    if(!user||!db)return;const uid=user.uid,payload=sanitizeCloudPayload({settings:safeSettings(settings),plans});
    try{localStorage.setItem('chaowei-cloud-backup-'+uid,JSON.stringify({...payload,savedAt:new Date().toISOString()}))}catch{}
    retry.disabled=true;
    try{await api.setDoc(profileRef(),{...payload,updatedAt:api.serverTimestamp()},{merge:true});if(user?.uid===uid){status('雲端已同步 · 本機也已保存');retry.classList.add('hidden')}}
    catch(e){if(user?.uid===uid){status('設定已保存在本機，雲端暫未同步。可稍後重試。');retry.classList.remove('hidden')}console.warn('Cloud sync failed:',e.code||'unavailable')}
    finally{retry.disabled=false}
  };
  window.chaoweiProfileChanged=settings=>{if(!user||applying)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>write(settings),900)};
  $('savePlan').addEventListener('click',async()=>{if(!user)return;const name=$('planName').value.trim();if(!name){status('請先輸入方案名稱');return}const settings=getLocal();const existing=plans.findIndex(p=>p.name===name);const item={name,settings,createdAt:new Date().toISOString()};if(existing>=0)plans[existing]=item;else plans.push(item);plans=plans.slice(-12);showPlans();$('planList').value=String(plans.findIndex(p=>p.name===name));window.chaoweiPlanApplied?.(name);await write(settings)});
  $('applyPlan').addEventListener('click',()=>{if(!user)return;const p=plans[Number($('planList').value)];if(!p)return;window.chaoweiApplyProfile?.({settings:p.settings});window.chaoweiPlanApplied?.(p.name);status(`已套用「${p.name}」`)});
  async function signedIn(next){user=next;clearTimeout(saveTimer);window.chaoweiSetMember?.(!!user);$('googleSignIn').classList.toggle('hidden',!!user);$('googleSignOut').classList.toggle('hidden',!user);$('accountPlans').classList.toggle('hidden',!user);const label=user?'我的帳號與外觀':'登入與外觀';$('accountTop').querySelector('.nav-label').textContent=label;$('accountTop').setAttribute('aria-label',label);$('accountTop').title=label;$('displaySyncNote').textContent=user?'外觀、權重與追蹤清單會同步到你的 Google 帳號。':'外觀與權重目前存在此瀏覽器；登入後可跨裝置同步。';
    if(!user){retry.classList.add('hidden');status(ready?'尚未登入；可繼續使用免費行情與本機設定。':'正在檢查登入服務…');plans=[];showPlans();return}
    status(`已登入 ${user.email} · 正在讀取同步設定…`);
    try{const snap=await api.getDoc(profileRef());if(user!==auth.currentUser)return;
      if(snap.exists()){const data=snap.data();plans=Array.isArray(data.plans)?data.plans.filter(p=>p&&typeof p.name==='string'&&p.settings).slice(-12):[];showPlans();if(data.settings){applying=true;window.chaoweiApplyProfile?.({settings:data.settings});applying=false}status(`已登入 ${user.email} · 已載入雲端設定`)}
      else{plans=[];showPlans();await write(getLocal())}
    }catch(e){applying=false;status(`已登入 ${user.email} · 雲端讀取失敗：${e.code||e.message}`)}
  }
  $('googleSignIn').addEventListener('click',async()=>{if(!ready){status('登入服務仍在載入，請稍後再試');return}try{await api.signInWithPopup(auth,new api.GoogleAuthProvider())}catch(e){status(`登入未完成：${e.code||e.message}`)}});
  $('googleSignOut').addEventListener('click',async()=>{try{await api.signOut(auth)}catch(e){status(`登出失敗：${e.code||e.message}`)}});
  Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]).then(([app,a,f])=>{
    api={...a,...f};const instance=app.initializeApp(config);auth=a.getAuth(instance);db=f.getFirestore(instance);ready=true;a.onAuthStateChanged(auth,signedIn,e=>status('登入服務無法連線：'+e.message));
  }).catch(e=>status('登入服務暫時無法載入：'+e.message));
}

// Live market factors (intraday TAIEX and turnover, TAIFEX BRF Brent near-month, CBC USD/TWD) through the Apps Script deployment.
// Apps Script caches one bundle for all visitors; the page asks every five minutes.
function installChaoweiLive(appsScriptUrl){
  const extra=(api,code)=>new Promise((resolve,reject)=>{
    const cb='__cwx_'+Date.now().toString(36)+Math.random().toString(36).slice(2,10),script=document.createElement('script'),u=new URL(appsScriptUrl);let done=false;
    u.searchParams.set('api',api);u.searchParams.set('callback',cb);if(code)u.searchParams.set('code',code);
    const finish=(err,data,late=false)=>{if(done)return;done=true;clearTimeout(timer);if(late){window[cb]=()=>{delete window[cb];script.remove()};script.onload=()=>{delete window[cb];script.remove()}}else{delete window[cb];script.remove()}err?reject(err):resolve(data)};
    window[cb]=d=>finish(null,d);script.onerror=()=>{if(done){delete window[cb];script.remove()}else finish(Error('資料連線失敗'))};const timer=setTimeout(()=>finish(Error('資料來源逾時'),null,true),api==='holders'?45000:20000);script.src=u.toString();document.head.append(script);
  });
  if(window.google?.script?.run){
    window.CHAOWEI_BANK=()=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getBankHistory());
    window.CHAOWEI_HOLDERS=code=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getHolderHistory(code));
  }else if(appsScriptUrl){window.CHAOWEI_BANK=()=>extra('bank');window.CHAOWEI_HOLDERS=code=>extra('holders',code)}
  // Anonymous usage events (one row each) and the popular-search list, via the same Apps Script.
  const jsonp=(api,prefix)=>new Promise((resolve,reject)=>{
    const callback=prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,10),script=document.createElement('script'),url=new URL(appsScriptUrl);
    url.searchParams.set('api',api);url.searchParams.set('callback',callback);let done=false;
    const finish=(error,data,timedOut=false)=>{
      if(done)return;done=true;clearTimeout(timer);
      // A timed-out JSONP request can still execute after its script tag is removed.
      // Keep a harmless callback until that late response finishes loading.
      if(timedOut){window[callback]=()=>{delete window[callback];script.remove()};script.onload=()=>{delete window[callback];script.remove()}}
      else{delete window[callback];script.remove()}
      error?reject(error):resolve(data);
    };
    window[callback]=data=>finish(null,data);script.onerror=()=>{if(done){delete window[callback];script.remove()}else finish(Error('連線失敗'))};const timer=setTimeout(()=>finish(Error('逾時'),null,true),15000);script.src=url.toString();document.head.append(script);
  });
  if(window.google?.script?.run){
    window.CHAOWEI_LOG=events=>events.forEach(e=>google.script.run.withFailureHandler(()=>{}).logEvent(e));
    window.CHAOWEI_POPULAR=()=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getPopular());
  }else if(appsScriptUrl){
    // sendBeacon survives page unload; text/plain avoids a CORS preflight. Apps Script runs doPost before its redirect.
    window.CHAOWEI_LOG=events=>{try{navigator.sendBeacon(appsScriptUrl,new Blob([JSON.stringify(events)],{type:'text/plain'}))}catch{}};
    window.CHAOWEI_POPULAR=()=>jsonp('popular','__cwp_');
  }
  if(window.google?.script?.run){
    window.CHAOWEI_LIVE=()=>new Promise((resolve,reject)=>
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getLiveMarket());
    return;
  }
  if(!appsScriptUrl)return;
  let sequence=0;
  window.CHAOWEI_LIVE=()=>new Promise((resolve,reject)=>{
    const callback='__cwl_'+Date.now().toString(36)+(++sequence).toString(36).padStart(8,'0');
    const script=document.createElement('script'),url=new URL(appsScriptUrl);
    url.searchParams.set('api','live');url.searchParams.set('callback',callback);
    let done=false;
    const finish=(error,data,timedOut=false)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(timedOut){window[callback]=()=>{delete window[callback];script.remove()};script.onload=()=>{delete window[callback];script.remove()}}
      else{delete window[callback];script.remove()}
      error?reject(error):resolve(data);
    };
    window[callback]=data=>finish(null,data);
    script.onerror=()=>{if(done){delete window[callback];script.remove()}else finish(Error('Apps Script 市場資料連線失敗'))};
    const timer=setTimeout(()=>finish(Error('Apps Script 市場資料逾時'),null,true),20000);
    script.src=url.toString();document.head.append(script);
  });
}

window.CHAOWEI_AI_ENDPOINT='https://script.google.com/macros/s/AKfycbwea2kGu7UX0RPfUYW2IaMmtar5_LitJth3mQ_c5uGOtgeihU_nmkM3uNw1CnddLdd6Kw/exec';window.CHAOWEI_STATIC=true;installChaoweiSnapshotCache();window.CHAOWEI_HOST='apps-script';installChaoweiApi('https://lee200202.github.io/chaowei-etf-observatory/',path=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(d=>d&&d.error?reject(Error(d.error)):resolve(d)).withFailureHandler(reject).readSnapshot(path)));installChaoweiQuote('');installChaoweiIdentity('apps-script');installChaoweiLive('');
(()=>{'use strict';
const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>Number.isFinite(n)?Number(n).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
let catalog=[],selected='0050',type='all',bars=[],market=[],brent=[],fx=[],position=null,marketPosition=null,brentPosition=null,fxPosition=null,interval='D',showMA=false,shareView=false,brentSnapshot=false;
let settings={window:'200',method:'equal',anchorMode:'wick',anchorCount:5,showLevels:true,font:'normal',dark:false,weights:[100,0,0,0,0],volumeDirection:'off'};
try{Object.assign(settings,JSON.parse(localStorage.getItem('chaowei-settings')||'{}'))}catch{}
try{const p=new URLSearchParams(location.search);if(p.has('preset')){const s=JSON.parse(atob(p.get('preset')));if(s&&Array.isArray(s.weights)&&s.weights.length<=5&&s.weights.every(x=>Number.isInteger(x)&&x>=0&&x<=100)&&['60','120','200','240','400','600','1200','2400','all'].includes(s.window)&&['equal','fib'].includes(s.method)&&['off','low','high'].includes(s.volumeDirection)&&/^[0-9A-Z]{4,6}$/.test(s.code)){settings.window=s.window;settings.method=s.method;settings.anchorMode=['wick','close','average'].includes(s.anchorMode)?s.anchorMode:'wick';settings.anchorCount=Math.max(1,Math.min(20,Math.round(Number(s.anchorCount)||5)));settings.showLevels=s.showLevels!==false;settings.weights=s.weights;settings.volumeDirection=s.volumeDirection;settings.marginWeight=Number.isInteger(s.marginWeight)?Math.max(0,Math.min(100,s.marginWeight)):0;settings.marginDirection=s.marginDirection==='high'?'high':'low';settings.mktMarginWeight=Number.isInteger(s.mktMarginWeight)?Math.max(0,Math.min(100,s.mktMarginWeight)):0;settings.mktMarginDirection=s.mktMarginDirection==='high'?'high':'low';settings.factorModes=s.factorModes;settings.bankWeight=Math.max(0,Math.min(100,Number(s.bankWeight)||0));settings.marketWindow=Math.max(20,Math.min(2400,Number(s.marketWindow)||120));settings.marketMethod=s.marketMethod==='mean'?'mean':'normal';settings.marketSpan=Math.max(1,Math.min(200,Number(s.marketSpan)||20));selected=s.code;shareView=true}}}catch{}
function save(){if(shareView)return false;const n=$('btBudgetSaved');try{localStorage.setItem('chaowei-settings',JSON.stringify(settings));if(n){n.textContent='設定已保存在此裝置。';delete n.dataset.error}window.chaoweiProfileChanged?.(settings);return true}catch(e){if(n){n.textContent='目前設定尚未保存於此裝置，請稍後再試。';n.dataset.error=e.name}return false}}
function notice(t){$('status').textContent=t;$('status').classList.remove('hidden')}
function renderList(){const q=$('search').value.trim().toLowerCase();const list=catalog.filter(e=>(type==='all'||e.type===type)&&(!q||e.code.toLowerCase().includes(q)||e.name.toLowerCase().includes(q)));$('etfList').replaceChildren();for(const e of list){const b=document.createElement('button');b.type='button';b.className=e.code===selected?'selected':'';const strong=document.createElement('strong');strong.textContent=e.code+' · '+e.name;const small=document.createElement('small');small.textContent=(e.type==='active'?'主動型':'被動型')+' / '+e.note;b.append(strong,small);b.addEventListener('click',()=>{selected=e.code;renderList();loadBars()});$('etfList').append(b)}if(!list.length)$('etfList').textContent='沒有符合的首批標的'}
function scoreFor(r,method){let raw;if(method==='equal'||r<0||r>1)raw=5*(1-r);else{const x=[0,.236,.382,.618,.786,1],y=[5,4,3,2,1,0];for(let i=0;i<x.length-1;i++)if(r<=x[i+1]){raw=y[i]+(y[i+1]-y[i])*(r-x[i])/(x[i+1]-x[i]);break}}return{raw,core:Math.max(0,Math.min(5,raw)),grade:r<0?5:r>=1?1:Math.max(1,Math.min(5,Math.ceil(raw)))}}
function computePosition(){const n=settings.window==='all'?bars.length-1:Number(settings.window);const prior=bars.slice(Math.max(0,bars.length-1-n),-1),last=bars.at(-1);if(!last||prior.length<20||settings.window!=='all'&&prior.length<n){position=null;return}const low=Math.min(...prior.map(x=>x.low)),high=Math.max(...prior.map(x=>x.high));if(high<=low){position=null;return}const r=(last.close-low)/(high-low);position={...scoreFor(r,settings.method),r,low,high,count:prior.length,last}}
function renderPosition(){const e=catalog.find(x=>x.code===selected);$('etfName').textContent=e?.name||selected;$('etfMeta').textContent=selected+' · 證交所上市';$('kind').textContent=e?.type==='active'?'主動型 ETF':'被動型 ETF';const last=bars.at(-1);$('price').textContent=last?fmt(last.close,2)+' 元':'—';$('asof').textContent=last?'資料日期：'+last.date+' · 官方盤後收盤':'資料日期：—';$('quoteStatus').textContent='盤後 · 非即時';$('sample').textContent='已取得 '+bars.length+' 個交易日';$('source').textContent=selected==='0050'?'證交所 · 已還原 1 拆 4':'來源：證交所';if(!position){$('grade').innerHTML='—<small>/5</small>';$('waterText').textContent=bars.length?'資料不足，請改用較短觀察窗':'尚無足夠價格資料';$('extended').textContent='未產生分數';$('cupWater').style.height='0%';$('low').textContent='區間低點 —';$('high').textContent='區間高點 —';return}const p=position;$('grade').innerHTML=fmt(p.core,1)+'<small>/5</small>';$('waterText').textContent=p.r<0?'跌破歷史區間低點':p.r>1?'突破歷史區間高點':p.grade>=4?'位於觀察區間較低處':p.grade<=2?'位於觀察區間較高處':'位於觀察區間中段';$('extended').textContent='水位 '+fmt(p.r,2)+(p.r<0||p.r>1?' · 超出區間，延伸分 '+fmt(p.raw,2):'');$('cupWater').style.height=Math.max(0,Math.min(1,p.r))*100+'%';$('rangeDot').style.left=Math.max(0,Math.min(1,p.r))*100+'%';$('low').textContent='區間低點 '+fmt(p.low,2);$('high').textContent='區間高點 '+fmt(p.high,2);$('sample').textContent='前 '+p.count+' 交易日'}
function aggregate(input,iv){if(iv==='D')return input;const out=[];let key='';for(const b of input){let k;if(iv==='M')k=b.date.slice(0,7);else{const d=new Date(b.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);k=d.toISOString().slice(0,10)}if(k!==key){out.push({...b});key=k}else{const z=out.at(-1);z.high=Math.max(z.high,b.high);z.low=Math.min(z.low,b.low);z.close=b.close;z.volume+=b.volume}}return out}
function drawChart(){const vis=aggregate(bars,interval).slice(-65),node=$('chart');if(!vis.length){node.textContent='尚未取得 K 線資料';return}const W=900,H=310,left=28,step=(W-2*left)/vis.length,width=Math.max(2,Math.min(10,step*.6));let lo=Math.min(...vis.map(x=>x.low)),hi=Math.max(...vis.map(x=>x.high)),span=hi-lo||1;lo-=span*.08;hi+=span*.08;const y=v=>18+(hi-v)/(hi-lo)*(H-52);let svg='<svg viewBox="0 0 900 310" preserveAspectRatio="none" aria-hidden="true">';for(let g=0;g<4;g++){const gy=25+g*76;svg+='<line x1="0" y1="'+gy+'" x2="900" y2="'+gy+'" stroke="var(--line)" stroke-dasharray="4 5"/><text x="6" y="'+(gy-5)+'" fill="var(--muted)" font-size="10">'+fmt(hi-(hi-lo)*g/4,1)+'</text>'}for(let i=0;i<vis.length;i++){const b=vis[i],x=left+i*step+step/2,color=b.close>=b.open?'#19a7a8':'#eb8c78',top=y(Math.max(b.open,b.close)),bottom=y(Math.min(b.open,b.close));svg+='<line x1="'+x+'" y1="'+y(b.high)+'" x2="'+x+'" y2="'+y(b.low)+'" stroke="'+color+'" stroke-width="2"/><rect x="'+(x-width/2)+'" y="'+top+'" width="'+width+'" height="'+Math.max(2,bottom-top)+'" fill="'+color+'" rx="1"/>'}if(showMA&&vis.length>=20){const pts=[];for(let i=19;i<vis.length;i++){const av=vis.slice(i-19,i+1).reduce((s,b)=>s+b.close,0)/20;pts.push((left+i*step+step/2)+','+y(av))}svg+='<polyline points="'+pts.join(' ')+'" fill="none" stroke="#f5bf6b" stroke-width="3"/>'}svg+='<text x="18" y="300" fill="var(--muted)" font-size="11">'+vis[0].date+'</text><text x="780" y="300" fill="var(--muted)" font-size="11">'+vis.at(-1).date+'</text></svg>';node.innerHTML=svg;node.setAttribute('aria-label',selected+' '+({D:'日',W:'週',M:'月'})[interval]+' K 線，從 '+vis[0].date+' 至 '+vis.at(-1).date);$('chartCaption').textContent='最近 '+vis.length+' 根'+({D:'日',W:'週',M:'月'})[interval]+' K · '+(selected==='0050'?'分割前價格除以 4；':'')+(showMA?'黃線為 MA20；':'')+'未納入配息再投入。'}
function computeMarket(){const n=settings.window==='all'?market.length-1:Number(settings.window),prior=market.slice(Math.max(0,market.length-1-n),-1),last=market.at(-1);if(!last||prior.length<20||settings.window!=='all'&&prior.length<n){marketPosition=null;$('indexScore').textContent='—';$('volumeScore').textContent='—';$('indexMeta').textContent='觀察窗資料不足';$('volumeMeta').textContent='觀察窗資料不足';return}const range=scalarRange(prior.map(x=>x.index));if(!range){marketPosition=null;return}const {low,high}=range;const r=(last.index-low)/(high-low),index=scoreFor(r,settings.method),rank=prior.filter(x=>x.volume<=last.volume).length/prior.length,volumeGrade=Math.max(1,Math.min(5,Math.ceil(rank*5)));marketPosition={index,volumeGrade,volumeScore:rank*5,rank,last};$('indexScore').textContent=fmt(index.core,1)+' / 5';$('indexMeta').textContent=fmt(last.index,2)+' 點 · '+last.date+' · 水位 '+fmt(r,2);$('volumeScore').textContent=fmt(rank*5,1)+' / 5';$('volumeMeta').textContent=fmt(last.volume/1e8,2)+' 億股 · '+last.date+' · 近 '+prior.length+' 日第 '+Math.round(rank*100)+' 百分位'}
function computeBrent(){const usable=bars.length?brent.filter(x=>x.date<=bars.at(-1).date):brent,n=settings.window==='all'?usable.length-1:Number(settings.window),prior=usable.slice(Math.max(0,usable.length-1-n),-1),last=usable.at(-1);if(!last||prior.length<20||settings.window!=='all'&&prior.length<n){brentPosition=null;$('brentScore').textContent='—';$('brentMeta').textContent='觀察窗資料不足';return}const age=bars.length?(Date.parse(bars.at(-1).date)-Date.parse(last.date))/86400000:0;if(age>14){brentPosition=null;$('brentScore').textContent='逾期';$('brentMeta').textContent=last.date+' 之後沒有新資料，暫停計分';return}const range=scalarRange(prior.map(x=>x.value));if(!range){brentPosition=null;return}const {low,high}=range,r=(last.value-low)/(high-low),s=scoreFor(r,settings.method);brentPosition={...s,last,r};$('brentScore').textContent=fmt(s.core,1)+' / 5';$('brentMeta').textContent=fmt(last.value,2)+' 美元／桶 · '+last.date+' · 低價分高'+(brentSnapshot?' · 來源快照':'')}
function computeFx(){const usable=bars.length?fx.filter(x=>x.date<=bars.at(-1).date):fx,n=settings.window==='all'?usable.length-1:Number(settings.window),prior=usable.slice(Math.max(0,usable.length-1-n),-1),last=usable.at(-1);if(!last||prior.length<20||settings.window!=='all'&&prior.length<n){fxPosition=null;$('fxScore').textContent='—';$('fxMeta').textContent='觀察窗資料不足';return}const range=scalarRange(prior.map(x=>x.value));if(!range){fxPosition=null;return}const {low,high}=range,r0=(last.value-low)/(high-low),r=settings.fxDirection==='high'?1-r0:r0,s=scoreFor(r,settings.method);fxPosition={...s,last,r};$('fxScore').textContent=fmt(s.core,1)+' / 5';$('fxMeta').textContent=fmt(last.value,3)+' 新台幣／美元 · '+last.date+' · 數值低分高'}
function updateWeights(){const w=['wEtf','wIndex','wVolume','wBrent','wFx'].map(k=>Number($(k).value));settings.weights=w;['oEtf','oIndex','oVolume','oBrent','oFx'].forEach((k,i)=>$(k).textContent=w[i]+'%');const sum=w.reduce((a,b)=>a+b,0);$('weightStatus').textContent='權重合計 '+sum+'%'+(sum===100?'':' · 請調整至 100%');$('wVolume').disabled=settings.volumeDirection==='off'||shareView;if(!position||sum!==100||w[1]>0&&!marketPosition||w[2]>0&&(!marketPosition||settings.volumeDirection==='off')||w[3]>0&&!brentPosition||w[4]>0&&!fxPosition){$('combined').textContent='—';$('combinedExtra').textContent=sum!==100?'完成 100% 後顯示綜合分':'資料不足或量能方向未設定';save();return}const vs=marketPosition?.volumeScore??0,v=settings.volumeDirection==='low'?5-vs:vs;const core=(w[0]*position.core+w[1]*(marketPosition?.index.core||0)+w[2]*(v||0)+w[3]*(brentPosition?.core||0)+w[4]*(fxPosition?.core||0))/100,ext=(w[0]*position.raw+w[1]*(marketPosition?.index.raw||0)+w[2]*(v||0)+w[3]*(brentPosition?.raw||0)+w[4]*(fxPosition?.raw||0))/100;$('combined').textContent=fmt(core,2)+' / 5';$('combinedExtra').textContent='延伸綜合分 '+fmt(ext,2);save()}
async function loadBars(){const code=selected;notice('正在讀取 '+code+' 的證交所歷史日 K…');try{const res=await fetch('/api/bars?code='+encodeURIComponent(code)),d=await res.json();if(code!==selected)return;if(!res.ok)throw Error(d.error||'資料讀取失敗');bars=d.bars;computePosition();computeBrent();computeFx();renderPosition();drawChart();updateWeights();if(d.missingMonths)notice('部分月份資料暫缺（'+d.missingMonths+' 個月）。本次水位可能不完整，請稍後重試。');else $('status').classList.add('hidden')}catch(e){if(code!==selected)return;bars=[];position=null;renderPosition();drawChart();updateWeights();notice('歷史行情暫時無法取得：'+e.message+'。請稍後重試。')}}
async function loadMarket(){try{const res=await fetch('/api/market'),d=await res.json();if(!res.ok)throw Error(d.error||'大盤資料讀取失敗');market=d.days;computeMarket();updateWeights();if(d.missingMonths)notice('大盤資料有 '+d.missingMonths+' 個月份暫缺，量能評分請暫勿作判斷。')}catch(e){market=[];marketPosition=null;$('indexMeta').textContent='資料暫不可用：'+e.message;$('volumeMeta').textContent='資料暫不可用：'+e.message;updateWeights()}}
async function loadBrent(){try{const res=await fetch('/api/brent'),d=await res.json();if(!res.ok)throw Error(d.error||'布蘭特資料讀取失敗');brent=d.days;brentSnapshot=!!d.snapshot;computeBrent();updateWeights()}catch(e){brent=[];brentPosition=null;$('brentScore').textContent='—';$('brentMeta').textContent='資料暫不可用：'+e.message;updateWeights()}}
async function loadFx(){try{const res=await fetch('/api/fx'),d=await res.json();if(!res.ok)throw Error(d.error||'央行匯率讀取失敗');fx=d.days;computeFx();updateWeights()}catch(e){fx=[];fxPosition=null;$('fxScore').textContent='—';$('fxMeta').textContent='資料暫不可用：'+e.message;updateWeights()}}
function share(){const data={code:selected,window:settings.window,method:settings.method,anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,showLevels:settings.showLevels,weights:settings.weights,volumeDirection:settings.volumeDirection,marginWeight:settings.marginWeight||0,marginDirection:settings.marginDirection||'low',factorModes:settings.factorModes,bankWeight:settings.bankWeight||0,marketWindow:settings.marketWindow||120,marketMethod:settings.marketMethod||'normal',marketSpan:settings.marketSpan||20,mktMarginWeight:settings.mktMarginWeight||0,mktMarginDirection:settings.mktMarginDirection||'low'},url=new URL(location.pathname,location.origin);url.searchParams.set('preset',btoa(JSON.stringify(data)));navigator.clipboard.writeText(url.toString()).then(()=>{$('share').textContent=' 已複製';setTimeout(()=>$('share').textContent='複製方案連結',2500)},()=>prompt('複製這個檢視連結',url.toString()))}
function prefs(){document.body.classList.toggle('dark',!!settings.dark);document.body.classList.remove('large','xlarge');if(settings.font!=='normal')document.body.classList.add(settings.font);$('fontSize').value=settings.font;$('window').value=settings.window;$('method').value=settings.method;$('volumeDirection').value=settings.volumeDirection;if($('anchorMode'))updateAnchorControls();const w=[100,0,0,0,0].map((v,i)=>settings.weights?.[i]??v);['wEtf','wIndex','wVolume','wBrent','wFx'].forEach((k,i)=>$(k).value=w[i]);updateWeights()}
$('search').addEventListener('input',()=>renderList());$('typeChips').addEventListener('click',e=>{const b=e.target.closest('button[data-type]');if(!b)return;type=b.dataset.type;$('typeChips').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderList()});$('window').addEventListener('change',function(){settings.window=this.value;computePosition();renderPosition();computeMarket();computeBrent();computeFx();updateWeights();save()});$('method').addEventListener('change',function(){settings.method=this.value;computePosition();renderPosition();computeMarket();computeBrent();computeFx();updateWeights();save()});$('intervalSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-interval]');if(!b)return;interval=b.dataset.interval;$('intervalSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));drawChart()});['wEtf','wIndex','wVolume','wBrent','wFx'].forEach(k=>$(k).addEventListener('input',updateWeights));$('volumeDirection').addEventListener('change',function(){settings.volumeDirection=this.value;updateWeights()});$('normalize').addEventListener('click',()=>{const available=[true,!!marketPosition,!!marketPosition&&settings.volumeDirection!=='off',!!brentPosition,!!fxPosition],count=available.filter(Boolean).length,v=[0,0,0,0,0];let left=100;available.forEach((yes,i)=>{if(yes){const chunk=Math.floor(100/count/5)*5;v[i]=chunk;left-=chunk}});v[0]+=left;['wEtf','wIndex','wVolume','wBrent','wFx'].forEach((k,i)=>$(k).value=v[i]);updateWeights()});$('share').addEventListener('click',share);$('fontSize').addEventListener('change',function(){settings.font=this.value;prefs();save()});['theme'].forEach(k=>$(k).addEventListener('click',()=>{settings.dark=!settings.dark;prefs();save()}));
prefs();fetch('/api/etfs').then(r=>r.json()).then(d=>{catalog=d.etfs;if(!catalog.some(x=>x.code===selected))selected='0050';renderList();loadBars();loadMarket();loadBrent();loadFx()}).catch(e=>notice('ETF 名單無法取得：'+e.message));function refresh(){if(document.hidden)return;$('refreshClock').textContent=new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Taipei'});loadBars(true);loadMarket();loadBrent();loadFx()}setInterval(refresh,300000);$('refreshClock').textContent=new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Taipei'});if(shareView){$('share').textContent='檢視中的方案';$('share').disabled=true;$('normalize').disabled=true;['wEtf','wIndex','wVolume','wBrent','wFx','window','method','volumeDirection'].forEach(k=>$(k).disabled=true)}
// Kept inside the client closure so the chart and data loaders share one state.
// Chart: TradingView Lightweight Charts 4.1.3 (same version as the Stock site); SVG close line if the CDN fails.
let chartRange='1m',historyMeta=null,historyGeneration=0,lwc=null,liveQuote=null,quoteDisabled=false;
settings.overlays=Object.assign({ma5:false,ma20:false,ma60:false,boll:false},settings.overlays||{});
// Sub-charts are multi-select: any of MACD, RSI and KD, each in its own pane.
const OSC_KEYS=['macd','rsi','kd'],OSC_ID={macd:'Macd',rsi:'Rsi',kd:'Kd'};
settings.oscs=Array.isArray(settings.oscs)?settings.oscs.filter(k=>OSC_KEYS.includes(k)):(OSC_KEYS.includes(settings.osc)?[settings.osc]:[]);
const oscOn=k=>settings.oscs.includes(k);
settings.anchorMode=['wick','close','average'].includes(settings.anchorMode)?settings.anchorMode:'wick';
settings.anchorCount=Math.max(1,Math.min(20,Math.round(Number(settings.anchorCount)||5)));
settings.showLevels=settings.showLevels===true;
const RISE='#e5484d',FALL='#12a06b',COLORS={ma5:'#3b82f6',ma20:'#e6a23c',ma60:'#8b5cf6',boll:'#14b8a6',dif:'#e6a23c',dea:'#8b5cf6',rsi:'#0ea5b7',k:'#e6a23c',d:'#3b82f6'};
const POPULAR=['0050','0056','00878','006208','00919','009816','00981A','00631L'];
settings.watchlist=Array.isArray(settings.watchlist)?[...new Set(settings.watchlist.filter(x=>typeof x==='string'&&/^[0-9A-Z]{4,6}$/.test(x)))].slice(0,50):POPULAR.slice();
const ivName=()=>({D:'日',W:'週',M:'月'})[interval];
const lots=v=>fmt(v/1000,0)+' 張';

// Adds (or reuses) an option for a user-typed value so a select can display it.
function customOption(select,value,label){value=String(value);if(!select||[...select.options].some(o=>o.value===value))return;const o=new Option(label,value);o.dataset.custom='1';const c=[...select.options].find(x=>x.value==='custom');select.insertBefore(o,c||null)}

/* ---------- ETF search ---------- */
const sortKey=e=>[e.type==='active'?1:0,parseInt(e.code.replace(/\D/g,''),10)||0,e.code];
function sortCatalog(){catalog.sort((a,b)=>{const x=sortKey(a),y=sortKey(b);return x[0]-y[0]||x[1]-y[1]||x[2].localeCompare(y[2])})}
let lastFocus=null,restoringSearchFocus=false,searchFocusTimer=null;
function openSearch(){if(restoringSearchFocus||!$('searchOverlay').classList.contains('hidden'))return;lastFocus=document.activeElement;$('searchOverlay').classList.remove('hidden');document.body.classList.add('searching');renderList();searchFocusTimer=setTimeout(()=>{if(!$('searchOverlay').classList.contains('hidden')){$('search').focus();$('search').select()}},30)}
// After a pick, focus must not jump back to the opener: the same Enter press would "click" it and reopen the sheet.
function closeSearch(restore=true){if($('searchOverlay').classList.contains('hidden'))return;clearTimeout(searchFocusTimer);$('searchOverlay').classList.add('hidden');document.body.classList.remove('searching');if(restore){restoringSearchFocus=true;try{lastFocus?.focus?.({preventScroll:true})}finally{restoringSearchFocus=false}}else document.activeElement?.blur?.()}
function pick(code){chartRange='1m';if(lwc)lwc.routeRange=null;selected=code;closeSearch(false);renderList();loadBars();const t=document.querySelector('.toolbar');window.scrollTo({top:t.getBoundingClientRect().top+scrollY-12,behavior:'instant'})}
/* Risk badge from the catalog name and index: inverse and leveraged first (their index names look like the core ones). */
function etfRisk(code){
  const e=catalog.find(x=>x.code===code);if(!e)return null;const t=e.name+' '+(e.note||'');
  if(/R$/.test(code)&&/反/.test(e.name))return{kind:'inverse',tag:'反向',warn:'反向 ETF 每日重設倍數，盤整與上漲時會持續耗損，只適合短線避險，不適合定期定額或逢低攤平。'};
  if(/L$/.test(code)&&/正2|正二/.test(e.name))return{kind:'lev',tag:'2倍槓桿',warn:'2 倍槓桿波動約為原型的兩倍，盤整時有耗損；逢低攤平又不設停損，回落可能非常深。建議改用再平衡或趨勢策略。'};
  if(/B$/.test(code)||/債/.test(e.name))return{kind:'bond',tag:'債券'};
  if(/高息|高股息|股息|收息|高收益/.test(t))return{kind:'income',tag:'高息'};
  if(e.type==='passive'&&/臺灣50指數|臺灣加權|發行量加權/.test(t))return{kind:'core',tag:'市值核心'};
  return null;
}
function riskBadge(code){const r=etfRisk(code);if(!r)return null;const s=document.createElement('span');s.className='risk-tag '+r.kind;s.textContent=r.tag;return s}
function renderQuick(){
  for(const id of ['quickPicks','quickInline']){
    const box=$(id);box.replaceChildren();
    for(const code of settings.watchlist){const e=catalog.find(x=>x.code===code);if(!e)continue;const b=document.createElement('button');b.type='button';b.className='pill mini'+(code===selected?' on':'');b.textContent=`${code} ${e.name}`;const rb=riskBadge(code);if(rb)b.append(rb);b.addEventListener('click',()=>pick(code));box.append(b)}
    if(!box.children.length){const p=document.createElement('span');p.className='small';p.textContent='點候選卡片上的追蹤按鈕建立清單';box.append(p)}
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
function closeDisplay(){} // Appearance is now a tab inside the account dialog.
renderList=function(){
  if(catalog.length&&!catalog.sorted){sortCatalog();catalog.sorted=true}
  const q=$('search').value.trim().toLocaleLowerCase('zh-TW');
  const matches=catalog.filter(e=>(type==='all'||type==='watch'&&settings.watchlist.includes(e.code)||e.type===type)&&(!q||`${e.code} ${e.name} ${e.note||''}`.toLocaleLowerCase('zh-TW').includes(q)));
  // Exact code hits first, so typing 0050 does not bury 0050 under 00500-style codes.
  if(q)matches.sort((a,b)=>(b.code.toLowerCase()===q)-(a.code.toLowerCase()===q)||(b.code.toLowerCase().startsWith(q))-(a.code.toLowerCase().startsWith(q)));
  $('catalogNote').textContent=`證交所上市 ETF ${catalog.length} 檔 · 約十年日 K`;
  $('searchCount').textContent=`共 ${catalog.length} 檔，符合 ${matches.length} 檔${q?`「${$('search').value.trim()}」`:''}`;
  $('etfList').replaceChildren();
  const limit=q?150:catalog.length;
  for(const e of matches.slice(0,limit)){
    const row=document.createElement('div');row.className='etf-result';
    const b=document.createElement('button');b.type='button';b.className='candidate-pick'+(e.code===selected?' selected':'');
    const strong=document.createElement('strong');strong.textContent=`${e.code} · ${e.name}`;const rb=riskBadge(e.code);if(rb)strong.append(rb);
    const small=document.createElement('small');small.textContent=`${e.type==='active'?'主動型':'被動型'} · ${e.listingDate?e.listingDate+' 上市':'上市日期待查'}`;
    b.append(strong,small);
    if(e.note&&e.note!=='主動管理'){const idx=document.createElement('small');idx.className='index';idx.textContent=e.note;b.append(idx)}
    b.addEventListener('click',()=>pick(e.code));
    const star=document.createElement('button');star.type='button';star.className='watch-star';star.setAttribute('aria-label',settings.watchlist.includes(e.code)?`取消追蹤 ${e.code}`:`追蹤 ${e.code}`);star.setAttribute('aria-pressed',String(settings.watchlist.includes(e.code)));star.textContent=settings.watchlist.includes(e.code)?'已追蹤':'追蹤';
    star.addEventListener('click',()=>{settings.watchlist=settings.watchlist.includes(e.code)?settings.watchlist.filter(x=>x!==e.code):[...settings.watchlist,e.code].slice(0,50);save();renderList()});
    row.append(b,star);$('etfList').append(row);
  }
  if(!matches.length)$('etfList').textContent='沒有符合的 ETF；請確認名稱或代號';
  else if(matches.length>limit){const p=document.createElement('p');p.className='small more';p.textContent=`顯示前 ${limit} 檔，繼續輸入可縮小範圍。`;$('etfList').append(p)}
  renderQuick();
  const risk=etfRisk(selected);$('riskTag').textContent=risk?.tag||'';$('riskTag').className='risk-tag'+(risk?' '+risk.kind:' hidden');
};
$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){const first=$('etfList').querySelector('.candidate-pick');if(first){e.preventDefault();first.click()}}});

let accountReturnFocus=null;
function accountPane(name){const appearance=name==='appearance';$('accountProfilePane').classList.toggle('hidden',appearance);$('accountAppearancePane').classList.toggle('hidden',!appearance);document.querySelectorAll('[data-account-pane]').forEach(b=>{const on=(b.dataset.accountPane==='appearance')===appearance;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1})}
function openAccount(){accountReturnFocus=document.activeElement;accountPane('profile');$('accountOverlay').classList.remove('hidden');document.body.classList.add('account-open');$('closeAccount').focus({preventScroll:true})}
function closeAccount(){const wasOpen=!$('accountOverlay').classList.contains('hidden');$('accountOverlay').classList.add('hidden');document.body.classList.remove('account-open');if(wasOpen)accountReturnFocus?.focus?.({preventScroll:true})}
document.querySelector('.account-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-account-pane]');if(b)accountPane(b.dataset.accountPane)});
document.querySelector('.account-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-account-pane]')],at=tabs.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?1:1-Math.max(0,at);accountPane(tabs[next].dataset.accountPane);tabs[next].focus()});
$('accountOverlay').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const all=[...$('accountOverlay').querySelectorAll('button,select,input,a[href]')].filter(el=>el.getClientRects().length&&!el.disabled&&el.tabIndex!==-1),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
for(const id of ['accountTop','memberStart'])$(id)?.addEventListener('click',openAccount);
$('closeAccount').addEventListener('click',closeAccount);
$('accountOverlay').addEventListener('click',e=>{if(e.target===$('accountOverlay'))closeAccount()});
window.chaoweiApplyProfile=profile=>{if(!profile||typeof profile!=='object')return;
  if(profile.settings&&typeof profile.settings==='object')Object.assign(settings,profile.settings);
  // Migrate before any renderer runs, including the first Google profile restoration.
  if(typeof btMigrate==='function')settings.bt=btMigrate(settings.bt);
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
  $('barGrade').textContent=position?fmt(position.core,1)+' / 5':'—';
  $('barDate').textContent=last?last.date.slice(5):'—';
  const provisional=liveQuote?.available&&last&&liveQuote.date>last.date;
  $('liveSource').classList.toggle('hidden',!provisional);
  $('priceLabel').textContent=provisional?'最新成交價':'最近收盤價';
  $('barPrice').previousElementSibling.textContent=provisional?'盤中成交':'收盤';
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
    if(keepView&&bars.length&&data.latest===bars.at(-1)?.date&&JSON.stringify(data.bars)===JSON.stringify(bars))return;
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
// User-defined indicator parameters. The series keep their slot names (ma5/ma20/ma60 = short/mid/long).
const IND_DEFAULT={ma:[5,20,60],bb:[20,2],macd:[12,26,9],rsi:14,kd:9};
function normInd(x){
  x=x&&typeof x==='object'?x:{};const int=(v,lo,hi,d)=>{v=Math.round(Number(v));return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):d};
  const f=int(x.macd?.[0],2,60,12);let s=int(x.macd?.[1],3,120,26);if(s<=f)s=f+1;
  return{ma:[0,1,2].map(i=>int(x.ma?.[i],2,2400,IND_DEFAULT.ma[i])),bb:[int(x.bb?.[0],5,100,20),Math.max(0.5,Math.min(4,Number(x.bb?.[1])||2))],macd:[f,s,int(x.macd?.[2],2,60,9)],rsi:int(x.rsi,2,60,14),kd:int(x.kd,3,60,9)};
}
settings.ind=normInd(settings.ind);
const indName={ma:i=>'MA'+settings.ind.ma[i],rsi:()=>'RSI '+settings.ind.rsi,kd:()=>'KD '+settings.ind.kd};
function technical(all){
  const P=settings.ind,close=all.map(x=>x.close),len=all.length,ma5=sma(close,P.ma[0]),ma20=sma(close,P.ma[1]),ma60=sma(close,P.ma[2]);
  const [bn,bk]=P.bb,mid=sma(close,bn),upper=Array(len).fill(null),lower=Array(len).fill(null);
  for(let i=bn-1;i<len;i++){let s=0;for(let j=i-bn+1;j<=i;j++)s+=(close[j]-mid[i])**2;const sd=Math.sqrt(s/bn);upper[i]=mid[i]+bk*sd;lower[i]=mid[i]-bk*sd}
  const [mf,ms,mg]=P.macd,ef=ema(close,mf),es=ema(close,ms),dif=close.map((_,i)=>i<ms-1?null:ef[i]-es[i]),dea=ema(dif,mg),hist=dif.map((v,i)=>v==null||dea[i]==null?null:(v-dea[i])*2);
  const R=P.rsi,rsi=Array(len).fill(null);let gain=0,loss=0;
  for(let i=1;i<len;i++){const ch=close[i]-close[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);if(i<=R){gain+=g/R;loss+=l/R}else{gain=(gain*(R-1)+g)/R;loss=(loss*(R-1)+l)/R}if(i>=R)rsi[i]=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss)}
  const K=P.kd,kk=Array(len).fill(null),dd=Array(len).fill(null);let k=50,d=50;
  for(let i=K-1;i<len;i++){let hi=-Infinity,lo=Infinity;for(let j=i-K+1;j<=i;j++){hi=Math.max(hi,all[j].high);lo=Math.min(lo,all[j].low)}const rsv=hi===lo?50:(close[i]-lo)/(hi-lo)*100;k=k*2/3+rsv/3;d=d*2/3+k/3;kk[i]=k;dd[i]=d}
  return{ma5,ma20,ma60,mid,upper,lower,dif,dea,hist,rsi,k:kk,d:dd,volMa20:sma(all.map(x=>x.volume),20)};
}

/* ---------- Chart ---------- */
function themeColors(){const dark=document.body.classList.contains('dark');return{text:dark?'#a5c0c1':'#617982',grid:dark?'#24434b':'#e7efef',border:dark?'#34525a':'#dce8e8',bg:'transparent'}}
function uiFontScale(){return settings.font==='xlarge'?1.38:settings.font==='large'?1.24:1.1}
function chartOptions(){
  const c=themeColors();
  return{autoSize:true,layout:{background:{type:'solid',color:c.bg},textColor:c.text,fontSize:Math.round(13*uiFontScale()),fontFamily:'-apple-system,BlinkMacSystemFont,"Noto Sans TC","Microsoft JhengHei",sans-serif'},
    grid:{vertLines:{color:c.grid},horzLines:{color:c.grid}},rightPriceScale:{borderColor:c.border,minimumWidth:Math.round(72*uiFontScale())},
    timeScale:{borderColor:c.border,rightOffset:0,minBarSpacing:0.05,fixLeftEdge:true,fixRightEdge:true},
    crosshair:{mode:0},localization:{locale:'zh-TW',dateFormat:'yyyy-MM-dd'},
    handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:false}},kineticScroll:{touch:true,mouse:false}};
}
function buildCharts(){
  if(lwc||!window.LightweightCharts)return lwc;
  // Volume sits in its own pane (as on the Stock site) so the price axis never labels the volume area.
  const L=window.LightweightCharts,main=L.createChart($('chart'),{...chartOptions(),timeScale:{...chartOptions().timeScale,visible:false}}),vol=L.createChart($('volChart'),chartOptions());
  const oscCharts={};for(const k of OSC_KEYS)oscCharts[k]=L.createChart($('chart'+OSC_ID[k]),chartOptions());
  const {macd,rsi,kd}=oscCharts;
  const line=(chart,color,extra={})=>chart.addLineSeries({color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,...extra});
  const s={
    candle:main.addCandlestickSeries({upColor:RISE,downColor:FALL,borderUpColor:RISE,borderDownColor:FALL,wickUpColor:RISE,wickDownColor:FALL,priceFormat:{type:'price',precision:2,minMove:0.01}}),
    volume:vol.addHistogramSeries({priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false}),
    ma5:line(main,COLORS.ma5),ma20:line(main,COLORS.ma20),ma60:line(main,COLORS.ma60),
    bollUp:line(main,COLORS.boll,{lineStyle:2,lineWidth:1.5}),bollLow:line(main,COLORS.boll,{lineStyle:2,lineWidth:1.5}),
    hist:macd.addHistogramSeries({priceLineVisible:false,lastValueVisible:false}),dif:line(macd,COLORS.dif),dea:line(macd,COLORS.dea),
    rsi:line(rsi,COLORS.rsi,{lastValueVisible:true}),k:line(kd,COLORS.k,{lastValueVisible:true}),d:line(kd,COLORS.d,{lastValueVisible:true})
  };
  main.priceScale('right').applyOptions({scaleMargins:{top:.05,bottom:.05}});
  vol.priceScale('right').applyOptions({scaleMargins:{top:.12,bottom:0}});
  lwc={L,main,vol,oscCharts,s,guides:[],syncing:false,data:[],tech:null};
  $('chart').dataset.axisFontSize=String(main.options().layout.fontSize);
  // Keep the volume and indicator panes aligned bar-for-bar with the price pane.
  const panes=[main,vol,macd,rsi,kd];
  for(const from of panes)from.timeScale().subscribeVisibleLogicalRangeChange(r=>{
    if(!r||lwc.syncing)return;lwc.syncing=true;
    for(const to of visiblePanes())if(to!==from)to.timeScale().setVisibleLogicalRange(r);
    lwc.syncing=false;
  });
  main.subscribeCrosshairMove(p=>{updateLegend(p?.logical);showTip(p)});
  main.subscribeClick(p=>window.chaoweiPins?.onChartClick(p));
  let waveMarkerFrame=0;
  main.timeScale().subscribeVisibleLogicalRangeChange(()=>{if(waveMarkerFrame)return;waveMarkerFrame=requestAnimationFrame(()=>{waveMarkerFrame=0;window.chaoweiWave?.refreshMarkers()})});
  vol.subscribeCrosshairMove(p=>{updateLegend(p?.logical);showTip(p&&p.point?{...p,point:{x:p.point.x,y:$('chart').clientHeight-10}}:p)});
  for(const k of OSC_KEYS)oscCharts[k].subscribeCrosshairMove(p=>updateLegend(p?.logical));
  return lwc;
}
// Hidden sub-chart panes have no width, so they are left out of range syncing.
function visiblePanes(){return lwc?[lwc.main,lwc.vol,...OSC_KEYS.filter(oscOn).map(k=>lwc.oscCharts[k])]:[]}
function seriesData(all,values){return all.map((b,i)=>values[i]==null?{time:b.date}:{time:b.date,value:values[i]})}
function setVisible(range){
  if(!lwc||!lwc.data.length)return;
  const all=lwc.data,n=all.length;let from=0;
  if(range==='custom'){
    // A user-picked date span: first bar on/after the start, last bar on/before the end.
    const from=settings.chartFrom||all[0].date,to=settings.chartTo||all.at(-1).date;let a=all.findIndex(b=>b.date>=from),z=-1;for(let k=0;k<n;k++)if(all[k].date<=to)z=k;
    if(a<0)a=0;if(z<a)z=Math.min(n-1,a+20);const r={from:a-0.5,to:z+0.5},apply=()=>{for(const c of visiblePanes())c.timeScale().setVisibleLogicalRange(r)};apply();requestAnimationFrame(()=>requestAnimationFrame(apply));return;
  }
  if(range!=='all'){const months=/m$/.test(range)?Number(range.slice(0,-1)):Math.round(Number(range)*12),d=new Date(all.at(-1).date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-months);const start=d.toISOString().slice(0,10);from=all.findIndex(b=>b.date>=start);if(from<0)from=0}
  // Set every pane directly: on first load the volume pane reports its own default range a frame later,
  // and the pane sync would otherwise copy that wider range back onto the price chart.
  const r={from:Math.max(-0.5,from-0.5),to:n-1+3},apply=()=>{for(const c of visiblePanes())c.timeScale().setVisibleLogicalRange(r)};
  apply();requestAnimationFrame(()=>requestAnimationFrame(apply));
}
function setRange(range){chartRange=String(range);$('rangeSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.range===chartRange));if(lwc)setVisible(chartRange);else drawChart()}
function applyOverlayButtons(){document.querySelectorAll('[data-overlay]').forEach(b=>b.setAttribute('aria-pressed',String(!!settings.overlays[b.dataset.overlay])));$('oscSeg').querySelectorAll('button').forEach(b=>{const on=b.dataset.osc==='none'?!settings.oscs.length:oscOn(b.dataset.osc);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}
drawChart=function(keepView=false){
  const last=bars.at(-1),provisional=liveQuote?.available&&last&&liveQuote.date>last.date;
  const quoteBar=provisional?{
    date:liveQuote.date,open:liveQuote.open||liveQuote.price,
    high:Math.max(liveQuote.high||liveQuote.price,liveQuote.price,liveQuote.open||liveQuote.price),
    low:Math.min(liveQuote.low||liveQuote.price,liveQuote.price,liveQuote.open||liveQuote.price),
    close:liveQuote.price,volume:liveQuote.volumeShares||0
  }:null;
  const daily=withVolumeBasis(quoteBar?[...bars,quoteBar]:bars),all=aggregate(daily,interval);
  if(!buildCharts())return drawSvgFallback(all);
  const {main,s}=lwc,tech=technical(all),ov=settings.overlays;
  const old=keepView?main.timeScale().getVisibleLogicalRange():null;
  lwc.data=all;lwc.daily=daily;lwc.tech=tech;
  s.candle.setData(all.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close})));
  window.chaoweiPins?.render();
  s.volume.setData(all.map(b=>({time:b.date,value:b.volume/1000,color:(b.close>=b.open)!==(settings.colorScheme==='intl')?'rgba(229,72,77,.45)':'rgba(18,160,107,.45)'})));
  for(const k of ['ma5','ma20','ma60']){s[k].setData(seriesData(all,tech[k]));s[k].applyOptions({visible:!!ov[k]})}
  s.bollUp.setData(seriesData(all,tech.upper));s.bollLow.setData(seriesData(all,tech.lower));
  s.bollUp.applyOptions({visible:!!ov.boll});s.bollLow.applyOptions({visible:!!ov.boll});
  if(ov.boll&&!ov.ma20&&settings.ind.bb[0]===settings.ind.ma[1])s.ma20.applyOptions({visible:true,color:COLORS.boll,lineStyle:2});else s.ma20.applyOptions({color:COLORS.ma20,lineStyle:0});
  // Sub-chart panes (any combination of MACD, RSI, KD).
  for(const k of OSC_KEYS)$('pane'+OSC_ID[k]).classList.toggle('hidden',!oscOn(k));
  for(const g of lwc.guides)g.series.removePriceLine(g.line);lwc.guides=[];
  s.hist.setData(oscOn('macd')?all.map((b,i)=>tech.hist[i]==null?{time:b.date}:{time:b.date,value:tech.hist[i],color:(tech.hist[i]>=0)!==(settings.colorScheme==='intl')?'rgba(229,72,77,.6)':'rgba(18,160,107,.6)'}):[]);
  s.dif.setData(oscOn('macd')?seriesData(all,tech.dif):[]);s.dea.setData(oscOn('macd')?seriesData(all,tech.dea):[]);
  s.rsi.setData(oscOn('rsi')?seriesData(all,tech.rsi):[]);
  s.k.setData(oscOn('kd')?seriesData(all,tech.k):[]);s.d.setData(oscOn('kd')?seriesData(all,tech.d):[]);
  const guide=(series,price,title)=>lwc.guides.push({series,line:series.createPriceLine({price,color:'#9fb3b6',lineWidth:1,lineStyle:2,axisLabelVisible:false,title})});
  if(oscOn('rsi')){guide(s.rsi,70,'70');guide(s.rsi,30,'30')}
  if(oscOn('kd')){guide(s.k,80,'80');guide(s.k,20,'20')}
  if(oscOn('macd'))guide(s.dif,0,'');
  if(old)main.timeScale().setVisibleLogicalRange(old);else setVisible(chartRange);
  requestAnimationFrame(()=>{const r=main.timeScale().getVisibleLogicalRange();if(!r)return;for(const c of visiblePanes())if(c!==main)c.timeScale().setVisibleLogicalRange(r)});
  $('chartCaption').textContent=`紅漲綠跌 · 量：張${volumeAdjusted()?'（分割前已換算）':''}${provisional?' · 末根為盤中暫值':''} · 滾輪縮放、拖曳平移`;
  $('chart').setAttribute('aria-label',all.length?`${selected} ${ivName()} K，${all[0].date} 至 ${all.at(-1).date}`:'尚未取得 K 線資料');
  updateLegend(null);renderTechRead(provisional?all.slice(0,-1):all,provisional?technical(all.slice(0,-1)):tech);
};
function updateLegend(logical){
  if(!lwc)return;const all=lwc.data,t=lwc.tech;if(!all.length){$('chartLegend').textContent='—';return}
  const raw=Number.isFinite(logical)?Math.round(logical):(lwc.visibleAnchor??all.length-1),i=Math.max(0,Math.min(all.length-1,raw)),b=all[i],prev=all[i-1];
  const chg=prev?b.close-prev.close:null,pct=prev?chg/prev.close*100:null,cls=chg>0?'up':chg<0?'down':'';
  const item=(label,val,color)=>`<span${color?` style="--c:${color}"`:''} class="${color?'dot':''}"><small>${label}</small>${val}</span>`;
  let h=item('日期',b.date)+item('開',fmt(b.open,2))+item('高',fmt(b.high,2))+item('低',fmt(b.low,2))+`<span class="${cls}"><small>收</small>${fmt(b.close,2)}${chg==null?'':` <em>${chg>=0?'+':''}${fmt(chg,2)}（${chg>=0?'+':''}${fmt(pct,2)}%）</em>`}</span>`+item('量',lots(b.volume));
  ['ma5','ma20','ma60'].forEach((k,j)=>{if(settings.overlays[k]&&t[k][i]!=null)h+=item(indName.ma(j),fmt(t[k][i],2),COLORS[k])});
  if(settings.overlays.boll&&t.upper[i]!=null)h+=item('布林上／下',`${fmt(t.upper[i],2)}／${fmt(t.lower[i],2)}`,COLORS.boll);
  $('chartLegend').innerHTML=h;
  if(oscOn('macd'))$('legendMacd').innerHTML=item('MACD','')+item('DIF',fmt(t.dif[i],3),COLORS.dif)+item('DEA',fmt(t.dea[i],3),COLORS.dea)+item('柱',fmt(t.hist[i],3));
  if(oscOn('rsi'))$('legendRsi').innerHTML=item('RSI'+settings.ind.rsi,fmt(t.rsi[i],1),COLORS.rsi);
  if(oscOn('kd'))$('legendKd').innerHTML=item('KD','')+item('K'+settings.ind.kd,fmt(t.k[i],1),COLORS.k)+item('D'+settings.ind.kd,fmt(t.d[i],1),COLORS.d);
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
  const slope=t.ma20[n]-t.ma20[n-5],M2=indName.ma(1),M3=indName.ma(2),trend=c>t.ma20[n]&&c>t.ma60[n]?`收盤在 ${M2} 與 ${M3} 之上`:c<t.ma20[n]&&c<t.ma60[n]?`收盤在 ${M2} 與 ${M3} 之下`:`收盤介於 ${M2} 與 ${M3} 之間`;
  rows.push(['趨勢',slope>0?'均線上彎':'均線下彎',`${trend}；${M2} 較 5 ${u}前${slope>0?'上升':'下降'} ${fmt(Math.abs(slope/t.ma20[n-5]*100),2)}%。`]);
  const pb=(c-t.lower[n])/(t.upper[n]-t.lower[n]),bw=(t.upper[n]-t.lower[n])/t.mid[n],past=[];for(let i=Math.max(settings.ind.bb[0]-1,n-119);i<=n;i++)past.push((t.upper[i]-t.lower[i])/t.mid[i]);
  const bwRank=past.filter(x=>x<=bw).length/past.length;
  rows.push(['布林通道',`%B ${fmt(pb,2)}`,`收盤位於通道${pb>1?'上軌之外':pb<0?'下軌之外':pb>=.8?'上緣附近':pb<=.2?'下緣附近':'中段'}；通道寬度 ${fmt(bw*100,1)}%，在近 ${past.length} ${u}中屬${bwRank<=.2?'偏窄（波動收斂）':bwRank>=.8?'偏寬（波動擴大）':'一般'}。`]);
  const mc=lastCross(t.dif,t.dea);
  rows.push(['MACD',t.hist[n]>=0?'柱狀體為正':'柱狀體為負',`DIF ${fmt(t.dif[n],3)}、DEA ${fmt(t.dea[n],3)}；${mc?`${mc.ago===0?'本':mc.ago+' '}${u}${mc.ago===0?'':'前'}出現${mc.up?'黃金交叉':'死亡交叉'}`:'近期無交叉'}；DIF 位於零軸${t.dif[n]>=0?'之上':'之下'}。`]);
  const r=t.rsi[n];rows.push([indName.rsi(),fmt(r,1),r>=70?'位於 70 以上的偏熱區。':r<=30?'位於 30 以下的偏冷區。':`位於 30–70 中性區，${r>=50?'漲幅略占上風':'跌幅略占上風'}。`]);
  const kc=lastCross(t.k,t.d);rows.push([indName.kd(),`K ${fmt(t.k[n],1)}／D ${fmt(t.d[n],1)}`,`${t.k[n]>=80?'K 值在 80 以上高檔':t.k[n]<=20?'K 值在 20 以下低檔':'K 值在中段'}；${kc?`${kc.ago===0?'本'+u:kc.ago+' '+u+'前'} K ${kc.up?'向上':'向下'}穿越 D`:'近期無交叉'}。`]);
  const vr=all[n].volume/t.volMa20[n];rows.push(['量能',`${fmt(vr,2)} 倍`,`最新成交 ${lots(all[n].volume)}，為 20 ${u}均量的 ${fmt(vr,2)} 倍（${vr>=1.5?'明顯放量':vr<=.6?'明顯縮量':'接近均量'}）。`]);
  const active=new Set(['趨勢','量能']);
  if(settings.overlays.boll)active.add('布林通道');
  if(oscOn('macd'))active.add('MACD');
  if(oscOn('rsi'))active.add(indName.rsi());
  if(oscOn('kd'))active.add(indName.kd());
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
  settings.showLevels=settings.showLevels===true;
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
$('oscSeg').addEventListener('click',e=>{
  const b=e.target.closest('button[data-osc]');if(!b)return;const k=b.dataset.osc;
  settings.oscs=k==='none'?[]:oscOn(k)?settings.oscs.filter(x=>x!==k):OSC_KEYS.filter(x=>x===k||oscOn(x));
  settings.osc=settings.oscs[0]||'none';applyOverlayButtons();save();drawChart(true);
});
const originalPrefs=prefs;
prefs=function(){originalPrefs();if(lwc){lwc.main.applyOptions({...chartOptions(),timeScale:{...chartOptions().timeScale,visible:false}});lwc.vol.applyOptions(chartOptions());for(const k of OSC_KEYS)lwc.oscCharts[k].applyOptions(chartOptions());$('chart').dataset.axisFontSize=String(lwc.main.options().layout.fontSize);window.dispatchEvent(new Event('chaowei-typography-changed'))}};

/* ---------- Volume basis: exchange-reported lots, or converted across splits ---------- */
// Bollinger bands are opt-in; earlier test builds may have saved them as on.
if((settings.overlayRev||0)<3){settings.overlays={ma5:false,ma20:false,ma60:false,boll:false};settings.osc='none';settings.oscs=[];settings.showLevels=false;settings.overlayRev=3;applyOverlayButtons();updateAnchorControls()}
settings.volumeBasis=settings.volumeBasis==='adjusted'?'adjusted':'raw';
$('volumeBasis').value=settings.volumeBasis;
$('volumeBasis').addEventListener('change',function(){settings.volumeBasis=this.value==='adjusted'?'adjusted':'raw';save();drawChart(true)});
function volumeAdjusted(){return settings.volumeBasis==='adjusted'&&(historyMeta?.adjustments||[]).length>0}
// A 1 至 4 split (factor 4) means one old lot equals four of today's lots, so earlier volume is multiplied by 4.
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
const shortDate=d=>String(d||'').slice(5).replace('-','/');
async function loadIntradayProfile(){try{const r=await fetch('/api/intraday-profile'),d=await r.json();if(r.ok&&Array.isArray(d.days))intradayProfile=d}catch{}}
function applyLive(){
  // Only merge the BRF near-month series; an older Apps Script version still answers with EIA spot in US dollars.
  if(live?.brent?.unit==='TWD/barrel'&&live.brent.days?.length&&brent.length){brent=mergeDays(brent,live.brent.days);brentSnapshot=false}
  if(live?.fx?.days?.length&&fx.length)fx=mergeDays(fx,live.fx.days);
  computeMarket();computeBrent();computeFx();updateWeights();
}
let liveFailure=null;
function renderLiveMeta(){
  if(!liveAt)return;
  $('refreshClock').textContent=hhmm(liveAt);
  if(liveFailure){$('liveMeta').textContent=`台股 ${market.at(-1)?.date||'—'} 收盤 · 線上檢查失敗（${liveFailure}），沿用每日快照`;return}
  const parts=[];
  if(live?.intraday)parts.push('大盤盤中 '+live.intraday.time.slice(0,5));
  else if(market.at(-1)?.date)parts.push('台股 '+shortDate(market.at(-1).date));
  if(live?.oil?.unit==='USD/barrel')parts.push('原油現貨 '+shortDate(live.oil.latest));
  if(live?.fx)parts.push('匯率 '+shortDate(live.fx.latest));
  if(live?.errors?.length)parts.push('部分來源暫不可用：'+live.errors.join('；'));
  $('liveMeta').textContent=parts.join(' · ')||'休市沿用最近收盤；等待下次檢查';
}
async function loadLive(){
  if(!window.CHAOWEI_LIVE){$('liveMeta').textContent='此版本未連接即時市場資料';return}
  try{live=await window.CHAOWEI_LIVE();liveAt=new Date();liveFailure=null}
  catch(e){liveAt=new Date();liveFailure=e.message;renderLiveMeta();return}
  if(live?.intraday&&!intradayProfile)await loadIntradayProfile();
  applyLive();renderLiveMeta();
}
const baseLoadMarket=loadMarket;
loadMarket=async function(){await baseLoadMarket();renderLiveMeta()};
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
    marketPosition.volumeGrade=null;marketPosition.volumeScore=null;$('volumeScore').textContent='—';
    $('volumeMeta').textContent='盤中 '+t.slice(0,5)+' 累計 '+fmt(li.lots*1000/1e8,2)+' 億股 · 同時段歷史不足，暫不計分';return;
  }
  const rank=prior.filter(v=>v<=today).length/prior.length,grade=Math.max(1,Math.min(5,Math.ceil(rank*5)));
  marketPosition.volumeGrade=grade;marketPosition.volumeScore=rank*5;marketPosition.rank=rank;
  $('volumeScore').textContent=fmt(rank*5,1)+' / 5';
  $('volumeMeta').textContent='盤中 '+mark.slice(0,2)+':'+mark.slice(2)+' 累計 '+fmt(today*1000/1e8,2)+' 億股 · 與前 '+prior.length+' 日同時段比第 '+Math.round(rank*100)+' 百分位';
};
// Factor notes keep value and date only; the scoring direction and update time are stated once on the card.
const tidyMeta=id=>{$(id).textContent=$(id).textContent.replace(/ · (低價分高|數值低分高|來源快照|每日快照)/g,'')};
const baseComputeBrent=computeBrent;
computeBrent=function(){baseComputeBrent();tidyMeta('brentMeta')};
const liveComputeFx=computeFx;
computeFx=function(){liveComputeFx();tidyMeta('fxMeta')};
const baseUpdateWeights=updateWeights;
updateWeights=function(){baseUpdateWeights();if(Number($('wVolume').value)>0&&settings.volumeDirection!=='off'&&marketPosition&&marketPosition.volumeGrade==null){$('combined').textContent='—';$('combinedExtra').textContent='盤中同時段量能資料不足，暫不計算綜合分'}};
// USD/TWD scoring direction is the user's call: a strong or a weak TWD can be the favourable side.
// Owner's rule (2026-10-20): a strong TWD (USD/TWD around 29) is no time to add, so a higher USD/TWD scores higher.
if(!settings.fxRev){settings.fxDirection='high';settings.fxRev=1}
settings.fxDirection=settings.fxDirection==='low'?'low':'high';$('fxDirection').value=settings.fxDirection;
$('fxDirection').addEventListener('change',function(){settings.fxDirection=this.value==='high'?'high':'low';computeFx();updateWeights();save()});
loadLive();
setInterval(()=>{if(!document.hidden)loadLive()},300000);

/* ---------- Member-only cards: backtest and weight plans unlock with Google sign-in ---------- */
let isMember=false;
window.chaoweiSetMember=signedIn=>{
  isMember=!!signedIn;document.body.classList.toggle('member',isMember);
  // Blurred content must not be reachable by keyboard or screen reader either.
  document.querySelectorAll('.member-only').forEach(card=>{for(const el of card.querySelectorAll('[data-member-gated]'))el.inert=!isMember;for(const el of card.children)if(!el.classList.contains('member-lock')){el.dataset.memberGated='';el.inert=!isMember}});
  window.chaoweiResearchMemberChanged?.(isMember);
  applyMarkers();updateWeights();
};
document.addEventListener('click',e=>{if(e.target.closest('[data-open-account]'))openAccount()});
window.chaoweiSetMember(false);
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
    el.textContent=(id==='priceChange'?(d.chg>0?' ':d.chg<0?' ':''):'')+changeText(d);
  }
  // One status label instead of three: the data date and whether it is a close or an intraday price.
  const last=bars.at(-1),provisional=liveQuote?.available&&last&&liveQuote.date>last.date;
  $('asof').classList.add('hidden');
  $('quoteStatus').textContent=!last?'—':provisional?'盤中 '+(liveQuote.time?new Date(liveQuote.time).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}):''):last.date.slice(5)+' 收盤';
}
const changeRenderPosition=renderPosition;
renderPosition=function(){changeRenderPosition();renderChange()};
function labelLastBar(){
  if(!lwc)return;const all=lwc.data,b=all.at(-1),p=all.at(-2);
  lwc.s.candle.applyOptions({title:chartRange!=='custom'&&b&&p&&p.close>0?(b.close>=p.close?'+':'')+fmt((b.close-p.close)/p.close*100,2)+'%':''});
}

/* ---------- One crosshair across price, volume and indicator panes ---------- */
function syncCrosshair(){
  if(!lwc||lwc.crossSynced)return;lwc.crossSynced=true;
  const {main,vol,oscCharts,s}=lwc,panes=[main,vol,...OSC_KEYS.map(k=>oscCharts[k])],seriesKey={macd:'dif',rsi:'rsi',kd:'k'};
  const target=chart=>{
    if(chart===main)return{series:s.candle,val:i=>lwc.data[i]?.close};
    if(chart===vol)return{series:s.volume,val:i=>lwc.data[i]?lwc.data[i].volume/1000:null};
    const o=OSC_KEYS.find(k=>oscCharts[k]===chart);if(!oscOn(o))return null;
    const key=seriesKey[o];return{series:s[key],val:i=>lwc.tech?.[key]?.[i]};
  };
  let moving=false;for(const from of panes)from.subscribeCrosshairMove(p=>{
    if(moving)return;moving=true;try{
    for(const to of panes){
      if(to===from)continue;const t=target(to);if(!t)continue;
      const i=p&&p.time&&Number.isFinite(p.logical)?Math.round(p.logical):-1,v=i>=0?t.val(i):null;
      if(v==null||!Number.isFinite(v))to.clearCrosshairPosition();else to.setCrosshairPosition(v,p.time,t.series);
    }}finally{moving=false}
  });
}
const crossDrawChart=drawChart;
drawChart=function(keepView){crossDrawChart(keepView);syncCrosshair();labelLastBar();window.chaoweiWave?.render()};

/* ---------- Favourites: up to ten saved condition sets for members, one click to apply ---------- */
settings.favorites=Array.isArray(settings.favorites)?settings.favorites.filter(f=>f&&typeof f.name==='string'&&f.s&&typeof f.s==='object').slice(0,10):[];
function favSnapshot(){return{window:settings.window,preferredWindow:settings.preferredWindow||settings.window,method:settings.method,anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,basis:$('basis').value,bt:{...settings.bt}}}
function favLabel(s){
  const a={wick:'最高最低',close:'收盤極值',average:'平均 '+s.anchorCount+' 筆'}[s.anchorMode]||'';
  const bt=s.bt?.v===3?((ChaoweiEngine.PRESETS.find(x=>x.id===s.bt.preset)||{}).name||'自訂策略'):'';
  return (s.window==='all'?'全部':s.window+' 日')+' · '+(s.method==='fib'?'黃金分割':'等距')+' · '+a+' · '+bt;
}
const favSame=(a,b)=>JSON.stringify({...a,bt:{...a.bt,markers:0}})===JSON.stringify({...b,bt:{...b.bt,markers:0}});
function renderFavs(){
  const box=$('favList'),cur=favSnapshot();box.replaceChildren();
  settings.favorites.forEach((f,i)=>{
    const chip=document.createElement('span');chip.className='fav-chip'+(favSame(f.s,cur)?' on':'');
    const go=document.createElement('button');go.type='button';go.textContent=f.name;go.title=favLabel(f.s);go.addEventListener('click',()=>applyFav(f));
    const del=document.createElement('button');del.type='button';del.className='fav-del';del.textContent='移除';del.setAttribute('aria-label','刪除收藏「'+f.name+'」');
    del.addEventListener('click',()=>{settings.favorites.splice(i,1);save();renderFavs()});
    chip.append(go,del);box.append(chip);
  });
  $('favAdd').disabled=settings.favorites.length>=10;
  $('favAdd').textContent=settings.favorites.length>=10?'已達 10 組上限':'收藏目前條件';
}
function applyFav(f){
  const s=f.s;
  Object.assign(settings,{window:s.window,preferredWindow:s.preferredWindow||s.window,method:s.method,anchorMode:s.anchorMode,anchorCount:s.anchorCount});
  if(s.bt)settings.bt=btMigrate(s.bt);
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
  settings.bt=btMigrate(settings.bt);btFillForm();btBarsRef=null;renderFavs();drawChart(true)};
renderFavs();

/* ---------- Drag bars: each chart pane can be made taller or shorter, remembered per browser ---------- */
const PANE_LIMITS={chart:[180,900],volChart:[60,400],chartMacd:[80,500],chartRsi:[80,500],chartKd:[80,500]};
settings.paneHeights=settings.paneHeights&&typeof settings.paneHeights==='object'?settings.paneHeights:{};
function setPaneHeight(id,h){
  const [lo,hi]=PANE_LIMITS[id]||[60,900],v=Math.round(Math.max(lo,Math.min(hi,h)));
  $(id).style.height=v+'px';settings.paneHeights[id]=v;return v;
}
for(const [id,h] of Object.entries(settings.paneHeights))if(PANE_LIMITS[id]&&Number.isFinite(h))setPaneHeight(id,h);
document.querySelectorAll('.pane-resizer').forEach(bar=>{
  const id=bar.dataset.resize;let startY=0,startH=0,dragging=false;
  bar.addEventListener('pointerdown',e=>{dragging=true;startY=e.clientY;startH=$(id).getBoundingClientRect().height;bar.setPointerCapture(e.pointerId);bar.classList.add('dragging');e.preventDefault()});
  bar.addEventListener('pointermove',e=>{if(dragging)setPaneHeight(id,startH+e.clientY-startY)});
  const end=()=>{if(!dragging)return;dragging=false;bar.classList.remove('dragging');save()};
  bar.addEventListener('pointerup',end);bar.addEventListener('pointercancel',end);
  // Double-click returns the pane to its default height.
  bar.addEventListener('dblclick',()=>{$(id).style.height='';delete settings.paneHeights[id];save()});
  bar.addEventListener('keydown',e=>{if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();setPaneHeight(id,$(id).getBoundingClientRect().height+(e.key==='ArrowDown'?20:-20));save()});
});

// A chart resized while its route is hidden loses its time-scale range. Capture
// before hiding, then restore after the route has a width, without resetting a
// user's manual pan to the selected preset.
window.chaoweiChartRouteView={
 save(){if(lwc&&$('chart').clientWidth>1)lwc.routeRange=lwc.main.timeScale().getVisibleLogicalRange()},
 restore(){if(!lwc||$('chart').clientWidth<2)return;const r=lwc.routeRange;if(r){for(const c of visiblePanes())c.timeScale().setVisibleLogicalRange(r)}else setVisible(chartRange)}
};

/* Deterministic, close-only swing research. A pivot becomes usable on confirmDate,
   never on the earlier extremeDate. Input is already adjusted for splits. */
const ChaoweiWave=(()=>{
  const defaults={minBars:10,reversal:3,large:10,fast:0.8,basis:'total',cutoff:''};
  const clamp=(v,lo,hi,fallback)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):fallback;
  function normalize(x={}){return{
    minBars:Math.round(clamp(x.minBars,2,120,defaults.minBars)),
    reversal:clamp(x.reversal,0.5,30,defaults.reversal),
    large:clamp(x.large,1,100,defaults.large),
    fast:clamp(x.fast,0.05,10,defaults.fast),
    basis:x.basis==='split'?'split':'total',
    cutoff:/^\d{4}-\d{2}-\d{2}$/.test(x.cutoff||'')?x.cutoff:''
  }}
  function priceSeries(rows,events=[],basis='total',adjustments=[]){
    if(basis==='split')return rows.map(b=>({...b,studyClose:b.close}));
    const div=new Map(events.filter(x=>Array.isArray(x)&&x.length>=2).map(([date,cash])=>{
      let factor=1;for(const a of adjustments)if(date<a.date)factor*=a.factor;
      return[date,Number(cash)/factor];
    }));
    let value=rows[0]?.close||0;
    return rows.map((b,i)=>{
      if(i)value*=((b.close+(div.get(b.date)||0))/rows[i-1].close);
      return{...b,studyClose:value};
    });
  }
  function detect(rows,input={}){
    const p=normalize(input),out=[];
    if(rows.length<2)return{pivots:out,segments:[],pending:null};
    let dir=0,start=0,low=0,high=0,candidate=0;
    const val=i=>rows[i].studyClose;
    for(let i=1;i<rows.length;i++){
      if(dir===0){
        if(val(i)<val(low))low=i;if(val(i)>val(high))high=i;
        if(i-low>=p.minBars&&val(i)>=val(low)*(1+p.reversal/100)){
          out.push({kind:'valley',index:low,date:rows[low].date,price:val(low),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          dir=1;candidate=-1;start=low;
        }else if(i-high>=p.minBars&&val(i)<=val(high)*(1-p.reversal/100)){
          out.push({kind:'peak',index:high,date:rows[high].date,price:val(high),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          dir=-1;candidate=-1;start=high;
        }
        continue;
      }
      // An extreme inside the minimum-spacing window cannot become the next
      // pivot. Begin tracking again at the first eligible bar, avoiding a
      // permanent stall after a short correction followed by a long trend.
      if(i-start<p.minBars)continue;
      if(candidate<0){candidate=i;continue}
      if(dir===1){
        if(val(i)>val(candidate))candidate=i;
        if(i>candidate&&val(i)<=val(candidate)*(1-p.reversal/100)){
          out.push({kind:'peak',index:candidate,date:rows[candidate].date,price:val(candidate),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          start=candidate;candidate=-1;dir=-1;
        }
      }else{
        if(val(i)<val(candidate))candidate=i;
        if(i>candidate&&val(i)>=val(candidate)*(1+p.reversal/100)){
          out.push({kind:'valley',index:candidate,date:rows[candidate].date,price:val(candidate),confirmDate:rows[i].endDate||rows[i].date,confirmIndex:i});
          start=candidate;candidate=-1;dir=1;
        }
      }
    }
    const segments=[];
    for(let i=1;i<out.length;i++){
      const from=out[i-1],to=out[i],bars=to.index-from.index;
      if(bars<=0||from.kind===to.kind)continue;
      const change=(to.price/from.price-1)*100;
      // In a strong long-term trend a later trough can be above an earlier
      // peak. It is a rising baseline, not a negative pullback.
      if(Math.abs(change)<p.reversal||from.kind==='peak'&&change>=0||from.kind==='valley'&&change<=0)continue;
      segments.push({from,to,bars,change,speed:Math.abs(change)/bars,
        size:Math.abs(change)>=p.large?'大波':'小波',
        pace:Math.abs(change)/bars>=p.fast?'快速':'緩慢',
        availableDate:to.confirmDate});
    }
    return{pivots:out,segments,pending:dir?{direction:dir,extremeDate:rows[candidate<0?start:candidate].date,lastDate:rows.at(-1).date}:null};
  }
  function summary(segments,cutoff='',excluded=[]){
    const accepted=segments.filter(s=>!excluded.some(date=>date>=s.from.date&&date<=s.to.date));
    const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
    const make=list=>({count:list.length,up:list.filter(s=>s.change>0).length,down:list.filter(s=>s.change<0).length,
      large:list.filter(s=>s.size==='大波').length,
      avgBars:avg(list.map(s=>s.bars)),avgChange:avg(list.map(s=>Math.abs(s.change))),
      avgPullback:avg(list.filter(s=>s.change<0).map(s=>Math.abs(s.change))),
      avgPullbackSpeed:avg(list.filter(s=>s.change<0).map(s=>s.speed))});
    return{all:make(accepted),training:make(accepted.filter(s=>!cutoff||s.availableDate<cutoff)),
      testing:make(cutoff?accepted.filter(s=>s.availableDate>=cutoff):[]),excluded:segments.length-accepted.length};
  }
  return{defaults,normalize,priceSeries,detect,summary};
})();

/* Lightweight research notes and the selected ETF's official institutional snapshot. */
const PIN_LABEL={valley:'參考谷',peak:'參考峰',exclude:'略過'};
const PIN_COLOR={valley:'#168a83',peak:'#dc5b52',exclude:'#8496a0'};
settings.wavePins=Array.isArray(settings.wavePins)?settings.wavePins.filter(p=>p&&/^[0-9A-Z]{4,6}$/.test(p.code)&&['D','W','M'].includes(p.interval)&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&PIN_LABEL[p.kind]).slice(-300):[];

const pinPanel=document.createElement('section');
pinPanel.className='wave-pin-panel member-only';
pinPanel.innerHTML='<div class="research-head"><div><h4>圖釘標記</h4><p class="small">只整理研究樣本，不改評分或回測。</p></div><button class="pill chip" type="button" id="pinMode" aria-pressed="false"> 標記 K 棒</button></div><div class="pin-controls"><label>標記用途<select id="pinKind"><option value="valley">參考波谷</option><option value="peak">參考波峰</option><option value="exclude">略過此處</option></select></label><label>簡短備註<input id="pinNote" type="text" maxlength="40" placeholder="例如：除息、雜訊"></label><button class="pill mini" type="button" id="pinExport">匯出標記</button></div><p class="small" id="pinHint">開啟圖釘後，點選圖上的 K 棒；日、週、月分別標記。</p><div class="pin-list" id="pinList"></div>';
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
      const markers=[...(window.chaoweiWaveMarkers||[]).filter(p=>times.has(p.time)),...currentPins().filter(p=>times.has(p.date)).map(p=>({time:p.date,position:p.kind==='peak'?'aboveBar':'belowBar',color:PIN_COLOR[p.kind],shape:p.kind==='exclude'?'circle':p.kind==='peak'?'arrowDown':'arrowUp',text:`${PIN_LABEL[p.kind]} ${fmt(p.price,2)}`}))].sort((a,b)=>a.time.localeCompare(b.time));
      window.chaoweiResearchMarkers=markers;
      applyMarkers();
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
chipCard.innerHTML='<div class="card-heading"><div><h3>ETF 法人與融資</h3><p class="small">證交所盤後資料 · ETF 本身</p></div><label class="chip-date">資料日<select id="chipDate" aria-label="法人籌碼日期"></select></label></div><div id="chipContents" class="chip-contents"><p class="small">讀取法人資料中…</p></div><p class="small chip-source">買賣超是當日交易，並非持有庫存；融資是餘額，不能直接視為買賣訊號。<a href="https://www.twse.com.tw/zh/trading/foreign/t86.html" target="_blank" rel="noopener">法人來源</a> · <a href="https://www.twse.com.tw/zh/trading/margin/mi-margn.html" target="_blank" rel="noopener">融資來源</a></p>';
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
  const range=[20,60,120].includes(settings.chipRange)?settings.chipRange:60,history=chipRows.filter(x=>x[0]<=day).slice(-range);
  const seg=document.createElement('div');seg.className='segment chip-range';seg.setAttribute('aria-label','趨勢期間');
  seg.innerHTML=[20,60,120].map(n=>`<button type="button" data-range="${n}" class="${n===range?'active':''}" aria-pressed="${n===range}">${n} 日</button>`).join('');
  seg.addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;settings.chipRange=Number(b.dataset.range);save();renderChip()});
  node.append(seg);
  const width=Math.max(280,Math.round(node.clientWidth||600));
  // 三大法人: stacked bars per day (buying above zero, selling below), the day's total as a line.
  const lots=v=>Number.isFinite(v)?v/1000:null;
  node.append(chipChart({title:'三大法人每日買賣超',unit:'張',width,dates:history.map(r=>r[0]),kind:'stack',
    series:[{name:'外陸資',color:'#d74640',data:history.map(r=>lots(r[1]))},{name:'投信',color:'#18a49b',data:history.map(r=>lots(r[2]))},{name:'自營商',color:'#e3a052',data:history.map(r=>lots(r[3]))}],
    line:{name:'合計',color:'var(--ink)',data:history.map(r=>lots(r[4]))}}));
  // 融資: balance as an area, the ETF close (split-adjusted) as a dashed line on its own right-hand scale.
  const closeBy=new Map(bars.map(b=>[b.date,b.close])),margin=history.map(r=>Number.isFinite(r[7])?r[7]:null);
  const firstM=margin.find(Number.isFinite),lastM=[...margin].reverse().find(Number.isFinite);
  node.append(chipChart({title:'融資餘額趨勢',unit:'張',width,dates:history.map(r=>r[0]),kind:'area',
    series:[{name:'融資餘額',color:'#0e7490',data:margin}],right:{name:`${selected} 收盤`,color:'#9aa5ab',data:history.map(r=>closeBy.get(r[0])??null)},
    note:Number.isFinite(firstM)&&Number.isFinite(lastM)?`區間變化 ${lastM>=firstM?'+':''}${fmt(lastM-firstM,0)} 張（${firstM?(lastM>=firstM?'+':'')+fmt((lastM/firstM-1)*100,1)+'%':'—'}）`:''}));
  const m=document.createElement('p');m.className='small';m.textContent=`${day} 融資餘額 ${Number.isFinite(row[7])?fmt(row[7],0)+' 張':'暫無資料'} · 融券餘額 ${Number.isFinite(row[8])?fmt(row[8],0)+' 張':'暫無資料'}`;node.append(m);
  updateWeights();
}
/* Small SVG trend chart drawn at the card's real pixel width, so labels stay legible on phones.
   kind 'stack': series stacked above/below zero plus an optional total line; kind 'area': one filled line
   plus an optional dashed comparison line on its own right-hand scale. Hover or tap shows that day. */
function chipChart({title,unit,width,dates,kind,series,line,right,note,bands=[],format,periodLabel='個交易日'}){
  const NS='http://www.w3.org/2000/svg',wrap=document.createElement('div');wrap.className='chip-trend';
  const head=document.createElement('div');head.className='chip-trend-head';head.innerHTML=`<strong></strong><span></span>`;
  head.querySelector('strong').textContent=title;head.querySelector('span').textContent=`${dates[0]||'—'} 至 ${dates.at(-1)||'—'} · 單位：${unit}${note?' · '+note:''}`;wrap.append(head);
  const all=series.flatMap(s=>s.data).filter(Number.isFinite),valueText=format||(v=>fmt(v,0)+' 張');
  if(!all.length){const p=document.createElement('p');p.className='small';p.textContent='此期間尚無可用資料';wrap.append(p);return wrap}
  const W=width-34,H=width<480?170:200,L=width<480?46:58,R=right?(width<480?40:50):10,T=12,B=24,n=dates.length,step=(W-L-R)/Math.max(1,n);
  let lo,hi;
  if(kind==='stack'){lo=0;hi=0;dates.forEach((_,i)=>{let p=0,q=0;for(const s of series){const v=s.data[i];if(v>0)p+=v;else if(v<0)q+=v}hi=Math.max(hi,p,line?.data[i]??0);lo=Math.min(lo,q,line?.data[i]??0)})}
  else{const ref=[...all,...bands.map(b=>b.value)];lo=Math.min(...ref);hi=Math.max(...ref);const pad=(hi-lo)*0.12||Math.abs(hi)*0.05||1;lo-=pad;hi+=pad}
  const span=hi-lo||1,y=v=>T+(hi-v)/span*(H-T-B),x=i=>L+step*(i+0.5);
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${title}，${dates.length} ${periodLabel}`);
  const el=(tag,attrs,parent=svg)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent.append(e);return e};
  const short=v=>Math.abs(v)>=10000?fmt(v/10000,1)+'萬':fmt(v,Math.abs(v)>=100?0:Math.abs(v)>=10?1:2);
  // Gridlines with labels: top, middle, bottom (and zero for stacked bars).
  const ticks=kind==='stack'?[hi,0,lo].filter((v,i,a)=>a.indexOf(v)===i):[hi,(hi+lo)/2,lo];
  // A label too close to one already drawn (zero next to a small maximum) is skipped; zero wins.
  const drawn=[];for(const v of kind==='stack'?[0,hi,lo]:ticks){if(!ticks.includes(v))continue;el('line',{x1:L,x2:W-R,y1:y(v),y2:y(v),stroke:'var(--line)','stroke-dasharray':v===0?'':'3 4'});if(drawn.some(d=>Math.abs(d-y(v))<14))continue;drawn.push(y(v));const t=el('text',{x:L-6,y:y(v)+4,'text-anchor':'end',class:'chip-axis'});t.textContent=short(v)}
  if(kind==='stack'){
    const bw=Math.max(2,Math.min(18,step*0.68));
    dates.forEach((_,i)=>{let p=0,q=0;for(const s of series){const v=s.data[i];if(!Number.isFinite(v)||!v)continue;const from=v>0?p:q,to=from+v;el('rect',{x:x(i)-bw/2,y:y(Math.max(from,to)),width:bw,height:Math.max(1,Math.abs(y(from)-y(to))),fill:s.color,rx:Math.min(2,bw/3)});if(v>0)p=to;else q=to}});
    if(line){const pts=line.data.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:null).filter(Boolean);if(pts.length>1)el('polyline',{points:pts.join(' '),fill:'none',stroke:line.color,'stroke-width':1.6,'stroke-linejoin':'round',opacity:.75});
      if(n<=60)line.data.forEach((v,i)=>{if(Number.isFinite(v))el('circle',{cx:x(i),cy:y(v),r:2.2,fill:line.color})})}
  }else{
    const s=series[0],pts=s.data.map((v,i)=>Number.isFinite(v)?[x(i),y(v)]:null).filter(Boolean);
    if(pts.length>1){el('path',{d:`M${pts[0][0]},${H-B} `+pts.map(p=>`L${p[0]},${p[1]}`).join(' ')+` L${pts.at(-1)[0]},${H-B} Z`,fill:s.color,opacity:.14});el('polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none',stroke:s.color,'stroke-width':2.4,'stroke-linejoin':'round'})}
    for(const extra of series.slice(1)){const points=extra.data.map((v,i)=>Number.isFinite(v)?`${x(i)},${y(v)}`:null).filter(Boolean);if(points.length>1)el('polyline',{points:points.join(' '),fill:'none',stroke:extra.color,'stroke-width':2.2,'stroke-linejoin':'round'})}
    // Reference lines (for example the observation window's high and low).
    for(const b of bands){el('line',{x1:L,x2:W-R,y1:y(b.value),y2:y(b.value),stroke:s.color,'stroke-dasharray':'6 4',opacity:.7});const below=bands.length>1&&b.value===Math.min(...bands.map(x=>x.value)),t=el('text',{x:L+6,y:y(b.value)+(below?13:-5),class:'chip-axis chip-band'});t.textContent=b.label+' '+valueText(b.value)}
    if(right){const rv=right.data.filter(Number.isFinite);if(rv.length>1){const rl=Math.min(...rv),rh=Math.max(...rv),rs=rh-rl||1,ry=v=>T+(rh-v)/rs*(H-T-B);
      const rp=right.data.map((v,i)=>Number.isFinite(v)?`${x(i)},${ry(v)}`:null).filter(Boolean);el('polyline',{points:rp.join(' '),fill:'none',stroke:right.color,'stroke-width':1.6,'stroke-dasharray':'5 4'});
      for(const v of [rh,rl]){const t=el('text',{x:W-R+6,y:ry(v)+4,class:'chip-axis'});t.textContent=fmt(v,v>=100?0:1)}}}
  }
  // Month labels at the first data point of each month (every 2nd, 3rd… month when space is short); the year is
  // added on January and on the first label. A short tick marks every month.
  const starts=[];dates.forEach((d,i)=>{if(i===0||d.slice(0,7)!==dates[i-1].slice(0,7))starts.push(i)});
  // A partial first month (data starting near month end) would crowd the next label; label from the next month.
  const labelled=starts.length>1&&x(starts[1])-x(starts[0])<48?starts.slice(1):starts;
  const stride=Math.max(1,Math.ceil(labelled.length*46/Math.max(1,W-L-R)));let shown=0;
  for(const i of starts)el('line',{x1:x(i),x2:x(i),y1:H-B,y2:H-B+4,stroke:'var(--muted)',opacity:.5});
  labelled.forEach((i,k)=>{if(k%stride)return;
    const m=Number(dates[i].slice(5,7)),t=el('text',{x:x(i),y:H-6,'text-anchor':i===0?'start':'middle',class:'chip-axis'});
    t.textContent=!shown||m===1?dates[i].slice(0,4)+'/'+m:m+'月';shown++});
  const guide=el('line',{x1:0,x2:0,y1:T,y2:H-B,stroke:'var(--muted)','stroke-width':1,opacity:0});
  wrap.append(svg);
  const legend=document.createElement('p');legend.className='chip-legend';
  legend.innerHTML=[...series.map(s=>`<span style="color:${s.color}"> ${s.name}</span>`),line?`<span>━ ${line.name}</span>`:'',right?`<span style="color:${right.color}">┅ ${right.name}（右軸）</span>`:''].join('');wrap.append(legend);
  const tip=document.createElement('p');tip.className='chip-tip';tip.setAttribute('aria-live','polite');wrap.append(tip);
  const signed=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v,0):'—';
  const show=i=>{tip.textContent=`${dates[i]}　`+[...series.map(s=>`${s.name} ${Number.isFinite(s.data[i])?valueText(s.data[i]):'—'}`),line?`${line.name} ${valueText(line.data[i])}`:'',right&&Number.isFinite(right.data[i])?`${right.name} ${fmt(right.data[i],2)}`:''].filter(Boolean).join(' · ');guide.setAttribute('x1',x(i));guide.setAttribute('x2',x(i));guide.setAttribute('opacity',.45)};
  const pick=e=>{const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*W/r.width;show(Math.max(0,Math.min(n-1,Math.floor((px-L)/step))))};
  svg.addEventListener('pointermove',pick);svg.addEventListener('pointerdown',pick);svg.addEventListener('pointerleave',()=>{guide.setAttribute('opacity',0);show(n-1)});
  show(n-1);return wrap;
}
// Charts are drawn at the card's pixel width; redraw when it changes.
let chipWidth=0;window.addEventListener('resize',()=>{const w=$('chipContents').clientWidth;if(chipRows.length&&Math.abs(w-chipWidth)>40){chipWidth=w;clearTimeout(window.__chipResize);window.__chipResize=setTimeout(renderChip,150)}});
async function loadChips(code){
  if(!isMember)return;
  const generation=++chipGeneration;chipCode=code;chipRows=[];$('chipDate').replaceChildren();$('chipContents').textContent='讀取法人資料中…';updateWeights();
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

/* Official weekly TDCC holder distribution for the selected ETF. */
const holderCard=document.createElement('section');holderCard.className='holder-card card member-only';holderCard.id='holderCard';
holderCard.innerHTML='<div class="card-heading"><div><h3>ETF 大戶持有分布</h3><p class="small">集保結算所每週資料 · ETF 本身</p></div></div><div id="holderContents" class="holder-contents"><p class="small">讀取集保資料中…</p></div><p class="small">持有 400 張以上的集保戶比例，不等於法人或八大官股持股，也不是每日買賣超。<a target="_blank" rel="noopener noreferrer">集保來源 </a></p>';
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

/* Optional, reproducible price momentum versus TAIEX. Uses finalized daily bars only. */
settings.momentumEnabled=settings.momentumEnabled===true;
const momentumPanel=document.createElement('section');momentumPanel.className='momentum-panel';
momentumPanel.innerHTML='<button id="momentumToggle" class="pill chip" type="button" aria-expanded="false">動量共振 · 選用指標</button><div id="momentumBody" class="momentum-body hidden"></div>';
$('techRead').after(momentumPanel);
const momentumToggle=$('momentumToggle'),momentumBody=$('momentumBody');
let momentumQueued=false;
function momentumRender(){
  momentumToggle.setAttribute('aria-expanded',String(settings.momentumEnabled));
  momentumBody.classList.toggle('hidden',!settings.momentumEnabled);
  if(!settings.momentumEnabled)return;
  const etf=bars.filter(b=>!b.intraday),idx=new Map(market.filter(d=>!d.intraday&&Number.isFinite(d.index)).map(d=>[d.date,d.index]));
  const pair=etf.filter(b=>idx.has(b.date));
  if(pair.length<61){momentumBody.textContent='ETF 與大盤共同交易日不足 61 日，暫不計算。';return}
  const at=pair.at(-1),prev20=pair.at(-21),prev60=pair.at(-61);
  const ret=(now,was)=>(now/was-1)*100;
  const e20=ret(at.close,prev20.close),e60=ret(at.close,prev60.close),m20=ret(idx.get(at.date),idx.get(prev20.date)),m60=ret(idx.get(at.date),idx.get(prev60.date));
  const excess20=e20-m20,excess60=e60-m60;
  const latest40=pair.slice(-40),splitDate=(historyMeta?.adjustments||[]).some(a=>a.date>=latest40[0].date&&a.date<=at.date);
  const volNow=latest40.slice(-20).reduce((n,b)=>n+b.volume,0),volBefore=latest40.slice(0,20).reduce((n,b)=>n+b.volume,0),volRatio=!splitDate&&volBefore>0?volNow/volBefore:null;
  const checks=[e20>0,e60>0,excess20>0,excess60>0];const positives=checks.filter(Boolean).length;
  const state=positives===4?'價格動量共振':positives>=2?'方向分歧':'價格動量偏弱';
  const signed=x=>(x>0?'+':'')+fmt(x,1)+'%';
  momentumBody.replaceChildren();
  const head=document.createElement('div');head.className='momentum-head';head.innerHTML='<strong></strong><small></small>';
  head.querySelector('strong').textContent=state;head.querySelector('small').textContent=`截至 ${at.date} · 已收盤日 K`;
  momentumBody.append(head);
  const grid=document.createElement('div');grid.className='momentum-grid';
  for(const [label,er,mr,ex] of [['20 日',e20,m20,excess20],['60 日',e60,m60,excess60]]){
    const card=document.createElement('div');card.className='momentum-period';
    const title=document.createElement('b');title.textContent=label+'相對大盤';
    const big=document.createElement('strong');big.className=ex>0?'up':ex<0?'down':'';big.textContent=signed(ex);
    const detail=document.createElement('small');detail.textContent=`${selected} ${signed(er)} · 大盤 ${signed(mr)}`;
    card.append(title,big,detail);grid.append(card)
  }
  momentumBody.append(grid);
  const recent=pair.slice(-61),baseEtf=recent[0].close,baseMarket=idx.get(recent[0].date);
  const etfSeries=recent.map(b=>b.close/baseEtf*100),marketSeries=recent.map(b=>idx.get(b.date)/baseMarket*100);
  const minimum=Math.min(...etfSeries,...marketSeries),maximum=Math.max(...etfSeries,...marketSeries),span=maximum-minimum||1;
  const points=series=>series.map((value,i)=>`${(i*480/60).toFixed(1)},${(109-(value-minimum)/span*96).toFixed(1)}`).join(' ');
  const trend=document.createElement('div');trend.className='momentum-trend';trend.innerHTML=`<div class="momentum-legend"><span></span><span> 加權指數</span><small>61 個共同交易日 · 起點＝100</small></div><svg viewBox="0 0 480 120" preserveAspectRatio="none" role="img"><line x1="0" y1="60" x2="480" y2="60" stroke="currentColor" opacity=".12"/><polyline points="${points(marketSeries)}" fill="none" stroke="#8b98a8" stroke-width="2" vector-effect="non-scaling-stroke"/><polyline points="${points(etfSeries)}" fill="none" stroke="#c9413b" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
  trend.querySelector('span').textContent=' '+selected;trend.querySelector('svg').setAttribute('aria-label',`${selected} 與加權指數近 60 日相對走勢`);
  momentumBody.append(trend);
  const vol=document.createElement('p');vol.className='small';vol.textContent=volRatio==null?'20 日量能比：分割前後張數口徑不同，暫不比較。':`20 日量能比 ${fmt(volRatio,2)} 倍（近 20 日成交股數 ÷ 前 20 日）。`;
  momentumBody.append(vol);
  const caveat=document.createElement('p');caveat.className='small';caveat.textContent='四項條件：ETF 近 20／60 日上漲，且兩段報酬各高於大盤。相對報酬＝ETF 分割還原價漲跌％ − 加權價指數漲跌％。除息期間價格可能失真；這是歷史描述，不是交易訊號，也未納入水位分數。';
  momentumBody.append(caveat);
}
function momentumSchedule(){if(momentumQueued)return;momentumQueued=true;queueMicrotask(()=>{momentumQueued=false;momentumRender()})}
momentumToggle.addEventListener('click',()=>{settings.momentumEnabled=!settings.momentumEnabled;save();momentumRender()});
const momentumDrawChart=drawChart;drawChart=function(...args){const r=momentumDrawChart(...args);momentumSchedule();return r};
const momentumComputeMarket=computeMarket;computeMarket=function(...args){const r=momentumComputeMarket(...args);momentumSchedule();return r};
const momentumApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{momentumApplyProfile(profile);settings.momentumEnabled=settings.momentumEnabled===true;momentumRender()};
momentumRender();

/* ---------- Strategy engine v3 (pure: no DOM; also loaded by scripts/test-engine.mjs) ----------
   Capital model: every strategy receives the same cash flows (one lump at the start, or the same
   deposit on the first trading day of each month), so returns are comparable with 定期定額.
   Uninvested cash earns the parking yield; cash dividends are always credited (DRIP reinvests them).
   Fills follow cfg.fill: legacy close, nextOpen, or the whiteboard's nextClose, with fees and tax.
   Indicators at day i use bars up to i;
   the water-level range at day i uses bars before i only. */
function createChaoweiEngine(){
  const DAY=86400000;
  // Returns and their cash benchmark cover the same calendar interval, including weekends.
  function riskSharpe(series,annualRate,tradeCount){
    if(!tradeCount)return{value:null,reason:'無實際交易',observations:Math.max(0,series.length-1)};
    const excess=[];
    for(let i=1;i<series.length;i++){const a=series[i-1],b=series[i],days=(Date.parse(b.time)-Date.parse(a.time))/DAY;if(!(a.nav>0&&b.nav>0&&days>0))continue;const x=b.nav/a.nav-1-(Math.pow(1+annualRate,days/365)-1);if(Number.isFinite(x))excess.push(x)}
    if(excess.length<5)return{value:null,reason:'有效期間不足',observations:excess.length};
    const mean=excess.reduce((s,x)=>s+x,0)/excess.length,sd=Math.sqrt(excess.reduce((s,x)=>s+(x-mean)**2,0)/(excess.length-1));
    return{value:sd<1e-10?null:mean/sd*Math.sqrt(245),reason:sd<1e-10?'超額波動接近零':'',observations:excess.length,mean,sd,annualPeriods:245};
  }
  // Work from the time-weighted NAV, never the cash-flow-inflated account balance.
  function drawdownEvents(series){
    const events=[];let peak=null,event=null;
    for(let i=0;i<series.length;i++){const p=series[i];if(!(p.nav>0))continue;if(!peak){peak={...p,i};continue}
      if(p.nav>=peak.nav-1e-12){if(event){event.recovery=p.time;event.tradingDays=i-peak.i;event.calendarDays=Math.round((Date.parse(p.time)-Date.parse(peak.time))/DAY);event.ongoing=false;events.push(event);event=null}peak={...p,i}}
      else{const depth=1-p.nav/peak.nav;if(!event)event={peak:peak.time,trough:p.time,recovery:null,depth,tradingDays:i-peak.i,calendarDays:Math.round((Date.parse(p.time)-Date.parse(peak.time))/DAY),ongoing:true};if(depth>event.depth){event.depth=depth;event.trough=p.time}event.tradingDays=i-peak.i;event.calendarDays=Math.round((Date.parse(p.time)-Date.parse(peak.time))/DAY)}
    }
    if(event)events.push(event);return events.sort((a,b)=>b.depth-a.depth);
  }
  /* ---------- indicators ---------- */
  function sma(a,n){const out=new Float64Array(a.length).fill(NaN);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)out[i]=s/n}return out}
  function marginHistory(bars,rows=[]){
    const a=rows.filter(x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(x.value)&&x.value>0).sort((x,y)=>x.date.localeCompare(y.date)),out=new Float64Array(bars.length).fill(NaN);let j=-1;
    for(let i=0;i<bars.length;i++){const date=bars[i].date;while(j+1<a.length&&a[j+1].date<date)j++;if(j<5)continue;const age=(Date.parse(date)-Date.parse(a[j].date))/DAY,span=(Date.parse(a[j].date)-Date.parse(a[j-5].date))/DAY;if(age<=7&&span<=14)out[i]=a[j].value/a[j-5].value-1}return out;
  }
  function prepare(bars,dividends,macro,extras={}){
    const n=bars.length,close=Float64Array.from(bars,b=>b.close),open=Float64Array.from(bars,b=>Number(b.open)>0?Number(b.open):b.close),high=Float64Array.from(bars,b=>b.high),low=Float64Array.from(bars,b=>b.low),vol=Float64Array.from(bars,b=>b.volume);
    const ma20=sma(close,20),ma60=sma(close,60),ma120=sma(close,120),ma200=sma(close,200),volMa20=sma(vol,20);
    const bbUp=new Float64Array(n).fill(NaN),bbLo=new Float64Array(n).fill(NaN),bw=new Float64Array(n).fill(NaN),bwRank=new Float64Array(n).fill(NaN);
    for(let i=19;i<n;i++){let s=0;for(let j=i-19;j<=i;j++)s+=(close[j]-ma20[i])**2;const sd=Math.sqrt(s/20);bbUp[i]=ma20[i]+2*sd;bbLo[i]=ma20[i]-2*sd;bw[i]=(bbUp[i]-bbLo[i])/ma20[i]}
    for(let i=138;i<n;i++){let c=0;for(let j=i-119;j<=i;j++)if(bw[j]<=bw[i])c++;bwRank[i]=c/120}
    const rsi=new Float64Array(n).fill(NaN);let g=0,l=0;
    for(let i=1;i<n;i++){const ch=close[i]-close[i-1],u=Math.max(ch,0),d=Math.max(-ch,0);if(i<=14){g+=u/14;l+=d/14}else{g=(g*13+u)/14;l=(l*13+d)/14}if(i>=14)rsi[i]=l===0?(g===0?50:100):100-100/(1+g/l)}
    const atr=new Float64Array(n).fill(NaN),hh22=new Float64Array(n).fill(NaN);let a=0;
    for(let i=1;i<n;i++){const tr=Math.max(high[i]-low[i],Math.abs(high[i]-close[i-1]),Math.abs(low[i]-close[i-1]));a=i<=22?a+tr/22:(a*21+tr)/22;if(i>=22)atr[i]=a;if(i>=21){let m=-Infinity;for(let j=i-21;j<=i;j++)m=Math.max(m,high[j]);hh22[i]=m}}
    const sigma=new Float64Array(n).fill(NaN);
    for(let i=20;i<n;i++){let s=0,s2=0;for(let j=i-19;j<=i;j++){const r=Math.log(close[j]/close[j-1]);s+=r;s2+=r*r}const m=s/20;sigma[i]=Math.sqrt(Math.max(0,s2/20-m*m))*Math.sqrt(245)}
    const div=new Float64Array(n);const byDate=new Map(bars.map((b,i)=>[b.date,i]));
    for(const [date,amount] of dividends||[]){const i=byDate.get(date);if(i!=null)div[i]+=amount}
    const monthStart=bars.map((b,i)=>i===0||b.date.slice(0,7)!==bars[i-1].date.slice(0,7));
    // KD(9,3,3): seed K/D at 50; no value until nine actual daily bars exist.
    const kdK=new Float64Array(n).fill(NaN),kdD=new Float64Array(n).fill(NaN);let k=50,d=50;
    for(let i=8;i<n;i++){let hi=-Infinity,lo=Infinity;for(let j=i-8;j<=i;j++){hi=Math.max(hi,high[j]);lo=Math.min(lo,low[j])}const rsv=hi>lo?100*(close[i]-lo)/(hi-lo):50;k=(2*k+rsv)/3;d=(2*d+k)/3;kdK[i]=k;kdD[i]=d}
    // Already aligned, published-before-signal margin observations. Missing values remain NaN.
    const marginDrop5=Float64Array.from({length:n},(_,i)=>Number.isFinite(extras.marginDrop5?.[i])?extras.marginDrop5[i]:NaN);
    return{bars,n,open,close,high,low,vol,ma20,ma60,ma120,ma200,volMa20,bbUp,bbLo,bw,bwRank,rsi,atr,hh22,sigma,kdK,kdD,marginDrop5,div,monthStart,macro:macro||null,refCache:new Map(),scoreCache:new Map()};
  }
  // Reference high/low at day i from the window of bars before i (no look-ahead).
  function reference(ctx,window,anchorMode,anchorCount){
    const key=window+'|'+anchorMode+'|'+anchorCount;if(ctx.refCache.has(key))return ctx.refCache.get(key);
    const {n,bars}=ctx,W=window==='all'?Infinity:Number(window),hi=new Float64Array(n).fill(NaN),lo=new Float64Array(n).fill(NaN),need=W===Infinity?20:W;
    const byClose=anchorMode==='close',H=bars.map(b=>byClose?b.close:b.high),L=bars.map(b=>byClose?b.close:b.low);
    if(anchorMode!=='average'){
      const qh=new Int32Array(n),ql=new Int32Array(n);let x=0,y=0,eh=0,el=0;
      for(let i=1;i<n;i++){const j=i-1;while(eh>x&&H[qh[eh-1]]<=H[j])eh--;qh[eh++]=j;while(el>y&&L[ql[el-1]]>=L[j])el--;ql[el++]=j;
        while(x<eh&&qh[x]<i-W)x++;while(y<el&&ql[y]<i-W)y++;if(i>=need){hi[i]=H[qh[x]];lo[i]=L[ql[y]]}}
    }else{
      const k=Math.max(1,Math.min(20,Math.round(anchorCount)||5));
      // Order statistics preserve the mean-of-k definition without sorting every window.
      function tree(values){const sorted=[...new Set(values)].sort((a,b)=>a-b),index=new Map(sorted.map((v,i)=>[v,i+1])),counts=new Int32Array(sorted.length+1),sums=new Float64Array(sorted.length+1);let total=0;
        return{add(v,d){total+=v*d;for(let j=index.get(v);j<counts.length;j+=j&-j){counts[j]+=d;sums[j]+=v*d}},smallest(t){if(t<=0)return 0;let at=0,c=0,s=0,bit=2**Math.floor(Math.log2(sorted.length||1));for(;bit;bit>>=1){const j=at+bit;if(j<counts.length&&c+counts[j]<t){at=j;c+=counts[j];s+=sums[j]}}return s+(t-c)*sorted[at]},sum(){return total}}}
      const th=tree(H),tl=tree(L);
      for(let i=1;i<n;i++){th.add(H[i-1],1);tl.add(L[i-1],1);if(i>W){th.add(H[i-W-1],-1);tl.add(L[i-W-1],-1)}if(i>=need){const count=Math.min(i,W),kk=Math.min(k,count);hi[i]=(th.sum()-th.smallest(count-kk))/kk;lo[i]=tl.smallest(kk)/kk}}
    }
    const out={hi,lo};ctx.refCache.set(key,out);return out;
  }
  // Water-level score (0–5, higher = lower in the range) and its whole-number tier (1–5).
  function score(r,method){
    let raw;
    if(method!=='fib'||r<0||r>1)raw=5*(1-r);
    else{const x=[0,.236,.382,.618,.786,1],y=[5,4,3,2,1,0];for(let i=0;i<5;i++)if(r<=x[i+1]){raw=y[i]+(y[i+1]-y[i])*(r-x[i])/(x[i+1]-x[i]);break}}
    return{raw,core:Math.max(0,Math.min(5,raw)),grade:r<0?5:r>=1?1:Math.max(1,Math.min(5,Math.ceil(raw)))};
  }
  function water(ctx,ref){
    const key=ref.window+'|'+ref.anchorMode+'|'+ref.anchorCount+'|'+ref.method;if(ctx.scoreCache.has(key))return ctx.scoreCache.get(key);
    const {hi,lo}=reference(ctx,ref.window,ref.anchorMode,ref.anchorCount),n=ctx.n,core=new Float64Array(n).fill(NaN),grade=new Int8Array(n);
    for(let i=0;i<n;i++)if(hi[i]>lo[i]){const s=score((ctx.close[i]-lo[i])/(hi[i]-lo[i]),ref.method);core[i]=s.core;grade[i]=s.grade}
    const out={hi,lo,core,grade};ctx.scoreCache.set(key,out);return out;
  }

  /* ---------- simulation ---------- */
  function xirr(flows){
    if(flows.length<2)return null;const t0=flows[0][0];
    const f=r=>flows.reduce((s,[t,v])=>s+v/Math.pow(1+r,(t-t0)/(365*DAY)),0);
    let a=-0.99,b=10,fa=f(a),fb=f(b);if(!(fa*fb<0))return null;
    for(let k=0;k<200;k++){const m=(a+b)/2,fm=f(m);if(Math.abs(fm)<1e-7)return m;if(fa*fm<0){b=m;fb=fm}else{a=m;fa=fm}}
    return(a+b)/2;
  }
  /* Fill model. A decision on day i only sees data up to close[i].
     fill 'close' (the original model): trade at close[i]. fill 'nextOpen': trade at open[i+1], the next session
     inside the run window; an order on the window's last day is not filled (no data past the window is read).
     slipBps moves every fill against the trader (buys higher, sells lower).
     A T+1 order is booked on day i so strategy state (shares, cost) stays exact, but until the next open the
     account still economically holds the old cash and shares: pendingCash/pendingShares undo the booking for
     day i's valuation, overnight interest and the next day's dividend entitlement. */
  function account(ctx,cfg,last){
    const fee=cfg.fee/100*cfg.discount/100,tax=cfg.tax/100,next=['nextOpen','nextClose'].includes(cfg.fill),slip=Math.max(0,Number(cfg.slipBps)||0)/10000;
    last=last==null?ctx.n-1:last;
    const fillAt=i=>{if(!next)return{j:i,ref:ctx.close[i]};if(i+1>last)return null;const o=ctx.open?.[i+1];return{j:i+1,ref:cfg.fill==='nextClose'?ctx.close[i+1]:o>0?o:ctx.close[i+1]}};
    return{cash:0,shares:0,cost:0,fee,tax,fees:0,slippage:0,unfilled:0,pendingCash:0,pendingShares:0,trades:[],divs:[],
      buy(i,amount,reason,kind){
        const at=fillAt(i),spend=Math.min(amount,this.cash);if(!(spend>0))return 0;if(!at){this.unfilled++;return 0}
        const c=at.ref*(1+slip);let sh=spend/(c*(1+fee));if(cfg.wholeShares)sh=Math.floor(sh);if(!(sh>0))return 0;
        const gross=sh*c,f=gross*fee;this.cash-=gross+f;this.shares+=sh;this.cost+=gross+f;this.fees+=f;this.slippage+=sh*(c-at.ref);
        if(at.j>i){this.pendingCash+=gross+f;this.pendingShares+=sh}
        this.trades.push({i:at.j,...(at.j>i?{signal:i}:{}),date:ctx.bars[at.j].date,type:'buy',kind:kind||'buy',price:c,shares:sh,amount:gross+f,reason});return sh;
      },
      sell(i,sh,reason,kind){
        sh=Math.min(sh,this.shares);if(cfg.wholeShares)sh=Math.floor(sh+1e-9);if(!(sh>0))return 0;const at=fillAt(i);if(!at){this.unfilled++;return 0}
        const c=at.ref*(1-slip),gross=sh*c,f=gross*(fee+(Number.isFinite(ctx.tradeTax?.[at.j])?ctx.tradeTax[at.j]:tax)),costPart=this.cost*sh/this.shares,net=gross-f,pnl=net-costPart;
        this.cash+=net;this.shares-=sh;this.cost-=costPart;this.fees+=f;this.slippage+=sh*(at.ref-c);if(this.shares<1e-9){this.shares=0;this.cost=0}
        if(at.j>i){this.pendingCash-=net;this.pendingShares-=sh}
        this.trades.push({i:at.j,...(at.j>i?{signal:i}:{}),date:ctx.bars[at.j].date,type:'sell',kind:kind||'sell',price:c,shares:sh,amount:net,pnl,ret:pnl/costPart,reason});return net;
      },
      // Economic holdings tonight: orders waiting for tomorrow's open are not yet filled.
      held(){return this.shares-this.pendingShares},
      value(i){return this.cash+this.pendingCash+this.held()*ctx.close[i]},
      settle(){this.pendingCash=0;this.pendingShares=0},
      toWeight(i,w,reason){const c=ctx.close[i],total=this.value(i),cur=this.shares*c,target=total*w;
        if(target>cur)return this.buy(i,(target-cur),reason,'rebalance');if(target<cur)return this.sell(i,(cur-target)/c,reason,'rebalance');return 0}
    };
  }
  /* Explicit budget calendar. Only dates inside this run release money; future salary is never cash. */
  function fundingCalendar(ctx,cfg,start,end){
    const months=[];for(let i=start;i<=end;i++)if(i===start||ctx.monthStart[i])months.push(i);
    const f=cfg.funding||{},annual=f.type==='annual',arrival=annual?(['monthly','yearStart','upfront'].includes(f.arrival)?f.arrival:'monthly'):(cfg.capitalMode==='monthly'?'monthly':'upfront');
    const releases=new Map(),inflows=new Map(),add=(m,i,v)=>m.set(i,(m.get(i)||0)+v),money=v=>{const n=Number(v);if(!Number.isFinite(n)||n<0||n>1e9)throw Error('年度預算須為 0 至 10 億元。');return n};
    let capital=0;
    if(annual){const seen=new Set();for(const i of months){const y=ctx.bars[i].date.slice(0,4),amount=money(Object.prototype.hasOwnProperty.call(f.years||{},y)?f.years[y]:f.annualAmount??240000);releases.set(i,amount/12);if(arrival==='monthly')add(inflows,i,amount/12);else if(!seen.has(y)){add(inflows,arrival==='upfront'?start:i,amount);seen.add(y)}}capital=[...inflows.values()].reduce((a,b)=>a+b,0)}
    else{capital=money(cfg.capital);const N=cfg.dcaPeriods==null||cfg.dcaPeriods==='auto'?months.length:Math.max(1,Math.round(Number(cfg.dcaPeriods)||12));for(const i of months.slice(0,N))releases.set(i,capital/N);if(arrival==='monthly')for(const [i,v] of releases)inflows.set(i,v);else inflows.set(start,capital)}
    if(!(capital>0))throw Error('此回測期間沒有正值預算，請至少設定一年的投入金額。');
    const scheduled=[...releases.values()].reduce((a,b)=>a+b,0),periods=months.map(i=>({date:ctx.bars[i].date,budget:releases.get(i)||0,inflow:inflows.get(i)||0}));
    return{annual,arrival,capital,releases,inflows,months,recycleGains:f.recycleGains!==false,N:releases.size,base:scheduled/Math.max(1,releases.size),external:arrival!=='upfront',periods,scheduled};
  }

  /* Runs one strategy (and the benchmarks with the same cash flows) from start to end (inclusive). */
  function run(ctx,cfg,start,end){
    end=end==null?ctx.n-1:end;start=Math.max(0,start);
    const strat=STRATEGIES[cfg.strategy]||STRATEGIES.classic,months=[];for(let i=start;i<=end;i++)if(i===start||ctx.monthStart[i])months.push(i);
    // One capital base C for everyone. N defaults to the number of months in the window ('auto'), so a
    // five-year test spreads 定期定額 over 60 months instead of spending C in the first year.
    // Pool mode (default): C is in the account on day one; 定期定額 invests C ÷ N on the first trading day
    // of each of the first N months; staged strategies split C by their number of stages.
    // Monthly mode: C ÷ N is deposited on each of those days instead (a salary), and buy-and-hold still
    // invests C on day one with its own cash flows, so its XIRR stays comparable.
    const auto=cfg.dcaPeriods==null||cfg.dcaPeriods==='auto',N=auto?months.length:Math.max(1,Math.round(Number(cfg.dcaPeriods)||12));
    const calendar=cfg.funding?.version===1?fundingCalendar(ctx,cfg,start,end):null;
    if(calendar)cfg={...cfg,capital:calendar.capital};
    const monthly=calendar?calendar.external:cfg.capitalMode==='monthly',lump=!monthly,base=calendar?calendar.base:cfg.capital/N,dcaMonths=new Set(calendar?[...calendar.releases.keys()]:months.slice(0,N));
    const inflowAt=calendar?calendar.inflows:monthly?new Map(months.slice(0,N).map(i=>[i,base])):new Map([[start,cfg.capital]]);
    const park=Math.pow(1+cfg.parking/100,1/365)-1,acc=account(ctx,cfg,end),state={};
    // Benchmarks: buy-and-hold (C invested on day one) and 定期定額 (C ÷ N per month), same fees and tax.
    const bh=account(ctx,cfg,end),dca=account(ctx,cfg,end);
    const flows=[],bhFlows=monthly&&!calendar?[[Date.parse(ctx.bars[start].date),-cfg.capital]]:flows,series=[],bhSeries=[],dcaSeries=[];
    let contributed=0,interest=0,dividends=0,nav=1,prevEq=0,peakNav=1,mdd=0,utilSum=0,days=0,lastT=Date.parse(ctx.bars[start].date),rets=[];
    let bhNav=1,bhPrev=0,bhPeak=1,bhMdd=0,dcaNav=1,dcaPrev=0,dcaPeak=1,dcaMdd=0;
    const helpers={base,capital:cfg.capital,tranches:fundingInfo(cfg).tranches,months,lump,N:calendar?calendar.N:N,dcaMonths,calendar,water:cfg.ref?water(ctx,cfg.ref):null};
    strat.init?.(ctx,cfg,state,helpers);
    for(let i=start;i<=end;i++){
      const t=Date.parse(ctx.bars[i].date),dd=Math.round((t-lastT)/DAY);lastT=t;
      // Interest on parked cash for the calendar days since the previous bar.
      if(dd>0)for(const a of [acc,bh,dca]){const r=(a.cash+a.pendingCash)*(Math.pow(1+park,dd)-1);a.cash+=r;if(a===acc)interest+=r}
      const inflow=inflowAt.get(i)||0,bhIn=monthly&&!calendar?(i===start?cfg.capital:0):inflow;
      if(inflow){acc.cash+=inflow;dca.cash+=inflow;contributed+=inflow;flows.push([t,-inflow])}
      bh.cash+=bhIn;
      // Dividends on shares held before today's trades.
      // Yesterday's T+1 orders fill at today's open: entitlement follows the holdings at yesterday's close.
      if(ctx.div[i]>0)for(const a of [acc,bh,dca]){const d=a.held()*ctx.div[i];a.settle();if(d>0){a.cash+=d;a.divs.push([t,d]);if(a===acc)dividends+=d;if(cfg.drip)a.buy(i,d,'配息再投入','drip')}}
      for(const a of [acc,bh,dca])a.settle();
      if(bhIn)bh.buy(i,bh.cash,'買進持有','bench');
      if(calendar){if(calendar.releases.has(i))helpers.base=calendar.releases.get(i)}else helpers.base=base;
      if(dcaMonths.has(i))dca.buy(i,calendar?calendar.releases.get(i):base,'定期定額','bench');
      strat.day(i,ctx,cfg,acc,state,helpers,inflow);
      const eq=acc.value(i),c=ctx.close[i];
      // Time-weighted return strips out deposits, so drawdowns are not hidden by new money.
      if(prevEq>0)nav*=(eq-inflow)/prevEq;else if(calendar&&inflow>0)nav=eq/inflow;prevEq=eq;peakNav=Math.max(peakNav,nav);const ddown=nav/peakNav-1;mdd=Math.min(mdd,ddown);
      if(series.length)rets.push(nav/series.at(-1).nav-1);
      const bq=bh.value(i);if(bhPrev>0)bhNav*=(bq-bhIn)/bhPrev;else if(calendar&&bhIn>0)bhNav=bq/bhIn;bhPrev=bq;bhPeak=Math.max(bhPeak,bhNav);bhMdd=Math.min(bhMdd,bhNav/bhPeak-1);
      const dq=dca.value(i);if(dcaPrev>0)dcaNav*=(dq-inflow)/dcaPrev;else if(calendar&&inflow>0)dcaNav=dq/inflow;dcaPrev=dq;dcaPeak=Math.max(dcaPeak,dcaNav);dcaMdd=Math.min(dcaMdd,dcaNav/dcaPeak-1);
      utilSum+=eq>0?acc.held()*c/eq:0;days++;
      series.push({time:ctx.bars[i].date,value:eq,nav,dd:ddown,exposure:eq>0?acc.held()*c/eq:0,contributed});
      bhSeries.push({time:ctx.bars[i].date,value:bq,nav:bhNav,dd:bhNav/bhPeak-1});dcaSeries.push({time:ctx.bars[i].date,value:dq,nav:dcaNav,dd:dcaNav/dcaPeak-1});
    }
    const tEnd=Date.parse(ctx.bars[end].date),years=Math.max(1/365,(tEnd-Date.parse(ctx.bars[start].date))/(365.25*DAY));
    // Pool CAGR must include day-one fees (NAV starts at the first observed closing valuation).
    // Salary accounts use flow-neutral NAV instead; never annualise final equity / total deposits.
    const summary=(a,navEnd,m,fl,paid)=>{const eq=a.value(end),pool=!monthly||a===bh&&!calendar;return{equity:eq,ret:paid?eq/paid-1:0,xirr:xirr([...fl,[tEnd,eq]]),cagr:Math.pow(pool?eq/cfg.capital:navEnd,1/years)-1,mdd:-m,fees:a.fees}};
    // Return on deployed capital: XIRR of the position alone (buys out, sales and dividends in, final
    // holding back), so cash waiting on the sidelines does not count. Answers "when it was invested, how
    // hard did the money work?" for strategies that sit mostly in cash.
    const sleeve=acc.trades.map(x=>[Date.parse(x.date),x.type==='buy'?-x.amount:x.amount]).concat(acc.divs);
    if(acc.shares>0)sleeve.push([tEnd,acc.shares*ctx.close[end]]);sleeve.sort((x,y)=>x[0]-y[0]);
    const s=summary(acc,nav,mdd,flows,contributed),sharpeInfo=riskSharpe(series,cfg.parking/100,acc.trades.length);
    const sells=acc.trades.filter(x=>x.type==='sell'&&x.kind!=='rebalance');
    return{cfg,start:ctx.bars[start].date,end:ctx.bars[end].date,years,contributed,N:calendar?calendar.N:N,base,monthly,...(calendar?{funding:{type:calendar.annual?'annual':'total',arrival:calendar.arrival,periods:calendar.periods,scheduled:calendar.scheduled,planned:calendar.capital}}:{}),...s,roic:acc.trades.length?xirr(sleeve):null,
      calmar:s.mdd>0?s.cagr/s.mdd:null,sharpe:sharpeInfo.value,sharpeInfo,drawdowns:drawdownEvents(series),utilization:utilSum/Math.max(1,days),
      interest,dividends,fees:acc.fees,slippage:acc.slippage,unfilled:acc.unfilled,fill:['nextOpen','nextClose'].includes(cfg.fill)?cfg.fill:'close',slipBps:Math.max(0,Number(cfg.slipBps)||0),friction:(acc.fees+acc.slippage)/(contributed||cfg.capital),trades:acc.trades,sells:sells.length,wins:sells.filter(x=>x.pnl>0).length,buys:acc.trades.filter(x=>x.type==='buy').length,
      shares:acc.shares,cost:acc.cost,cash:acc.cash,rounds:closedRounds(acc.trades,acc.divs),state,series,bh:{...summary(bh,bhNav,bhMdd,bhFlows,calendar?contributed:cfg.capital),series:bhSeries,trades:bh.trades},dca:{...summary(dca,dcaNav,dcaMdd,flows,contributed),series:dcaSeries,trades:dca.trades}};
  }

  /* ---------- strategies ---------- */
  const monthDay=(ctx,i,start)=>ctx.monthStart[i]||i===start;
  function classicDay(i,ctx,cfg,acc,st,h,inflow){
    const p=cfg.params,w=h.water,c=ctx.close[i],hi=w.hi[i],lo=w.lo[i],valid=hi>lo,canBuy=!cfg.entryFlags||cfg.entryFlags[i]===true,parts=p.entry==='fib'?Math.min(p.levels.length,h.tranches||p.levels.length):(h.tranches||1+p.adds);
    // Optional base position: the first of the equal parts is bought on the first day and never sold, so the
    // strategy is not idle for years while waiting for a pullback; the remaining parts trade the swing.
    if(p.core&&p.basePct>0){if(inflow>0){const sh=acc.buy(i,inflow*p.basePct/100,'底倉：入金 '+p.basePct+'%（不賣）','entry');st.coreShares=(st.coreShares||0)+(sh||0)}st.coreDone=true}
    else if(p.core&&!st.coreDone){st.coreDone=true;const sh=acc.buy(i,acc.cash/parts,'底倉：起點買進第 1 份（不賣）','entry');st.coreShares=sh||0}
    const maxBuys=p.core&&!p.basePct?parts-1:parts,core=st.coreShares||0;
    // Tranche: an equal share of the cash still available for this round.
    const tranche=()=>acc.cash/Math.max(1,maxBuys-(st.buys||0));
    const swingShares=()=>Math.max(0,acc.shares-core);
    let bought=false;
    if(maxBuys<1)return;
    if(!st.buys){
      if(!valid||!canBuy)return;
      let why=null;
      if(p.entry==='drop'&&c<=hi*(1-p.drop/100))why='首次買進：較區間高點下跌 '+((1-c/hi)*100).toFixed(1)+'%';
      else if(p.entry==='fib'&&c<=hi-p.levels[0]*(hi-lo))why='首次買進：回檔到 '+(p.levels[0]*100).toFixed(1)+'% 位階';
      else if(p.entry==='grade'&&w.grade[i]>=p.buyGrade)why='首次買進：水位 '+w.grade[i]+' 分';
      if(why&&acc.buy(i,tranche(),why,'entry')){st.buys=1;st.hi=hi;st.lo=lo;st.last=c;st.entry=i;st.peak=c;st.stage=0;st.swingCost=acc.trades.at(-1).amount;bought=true}
      return;
    }
    const lastBuys=acc.trades.length;
    st.peak=Math.max(st.peak,c);
    if(canBuy&&p.entry==='drop'){while(st.buys<maxBuys&&c<=st.hi*(1-(p.drop+st.buys*p.step)/100)){if(!acc.buy(i,tranche(),'加碼：較區間高點下跌 '+(p.drop+st.buys*p.step)+'%','add'))break;st.buys++;bought=true}}
    else if(canBuy&&p.entry==='fib'){while(st.buys<maxBuys&&c<=st.hi-p.levels[st.buys]*(st.hi-st.lo)){if(!acc.buy(i,tranche(),'加碼：回檔到 '+(p.levels[st.buys]*100).toFixed(1)+'% 位階','add'))break;st.buys++;bought=true}}
    else if(canBuy&&st.buys<maxBuys&&c<=st.last*(1-p.step/100)&&w.grade[i]>=p.buyGrade){if(acc.buy(i,tranche(),'加碼：較上次買價再跌 '+p.step+'%','add')){st.buys++;st.last=c;bought=true}}
    for(const t of acc.trades.slice(lastBuys))if(t.type==='buy')st.swingCost=(st.swingCost||0)+t.amount;
    const swing=swingShares();if(bought||swing<1e-9)return;
    // Exits use the swing part's own average cost; the base position is not counted or sold.
    const avg=core?(st.swingCost||0)/swing:acc.cost/acc.shares;let why=null;
    if(p.stop>0&&c<=avg*(1-p.stop/100))why='停損：低於平均成本 '+p.stop+'%';
    else if(p.maxDays>0&&i-st.entry>=p.maxDays)why='持有滿 '+p.maxDays+' 個交易日';
    else if(p.exit==='gain'&&c>=avg*(1+p.rise/100))why='獲利：高於平均成本 '+p.rise+'%';
    else if(p.exit==='high'&&c>=st.hi*(1+p.rise/100))why=p.rise?'突破進場前高點 '+p.rise+'%':'回到進場前高點';
    else if(p.exit==='grade'&&valid&&w.grade[i]<=p.sellGrade)why='水位回到 '+w.grade[i]+' 分';
    else if(p.exit==='fibext'&&c>=st.lo+p.fibExt*(st.hi-st.lo))why=p.fibExt===1?'回到區間高點':'到達 '+(p.fibExt*100).toFixed(1)+'% 擴展位';
    else if(p.exit==='trailing'){
      // Trailing exit only arms after the price has recovered the pre-entry high, so the bottom is not sold.
      if(c>=st.hi)st.armed=true;
      const chand=ctx.hh22[i]-p.atrMult*ctx.atr[i];
      if(st.armed&&(c<=st.peak*(1-p.trail/100)||(p.atrMult>0&&c<chand)))why='移動停利：自高點 '+st.peak.toFixed(2)+' 回落';
    }
    else if(p.exit==='pyramid'){
      if(st.stage===0&&c>=Math.max(avg*(1+p.rise/100),st.hi)){st.swingCost*=0.7;acc.sell(i,swing*0.3,'分批停利一：賣出 30%','trim');st.stage=1;return}
      if(st.stage===1&&c>=st.lo+1.382*(st.hi-st.lo)){st.swingCost*=4/7;acc.sell(i,swing*(0.3/0.7),'分批停利二：到 138.2% 擴展位再賣 30%','trim');st.stage=2;return}
      if(st.stage>=1&&c<ctx.ma120[i])why='留存部位出場：跌破半年線（MA120）';
    }
    if(why){acc.sell(i,swing,why+(core?'（底倉保留）':''),'exit');st.buys=0;st.armed=false;st.swingCost=0}
  }
  const multByGrade=(p,g)=>p.mult[Math.max(1,Math.min(5,g))-1];
  // Two pots for the multiplier strategies: each scheduled month releases B = C ÷ N. A month with a
  // multiplier below 1 spends B × m and moves the rest into a reserve; a month above 1 spends B plus an
  // extra drawn from the reserve (B × (m − 1), or draw % of the reserve if larger). Spending can never
  // run ahead of the schedule, so the pot does not run dry in year one, and after the N months the
  // reserve is still there for low-water months. Sale proceeds (trims) also go to the reserve.
  function positionUsage(r){const rows=r.series||[];let held=0,run=0,longest=0,sum=0;for(const x of rows){const w=Number.isFinite(x.exposure)?Math.max(0,x.exposure):0;if(w>1e-6){held++;sum+=w;run=0}else{run++;longest=Math.max(longest,run)}}return{total:rows.length,held,idle:rows.length-held,participation:held/Math.max(1,rows.length),heldWeight:sum/Math.max(1,held),average:sum/Math.max(1,rows.length),longestIdle:longest,firstBuy:r.trades?.find(t=>t.type==='buy')?.date||null}}
  function fundingInfo(cfg){const supported=['classic','smart_dca_water','bias_tiered_dca','tech_bb_rsi_dca','core_satellite'].includes(cfg.strategy),tranches=supported&&[2,3,4].includes(Number(cfg.entryTranches))?Number(cfg.entryTranches):0;return{supported,tranches}}
  function paced(i,acc,st,h,m,reason,draw){
    const B=h.dcaMonths.has(i)?h.base:0,reserve=st.reserve||0,regular=B*Math.min(1,Math.max(0,m));
    if(h.tranches&&m>1){const before=acc.cash;acc.buy(i,(h.calendar&&h.calendar.recycleGains?acc.cash+acc.cost:h.capital)/h.tranches,reason+'（'+(h.calendar&&h.calendar.recycleGains?'含已實現損益的資金':h.calendar?'原本金':'本金')+'分 '+h.tranches+' 批）','add');st.reserve=Math.max(0,Math.min(acc.cash,reserve+B-(before-acc.cash)));return}
    const extra=m>1?Math.min(reserve,Math.max(h.base*(m-1),reserve*(draw||0)/100)):0,before=acc.cash;
    if(regular+extra>0)acc.buy(i,regular+extra,reason+(extra>0.5?'（動用蓄水池 '+Math.round(extra)+' 元）':''),'dca');
    st.reserve=Math.max(0,reserve+B-(before-acc.cash));
  }
  const toReserve=(st,net)=>{st.reserve=(st.reserve||0)+(net||0)};
  // New experiments share the real account; the satellite ledger protects core and DRIP shares.
  function reserveDay(i,ctx,cfg,acc,st,h,inflow){
    const p=cfg.params,c=ctx.close[i];st.coreShares||=0;st.satShares||=0;st.satCost||=0;st.batches||=0;
    if(inflow>0){const sh=acc.buy(i,inflow*p.core/100,'已到位資金 '+p.core+'% 建立核心（保留）','core');st.coreShares+=sh;if(st.batches>=p.parts)st.batches=0}
    const k=ctx.kdK[i],d=ctx.kdD[i],pk=ctx.kdK[i-1],pd=ctx.kdD[i-1];
    if(cfg.strategy==='kd_oversold_golden_dca'&&k>p.high&&k<d&&pk>=pd&&st.satShares>1e-8){
      // Check profit after this model's fees/tax, using only the signal close (not tomorrow's price).
      const fee=cfg.fee/100*cfg.discount/100,tax=Number.isFinite(ctx.tradeTax?.[i])?ctx.tradeTax[i]:cfg.tax/100;
      if(c*(1-fee-tax)>st.satCost/st.satShares){const sh=st.satShares*p.trim/100,before=acc.cost,count=acc.trades.length;acc.sell(i,sh,'KD 高檔死叉：調節 '+p.trim+'% 衛星獲利部位，核心保留','trim');if(acc.trades.length>count){const t=acc.trades.at(-1),cost=st.satCost*t.shares/st.satShares,removed=before-acc.cost;acc.cost+=removed-cost;t.pnl=t.amount-cost;t.ret=t.pnl/cost;st.satCost-=cost;st.satShares-=t.shares;st.batches=0;st.last=i}}return;
    }
    if(st.batches>=p.parts||i-(st.last??-Infinity)<p.cooldown||!(acc.cash>1e-6)||cfg.entryFlags&&cfg.entryFlags[i]!==true)return;
    let signal=false,reason='';
    if(cfg.strategy==='trend_pullback_ma60'&&i>0&&ctx.ma200[i]>0&&ctx.ma60[i-1]>0&&ctx.ma20[i-1]>0){
      const prev=ctx.close[i-1]/ctx.ma20[i-1]-1,bias=c/ctx.ma20[i]-1;
      signal=c>=ctx.ma200[i]&&(ctx.low[i-1]<=ctx.ma60[i-1]||prev<=-p.bias/100)&&prev<0&&bias<0&&bias>prev&&c>ctx.open[i]&&ctx.close[i-1]<=ctx.open[i-1]&&ctx.low[i]>=ctx.low[i-1];reason='季線／負乖離後首根紅 K 收斂（MA200 多頭）';
    }else if(cfg.strategy==='kd_oversold_golden_dca'){signal=k<p.low&&k>d&&pk<=pd;reason='KD(9,3,3) 低檔黃金交叉';}
    else if(cfg.strategy==='margin_fear_contrarian'){const m=ctx.marginDrop5[i];st.marginValid=(st.marginValid||0)+Number(Number.isFinite(m));signal=ctx.ma60[i]>0&&c/ctx.ma60[i]-1<=-p.bias/100&&Number.isFinite(m)&&m<=-p.marginDrop/100&&h.water?.core[i]>=p.minScore;reason='融資近五筆下降＋負乖離＋低價水位';}
    if(signal){const before=acc.trades.length,sh=acc.buy(i,acc.cash/Math.max(1,p.parts-st.batches),reason+'：剩餘現金分批','add');if(sh&&acc.trades.length>before){st.satShares+=sh;st.satCost+=acc.trades.at(-1).amount;st.batches++;st.last=i}}
  }
  const STRATEGIES={
    chat_ladder:{day(i,ctx,cfg,acc,st,h,inflow){const p=cfg.params,params={...PARAMS.classic,entry:'drop',drop:p.drop,step:p.step,adds:p.parts-1,core:p.core>0,basePct:p.core,exit:p.takeProfit>0?'gain':'hold',rise:p.takeProfit};classicDay(i,ctx,{...cfg,params},acc,st,{...h,tranches:0},inflow)}},
    trend_pullback_ma60:{day:reserveDay},kd_oversold_golden_dca:{day:reserveDay},margin_fear_contrarian:{day:reserveDay},
    buy_hold:{day(i,ctx,cfg,acc,st,h,inflow){if(inflow>0)acc.buy(i,acc.cash,'買進持有：投入已到位資金','bench')}},
    regime_switch:{day(i,ctx,cfg,acc,st,h,inflow){const p=cfg.params,fast=ctx.ma20[i],slow=ctx.ma60[i];if(!(fast>0&&slow>0))return;const on=fast>=slow,target=(on?p.bull:p.bear)/100,cur=acc.value(i)>0?acc.shares*ctx.close[i]/acc.value(i):0;if(st.on!==on||inflow>0||Math.abs(cur-target)>.1)acc.toWeight(i,target,on?'MA20 高於 MA60：順勢配置':'MA20 低於 MA60：防守配置');st.on=on}},
    classic:{day:classicDay},
    dca:{day(i,ctx,cfg,acc,st,h){if(h.dcaMonths.has(i))acc.buy(i,h.base,'定期定額：C ÷ '+h.N,'dca')}},
    smart_dca_water:{day(i,ctx,cfg,acc,st,h){
      if(!monthDay(ctx,i,h.months[0]))return;const p=cfg.params,g=h.water.grade[i]||3,m=multByGrade(p,g);
      paced(i,acc,st,h,m,'潮位定投：水位 '+g+' 分 × '+m,g>=5?p.draw:0);
      if(p.trim&&g===1&&ctx.ma60[i]&&ctx.close[i]/ctx.ma60[i]-1>p.trimBias/100)toReserve(st,acc.sell(i,acc.shares*p.trimPct/100,'高檔減碼 '+p.trimPct+'%，轉入蓄水池','trim'));
    }},
    value_averaging:{day(i,ctx,cfg,acc,st,h){
      // After the N scheduled months no new installments are added; the target keeps only its monthly growth.
      if(!monthDay(ctx,i,h.months[0]))return;const p=cfg.params,g=p.growth/100;st.m=(st.m||0)+1;const k=Math.min(h.N,st.m);
      if(h.calendar)st.target=(st.target||0)*(1+g)+(h.calendar.releases.get(i)||0);
      const target=h.calendar?st.target:(g>0?h.base*((Math.pow(1+g,k)-1)/g):h.base*k)*Math.pow(1+g,st.m-k),cur=acc.shares*ctx.close[i],gap=target-cur;
      if(gap>=0)paced(i,acc,st,{...h,tranches:0},Math.min(p.cap,gap/h.base),'定期定值：補到目標市值');
      else{if(h.dcaMonths.has(i))toReserve(st,h.base);if(p.allowSell)toReserve(st,acc.sell(i,-gap/ctx.close[i],'定期定值：超出目標的部分轉入蓄水池','trim'))}
    }},
    bias_tiered_dca:{day(i,ctx,cfg,acc,st,h){
      if(!monthDay(ctx,i,h.months[0])||!(ctx.ma60[i]>0))return;const b=(ctx.close[i]/ctx.ma60[i]-1)*100,t=cfg.params.tiers;
      const m=b>15?t[0]:b>=-5?t[1]:b>=-10?t[2]:b>=-15?t[3]:t[4];paced(i,acc,st,h,m,'乖離定投：MA60 乖離 '+b.toFixed(1)+'% × '+m);
    }},
    tech_bb_rsi_dca:{day(i,ctx,cfg,acc,st,h){
      const p=cfg.params;if(monthDay(ctx,i,h.months[0]))acc.buy(i,h.base*p.baseRatio,'技術存股：每月底倉','dca');
      const pb=(ctx.close[i]-ctx.bbLo[i])/(ctx.bbUp[i]-ctx.bbLo[i]);if(!Number.isFinite(pb)||!Number.isFinite(ctx.rsi[i]))return;
      if(i-(st.lastBuy??-99)>=5&&pb<p.pbLow&&ctx.rsi[i]<p.rsiLow){if(acc.buy(i,h.tranches?h.capital/h.tranches:h.base*p.dipMult,'超賣加碼：%B '+pb.toFixed(2)+'、RSI '+ctx.rsi[i].toFixed(0),'add'))st.lastBuy=i}
      if(i-(st.lastSell??-99)>=5&&pb>p.pbHigh&&ctx.rsi[i]>p.rsiHigh&&acc.shares){acc.sell(i,acc.shares*p.trimPct/100,'過熱減碼 '+p.trimPct+'%','trim');st.lastSell=i}
    }},
    core_satellite:{init(ctx,cfg,st){st.sat=0;st.satShares=0;st.satCost=0;st.round={buys:0}},day(i,ctx,cfg,acc,st,h,inflow){
      // The satellite is a sub-ledger inside the same account: its cash and shares are tracked separately.
      const p=cfg.params,c=ctx.close[i],w=h.water;st.sat+=inflow*(1-p.core/100);
      if(p.upfrontCore&&inflow>0)acc.buy(i,Math.min(acc.cash-st.sat,inflow*p.core/100),'核心：已到位資金 '+p.core+'% 長期持有','entry');
      if(!p.upfrontCore&&monthDay(ctx,i,h.months[0])){const g=w.grade[i]||3,m=multByGrade(p,g),avail=acc.cash-st.sat;
        if(avail>0)acc.buy(i,Math.min(avail,h.base*(p.core/100)*m),'核心定投：水位 '+g+' 分','dca')}
      const r=st.round;
      if(!r.buys){if(w.grade[i]>=p.satGrade&&st.sat>0){const spent=st.sat/(h.tranches||2),sh=acc.buy(i,Math.min(spent,acc.cash),'衛星進場：水位 '+w.grade[i]+' 分','add');if(sh){st.satShares+=sh;st.satCost+=acc.trades.at(-1).amount;st.sat-=acc.trades.at(-1).amount;r.buys=1;r.peak=c;r.hi=w.hi[i];r.last=c}}return}
      r.peak=Math.max(r.peak,c);
      if(r.buys<(h.tranches||2)&&c<=r.last*(1-p.step/100)&&st.sat>0){const sh=acc.buy(i,Math.min(st.sat/((h.tranches||2)-r.buys),acc.cash),'衛星加碼','add');if(sh){st.satShares+=sh;st.satCost+=acc.trades.at(-1).amount;st.sat-=acc.trades.at(-1).amount;r.buys++;r.last=c}}
      if(c>=r.hi)r.armed=true;
      if(r.armed&&c<=r.peak*(1-p.trail/100)&&st.satShares>0){const before=acc.cost,count=acc.trades.length,net=acc.sell(i,st.satShares,'衛星移動停利出場','exit');if(h.calendar&&acc.trades.length===count)return;if(h.calendar&&acc.trades.length>count){const t=acc.trades.at(-1),removed=before-acc.cost;acc.cost+=removed-st.satCost;t.pnl=net-st.satCost;t.ret=t.pnl/st.satCost}
        // Satellite profit goes to the core pot; the original stake returns to the satellite pot.
        const profit=Math.max(0,net-st.satCost);st.sat+=Math.min(net,st.satCost);if(h.calendar?.recycleGains&&profit>0)acc.buy(i,Math.min(profit,acc.cash),'衛星已實現淨利再投入核心','core');st.satShares=0;st.satCost=0;st.round={buys:0}}
    }},
    rebalance_50_50:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,w=p.weight/100,band=p.band/100,cur=acc.value(i)>0?acc.shares*ctx.close[i]/acc.value(i):0;
      if(inflow||cur>w+band||cur<w-band)acc.toWeight(i,w,inflow?'入金後回到 '+p.weight+'%':'偏離 '+(cur*100).toFixed(0)+'%，再平衡回 '+p.weight+'%');
    }},
    dual_momentum:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,c=ctx.close[i];
      if(monthDay(ctx,i,h.months[0])&&i>=120){
        const mom=0.5*(c/ctx.close[i-60]-1)+0.5*(c/ctx.close[i-120]-1),hurdle=cfg.parking/100*0.5,okScore=!p.minScore||(h.water.core[i]>=p.minScore);
        const on=mom>hurdle&&c>ctx.ma120[i]&&okScore;
        if(on&&!st.on)acc.buy(i,acc.cash,'動能轉正：近 60／120 日 '+(mom*100).toFixed(1)+'%，站上 MA120','entry');
        if(!on&&st.on&&acc.shares)acc.sell(i,acc.shares,'動能轉弱或跌破 MA120，轉入停泊','exit');
        st.on=on;
      }
      if(st.on&&inflow&&acc.cash>0)acc.buy(i,acc.cash,'動能期間投入新入金','add');
    }},
    macro_regime:{day(i,ctx,cfg,acc,st,h){
      const p=cfg.params,c=ctx.close[i];if(!(ctx.ma200[i]>0)||i<220)return;
      const bull=c>ctx.ma200[i]&&ctx.ma200[i]>ctx.ma200[i-20];
      const macroOk=!p.macroFilter||!ctx.macro||!(ctx.macro[i]<p.macroMin);
      if(!acc.shares||acc.shares*c<acc.value(i)*0.05){
        if(bull){let hh=-Infinity;for(let j=i-19;j<=i;j++)hh=Math.max(hh,ctx.close[j]);
          if(macroOk&&(c<=ctx.ma20[i]*1.01||c<=hh*(1-p.pullback/100))){if(acc.buy(i,acc.cash,'多頭淺回檔買進（回到 MA20 或回落 '+p.pullback+'%）','entry')){st.peak=c;st.mode='bull'}}}
        else if(macroOk&&h.water.grade[i]>=5){if(acc.buy(i,acc.cash,'空頭深回檔：水位 5 分','entry')){st.peak=c;st.mode='bear';st.entry=c}}
        return;
      }
      st.peak=Math.max(st.peak||c,c);
      if(st.mode==='bull'&&c<=st.peak*(1-p.trail/100))acc.sell(i,acc.shares,'多頭移動停利：自高點回落 '+p.trail+'%','exit');
      else if(st.mode==='bear'&&(c>=ctx.ma60[i]&&c>st.entry||c<=st.entry*(1-p.stop/100)))acc.sell(i,acc.shares,c>=ctx.ma60[i]?'空頭反彈到 MA60 獲利了結':'空頭停損','exit');
    }},
    vol_targeting:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,s=ctx.sigma[i];if(!(s>0))return;
      const target=Math.max(p.minW/100,Math.min(1,p.target/100/s)),cur=acc.value(i)>0?acc.shares*ctx.close[i]/acc.value(i):0;
      if(inflow||Math.abs(cur-target)>p.band/100)acc.toWeight(i,target,'波動 '+(s*100).toFixed(0)+'%，部位調到 '+(target*100).toFixed(0)+'%');
    }},
    bb_squeeze:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,c=ctx.close[i];if(!Number.isFinite(ctx.bbUp[i]))return;
      if(!acc.shares){let squeezed=false;for(let j=Math.max(0,i-5);j<=i;j++)if(ctx.bwRank[j]<=p.squeeze/100)squeezed=true;
        if(squeezed&&c>ctx.bbUp[i]&&(!p.volume||ctx.vol[i]>ctx.volMa20[i]))acc.buy(i,acc.cash,'帶寬壓縮後突破上軌','entry');return}
      if(inflow&&acc.cash>0)acc.buy(i,acc.cash,'持有期間投入新入金','add');
      if(c<ctx.ma20[i])acc.sell(i,acc.shares,'收盤跌破 MA20','exit');
    }},
    // 960 Trading's rule, long-only (see planning/960trading-策略紀錄.md): the dividing line is the N-bar average
    // shifted right by `offset` bars; buy when the close is below it while the flow direction is positive, sell
    // everything when the close is above it while the flow turns negative.
    ma_offset_flow:{day(i,ctx,cfg,acc,st,h,inflow){
      const p=cfg.params,{line,flow}=lineFlow(ctx,p),c=ctx.close[i];if(!Number.isFinite(line[i])||!Number.isFinite(flow[i]))return;
      if(!acc.shares){if(c<line[i]&&flow[i]>0)acc.buy(i,acc.cash,`收盤 ${c} 低於分界線 ${line[i].toFixed(2)}，籌碼方向 +${flow[i].toFixed(2)}`,'entry');return}
      if(inflow&&acc.cash>0)acc.buy(i,acc.cash,'持有期間投入新入金','add');
      if(c>line[i]&&flow[i]<0)acc.sell(i,acc.shares,`收盤 ${c} 高於分界線 ${line[i].toFixed(2)}，籌碼方向 ${flow[i].toFixed(2)}`,'exit');
    }}
  };
  /* Dividing line (SMA of `ma` closes, shifted right by `offset` bars) and flow direction (sum over `flow` bars
     of candle direction × body ratio). Both use bars up to i only. */
  function lineFlow(ctx,p){
    const key='lf|'+p.ma+'|'+p.offset+'|'+p.flow;if(ctx.refCache.has(key))return ctx.refCache.get(key);
    const n=ctx.n,ma=sma(ctx.close,Math.max(1,p.ma)),line=new Float64Array(n).fill(NaN),flow=new Float64Array(n).fill(NaN),f=new Float64Array(n);
    for(let i=0;i<n;i++){if(i-p.offset>=0)line[i]=ma[i-p.offset];const b=ctx.bars[i],range=b.high-b.low;f[i]=range>0?Math.sign(b.close-b.open)*Math.abs(b.close-b.open)/range:0}
    let s=0;for(let i=0;i<n;i++){s+=f[i];if(i>=p.flow)s-=f[i-p.flow];if(i>=p.flow-1)flow[i]=s}
    const out={line,flow};ctx.refCache.set(key,out);return out;
  }
  /* ---------- defaults and presets ---------- */
  const PARAMS={
    chat_ladder:{core:40,parts:3,drop:10,step:10,takeProfit:0,window:240},
    trend_pullback_ma60:{core:50,parts:3,bias:3.5,cooldown:8},
    kd_oversold_golden_dca:{core:45,parts:3,low:25,high:85,trim:15,cooldown:6},
    margin_fear_contrarian:{core:40,parts:3,bias:4,marginDrop:1,minScore:3.8,cooldown:10},
    buy_hold:{},regime_switch:{bull:90,bear:25},
    classic:{entry:'drop',drop:20,levels:[0.382,0.5,0.618],buyGrade:5,step:10,adds:3,exit:'gain',rise:20,sellGrade:1,fibExt:1,trail:10,atrMult:3,stop:0,maxDays:0,core:false},
    dca:{},
    smart_dca_water:{mult:[0.3,0.7,1,1.8,3],draw:30,trim:false,trimBias:25,trimPct:15},
    value_averaging:{growth:0.6,cap:3.5,allowSell:true},
    bias_tiered_dca:{tiers:[0.5,1,1.5,2.2,3.5]},
    tech_bb_rsi_dca:{baseRatio:0.6,dipMult:2,pbLow:0.15,rsiLow:35,pbHigh:1.05,rsiHigh:80,trimPct:10},
    core_satellite:{core:70,mult:[0.3,0.7,1,1.8,3],satGrade:4,step:8,trail:10},
    rebalance_50_50:{weight:50,band:10},
    dual_momentum:{minScore:0},
    macro_regime:{pullback:6,trail:10,stop:15,macroFilter:true,macroMin:1.5},
    vol_targeting:{target:18,minW:20,band:10},
    bb_squeeze:{squeeze:15,volume:true},
    ma_offset_flow:{ma:16,offset:13,flow:13}
  };
  const P=(strategy,params)=>({strategy,params:{...PARAMS[strategy],...params}});
  // Archived rule definitions remain executable only for reproducibility of old experiments/tests.
  // Public menus, optimisation and holdout selection use PRESETS exclusively.
  const LEGACY_PRESETS=[
    {id:'drop20',family:'swing',name:'跌 20% 買、賺 20% 賣',...P('classic',{entry:'drop',drop:20,step:10,adds:3,exit:'gain',rise:20})},
    {id:'ladder10',family:'swing',name:'每跌 10% 分批承接',...P('classic',{entry:'drop',drop:10,step:10,adds:4,exit:'gain',rise:15})},
    {id:'backToHigh',family:'swing',name:'回到前高就賣',...P('classic',{entry:'drop',drop:15,step:10,adds:2,exit:'high',rise:0})},
    {id:'fib',family:'swing',name:'黃金分割分批',...P('classic',{entry:'fib',levels:[0.382,0.5,0.618],exit:'fibext',fibExt:1})},
    {id:'grade51',family:'swing',name:'水位 5 分買、1 分賣',...P('classic',{entry:'grade',buyGrade:5,step:10,adds:2,exit:'grade',sellGrade:1})},
    {id:'chandelier',family:'swing',name:'潮位抄底＋移動停利',...P('classic',{entry:'grade',buyGrade:4,step:8,adds:2,exit:'trailing',trail:10,atrMult:3})},
    {id:'pyramid',family:'swing',name:'金字塔分批停利',...P('classic',{entry:'drop',drop:12,step:8,adds:2,exit:'pyramid',rise:15})},
    {id:'coreSwing',family:'swing',name:'底倉＋回檔加碼（3 等分）',...P('classic',{entry:'drop',drop:10,step:10,adds:2,exit:'gain',rise:20,core:true})},
    {id:'ma960',family:'swing',name:'MA16 平移＋K 棒力道',...P('ma_offset_flow',{})},
    {id:'ma4flow',family:'swing',name:'MA4 平移＋K 棒力道',...P('ma_offset_flow',{ma:4,offset:13,flow:13})},
    {id:'dca',family:'dca',name:'定期定額（對照）',...P('dca',{})},
    {id:'smartDca',family:'dca',name:'潮位動態加權定投',...P('smart_dca_water',{})},
    {id:'va',family:'dca',name:'定期定值',...P('value_averaging',{})},
    {id:'bias',family:'dca',name:'均線乖離階梯定投',...P('bias_tiered_dca',{})},
    {id:'bbRsi',family:'dca',name:'布林 %B＋RSI 技術存股',...P('tech_bb_rsi_dca',{})},
    {id:'momentum',family:'trend',name:'雙動能趨勢',...P('dual_momentum',{})},
    {id:'regime',family:'trend',name:'多空體制切換',...P('macro_regime',{})},
    {id:'volTarget',family:'trend',name:'目標波動率控倉',...P('vol_targeting',{})},
    {id:'squeeze',family:'trend',name:'布林壓縮突破',...P('bb_squeeze',{})},
    {id:'coreSat',family:'mix',name:'70/30 核心衛星',...P('core_satellite',{})},
    {id:'rebalance',family:'mix',name:'50:50 動態再平衡',...P('rebalance_50_50',{})}
  ];
  const FAMILIES=[['benchmark','基準對照'],['value','左側水位加碼'],['trend','順勢與配置']];
  const PRESETS=[
    {id:'trendPullback',family:'trend',name:'季線回檔收斂',...P('trend_pullback_ma60',{})},
    {id:'kdGolden',family:'value',name:'KD 低檔分批',...P('kd_oversold_golden_dca',{})},
    {id:'marginFear',family:'value',name:'融資減幅逆勢',...P('margin_fear_contrarian',{})},
    {id:'buyHold',family:'benchmark',name:'買進持有',...P('buy_hold',{})},
    {id:'dca',family:'benchmark',name:'資金池分批定投',...P('dca',{})},
    {id:'coreSwing',family:'value',name:'底倉＋回檔分批',...P('classic',{entry:'drop',drop:10,step:10,adds:2,exit:'gain',rise:20,core:true,basePct:40})},
    {id:'smartDca',family:'value',name:'潮位動態定投',...P('smart_dca_water',{})},
    {id:'bias',family:'value',name:'均線乖離階梯定投',...P('bias_tiered_dca',{})},
    {id:'coreSat',family:'trend',name:'70/30 核心衛星',...P('core_satellite',{upfrontCore:true})},
    {id:'regime',family:'trend',name:'多空體制切換',...P('regime_switch',{})},
    {id:'chandelier',family:'trend',name:'潮位抄底＋移動停利',...P('classic',{entry:'grade',buyGrade:4,step:8,adds:2,exit:'trailing',trail:10,atrMult:3})}
  ];
  const RETIRED={drop20:'coreSwing',ladder10:'coreSwing',backToHigh:'chandelier',fib:'smartDca',grade51:'coreSat',pyramid:'chandelier',ma960:'regime',ma4flow:'regime',va:'smartDca',bbRsi:'bias',momentum:'regime',volTarget:'regime',squeeze:'regime',rebalance:'coreSat'};
  function closedRounds(trades,divs=[]){let shares=0,cost=0,proceeds=0,opened=null;const rounds=[],events=[...trades.map((t,i)=>({...t,order:i+1})),...divs.map(([time,amount])=>({date:new Date(time).toISOString().slice(0,10),type:'dividend',amount,order:0}))].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order);for(const t of events){if(t.type==='dividend'){if(shares>1e-7)proceeds+=t.amount;continue}if(t.type==='buy'){if(shares<1e-8)opened=t.date;shares+=t.shares;cost+=t.amount}else{shares-=t.shares;proceeds+=t.amount;if(shares<=1e-7&&cost>0){rounds.push({from:opened,to:t.date,pnl:proceeds-cost,ret:proceeds/cost-1});shares=0;cost=0;proceeds=0;opened=null}}}return{rounds,total:rounds.length,wins:rounds.filter(x=>x.pnl>0).length,open:shares>1e-7}}
  return{prepare,marginHistory,reference,water,score,lineFlow,run,xirr,fundingCalendar,fundingInfo,positionUsage,riskSharpe,drawdownEvents,closedRounds,STRATEGIES,PARAMS,PRESETS,FAMILIES,RETIRED,LEGACY_PRESETS};
}
const ChaoweiEngine=createChaoweiEngine();

function optimizerBatch(engine,ctx,candidates,start,end,onProgress){
  const rows=[],begun=performance.now();let dcaRef=null;
  for(let i=0;i<candidates.length;i++){const c=candidates[i],r=engine.run(ctx,c.cfg,start,end);dcaRef=dcaRef||{monthly:r.monthly,xirr:r.dca.xirr,mdd:r.dca.mdd,cagr:r.dca.cagr};rows.push({p:c.p,w:c.w,usesWater:c.usesWater,r:{monthly:r.monthly,xirr:r.xirr,cagr:r.cagr,annual:r.monthly?r.xirr:r.cagr,mdd:r.mdd,calmar:r.calmar,dca:{xirr:r.dca.xirr,cagr:r.dca.cagr}}});if(i%3===0||i===candidates.length-1)onProgress?.(i+1,candidates.length)}
  return{rows,dcaRef,computeMs:performance.now()-begun};
}
function createOptimizerRunner(){
  let worker=null,rejectCurrent=null,generation=0;const memo=new Map();
  function aborted(){const e=Error('cancelled');e.name='AbortError';return e}
  function cancel(){generation++;worker?.terminate();worker=null;if(rejectCurrent){rejectCurrent(aborted());rejectCurrent=null}}
  async function run(key,ctx,candidates,start,end,progress){
    const begun=performance.now();cancel();const mine=generation;if(memo.has(key))return{...memo.get(key),executor:'memory',elapsedMs:performance.now()-begun};
    let result;
    try{
      const src='const E=('+createChaoweiEngine.toString()+')();const batch='+optimizerBatch.toString()+';onmessage=e=>{try{const d=e.data;const result=batch(E,d.ctx,d.candidates,d.start,d.end,(done,total)=>postMessage({progress:{done,total}}));postMessage({result})}catch(e){postMessage({error:e.message})}}';
      const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));try{worker=new Worker(url)}finally{URL.revokeObjectURL(url)}
      result=await new Promise((resolve,reject)=>{rejectCurrent=reject;worker.onmessage=e=>{if(e.data.progress)progress?.(e.data.progress.done,e.data.progress.total);if(e.data.error)reject(Error(e.data.error));if(e.data.result)resolve({...e.data.result,executor:'worker'})};worker.onerror=e=>reject(Error(e.message||'worker unavailable'));worker.postMessage({ctx,candidates,start,end})});
    }catch(e){if(e.name==='AbortError'||mine!==generation)throw aborted();worker?.terminate();worker=null;const rows=[];let dcaRef=null;const t=performance.now();for(let i=0;i<candidates.length;i++){if(mine!==generation)throw aborted();const one=optimizerBatch(E,ctx,[candidates[i]],start,end);rows.push(...one.rows);dcaRef=dcaRef||one.dcaRef;progress?.(i+1,candidates.length);await new Promise(resolve=>setTimeout(resolve,0))}if(mine!==generation)throw aborted();result={rows,dcaRef,executor:'chunked',computeMs:performance.now()-t}}
    finally{if(mine===generation){rejectCurrent=null;worker?.terminate();worker=null}}
    result.elapsedMs=performance.now()-begun;memo.set(key,result);if(memo.size>4)memo.delete(memo.keys().next().value);return result;
  }
  return{run,cancel};
}
const OptimizerRunner=createOptimizerRunner();

/* ---------- Strategy backtest panel (uses ChaoweiEngine from strategy-engine.js) ---------- */
const E=ChaoweiEngine;
// dcaPeriods 'auto' = one installment per month of the backtest window; sync = use the observation settings above.
const BT_DEFAULT={v:5,family:'value',preset:'smartDca',strategy:'smart_dca_water',params:{...E.PARAMS.smart_dca_water},
  ref:{window:'240',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,entryTranches:0,dcaPeriods:'auto',capitalMode:'pool',sync:true,period:'5',
  fee:0.1425,discount:100,tax:0.1,fill:'nextOpen',slipBps:5,parking:1.5,drip:true,wholeShares:false,markers:true};
// v2 stored the classic builder's fields at the top level; keep the user's swing settings.
// v3 defaulted to 12 installments, which spent C in the first year of a five-year test; 12 becomes 'auto'.
function btMigrateStored(b){
  if(b&&b.v!==5){const target=(b.v===2||b.mode||b.preset==='custom'&&b.strategy==='classic'?'coreSwing':null)||E.RETIRED[b.preset]||(['coreSwing','coreSat','regime'].includes(b.preset)?b.preset:null),p=E.PRESETS.find(x=>x.id===target);if(p)return{...BT_DEFAULT,...b,v:5,...p,preset:p.id,params:JSON.parse(JSON.stringify(p.params)),migrationNotice:'策略目錄已精簡。舊方案「'+(E.LEGACY_PRESETS.find(x=>x.id===b.preset)?.name||'舊自訂方案')+'」已改為「'+p.name+'」；規則已重設，請確認條件並重新回測。',ref:{...BT_DEFAULT.ref,...b.ref}}}

  if(b&&(b.v===3||b.v===4||b.v===5)){const out={...BT_DEFAULT,...b,v:5,ref:{...BT_DEFAULT.ref,...b.ref},params:{...E.PARAMS[b.strategy]||{},...b.params}};
    if(b.v===3){if(b.dcaPeriods===12)out.dcaPeriods='auto';out.sync=String(out.ref.window)===String(settings.window)&&out.ref.method===settings.method&&out.ref.anchorMode===settings.anchorMode}
    if(['chat_ladder','chat_annual_regime'].includes(out.strategy))return{...out,preset:'custom',family:out.strategy==='chat_ladder'?'value':'trend'};const p=E.PRESETS.find(x=>x.id===out.preset);if(p)out.family=p.family;else if(E.PRESETS.some(x=>x.strategy===out.strategy))out.family=E.PRESETS.find(x=>x.strategy===out.strategy).family;else if(!E.PRESETS.some(x=>x.strategy===out.strategy))return{...BT_DEFAULT,ref:out.ref,migrationNotice:'原方案不在目前策略目錄中，請重新選擇。'};return out}
  const out={...BT_DEFAULT,ref:{...BT_DEFAULT.ref,window:settings.window||'240',anchorMode:settings.anchorMode||'wick',anchorCount:settings.anchorCount||5,method:settings.method||'equal'}};
  if(b&&typeof b==='object'&&(b.v===2||b.mode)){
    const keys=['entry','drop','levels','buyGrade','step','adds','exit','rise','sellGrade','fibExt','stop','maxDays'],params={...E.PARAMS.classic};
    for(const k of keys)if(b[k]!=null)params[k]=b[k];if(b.mode==='fib'){params.entry='fib';params.exit='fibext';params.fibExt=b.fibSell||1}
    Object.assign(out,{family:'swing',preset:'custom',strategy:'classic',params,period:b.period||'5',fee:b.fee??out.fee,discount:b.discount??out.discount,tax:b.tax??out.tax,wholeShares:!!b.wholeShares,markers:b.markers!==false});
    if(b.window)out.ref={window:String(b.window),anchorMode:b.anchorMode||'wick',anchorCount:b.anchorCount||5,method:b.method||'equal'};
  }
  return out;
}
function btMigrate(b){const out=btMigrateStored(b),f=out.funding&&typeof out.funding==='object'?out.funding:null;out.funding={version:1,type:'total',arrival:'yearStart',annualAmount:240000,recycleGains:true,years:{},...f};out.funding.type=f?.type==='annual'?'annual':'total';out.funding.years=f?.years&&typeof f.years==='object'?{...f.years}:{};out.funding.version=1;if(!f&&out.dcaPeriods===12)out.fundingNotice='目前保留舊設定：總預算只分首 12 個月，不會每年再入金。可改選「整段回測期間」或「逐年新增預算」。';return out}
settings.bt=btMigrate(settings.bt);
function btYears(){if(!bars.length)return[];return [...new Set(bars.slice(btStart(settings.bt.period),btEnd()+1).map(x=>x.date.slice(0,4)))]}
function btFundingForm(){const b=settings.bt,f=b.funding,annual=f.type==='annual';$('btBudgetType').value=annual?'annual':'total';$('btAnnualFields').hidden=!annual;for(const id of ['btTotalCapital','btTotalArrival','btDeployment','btCapChips'])$(id).hidden=annual;$('btAnnualArrival').value=f.arrival||'yearStart';$('btRecycleGains').checked=f.recycleGains!==false;$('btAnnualAmount').value=f.annualAmount??240000;$('btFundingNotice').textContent=!annual&&b.dcaPeriods===12?b.fundingNotice||'':'';const list=$('btYearBudgets');list.replaceChildren();for(const y of btYears()){const l=document.createElement('label');l.textContent=y+' 年';const input=document.createElement('input');input.type='number';input.min='0';input.max='1000000000';input.step='10000';input.dataset.budgetYear=y;input.setAttribute('aria-label',y+' 年新增預算');input.value=f.years?.[y]??f.annualAmount??240000;l.append(input);list.append(l)}}
function btFundingText(r){if(!r?.funding)return'';const f=r.funding,positive=f.periods.filter(x=>x.inflow>0),first=positive[0]?.date,last=positive.at(-1)?.date;return(f.type==='annual'?'逐年新增預算':'整段總預算')+' · '+(f.arrival==='monthly'?'按月到帳':f.arrival==='yearStart'?'年度額度於該年可用':'期初全額到位')+' · 實際入金 '+money(r.contributed)+' · '+positive.length+' 次（'+first+' 至 '+last+'） · 定投按 '+r.N+' 個月排程。'}
function btFundingResult(r){const host=$('btFundingSummary'),wasOpen=!!host.querySelector('details[open]');if(!r?.funding){host.replaceChildren();return}host.replaceChildren();const p=document.createElement('p');p.textContent=btFundingText(r);host.append(p);if(r.funding.type==='total'&&r.N<Math.round(r.years*12)-1){const b=document.createElement('button');b.type='button';b.className='pill mini';b.textContent='改為整段期間分期';b.onclick=()=>{settings.bt.dcaPeriods='auto';delete settings.bt.fundingNotice;save();btFillForm();renderBacktest()};host.append(b)}const detail=document.createElement('details');detail.className='metric-detail';detail.open=wasOpen;detail.innerHTML='<summary>逐年入金與買進核對</summary>';const rows=new Map();for(const x of r.funding.periods){const y=x.date.slice(0,4);if(!rows.has(y))rows.set(y,{income:0,budget:0,buy:0,sell:0,pnl:0,cash:0,count:0});rows.get(y).income+=x.inflow;rows.get(y).budget+=x.budget}for(const t of r.trades)if(t.type==='buy'&&t.kind!=='drip'){const v=rows.get(t.date.slice(0,4));if(v){v.buy+=t.amount;v.count++}}for(const t of r.trades)if(t.type==='sell'){const v=rows.get(t.date.slice(0,4));if(v){v.sell+=t.amount;v.pnl+=t.pnl||0}}for(const t of r.series){const v=rows.get(t.time.slice(0,4));if(v)v.cash=t.value*(1-t.exposure)}const box=document.createElement('div');box.className='funding-calendar-table';box.innerHTML='<table><thead><tr><th>年度</th><th>外部入金</th><th>定投排程</th><th>策略買進</th><th>賣出淨額</th><th>已實現損益</th><th>期末現金</th><th>買進次數</th></tr></thead><tbody>'+[...rows].map(([y,v])=>'<tr><th>'+y+'</th><td>'+money(v.income)+'</td><td>'+money(v.budget)+'</td><td>'+money(v.buy)+'</td><td>'+money(v.sell)+'</td><td>'+money(v.pnl)+'</td><td>'+money(v.cash)+'</td><td>'+v.count+'</td></tr>').join('')+'</tbody></table><p class="small">買進含費用、不含股利再投入；可使用以前留下的現金及賣出款，買進額不等於新入金。期末訊號可能尚未成交。三組對照使用完全相同的外部入金。'+(sameBaseline(r)?'本設定下定投與買進持有都在到帳日買進，兩條基準幾乎相同（只差零頭現金的利息與股利）。':'')+'</p>';detail.append(box);host.append(detail)}
var btResult=null,btBarsRef=null,btCtx=null,btDivs=null,btTimer=0,btCharts=null,btTradeFilter='all',btSeq=0;
const clampNum=(v,lo,hi,d)=>{const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d};

/* Parameter fields per strategy: [key,label,type,extra,visible(params)]. */
const GRADE_OPTS=[['5','5 分（區間最低處）'],['4','4 分以上'],['3','3 分以上']];
const BT_SCHEMA={
  chat_ladder:[['core','保留核心','num',{min:0,max:90,step:5,unit:'%'}],['parts','加碼池分批','num',{min:1,max:10,step:1,unit:'批'}],['drop','首次自高點下跌','num',{min:1,max:90,step:1,unit:'%'}],['step','之後每再跌','num',{min:1,max:50,step:1,unit:'%'}],['takeProfit','衛星獲利出場（0＝持有）','num',{min:0,max:300,step:1,unit:'%'}],['window','前期高點觀察窗','num',{min:20,max:2400,step:20,unit:'日'}]],
  trend_pullback_ma60:[['core','保留核心','num',{min:10,max:90,step:5,unit:'%'}],['parts','加碼池分批','num',{min:2,max:4,step:1,unit:'批'}],['bias','前日 MA20 負乖離至少','num',{min:0.5,max:20,step:0.5,unit:'%'}],['cooldown','加碼間隔','num',{min:1,max:60,step:1,unit:'交易日'}]],
  kd_oversold_golden_dca:[['core','保留核心','num',{min:10,max:90,step:5,unit:'%'}],['parts','加碼池分批','num',{min:2,max:4,step:1,unit:'批'}],['low','金叉時 K 低於','num',{min:5,max:50,step:1}],['high','死叉時 K 高於','num',{min:60,max:95,step:1}],['trim','調節衛星獲利股數','num',{min:5,max:50,step:5,unit:'%'}],['cooldown','交易間隔','num',{min:1,max:60,step:1,unit:'交易日'}]],
  margin_fear_contrarian:[['core','保留核心','num',{min:10,max:90,step:5,unit:'%'}],['parts','加碼池分批','num',{min:2,max:4,step:1,unit:'批'}],['bias','MA60 負乖離至少','num',{min:1,max:30,step:0.5,unit:'%'}],['marginDrop','融資近五筆減少至少','num',{min:0.1,max:20,step:0.1,unit:'%'}],['minScore','價格水位至少','num',{min:0,max:5,step:0.1,unit:'分'}],['cooldown','加碼間隔','num',{min:1,max:60,step:1,unit:'交易日'}]],
  classic:[['entry','買進條件','select',[['drop','自區間高點下跌'],['fib','回檔到黃金分割位階'],['grade','水位分數達到']]],
    ['drop','下跌幅度','num',{min:1,max:90,step:1,unit:'%'},p=>p.entry==='drop'],['levels','買進位階','levels',null,p=>p.entry==='fib'],
    ['buyGrade','水位分數','select',GRADE_OPTS,p=>p.entry==='grade'],['step','每再跌','num',{min:1,max:50,step:1,unit:'%'},p=>p.entry!=='fib'],
    ['adds','加碼最多','num',{min:0,max:10,step:1,unit:'次'},p=>p.entry!=='fib'],
    ['exit','賣出條件','select',[['gain','自平均成本上漲'],['high','突破進場前高點'],['grade','水位分數回到'],['fibext','黃金分割擴展位'],['trailing','移動停利（不設高點）'],['pyramid','分批停利＋留底倉']]],
    ['rise','幅度','num',{min:0,max:300,step:1,unit:'%'},p=>['gain','high','pyramid'].includes(p.exit)],['sellGrade','水位分數','select',[['1','1 分（區間最高處）'],['2','2 分以下']],p=>p.exit==='grade'],
    ['fibExt','位置','select',[['1','區間高點（100%）'],['1.272','127.2%'],['1.618','161.8%']],p=>p.exit==='fibext'],
    ['trail','自高點回落','num',{min:2,max:40,step:1,unit:'%'},p=>p.exit==='trailing'],['atrMult','吊燈 ATR 倍數','num',{min:0,max:6,step:0.5,unit:'倍'},p=>p.exit==='trailing'],
    ['basePct','核心底倉','num',{min:10,max:80,step:5,unit:'%'},p=>p.core&&p.basePct>0],['core','第 1 份當底倉（起點買進、不賣）','check'],['stop','停損','num',{min:0,max:90,step:1,unit:'%'}],['maxDays','最長持有','num',{min:0,max:2400,step:10,unit:'日'}]],
  buy_hold:[],regime_switch:[['bull','多頭持股','num',{min:0,max:100,step:5,unit:'%'}],['bear','空頭持股','num',{min:0,max:100,step:5,unit:'%'}]],
  dca:[],
  smart_dca_water:[['mult','各水位扣款倍數（1 至 5 分）','array5',{step:0.1}],['trim','高檔減碼','check'],['trimBias','MA60 乖離超過','num',{min:5,max:60,step:1,unit:'%'},p=>p.trim],['trimPct','減碼比例','num',{min:5,max:50,step:5,unit:'%'},p=>p.trim]],
  value_averaging:[['growth','目標市值月成長','num',{min:0,max:3,step:0.1,unit:'%'}],['cap','單月最多投入','num',{min:1,max:10,step:0.5,unit:'倍'}],['allowSell','超出目標時賣出','check']],
  bias_tiered_dca:[['tiers','扣款倍數：乖離 >15%、−5~15%、−10~−5%、−15~−10%、<−15%','array5',{step:0.1}]],
  tech_bb_rsi_dca:[['baseRatio','每月底倉比例','num',{min:0,max:1,step:0.1,unit:'倍'}],['dipMult','超賣加碼','num',{min:0.5,max:5,step:0.5,unit:'倍'}],['pbLow','%B 低於','num',{min:-0.5,max:0.5,step:0.05}],['rsiLow','RSI 低於','num',{min:10,max:50,step:1}],['pbHigh','%B 高於','num',{min:0.8,max:1.5,step:0.05}],['rsiHigh','RSI 高於','num',{min:60,max:95,step:1}],['trimPct','過熱減碼','num',{min:0,max:50,step:5,unit:'%'}]],
  core_satellite:[['core','核心比例','num',{min:10,max:90,step:5,unit:'%'}],['satGrade','衛星進場水位','select',GRADE_OPTS],['step','衛星再跌加碼','num',{min:1,max:30,step:1,unit:'%'}],['trail','衛星自高點回落出場','num',{min:2,max:40,step:1,unit:'%'}]],
  rebalance_50_50:[['weight','目標持股比例','num',{min:10,max:90,step:5,unit:'%'}],['band','偏離多少再平衡','num',{min:2,max:30,step:1,unit:'%'}]],
  dual_momentum:[['minScore','另需水位分數至少','num',{min:0,max:4,step:0.5,unit:'分'}]],
  macro_regime:[['pullback','多頭：回落多少買','num',{min:2,max:20,step:1,unit:'%'}],['trail','多頭：自高點回落賣','num',{min:3,max:30,step:1,unit:'%'}],['stop','空頭：停損','num',{min:5,max:40,step:1,unit:'%'}],['macroFilter','原油與匯率濾網','check'],['macroMin','濾網最低分','num',{min:0,max:4,step:0.5,unit:'分'},p=>p.macroFilter]],
  vol_targeting:[['target','目標年化波動','num',{min:5,max:60,step:1,unit:'%'}],['minW','最低持股','num',{min:0,max:80,step:5,unit:'%'}],['band','偏離多少調整','num',{min:2,max:30,step:1,unit:'%'}]],
  bb_squeeze:[['squeeze','帶寬低於近 120 日','num',{min:5,max:40,step:1,unit:'% 分位'}],['volume','突破時需放量','check']],
  ma_offset_flow:[['ma','分界均線','num',{min:2,max:960,step:1,unit:'日'}],['offset','往右平移','num',{min:0,max:60,step:1,unit:'根'}],['flow','籌碼方向期數','num',{min:2,max:60,step:1,unit:'根'}]]
};
const BT_EXPLAIN={chat_annual_regime:'成熟 MA240 上方配置90%，下方30%；體制改變或入金時調整。與對話使用相同資金及成交設定。',buy_hold:'資金到位後買進並持有；與定投使用相同費用、配息與成交模型。',regime_switch:'MA20 高於 MA60 採多頭配置，反向採防守配置；首次均線成熟前維持現金。',
  chat_ladder:'對話轉成的回檔分批規則；核心保留、剩餘現金依批數投入。跌幅以該輪確認的前期高點為基準，不是每筆成交價的複利跌幅。停利為 0 時持有。',
  trend_pullback_ma60:'核心隨已到位資金建立；MA200 多頭中，前日碰季線或 MA20 負乖離達門檻，首根紅 K 收斂且不破前低才加碼。前段均線不足不加碼，核心保留。',
  kd_oversold_golden_dca:'KD(9,3,3) 低檔金叉時動用剩餘加碼池，每輪分批；高檔死叉且衛星扣成本後有獲利才小幅調節。核心與配息再投入股數保留；不是固定 2.5 倍扣款。',
  margin_fear_contrarian:'同時符合 MA60 負乖離、近五筆已公布市場融資餘額減幅及價格水位才加碼。融資至少延後一交易日使用，缺值或跨長缺口不觸發；核心保留。三項為 AND。',
  classic:'在區間低處分批買進，依設定賣出；沒有部位時現金停泊',dca:'每月固定金額買進，作為比較基準',
  smart_dca_water:'每月扣款，依水位分數放大或縮小金額；扣不完的錢留作下次加碼',value_averaging:'讓持股市值照目標曲線成長，跌深多買、漲多少買或賣出',
  bias_tiered_dca:'依股價與 MA60 的乖離決定每月扣款倍數',tech_bb_rsi_dca:'每月小額底倉，超賣（%B、RSI 偏低）時加碼，過熱時小幅減碼',
  core_satellite:'資金到位先建立核心部位、不賣出；其餘衛星資金在低水位進場、移動停利出場',rebalance_50_50:'維持固定持股比例，偏離時高賣低買',
  dual_momentum:'近 60／120 日報酬為正且站上 MA120 時滿倉，轉弱時改持現金',macro_regime:'依 MA200 判斷多空：多頭淺回檔買、空頭只在水位 5 分買',
  vol_targeting:'波動低時提高持股、波動放大時降低持股',bb_squeeze:'布林帶寬壓縮後突破上軌才買進，跌破 MA20 賣出',
  ma_offset_flow:'均線分界＋籌碼方向（只做多）：收盤低於往右平移的均線且籌碼方向為正時買進；收盤高於分界線且籌碼方向轉負時全賣。「做空條件」在 ETF 回測中只作出場，不建立空單。MA 長度、平移根數及籌碼期數均可調整'
};

/* ---------- context: daily bars + split-adjusted dividends + macro score ---------- */
let btMarginRows=[],btMarginPromise=null,btMarginSnapshot=null,btMarginAt=0;
function btEnsureMargin(){if(btMarginPromise&&Date.now()-btMarginAt<300000)return btMarginPromise;btMarginAt=Date.now();return btMarginPromise=(async()=>{try{const r=await fetch('/api/margin'),d=await r.json();if(!r.ok||!Array.isArray(d.rows))throw Error('margin unavailable');btMarginSnapshot=d;btMarginRows=d.rows.filter(x=>Number.isFinite(x[3])).map(x=>({date:x[0],value:x[3]}))}catch{btMarginRows=[]}btCtx=null;return btMarginRows})()}
async function btEnsureDividends(){await btEnsureMargin();if(btDivs)return btDivs;try{const r=await fetch('/api/dividends'),d=await r.json();btDivs=r.ok?d.events||{}:{}}catch{btDivs={}}return btDivs}
function btMacro(){
  // Average of the oil score (cheaper = higher) and the USD/TWD score (user's direction), on each bar's date.
  // Use the same FinMind Brent spot series as the card; never mix ETF/futures prices with spot prices.
  const oilList=oilDays;
  if(!oilList.length||!fx.length)return null;
  const series=(list,flip)=>{const out=new Map();for(let k=0;k<list.length;k++){const s=Math.max(0,k-240),w=list.slice(s,k);if(w.length<40)continue;const lo=Math.min(...w.map(x=>x.value)),hi=Math.max(...w.map(x=>x.value));if(hi>lo){const r=(list[k].value-lo)/(hi-lo);out.set(list[k].date,5*(1-(flip?1-r:r)))}}return out};
  const oil=series(oilList,false),cur=series(fx,settings.fxDirection==='high'),dates=bars.map(b=>b.date),pick=(m,keys)=>{let v=null,j=0;return d=>{while(j<keys.length&&keys[j]<=d){v=m.get(keys[j]);j++}return v}};
  const po=pick(oil,[...oil.keys()].sort()),pf=pick(cur,[...cur.keys()].sort());
  return dates.map(d=>{const a=po(d),b=pf(d);return a==null||b==null?NaN:(a+b)/2});
}
function btContext(){
  if(btCtx&&btCtx.bars===bars)return btCtx;
  const adj=historyMeta?.adjustments||[],div=(btDivs?.[selected]||[]).map(([date,v])=>{let f=1;for(const a of adj)if(date<a.date)f*=a.factor;return[date,v/f]});
  btCtx=E.prepare(bars,div,btMacro(),{marginDrop5:E.marginHistory(bars,btMarginRows)});btCtx.bars=bars;return btCtx;
}
// Custom dates use the first bar on or after the start and the last bar on or before the end.
function btEnd(){const b=settings.bt;if(b.period!=='custom'||!b.to)return bars.length-1;let j=-1;for(let i=0;i<bars.length;i++)if(bars[i].date<=b.to)j=i;return Math.max(0,j)}
function btStart(period){if(period==='all')return 0;if(period==='custom'){const b=settings.bt,i=b.from?bars.findIndex(x=>x.date>=b.from):0;return Math.max(0,Math.min(i<0?0:i,btEnd()-40))}const d=new Date(bars.at(-1).date+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-Number(period));const i=bars.findIndex(b=>b.date>=d.toISOString().slice(0,10));return i<0?0:i}
// With sync on, the backtest reads the observation settings above at run time, so the two never disagree.
const btTopRef=()=>({window:String(settings.window),anchorMode:settings.anchorMode||'wick',anchorCount:Number(settings.anchorCount)||5,method:settings.method==='fib'?'fib':'equal'});
const btRef=()=>settings.bt.sync?btTopRef():settings.bt.ref;
function btMonths(){if(!bars.length)return 0;const s=btStart(settings.bt.period),e=btEnd();let n=0;for(let i=s;i<=e;i++)if(i===s||bars[i].date.slice(0,7)!==bars[i-1].date.slice(0,7))n++;return n}
const btN=()=>settings.bt.dcaPeriods==='auto'?btMonths():settings.bt.dcaPeriods;
const btCfg=(over={})=>{const b=settings.bt,k=[2,3,4].includes(Number(b.entryTranches))?Number(b.entryTranches):0,params={...b.params};if(k&&b.strategy==='classic'){if(params.entry==='fib')params.levels=params.levels.slice(0,k);else params.adds=k-1}return{ref:{...btRef()},capital:b.capital,entryTranches:k,dcaPeriods:b.dcaPeriods,capitalMode:b.capitalMode,funding:JSON.parse(JSON.stringify(b.funding)),fee:b.fee,discount:b.discount,tax:b.tax,fill:b.fill==='close'?'close':'nextOpen',slipBps:b.fill==='close'?0:Number.isFinite(b.slipBps)?b.slipBps:5,parking:b.parking,drip:b.drip,wholeShares:b.wholeShares,strategy:b.strategy,params,...over}};

/* ---------- form ---------- */
function btFieldHtml([key,label,type,extra,visible],p){
  const hide=visible&&!visible(p)?' hidden':'';
  if(type==='select')return `<label class="bt-f${hide}">${label}<select data-k="${key}">${extra.map(([v,t])=>`<option value="${v}"${String(p[key])===v?' selected':''}>${t}</option>`).join('')}</select></label>`;
  if(type==='check')return `<label class="bt-check${hide}"><input type="checkbox" data-k="${key}"${p[key]?' checked':''}>${label}</label>`;
  if(type==='levels')return `<fieldset class="bt-levels${hide}"><legend>${label}</legend>${[0.236,0.382,0.5,0.618,0.786].map(v=>`<label><input type="checkbox" data-level="${v}"${p.levels.includes(v)?' checked':''}>${(v*100).toFixed(1).replace('.0','')}%</label>`).join('')}</fieldset>`;
  if(type==='array5')return `<fieldset class="bt-array${hide}"><legend>${label}</legend>${p[key].map((v,i)=>`<input type="number" data-arr="${key}" data-i="${i}" value="${v}" step="${extra.step}" min="0" max="10" aria-label="${label} 第 ${i+1} 項">`).join('')}</fieldset>`;
  return `<label class="bt-f${hide}">${label}<span class="bt-num"><input type="number" data-k="${key}" value="${p[key]}" min="${extra.min}" max="${extra.max}" step="${extra.step}" inputmode="decimal">${extra.unit?`<em>${extra.unit}</em>`:''}</span></label>`;
}
function btRenderParams(){
  const b=settings.bt,schema=(BT_SCHEMA[b.strategy]||[]).filter(f=>!(b.strategy==='classic'&&f[0]==='adds'));
  $('btParams').innerHTML=(settings.bt.migrationNotice?'<p class="migration-note" role="status">'+settings.bt.migrationNotice+'</p>':'')+(schema.length?schema.map(f=>btFieldHtml(f,b.params)).join(''):'')+`<p class="bt-hint">${BT_EXPLAIN[b.strategy]||''}</p>`;
  if(b.params.basePct>0){const label=$('btParams').querySelector('[data-k="core"]')?.closest('label');if(label)label.lastChild.textContent='保留核心底倉，不隨波段賣出'}
}
function btFillForm(){
  const b=settings.bt;
  if(!$('btWindow').options.length){$('btWindow').innerHTML=$('window').innerHTML;$('btAnchorMode').innerHTML=$('anchorMode').innerHTML;$('btMethod').innerHTML=$('method').innerHTML}
  $('btFamilies').innerHTML=E.FAMILIES.map(([id,name])=>`<button type="button" role="tab" data-family="${id}" aria-selected="${b.family===id}" class="${b.family===id?'active':''}">${name}</button>`).join('');
  $('btPresets').innerHTML=E.PRESETS.filter(p=>p.family===b.family).map(p=>`<button class="pill mini${b.preset===p.id?' on':''}" type="button" data-preset="${p.id}">${p.name}</button>`).join('');
  const set=(id,v)=>{$(id).value=String(v)};
  set('btCapital',b.capital);set('btCapitalMode',b.capitalMode);
  const months=btMonths();$('btDcaPeriods').options[0].textContent='整段回測期間：每月一期'+(months?'（共 '+months+' 期）':'');
  if(b.dcaPeriods!=='auto')customOption($('btDcaPeriods'),b.dcaPeriods,b.dcaPeriods+' 期（自訂）');set('btDcaPeriods',b.dcaPeriods);set('btPeriod',b.period);
  $('btCapChips').querySelectorAll('[data-cap]').forEach(x=>x.classList.toggle('on',Number(x.dataset.cap)===b.capital));
  $('btDates').classList.toggle('hidden',b.period!=='custom');if(b.period==='custom'&&bars.length){$('btFrom').value=b.from||bars[btStart('5')].date;$('btTo').value=b.to||bars.at(-1).date}
  const ref=btRef();$('btSync').checked=!!b.sync;
  customOption($('btWindow'),ref.window,ref.window+' 交易日（自訂）');set('btWindow',ref.window);set('btAnchorMode',ref.anchorMode);set('btAnchorCount',ref.anchorCount);set('btMethod',ref.method);
  for(const id of ['btWindow','btAnchorMode','btAnchorCount','btMethod'])$(id).disabled=!!b.sync;
  set('btFee',b.fee);set('btFill',b.fill==='close'?'close':'nextOpen');set('btSlip',Number.isFinite(b.slipBps)?b.slipBps:5);$('btSlip').disabled=b.fill==='close';set('btDiscount',b.discount);set('btTax',b.tax);set('btParking',b.parking);$('btDrip').checked=!!b.drip;$('btWhole').checked=!!b.wholeShares;
  const card=$('backtestCard');card.querySelectorAll('.bt-if-average').forEach(e=>e.classList.toggle('hidden',ref.anchorMode!=='average'));
  card.querySelectorAll('.bt-if-classic').forEach(e=>e.classList.toggle('hidden',b.strategy!=='classic'));
  btFundingForm();btRenderSplit();
  {const slip=b.fill==='close'?0:Number.isFinite(b.slipBps)?b.slipBps:5;$('btFriction').textContent=(b.fill==='close'?'T 日收盤（理想）':'T+1 開盤')+' · 買賣一次成本 '+fmt(b.fee*b.discount/100*2+b.tax+slip/100*2,4)+'%'}
  $('btMarkers').setAttribute('aria-pressed',String(!!b.markers));
  btRenderParams();
}
function btRenderSplit(){
  const b=settings.bt,p=b.params,C=b.capital,N=btN(),base=N?C/N:0,m=v=>fmt(Math.round(v),0)+' 元',monthly=b.capitalMode==='monthly';
  if(b.funding.type==='annual'){$('btSplit').textContent='各曆年金額可不同；每月基準＝該年預算÷12。只算所選月份，零元年度不入金。按年到帳會在該年首個所選交易日存入全年金額；期初到位則一次存入所選各年全年預算。策略可保留現金、減碼再運用；不強迫投完。';return}
  if(!N){$('btSplit').textContent='';return}
  let mine;
  if(b.strategy==='classic'){const k=p.entry==='fib'?Math.min(p.levels.length,Number(b.entryTranches)||p.levels.length):(Number(b.entryTranches)||1+p.adds);mine=monthly?'本策略分 '+k+' 等分：每份＝當時可用現金 ÷ 剩下份數':'本策略分 '+k+' 等分：每份 C ÷ '+k+' = <b>'+m(C/k)+'</b>（約為定期定額每期的 '+fmt(C/k/base,0)+' 倍）'+(p.core?'；第 1 份起點買進當底倉、不賣，其餘 '+(k-1)+' 份做回檔加碼與停利':'')}
  else if(b.strategy==='dca')mine='本策略就是定期定額';
  else if(['smart_dca_water','bias_tiered_dca','value_averaging'].includes(b.strategy))mine='本策略每月基準 '+m(base)+' × 當月倍數；少扣的錢存入蓄水池，低水位時再動用';
  else if(b.strategy==='tech_bb_rsi_dca')mine='本策略每月底倉 '+m(base*p.baseRatio)+'，超賣時加碼 '+m(base*p.dipMult);
  else if(b.strategy==='core_satellite')mine='核心每月 '+m(base*p.core/100)+' × 倍數；衛星資金 '+m(C*(100-p.core)/100)+' 分 2 批';
  else if(['rebalance_50_50','vol_targeting'].includes(b.strategy))mine='本策略依目標持股比例調整，不分期';
  else mine='本策略符合條件時投入全部可用資金';
  const plan=E.fundingInfo(btCfg());if(plan.tranches&&plan.supported&&b.strategy!=='classic')mine=b.strategy==='core_satellite'?'核心維持定投；衛星預算 '+m(C*(100-p.core)/100)+' 分 '+plan.tranches+' 批':'觸發加碼時，目標單筆 C ÷ '+plan.tranches+' = '+m(C/plan.tranches)+'；最多使用當時現金，賣出後可再運用';
  if(p.core&&p.basePct>0)mine='核心底倉 '+p.basePct+'% = '+m(C*p.basePct/100)+'；剩餘 '+(100-p.basePct)+'% 分 '+(Number(b.entryTranches)||1+p.adds)+' 批，每批目標 '+m(C*(1-p.basePct/100)/(Number(b.entryTranches)||1+p.adds))+'。僅使用已到位現金，底倉不隨波段賣出。';
  if(b.strategy==='core_satellite'&&p.upfrontCore)mine='已到位資金 '+p.core+'% 作核心，剩餘 '+(100-p.core)+'% 為衛星預算。';
  if(['trend_pullback_ma60','kd_oversold_golden_dca','margin_fear_contrarian'].includes(b.strategy))mine='已到位資金 '+p.core+'% 建立保留核心；剩餘 '+(100-p.core)+'% 分 '+p.parts+' 批，符合加碼條件時以當輪可用現金除剩餘批數投入。';
  $('btSplit').innerHTML=(monthly?'每月入金 C ÷ '+N+' = <b>'+m(base)+'</b>，定期定額當月全數買進':'定期定額：每月 C ÷ '+N+' = <b>'+m(base)+'</b>')+'<br>'+mine+'<br>買進持有：'+(monthly?'每次入金後買進，不預支未來資金':'第一天投入 C = '+m(C))+'。基準排程不是策略的強制持股比例。';
}
function btReadForm(){
  const b=settings.bt,num=(id,lo,hi,d)=>clampNum($(id).value,lo,hi,d);
  b.funding={...b.funding,recycleGains:$('btRecycleGains').checked,version:1,type:$('btBudgetType').value==='annual'?'annual':'total',arrival:$('btAnnualArrival').value,annualAmount:Math.round(num('btAnnualAmount',0,1e9,240000)),years:{...b.funding.years}};for(const el of $('btYearBudgets').querySelectorAll('[data-budget-year]'))b.funding.years[el.dataset.budgetYear]=Math.round(clampNum(el.value,0,1e9,0));
  b.capital=Math.round(num('btCapital',10000,1e9,1200000));b.capitalMode=$('btCapitalMode').value==='monthly'?'monthly':'pool';
  if($('btDcaPeriods').value==='auto')b.dcaPeriods='auto';else{const n=Math.round(Number($('btDcaPeriods').value));if(Number.isFinite(n)&&n>=1&&n<=240)b.dcaPeriods=n}
  b.period=['1','3','5','10','all','custom'].includes($('btPeriod').value)?$('btPeriod').value:'5';if(b.period==='custom'){b.from=$('btFrom').value||b.from;b.to=$('btTo').value||b.to}
  // Unticking sync starts from the observation settings, then the step-3 fields are the backtest's own.
  const wasSync=b.sync;b.sync=$('btSync').checked;
  if(!b.sync)b.ref=wasSync?btTopRef():{window:$('btWindow').value,anchorMode:$('btAnchorMode').value,anchorCount:Math.round(num('btAnchorCount',1,20,5)),method:$('btMethod').value==='fib'?'fib':'equal'};
  b.fee=num('btFee',0,1,0.1425);b.fill=$('btFill').value==='close'?'close':'nextOpen';b.slipBps=num('btSlip',0,100,5);b.discount=num('btDiscount',10,100,100);b.tax=num('btTax',0,1,0.1);b.parking=num('btParking',0,10,1.5);b.drip=$('btDrip').checked;b.wholeShares=$('btWhole').checked;
  $('btParams').querySelectorAll('[data-k]').forEach(el=>{const k=el.dataset.k,v=el.type==='checkbox'?el.checked:el.tagName==='SELECT'?el.value:Number(el.value);
    b.params[k]=el.tagName==='SELECT'&&/^-?\d+(\.\d+)?$/.test(v)?Number(v):(typeof v==='number'&&!Number.isFinite(v)?b.params[k]:v)});
  const levels=[...$('btParams').querySelectorAll('[data-level]:checked')].map(x=>Number(x.dataset.level)).sort((x,y)=>x-y);if($('btParams').querySelector('[data-level]'))b.params.levels=levels.length?levels:[0.382];
  $('btParams').querySelectorAll('[data-arr]').forEach(el=>{const v=Number(el.value);if(Number.isFinite(v))b.params[el.dataset.arr][Number(el.dataset.i)]=Math.max(0,Math.min(10,v))});
  if(['trend_pullback_ma60','kd_oversold_golden_dca','margin_fear_contrarian'].includes(b.strategy))for(const [key,,kind,bound] of BT_SCHEMA[b.strategy])if(kind==='num'){const raw=Number(b.params[key]),v=Math.max(bound.min,Math.min(bound.max,Number.isFinite(raw)?raw:E.PARAMS[b.strategy][key]));b.params[key]=['parts','cooldown'].includes(key)?Math.round(v):v}
  b.preset=E.PRESETS.some(p=>p.id===b.preset&&p.strategy===b.strategy&&JSON.stringify({...E.PARAMS[p.strategy],...p.params})===JSON.stringify(b.params))?b.preset:'custom';
  save();
}
function btSchedule(){clearTimeout(btTimer);btTimer=setTimeout(renderBacktest,160)}
$('btFamilies').addEventListener('click',e=>{const t=e.target.closest('[data-family]');if(!t)return;const p=E.PRESETS.find(x=>x.family===t.dataset.family);btApplyPreset(p.id)});
$('btPresets').addEventListener('click',e=>{const t=e.target.closest('[data-preset]');if(t)btApplyPreset(t.dataset.preset)});
function btApplyPreset(id,over){delete settings.bt.migrationNotice;const p=E.PRESETS.find(x=>x.id===id);if(!p)return;Object.assign(settings.bt,{family:p.family,preset:p.id,strategy:p.strategy,params:JSON.parse(JSON.stringify({...E.PARAMS[p.strategy],...p.params}))},over||{});save();btFillForm();renderBacktest()}
$('backtestCard').addEventListener('change',e=>{if(e.target.closest('.bt-steps,.bt-advanced')){btReadForm();btFillForm();btSchedule()}});
$('btRisk').addEventListener('click',e=>{const t=e.target.closest('[data-preset]');if(t)btApplyPreset(t.dataset.preset)});
$('btYearBudgets').addEventListener('input',e=>{const y=e.target.dataset.budgetYear;if(!y||!e.target.validity.valid)return;settings.bt.funding.years[y]=Math.round(Number(e.target.value)||0);save();btSchedule()});
$('btAnnualCopy').onclick=()=>{const f=settings.bt.funding;f.annualAmount=Math.round(clampNum($('btAnnualAmount').value,0,1e9,240000));for(const y of btYears())f.years[y]=f.annualAmount;save();btFillForm();btSchedule()};
$('btCapChips').addEventListener('click',e=>{const t=e.target.closest('[data-cap]');if(!t)return;$('btCapital').value=t.dataset.cap;btReadForm();btFillForm();btSchedule()});
// Observation settings changed above: a synced backtest follows.
function btFollowTop(){if(settings.bt.sync&&btResult&&JSON.stringify(btResult.cfg.ref)!==JSON.stringify(btRef())){btFillForm();btSchedule()}}
document.querySelector('.view-card').addEventListener('change',()=>setTimeout(btFollowTop,0));
$('btMarkers').addEventListener('click',()=>{settings.bt.markers=!settings.bt.markers;save();btFillForm();applyMarkers()});
$('btTradeFilter').addEventListener('click',e=>{const t=e.target.closest('[data-f]');if(!t)return;btTradeFilter=t.dataset.f;$('btTradeFilter').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===t));btRenderTrades()});

/* ---------- text ---------- */
const pctText=v=>v==null||!Number.isFinite(v)?'—':(v>0?'+':'')+fmt(v*100,1)+'%';
// Gaps are judged at the precision pctText shows (0.1 percentage point), so a +0.0% gap is never called a lead.
const shownPct=v=>Number.isFinite(v)?(Math.round(v*1000)/1000)||0:v;
// With money arriving in instalments and bought on arrival, 定期定額 and 買進持有 differ only by leftover cash
// interest and dividends; when they also read the same at the shown precision they are shown as one baseline.
const sameBaseline=r=>!!(r?.monthly&&r?.bh&&r?.dca)&&shownPct(r.bh.xirr)===shownPct(r.dca.xirr);
const money=v=>fmt(Math.round(v),0)+' 元';
function btSentence(cfg){
  const b=settings.bt,p=cfg.params,cash=(cfg.funding?.type==='annual'?'本段入金 ':'總預算 ')+fmt(cfg.capital/10000,1)+' 萬元';
  const win=cfg.ref.window==='all'?'全部歷史':'近 '+cfg.ref.window+' 日';
  const name=E.PRESETS.find(x=>x.id===b.preset)?.name||'自訂組合';
  let s=`「${name}」：${cash}，${BT_EXPLAIN[cfg.strategy]}`;
  if(cfg.strategy==='classic'){
    const adds=Number(cfg.entryTranches)?Number(cfg.entryTranches)-1:p.adds;const e={drop:'較區間高點跌 '+p.drop+'% 買'+(adds?'、每再跌 '+p.step+'% 加碼（最多 '+adds+' 次）':''),fib:'回檔到 '+p.levels.map(x=>(x*100).toFixed(1)+'%').join('、')+' 分批買',grade:'水位 '+p.buyGrade+' 分買'}[p.entry];
    const x={gain:'高於成本 '+p.rise+'% 全賣',high:p.rise?'突破前高 '+p.rise+'% 全賣':'回到前高全賣',grade:'水位回到 '+p.sellGrade+' 分全賣',fibext:'到 '+(p.fibExt*100).toFixed(1)+'% 擴展位全賣',trailing:'回到前高後改用移動停利（回落 '+p.trail+'%'+(p.atrMult?'或吊燈 '+p.atrMult+'×ATR':'')+'）',pyramid:'+'+p.rise+'% 或回到前高先賣 30%、138.2% 再賣 30%，底倉跌破 MA120 才出'}[p.exit];
    s=`「${name}」：${cash}，${e}；${x}${p.stop?'，停損 '+p.stop+'%':''}`;
  }
  if(['classic','smart_dca_water','core_satellite','macro_regime','margin_fear_contrarian'].includes(cfg.strategy)||cfg.params.minScore)s+=`（水位以${win}區間計算）`;
  return s+'。';
}

/* ---------- results ---------- */
function btAnimate(el,to,format){
  // Short count-up so changed numbers are noticed; skipped when the user prefers reduced motion.
  const from=Number(el.dataset.v),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;el.dataset.v=to;
  if(!Number.isFinite(from)||reduce||!Number.isFinite(to)){el.textContent=format(to);return}
  const t0=performance.now(),tick=t=>{const k=Math.min(1,(t-t0)/350),e=1-Math.pow(1-k,3);el.textContent=format(from+(to-from)*e);if(k<1)requestAnimationFrame(tick)};requestAnimationFrame(tick);
}
function btCharts_(){
  if(btCharts||!window.LightweightCharts)return btCharts;
  const L=window.LightweightCharts,opt={...chartOptions(),handleScroll:chartOptions().handleScroll,handleScale:chartOptions().handleScale};
  const top=L.createChart($('btEquity'),{...opt,timeScale:{...opt.timeScale,visible:false}}),under=L.createChart($('btUnder'),opt);
  const money=v=>fmt(v/10000,v>=1e6?0:1)+' 萬',pc=v=>fmt(v,0)+'%';
  btCharts={top,under,
    s:top.addLineSeries({color:'#0e7490',lineWidth:2.5,priceLineVisible:false,priceFormat:{type:'custom',formatter:money}}),
    d:top.addLineSeries({color:'#e6a23c',lineWidth:1.6,priceLineVisible:false,priceFormat:{type:'custom',formatter:money}}),
    h:top.addLineSeries({color:'#9aa5ab',lineWidth:1.4,priceLineVisible:false,priceFormat:{type:'custom',formatter:money}}),
    c:top.addLineSeries({color:'#7c8a90',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:money}}),
    e:under.addAreaSeries({priceScaleId:'left',lineColor:'rgba(25,167,170,.0)',topColor:'rgba(25,167,170,.18)',bottomColor:'rgba(25,167,170,.04)',priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:pc}}),
    sd:under.addLineSeries({color:'#0e7490',lineWidth:1.8,priceLineVisible:false,priceFormat:{type:'custom',formatter:pc}}),
    dd:under.addLineSeries({color:'#e6a23c',lineWidth:1.2,priceLineVisible:false,priceFormat:{type:'custom',formatter:pc}})};
  under.priceScale('left').applyOptions({visible:false,scaleMargins:{top:0,bottom:0}});
  // The two panes share one time axis.
  let syncing=false;for(const [a,b] of [[top,under],[under,top]])a.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(!r||syncing)return;syncing=true;b.timeScale().setVisibleLogicalRange(r);syncing=false});
  // A width change keeps the bar spacing, so a chart first drawn narrow (hidden card, phone, closed panel)
  // left most of the canvas empty once it widened. Remember the range the reader chose and re-apply it
  // after the width settles, so the same span always fills the full width.
  let view=null,width=$('btEquity').clientWidth;
  top.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r&&Math.abs($('btEquity').clientWidth-width)<2)view={from:r.from,to:r.to}});
  new ResizeObserver(()=>{const w=$('btEquity').clientWidth;if(w<2||Math.abs(w-width)<2)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const c of [top,under]){if(view)c.timeScale().setVisibleLogicalRange(view);else c.timeScale().fitContent()}width=$('btEquity').clientWidth}))}).observe($('btEquity'));
  btCharts.resetView=()=>{view=null;width=$('btEquity').clientWidth};
  return btCharts;
}
function btDrawCharts(r){
  const c=btCharts_();if(!c)return;
  c.s.setData(r.series.map(x=>({time:x.time,value:x.value})));c.d.setData(r.dca.series.map(x=>({time:x.time,value:x.value})));
  c.h.setData(r.bh.series.map(x=>({time:x.time,value:x.value})));c.c.setData(r.series.map(x=>({time:x.time,value:x.contributed})));
  c.sd.setData(r.series.map(x=>({time:x.time,value:x.dd*100})));c.dd.setData(r.dca.series.map(x=>({time:x.time,value:x.dd*100})));
  c.e.setData(r.series.map(x=>({time:x.time,value:x.exposure*100})));
  c.resetView();c.top.timeScale().fitContent();c.under.timeScale().fitContent();
}
function btNextReference(ctx,cfg,i){
  const history=ctx.bars.slice(0,i+1),next={n:history.length+1,bars:[...history,{...history.at(-1)}],refCache:new Map()},r=E.reference(next,cfg.ref.window,cfg.ref.anchorMode,cfg.ref.anchorCount);
  return{hi:r.hi.at(-1),lo:r.lo.at(-1)};
}
function btNow(r){
  const ctx=btCtx,i=Math.max(0,ctx.bars.findIndex(b=>b.date===r.end)),c=ctx.close[i],p=r.cfg.params,st=r.state,w=E.water(ctx,r.cfg.ref),g=w.grade[i],core=w.core[i],rows=[];
  const at=v=>'<b>'+fmt(v,2)+'</b>（較今日 '+pctText(v/c-1)+'）',hold=r.shares>0?'持有 '+fmt(r.shares,0)+' 股、現金 '+money(r.cash):'空手、現金 '+money(r.cash);
  rows.push(['目前',hold]);
  const s=r.cfg.strategy;
  if(s==='classic'){
    // Tomorrow's range includes today; use the engine's own reference for the next bar when it exists.
    const {hi,lo}=btNextReference(ctx,r.cfg,i);
    if(!st.buys){if(p.entry==='drop')rows.push(['下一個買點','收盤跌到 '+at(hi*(1-p.drop/100))]);if(p.entry==='fib')rows.push(['下一個買點','收盤跌到 '+at(hi-p.levels[0]*(hi-lo))]);if(p.entry==='grade')rows.push(['下一個買點','水位達 '+p.buyGrade+' 分（目前 '+(g||'—')+' 分）'])}
    else{const avg=r.cost/r.shares;rows.push(['平均成本',fmt(avg,2)+'，未實現 '+pctText(c/avg-1)]);
      if(p.exit==='gain')rows.push(['賣出點','收盤漲到 '+at(avg*(1+p.rise/100))]);if(p.exit==='trailing')rows.push(['移動停利',st.armed?'收盤跌到 '+at(st.peak*(1-p.trail/100)):'需先回到進場前高點 '+fmt(st.hi,2)+' 才啟動']);
      if(p.stop)rows.push(['停損點','收盤跌到 '+at(avg*(1-p.stop/100))])}
  }else if(s==='smart_dca_water'||s==='core_satellite'||s==='value_averaging'){if(st.reserve>0)rows.push(['蓄水池',money(st.reserve)])}
  else if(s==='bias_tiered_dca'&&ctx.ma60[i]>0){const b=(c/ctx.ma60[i]-1)*100;rows.push(['MA60 乖離',fmt(b,1)+'%'])}
  else if(s==='tech_bb_rsi_dca'){const pb=(c-ctx.bbLo[i])/(ctx.bbUp[i]-ctx.bbLo[i]);rows.push(['%B／RSI',fmt(pb,2)+'／'+fmt(ctx.rsi[i],0)+'（加碼門檻 %B<'+p.pbLow+' 且 RSI<'+p.rsiLow+'）'])}
  else if(s==='dual_momentum'&&i>=120){const mom=0.5*(c/ctx.close[i-60]-1)+0.5*(c/ctx.close[i-120]-1);rows.push(['動能',pctText(mom)+(c>ctx.ma120[i]?'，在 MA120 之上':'，在 MA120 之下')+(st.on?'（滿倉中）':'（持現金）')])}
  else if(s==='macro_regime'&&ctx.ma200[i]>0){rows.push(['市場體制',c>ctx.ma200[i]&&ctx.ma200[i]>ctx.ma200[i-20]?'多頭（MA200 之上且上彎）':'空頭或盤整']);if(ctx.macro)rows.push(['原油＋匯率分數',Number.isFinite(ctx.macro[i])?fmt(ctx.macro[i],1)+' 分':'—'])}
  else if(s==='vol_targeting'){rows.push(['近 20 日年化波動',fmt(ctx.sigma[i]*100,0)+'%  至  目標持股 '+fmt(Math.max(p.minW,Math.min(100,p.target/ctx.sigma[i])),0)+'%'])}
  else if(s==='bb_squeeze'){rows.push(['布林帶寬','近 120 日第 '+fmt(ctx.bwRank[i]*100,0)+' 百分位'+(r.shares?'；持有中，跌破 MA20 '+fmt(ctx.ma20[i],2)+' 賣出':'')])}
  else if(s==='ma_offset_flow'){const lf=E.lineFlow(ctx,p);rows.push(['分界線／籌碼方向',(Number.isFinite(lf.line[i])?fmt(lf.line[i],2):'—')+'／'+(Number.isFinite(lf.flow[i])?(lf.flow[i]>0?'+':'')+fmt(lf.flow[i],2):'—')])}
  else if(s==='rebalance_50_50'){const v=r.shares*c,eq=v+r.cash;rows.push(['持股比例',fmt(v/eq*100,0)+'%（目標 '+p.weight+'%，±'+p.band+'% 時再平衡）'])}
  return rows;
}
/* Today's action: the selected rule applied to today's close, in plain words with amounts. */
const BT_ZONE=['','高水位・偏貴','中段偏高','中段','偏低','低水位・便宜'];
function btAction(r){
  const ctx=btCtx,i=Math.max(0,ctx.bars.findIndex(b=>b.date===r.end)),c=ctx.close[i],cfg=r.cfg,p=cfg.params,s=cfg.strategy,st=r.state,B=r.funding?.periods.at(-1)?.budget??r.base,e=catalog.find(x=>x.code===selected);
  // Tomorrow's range includes today's bar, like the water card above.
  const {hi,lo}=btNextReference(ctx,cfg,i),sc=hi>lo?E.score((c-lo)/(hi-lo),cfg.ref.method):null,g=sc?.grade;
  // Close at or below which the tier is at least k (inverse of the score scale).
  const priceFor=k=>lo+(cfg.ref.method==='fib'?[0,.236,.382,.618,.786,1][6-k]:1-(k-1)/5)*(hi-lo);
  const amt=v=>'<b>'+money(v)+'</b>',px=v=>'<b>'+fmt(v,2)+' 元</b>';
  let main='';
  const first=ctx.bars.findIndex(b=>b.date===r.start),scheduled=ctx.bars.slice(first,i+1).filter((_,j)=>j===0||ctx.monthStart[first+j]).length;
  if(s==='buy_hold')main='依「買進持有」：已到位的資金依成交設定買進並持有，不因短期水位進出。未來入金只在原排程內投入。';
  else if(s==='regime_switch'){const on=ctx.ma20[i]>=ctx.ma60[i];main=ctx.ma60[i]>0?`MA20 ${on?'高於或等於':'低於'} MA60，目標持股 <b>${on?p.bull:p.bear}%</b>；體制改變、入金或偏離目標超過 10 個百分點時調整。`:'MA60 尚未成熟，等待足夠歷史資料。'}
  else if(s==='core_satellite'&&p.upfrontCore)main=`核心 ${p.core}% 隨已到位資金建立並保留；衛星現金約 ${amt(st.sat||0)}，達 ${p.satGrade} 分以上分批進場。回到進場前高後，自高點回落 ${p.trail}% 才結束衛星波段。`;
  else if(scheduled>=r.N&&['smart_dca_water','bias_tiered_dca'].includes(s)){const bias=ctx.ma60[i]>0?(c/ctx.ma60[i]-1)*100:null,t=p.tiers,m=s==='smart_dca_water'&&g?p.mult[g-1]:bias==null?0:bias>15?t[0]:bias>=-5?t[1]:bias>=-10?t[2]:bias>=-15?t[3]:t[4],reserve=st.reserve||0,extra=m>1?Math.min(r.cash,E.fundingInfo(cfg).tranches?cfg.capital/E.fundingInfo(cfg).tranches:Math.min(reserve,Math.max(B*(m-1),reserve*((s==='smart_dca_water'&&g>=5?p.draw:0)||0)/100))):0;main=`${r.N} 期排程已完成，不再增加定期扣款。依目前條件，下次月初${extra>0?'可由現有資金池加碼約 '+amt(extra):'不買進，等待加碼條件'}；以實際可用現金為上限。`;}
  else if((s==='smart_dca_water'||s==='core_satellite')&&g){
    const m=p.mult[g-1],k=s==='core_satellite'?p.core/100:1,b=B*k,next=g<4?4:null;
    main=m<1?`依「${btName()}」：水位 ${g} 分，本期扣款縮減為 <b>${m} 倍</b>＝${amt(b*m)}（基準 ${money(b)}），省下的 ${amt(b*(1-m))} 存入蓄水池。`
      :m===1?`依「${btName()}」：水位 ${g} 分，維持標準扣款 ${amt(b)}。`
      :(E.fundingInfo(cfg).tranches&&s==='smart_dca_water')?`依「${btName()}」：水位 ${g} 分，觸發加碼；單筆目標 ${amt(cfg.capital/E.fundingInfo(cfg).tranches)}，實際以當時現金為上限。`
      :`依「${btName()}」：水位 ${g} 分，低檔加碼 <b>${m} 倍</b>＝${amt(b*m)}，超出基準的部分由蓄水池支付（目前約 ${money(st.reserve||0)}）。`;
    if(next&&!(E.fundingInfo(cfg).tranches&&s==='smart_dca_water'))main+=`收盤跌到 ${px(priceFor(next))} 以下（水位 ${next} 分，較今日 ${pctText(priceFor(next)/c-1)}）時，加碼到 ${p.mult[next-1]} 倍。`;
  }else if(s==='bias_tiered_dca'&&ctx.ma60[i]>0){
    const b=(c/ctx.ma60[i]-1)*100,t=p.tiers,m=b>15?t[0]:b>=-5?t[1]:b>=-10?t[2]:b>=-15?t[3]:t[4];
    main=E.fundingInfo(cfg).tranches&&m>1?`依「${btName()}」：MA60 乖離 ${fmt(b,1)}%，加碼目標 ${amt(cfg.capital/E.fundingInfo(cfg).tranches)}，以當時現金為上限。`:`依「${btName()}」：MA60 乖離 ${fmt(b,1)}%，本期扣款 <b>${m} 倍</b>＝${amt(B*m)}${m<1?'，省下的錢存入蓄水池':''}。`;
  }else if(s==='value_averaging'){
    const g2=p.growth/100,mm=(st.m||0)+1,k=Math.min(r.N,mm),target=(g2>0?B*((Math.pow(1+g2,k)-1)/g2):B*k)*Math.pow(1+g2,mm-k),cur=r.shares*c,gap=target-cur;
    main=gap>0?`依「定期定值」：下期目標市值 ${money(target)}，目前持股 ${money(cur)}，應補 ${amt(Math.min(gap,B*p.cap))}${gap>B*p.cap?'（已達單月上限 '+p.cap+' 倍）':''}。`
      :`依「定期定值」：持股市值已超過目標 ${amt(-gap)}，${p.allowSell?'可賣出超出部分轉入蓄水池':'本期不扣款'}。`;
  }else if(s==='dca')main=scheduled>=r.N?`原排程 ${r.N} 期已完成，不再追加扣款；既有持股與剩餘現金繼續留在帳戶。`:`依「定期定額」：排程內每月扣款 ${amt(B)}，尚餘 ${r.N-scheduled} 期，不看水位。`;
  else if(s==='ma_offset_flow'){
    const lf=E.lineFlow(ctx,p),L=lf.line[i],F=lf.flow[i];
    if(Number.isFinite(L)&&Number.isFinite(F)){const below=c<L,buy=below&&F>0,sell=!below&&F<0;
      main=`依「${p.ma}MA＋${p.offset} 分界線與籌碼方向」：收盤 ${px(c)} ${below?'低於':'高於'}分界線 ${px(L)}，籌碼方向 <b>${F>0?'+':''}${fmt(F,2)}</b>（${F>0?'買盤':'賣盤'}較強）。`+
        (r.shares?(sell?'符合出場條件，持股應<b>全部賣出</b>。':'持有中，等收盤高於分界線且籌碼方向轉負才出場。'):(buy?`符合進場條件，可投入約 ${amt(r.cash)}。`:'目前空手，等收盤低於分界線且籌碼方向轉正。'))}
  }
  else if(s==='tech_bb_rsi_dca')main=`依「${btName()}」：每月底倉 ${amt(B*p.baseRatio)}；%B 低於 ${p.pbLow} 且 RSI 低於 ${p.rsiLow} 時加碼 ${amt(E.fundingInfo(cfg).tranches?cfg.capital/E.fundingInfo(cfg).tranches:B*p.dipMult)}，以當時現金為上限。`;
  else if(['trend_pullback_ma60','kd_oversold_golden_dca','margin_fear_contrarian'].includes(s)){const used=st.batches||0,left=Math.max(0,p.parts-used);main=`核心保留；本輪已用 ${used}／${p.parts} 批，區間末現金 ${amt(r.cash)}。`+(left?`下一次條件成立且間隔滿 ${p.cooldown} 交易日時，加碼目標約 ${amt(r.cash/left)}，仍以實際可用現金為上限。`:'本輪加碼池已用完；不再新增本金。')+(s==='kd_oversold_golden_dca'?`高檔死叉只調節 ${p.trim}% 已獲利衛星股數。`:'')+(s==='margin_fear_contrarian'&&!Number.isFinite(ctx.marginDrop5[i])?'末日融資資料不足，不能確認加碼條件。':'')}
  else if(s==='classic'){
    const k=p.entry==='fib'?p.levels.length:1+p.adds;
    if(!st.buys){const at=p.entry==='drop'?hi*(1-p.drop/100):p.entry==='fib'?hi-p.levels[0]*(hi-lo):g>=p.buyGrade?c:priceFor(p.buyGrade);
      main=`依「${btName()}」：${st.coreShares>0?'核心底倉保留，波段部位等待進場':'目前空手'}。收盤跌到 ${px(at)}（較今日 ${pctText(at/c-1)}）時買進第一批，約 ${amt(r.cash/k)}。`}
    else main=`依「${btName()}」：持有中，已買 ${st.buys} 批，平均成本 ${fmt(r.cost/r.shares,2)} 元（未實現 ${pctText(c*r.shares/r.cost-1)}）。`;
  }
  const rows=btNow(r).filter(x=>!['下一個買點','平均成本'].includes(x[0]));
  return `<h4>區間末日試算</h4><p class="bt-act-meta">${selected} ${e?.name||''}｜${r.end} 收盤 ${fmt(c,2)}｜水位 ${sc?fmt(sc.core,1):'—'} / 5${g?'（'+BT_ZONE[g]+'）':''}</p>`+
    (main?`<p class="bt-act-main">${main}</p>`:'')+(rows.length?'<dl>'+rows.map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join('')+'</dl>':'')+
    '<p class="bt-act-note">依區間末日收盤與所選規則試算；觸發條件不代表可在該價成交。</p>';
}
const btName=()=>E.PRESETS.find(x=>x.id===settings.bt.preset)?.name||'自訂組合';
function btRenderTrades(){
  const r=btResult;if(!r)return;
  const list=r.trades.filter(t=>btTradeFilter==='all'||(btTradeFilter==='dca'?['dca','drip'].includes(t.kind):t.type===btTradeFilter&&!['dca','drip'].includes(t.kind)));
  const maxAmount=Math.max(1,...list.map(t=>Math.abs(t.amount))),maxRet=Math.max(0.01,...list.filter(t=>t.ret!=null).map(t=>Math.abs(t.ret))),cls=v=>v>0?'up':v<0?'down':'';
  const rows=list.slice(-400).reverse();
  $('btTradesTitle').textContent='交易明細（'+r.trades.length+' 筆）';
  $('btTrades').innerHTML=rows.length?`<table><thead><tr><th>日期</th><th>動作</th><th>價格</th><th>股數</th><th>金額</th><th>報酬</th><th>原因</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${t.date}</td><td class="${t.type}">${t.type==='buy'?(t.kind==='dca'?'定投':t.kind==='drip'?'配息再投入':'買進'):'賣出'}</td><td>${fmt(t.price,2)}</td><td>${fmt(t.shares,0)}</td><td class="amount-cell"><span class="bt-bar" style="--w:${Math.abs(t.amount)/maxAmount*100}%"></span><span>${fmt(t.amount,0)}</span></td><td class="${cls(t.ret)}">${t.ret!=null?`<span class="bt-bar" style="--w:${Math.round(Math.abs(t.ret)/maxRet*100)}%"></span>${pctText(t.ret)}`:''}</td><td>${t.reason}</td></tr>`).join('')}</tbody></table>${list.length>400?'<p class="small">只顯示最近 400 筆；完整明細請下載 CSV。</p>':''}`:'<p class="small">沒有符合的交易。</p>';
}
/* Q03: the same rules under the other fill model, so the cost of waiting for the next open (plus slippage) is visible.
   T+1 open is the default; the comparison is the ideal same-day close without slippage. */
function btRenderFill(ctx,cfg,start,end,r){
  let box=$('btFillCompare');if(!box){box=document.createElement('div');box.id='btFillCompare';box.className='bt-fill-compare';$('btKpis').after(box)}
  const next=r.fill==='nextOpen',alt=E.run(ctx,next?{...cfg,fill:'close',slipBps:0}:{...cfg,fill:'nextOpen',slipBps:cfg.slipBps||5},start,end);
  const rows=next?[['T+1 開盤＋滑價 '+fmt(r.slipBps,0)+' bps（目前）',r],['T 日收盤（理想，無滑價）',alt]]:[['T 日收盤（目前，理想無滑價）',r],['T+1 開盤＋滑價 '+fmt(alt.slipBps,0)+' bps',alt]];
  const real=next?r:alt,ideal=next?alt:r,dx=btAnnual(real)-btAnnual(ideal),de=real.equity-ideal.equity,span=Math.max(.01,...rows.map(([,x])=>Math.abs(btAnnual(x)||0)));
  box.innerHTML='<div class="bt-fill-head"><p class="kicker teal">成交模型對照</p><b class="bt-fill-gap '+(dx<-5e-5?'down':dx>5e-5?'up':'')+'">T+1 對理想 '+(Math.abs(dx)<5e-5?'0.00':(dx>0?'+':'−')+fmt(Math.abs(dx)*100,2))+' 個百分點</b></div><p class="small bt-fill-sub">訊號都在 T 日收盤確認；差別只在成交價與時點。</p>'+rows.map(([label,x])=>{const v=btAnnual(x)||0;return'<div class="bt-fill-row"><span>'+label+'</span><i class="bt-fill-bar"><i class="'+(v>=0?'up-bg':'down-bg')+'" style="width:'+(Math.abs(v)/span*100).toFixed(1)+'%"></i></i><b class="'+(v>0?'up':v<0?'down':'')+'">'+pctText(btAnnual(x))+'</b></div>'}).join('')+
    '<p class="small">延遲到 T+1 開盤並計入滑價，年化'+(Math.abs(dx)<5e-5?'幾乎不變':(dx<0?'少 ':'多 ')+fmt(Math.abs(dx)*100,2)+' 個百分點')+'，期末'+(de<0?'少 ':'多 ')+money(Math.abs(de))+'。真實模型的摩擦成本：手續費與稅 '+money(real.fees)+'＋滑價 '+money(real.slippage)+'，合計佔本金 '+fmt(real.friction*100,2)+'%'+(real.unfilled?'；期末最後一天的 '+real.unfilled+' 筆訊號因無下一個開盤而未成交':'')+'。</p>';
}
const btAnnual=(r,monthly=r.monthly)=>monthly?r.xirr:r.cagr;
function renderBacktest(){
  btBarsRef=bars;
  if(!bars.length||bars.length<60){$('btKpis').innerHTML='<p class="small">需要至少 60 個交易日才能回測。</p>';btResult=null;applyMarkers();return}
  if(!btDivs){btEnsureDividends().then(()=>{btCtx=null;renderBacktest()});}
  const seq=++btSeq,ctx=btContext(),cfg=btCfg(),start=btStart(settings.bt.period),end=btEnd();let r;try{r=E.run(ctx,cfg,start,end)}catch(e){$('btSummary').textContent=e.message;$('btFundingSummary').textContent='請調整預算後重新回測。';btResult=null;$('btKpis').replaceChildren();return}btResult=r;btFundingResult(r);
  $('btSummary').textContent=btSentence(r.cfg);
  // Verdict: name the metric; never call it a win when the return is behind.
  const dx=shownPct(btAnnual(r)-btAnnual(r.dca,r.monthly)),dm=r.dca.mdd-r.mdd,calS=r.calmar,calD=r.dca.mdd>0?r.dca.cagr/r.dca.mdd:null;
  $('btVerdict').innerHTML=r.cfg.strategy==='dca'?'<span class="bt-tag">這就是定期定額本身，可作為其他策略的比較基準。</span>':
    (dx===0?`<span class="bt-tag">年化報酬與定期定額相同（差距不到 0.1 個百分點）</span>`:dx>0?`<span class="bt-tag win"> 年化報酬勝過定期定額 ${fmt(dx*100,1)} 個百分點</span>`:`<span class="bt-tag lose">年化報酬落後定期定額 ${fmt(-dx*100,1)} 個百分點</span>`)+
    (dm>0.005?`<span class="bt-tag win">最大回落少 ${fmt(dm*100,1)} 個百分點</span>`:'')+(calS!=null&&calD!=null&&calS>calD?`<span class="bt-tag win">風險調整後（Calmar）較佳：${fmt(calS,2)} vs ${fmt(calD,2)}</span>`:'')+
    // Mostly-cash strategies: the pot's return understates what the invested part earned; say both.
    (r.cfg.strategy!=='dca'&&r.utilization<0.5?`<span class="bt-tag shield">資金參與偏低：期間平均持股 ${fmt(r.utilization*100,0)}%。請展開「資金運用與分批試算」查看空手時間與進場金額。</span>`:'');
  // Same three lines on every benchmark card: annualised (XIRR) big; total return and final value small.
  const wan=v=>fmt(v/10000,v>=1e7?0:1)+' 萬',sub=x=>'總報酬 '+pctText(x.ret)+' · 期末 '+wan(x.equity);
  const k=[['策略績效',btAnnual(r),v=>pctText(v),sub(r)],['定期定額基準',btAnnual(r.dca,r.monthly),v=>pctText(v),sub(r.dca)],['買進持有基準',btAnnual(r.bh,r.funding?r.monthly:false),v=>pctText(v),sub(r.bh)],['最大回落',r.mdd,v=>'−'+fmt(v*100,1)+'%','定期定額 −'+fmt(r.dca.mdd*100,1)+'%']];
  const small=[['期間',r.start+' 至 '+r.end],['資金基數',money(r.contributed)+(r.monthly?'（每月入金）':'')],['期末現金',money(r.cash)],['Calmar',r.calmar!=null?fmt(r.calmar,2):'—'],['Sharpe',r.sharpe!=null?fmt(r.sharpe,2):'—'],['平均持股比例',fmt(r.utilization*100,0)+'%'],['股利入帳',money(r.dividends)],['停泊利息',money(r.interest)],['手續費與稅',money(r.fees)],['滑價成本',money(r.slippage||0)],['摩擦成本合計',fmt((r.friction||0)*100,2)+'% 本金'],['基準手續費','定額 '+money(r.dca.fees)+'／持有 '+money(r.bh.fees)],['交易',r.buys+' 買／'+r.sells+' 賣'+(r.sells?'（勝率 '+fmt(r.wins/r.sells*100,0)+'%）':'')]];
  if(!$('btKpis').querySelector('.bt-big'))$('btKpis').innerHTML=`<p class="bt-kpi-note">大字＝年化報酬（XIRR，依實際入金日計算）</p><div class="bt-big">${k.map((_,j)=>`<div><small></small><b data-k="${j}"></b><span></span></div>`).join('')}</div><div class="bt-small"></div>`;
  $('btKpis').querySelectorAll('.bt-big>div').forEach((el,j)=>{const [label,v,f,sub]=k[j];el.querySelector('small').textContent=label;el.querySelector('span').textContent=sub;const b=el.querySelector('b');b.className=j<3?(v>0?'up':v<0?'down':''):'';btAnimate(b,v,f)});
  $('btKpis').querySelector('.bt-small').innerHTML=small.map(([a,b])=>`<span><small>${a}</small>${b}</span>`).join('');
  btRenderFill(ctx,cfg,start,end,r);
  btDrawCharts(r);
  $('btNow').innerHTML=btAction(r);
  // Leveraged and inverse ETFs decay in sideways markets; averaging down without a stop is the risky combination.
  const risk=etfRisk(selected),dip=['dca','smart_dca_water','value_averaging','bias_tiered_dca','tech_bb_rsi_dca','core_satellite'].includes(cfg.strategy)||cfg.strategy==='classic'&&!cfg.params.stop;
  $('btRisk').innerHTML=risk&&(risk.kind==='inverse'||risk.kind==='lev'&&dip)?`<div class="bt-risk-box ${risk.kind}"><p><b>${risk.tag}</b>${risk.warn}</p><span><button class="pill mini" type="button" data-preset="coreSat">查看核心衛星</button><button class="pill mini" type="button" data-preset="regime">查看體制切換</button></span></div>`:'';
  btRenderTrades();
  if(cfg.strategy==='classic')btRenderGrid(ctx,cfg,start,end);
  if($('btRollingBox').open)btRenderRolling();else $('btRolling').innerHTML='';
  applyMarkers();
}
function btRenderGrid(ctx,cfg,start,end){
  const p=cfg.params;let rows,cols,rowLabel,colLabel,make,cur;
  if(p.entry==='drop'){rows=[8,10,15,20,25];rowLabel='下跌';make=a=>({drop:a});cur=p.drop}else if(p.entry==='fib'){rows=[0.236,0.382,0.5,0.618];rowLabel='第一個位階';make=a=>({levels:[a,...p.levels.filter(x=>x>a)]});cur=p.levels[0]}else{rows=[5,4,3];rowLabel='買進分數';make=a=>({buyGrade:a});cur=p.buyGrade}
  if(['gain','high','pyramid'].includes(p.exit)){cols=[0,10,20,30,50].filter(x=>p.exit!=='gain'||x>0).map(x=>({rise:x}));colLabel='幅度'}else if(p.exit==='trailing'){cols=[6,8,10,15,20].map(x=>({trail:x}));colLabel='回落'}else if(p.exit==='grade'){cols=[{sellGrade:1},{sellGrade:2}];colLabel='賣出分數'}else{cols=[{fibExt:1},{fibExt:1.272},{fibExt:1.618}];colLabel='擴展位'}
  const curCol=JSON.stringify(Object.fromEntries(Object.keys(cols[0]).map(x=>[x,p[x]])));
  const rt=a=>p.entry==='drop'?a+'%':p.entry==='fib'?(a*100).toFixed(1)+'%':a+' 分',ct=b=>{const [kk,v]=Object.entries(b)[0];return kk==='fibExt'?(v*100).toFixed(1)+'%':kk==='sellGrade'?v+' 分':v+'%'};
  let html=`<table><thead><tr><th>${rowLabel} ＼ ${colLabel}</th>${cols.map(b=>`<th>${ct(b)}</th>`).join('')}</tr></thead><tbody>`;
  for(const a of rows){html+=`<tr><th>${rt(a)}</th>`;for(const b of cols){const x=E.run(ctx,{...cfg,params:{...p,...make(a),...b}},start,end),isCur=a===cur&&JSON.stringify(b)===curCol,t=Math.max(-1,Math.min(1,x.xirr||0));
    html+=`<td class="${x.xirr>0?'up':x.xirr<0?'down':''}${isCur?' current':''}" style="--heat:${Math.abs(t)}" title="總報酬 ${pctText(x.ret)}">${x.buys?pctText(btAnnual(x)):'未觸發'}</td>`}html+='</tr>'}
  $('btGrid').innerHTML=html+'</tbody></table><p class="small">表中為年化報酬；框起來的是目前設定。</p>';
}
function btRenderRolling(){
  const ctx=btContext(),cfg=btCfg(),out=[];
  for(const years of [1,3]){
    const len=Math.round(years*245);let win=0,winCal=0,total=0;
    for(let i=0;i+len<ctx.n;i++){if(!ctx.monthStart[i])continue;const r=E.run(ctx,cfg,i,i+len);total++;if(r.xirr>r.dca.xirr)win++;const cd=r.dca.mdd>0?r.dca.cagr/r.dca.mdd:0;if((r.calmar||0)>cd)winCal++}
    out.push(total?`<div class="bt-roll"><b>持有 ${years} 年</b><span>共 ${total} 個起點</span><span>年化報酬勝過定期定額：<b>${fmt(win/total*100,0)}%</b></span><span>Calmar 勝過：<b>${fmt(winCal/total*100,0)}%</b></span></div>`:`<p class="small">資料不足 ${years} 年。</p>`);
  }
  $('btRolling').innerHTML=out.join('')+'<p class="small">每個月的第一個交易日都當成一次起點，用同樣的資金基數各跑一次。</p>';
}
$('btRollingBox').addEventListener('toggle',()=>{if($('btRollingBox').open&&btResult)btRenderRolling()});
$('btCsv').addEventListener('click',()=>{
  if(!btResult)return;
  const rows=[['日期','類型','價格','股數','金額','損益','報酬率','原因']].concat(btResult.trades.map(t=>[t.date,t.type==='buy'?(t.kind==='dca'?'定投':t.kind==='drip'?'配息再投入':'買進'):'賣出',t.price,Math.round(t.shares*1000)/1000,Math.round(t.amount),t.pnl!=null?Math.round(t.pnl):'',t.ret!=null?(t.ret*100).toFixed(2)+'%':'',t.reason]));
  const csv='﻿'+rows.map(r=>r.map(x=>/[",\n]/.test(String(x))?'"'+String(x).replace(/"/g,'""')+'"':x).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=selected+'-回測交易明細.csv';document.body.append(a);a.click();a.remove();
});

/* ---------- optimizer: every preset, three water-level windows, ranked three ways ---------- */
$('btOptimize').addEventListener('click',async()=>{
  if(!isMember){$('accountTop').click();return}if(!bars.length)return;
  await btEnsureDividends();const ctx=btContext(),start=btStart(settings.bt.period),end=btEnd(),base=btCfg(),code=selected,candidates=[];
  for(const p of E.PRESETS){const usesWater=['classic','smart_dca_water','core_satellite','macro_regime','margin_fear_contrarian'].includes(p.strategy);for(const w of usesWater?[...new Set(['60','120','240',base.ref.window])]:[base.ref.window])candidates.push({p,w,usesWater,cfg:{...base,strategy:p.strategy,params:JSON.parse(JSON.stringify({...E.PARAMS[p.strategy],...p.params})),ref:{...base.ref,window:w}}})}
  $('btOptSheet').classList.remove('hidden');document.body.classList.add('searching');$('btOptBody').innerHTML='<p class="small">正在背景試算，其他介面仍可操作。</p>';$('btOptimize').disabled=true;
  const key=JSON.stringify([code,ctx.bars,start,end,base,Array.from(ctx.div),Array.from(ctx.macro||[])]);
  try{
    const out=await OptimizerRunner.run(key,ctx,candidates,start,end,(done,total)=>{$('btOptNote').textContent=`背景試算 ${done} / ${total} 組`});
    if(selected!==code||bars!==ctx.bars){$('btOptBody').textContent='資料或標的已更新，請重新試算。';return}
    const {rows,dcaRef}=out,calD=dcaRef.mdd>0?dcaRef.cagr/dcaRef.mdd:0,board=(title,key,dir,fmtv)=>{const seen=new Set(),list=[...rows].filter(x=>x.p.strategy!=='dca').sort((a,b)=>dir*((b.r[key]??-9)-(a.r[key]??-9))).filter(x=>!seen.has(x.p.id)&&seen.add(x.p.id)).slice(0,3);
      return `<section class="bt-board"><h4>${title}</h4>${list.map((x,j)=>`<button class="bt-rank" type="button" data-preset="${x.p.id}" data-window="${x.w}"><b>${j+1}</b><span>${x.p.name}${x.usesWater?'（'+x.w+' 日）':''}</span><em>${fmtv(x.r)}</em></button>`).join('')}</section>`};
    $('btOptNote').textContent=`${code}，${bars[start].date} 至 ${bars[end].date}，共試算 ${rows.length} 組。定期定額：年化 ${pctText(dcaRef.monthly?dcaRef.xirr:dcaRef.cagr)}、最大回落 ${fmt(dcaRef.mdd*100,1)}%、Calmar ${fmt(calD,2)}。${out.executor==='memory'?'相同條件快取':out.executor==='worker'?'背景運算':'分批運算'} ${fmt(out.elapsedMs,0)} ms。`;
    $('btOptBody').dataset.executor=out.executor;$('btOptBody').dataset.elapsedMs=out.elapsedMs.toFixed(2);
    $('btOptBody').innerHTML='<div class="bt-boards">'+board('年化報酬最高','annual',1,r=>pctText(r.annual))+board('Calmar 最高','calmar',1,r=>fmt(r.calmar,2))+board('最大回落最小','mdd',-1,r=>fmt(r.mdd*100,1)+'%，年化 '+pctText(r.annual))+'</div><p class="small">這是本區間的歷史排行，不代表未來最佳策略。點選結果可帶入；仍需另以較晚區間驗證。</p>';
  }catch(e){if(e.name!=='AbortError')$('btOptBody').textContent='本次試算未完成，請重試。'}finally{$('btOptimize').disabled=false}
});
$('btOptBody').addEventListener('click',e=>{const t=e.target.closest('.bt-rank');if(!t)return;btCloseSheet();const cur=btRef(),ref={...cur,window:t.dataset.window};btApplyPreset(t.dataset.preset,ref.window===cur.window?{ref}:{ref,sync:false});$('backtestCard').scrollIntoView({behavior:'smooth',block:'start'})});
function btCloseSheet(){OptimizerRunner.cancel();$('btOptSheet').classList.add('hidden');document.body.classList.remove('searching')}
$('btOptClose').addEventListener('click',btCloseSheet);$('btOptSheet').addEventListener('click',e=>{if(e.target===$('btOptSheet'))btCloseSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('btOptSheet').classList.contains('hidden'))btCloseSheet()});

/* ---------- markers on the K-line chart ---------- */
function applyMarkers(){
  if(!lwc)return;
  if(!isMember||!lwc.data.length){lwc.s.candle.setMarkers([]);return}
  const research=(window.chaoweiResearchMarkers||[]).filter(x=>lwc.data.some(b=>b.date===x.time));
  if(!btResult||!settings.bt.markers){lwc.s.candle.setMarkers(research);return}
  const dates=lwc.data.map(b=>b.date),markers=[];
  // Routine monthly buys and dividend reinvestment would bury the chart; show decisions only.
  for(const t of btResult.trades){
    if(['dca','drip','bench'].includes(t.kind))continue;
    let lo=0,hi=dates.length-1,at=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(dates[mid]<=t.date){at=mid;lo=mid+1}else hi=mid-1}
    if(at<0)continue;
    markers.push(t.type==='buy'?{time:dates[at],position:'belowBar',color:RISE,shape:'arrowUp',text:'B'}:{time:dates[at],position:'aboveBar',color:FALL,shape:'arrowDown',text:'S'});
  }
  markers.push(...research);
  markers.sort((a,b)=>a.time.localeCompare(b.time));
  lwc.s.candle.setMarkers(markers);
}
const btDrawChart=drawChart;
drawChart=function(keepView){btDrawChart(keepView);if(bars.length&&btBarsRef!==bars){btCtx=null;btFillForm();renderBacktest()}else{applyMarkers();btFollowTop()}};
const btPrefs=prefs;
prefs=function(){btPrefs();if(btCharts){const o={...chartOptions(),handleScroll:chartOptions().handleScroll,handleScale:chartOptions().handleScale};btCharts.top.applyOptions({...o,timeScale:{...o.timeScale,visible:false}});btCharts.under.applyOptions(o)}};
// Brent / FX arrive after the first render; the macro filter needs them.
const btLoadLiveHook=applyLive;applyLive=function(){btLoadLiveHook();if(btCtx&&!btCtx.macro&&brent.length&&fx.length){btCtx=null;btSchedule()}};
btEnsureDividends();btFillForm();

/* ---------- Three-step introduction, replayable from the view bar or display menu ---------- */
const TOUR_STEPS=[
 ['#matrixView','1. 從總覽選 ETF','首頁是候選 ETF 的盤後總覽。點卡片可進入觀測；主動型與被動型可以分開看，資料日期列在卡片內。'],
 ['#compactTicker','2. 搜尋與換檔','用名稱、代號或追蹤指數搜尋，也可按鍵盤 /。選取後，價格、技術面與回測會一起切換；關閉搜尋可回到原頁。'],
 ['.water-copy','3. 先認識分數','水位是歷史價格位置，分數為 0–5。預設價格低分高，也可反向；它不是勝率。上方可選觀察天數、黃金分割或等距刻度。'],
 ['#chartCard','4. 操作價格與技術圖','滾輪縮放、拖曳平移，按貼合畫面恢復。日、週、月 K 可切換；均線、布林、MACD 等需自行開啟，量測工具可查看漲跌幅與天數。'],
 ['#market','5. 補看市場背景','市場刻度獨立成頁。每張卡可展開計分方向、範圍與來源日期；盤後或週資料不會因五分鐘檢查就變成即時行情。'],
 ['.board-palette','6. 拖拉自己的條件','策略白板預設空白。從上方加入 ETF、條件、判斷、配置與組合卡；拖標題移動，連右側圓點到下一張的左側圓點。也能用步驟清單與下方管理連線。'],
 ['.board-run-panel','7. 檢查組合與預算','每檔 ETF 的條件分別接配置卡，再合併到組合卡。預算合計不可超過 100%；選日期後登入回測，和同期定額比較。範例只是可修改的研究起點。'],
 ['#trainingLab','8. 固定訓練，再驗證','登入後選訓練與驗證日期。系統只用訓練期挑一次規則，再鎖定到後段；可查看鎖定參數，也可把驗證帶到回測圖。'],
 ['#subperiodControls','9. 對照歷史水位與交易','在回測選擇日期，切換資產、持股現金或回撤圖；展開每日水位與交易對照。各圖共用時間軸與游標；紅點買、綠點賣，資料不足時留白。'],
 ['#technicalGuide','10. 需要時再查說明','方法說明頁保留公式、價格口徑與技術指標解釋。帳號與外觀集中於右上角人像圖示，可調字級、深淺色，並隨時重播教學。']
];
let tourIndex=-1;
function tourEls(){
  let shade=$('tourShade');
  if(!shade){
    shade=document.createElement('div');shade.id='tourShade';shade.className='tour-shade hidden';
    shade.innerHTML='<div class="tour-spot" id="tourSpot"></div><div class="tour-card card" id="tourCard" role="dialog" aria-modal="true" aria-labelledby="tourTitle"><small id="tourCount"></small><h4 id="tourTitle"></h4><p id="tourText"></p><div class="tour-actions"><button class="pill mini" type="button" id="tourSkip">略過教學</button><span><button class="pill mini" type="button" id="tourPrev">上一步</button><button class="action tour-next" type="button" id="tourNext">下一步</button></span></div></div>';
    document.body.append(shade);
    $('tourSkip').addEventListener('click',()=>endTour());
    $('tourPrev').addEventListener('click',()=>showTourStep(tourIndex-1));
    $('tourNext').addEventListener('click',()=>tourIndex>=TOUR_STEPS.length-1?endTour():showTourStep(tourIndex+1));
    document.addEventListener('keydown',e=>{if(tourIndex<0)return;if(e.key==='Escape')endTour();if(e.key==='ArrowRight')$('tourNext').click();if(e.key==='ArrowLeft'&&tourIndex>0)showTourStep(tourIndex-1);if(e.key==='Tab'){const buttons=[...$('tourCard').querySelectorAll('button:not([disabled])')],first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
    window.addEventListener('resize',()=>{if(tourIndex>=0)placeTour()});
    window.addEventListener('scroll',()=>{if(tourIndex>=0)placeTour()},{passive:true});
  }
  return shade;
}
function placeTour(){
  const step=TOUR_STEPS[tourIndex],target=document.querySelector(step[0]),spot=$('tourSpot'),card=$('tourCard');
  if(!target)return;
  const r=target.getBoundingClientRect(),pad=8,top=Math.max(4,r.top-pad),h=Math.min(r.height+pad*2,innerHeight-top-4);
  Object.assign(spot.style,{left:Math.max(4,r.left-pad)+'px',top:top+'px',width:Math.min(r.width+pad*2,innerWidth-8)+'px',height:Math.max(40,h)+'px'});
  // The card goes below the highlighted area when there is room, otherwise above it, otherwise at the bottom.
  const cw=Math.min(360,innerWidth-24),ch=card.offsetHeight||170,below=r.bottom+pad+12,above=r.top-pad-12-ch;
  const y=below+ch<innerHeight?below:above>8?above:innerHeight-ch-12;
  Object.assign(card.style,{width:cw+'px',left:Math.max(12,Math.min(innerWidth-cw-12,r.left))+'px',top:Math.max(8,y)+'px'});
}
function showTourStep(i){
  if(i<0||i>=TOUR_STEPS.length)return;
  tourIndex=i;const [sel,title,text]=TOUR_STEPS[i],target=document.querySelector(sel);
  window.chaoweiTourTarget?.(target);
  $('tourCount').textContent=(i+1)+' / '+TOUR_STEPS.length;$('tourTitle').textContent=title;$('tourText').textContent=text;
  $('tourPrev').disabled=i===0;$('tourNext').textContent=i===TOUR_STEPS.length-1?'開始使用':'下一步';
  const bring=el=>{
    // Tall cards are aligned to their top edge (below the pinned summary bar); short ones are centred.
    const r=el.getBoundingClientRect(),bar=$('siteHeader').getBoundingClientRect().height+24;
    const y=r.height>innerHeight*.6?r.top+scrollY-bar:r.top+scrollY-(innerHeight-r.height)/2;
    window.scrollTo({top:Math.max(0,sel==='.toolbar'?r.top+scrollY-120:y),behavior:'instant'});
  };
  if(target)bring(target);
  requestAnimationFrame(placeTour);$('tourNext').focus({preventScroll:true});
  // Opening a step's panel can close or fill other panels a moment later (accordions, lazy charts), which moves
  // the target without any scroll event. Follow it for a short while so the highlight never drifts away.
  let last='',n=0;const follow=()=>{if(tourIndex!==i||++n>60)return;const el=document.querySelector(sel);if(el){const r=el.getBoundingClientRect(),key=Math.round(r.top)+':'+Math.round(r.height);if(last&&key!==last){bring(el);placeTour()}last=key}setTimeout(follow,50)};setTimeout(follow,50);
}
function startTour(){window.chaoweiBeginTour?.();closeDisplay?.();closeSearch?.();closeAccount?.();tourEls().classList.remove('hidden');document.body.classList.add('touring');showTourStep(0)}
function endTour(){
  tourIndex=-1;$('tourShade')?.classList.add('hidden');document.body.classList.remove('touring');
  if(!settings.tourDone){settings.tourDone=new Date().toISOString().slice(0,10);save()}
  window.chaoweiEndTour?.();if($('quickTour')?.getClientRects().length)$('quickTour').focus({preventScroll:true});
}
$('startTour').addEventListener('click',startTour);
// First sign-in: wait for the cloud profile to load (it may say the tour was already done on another device).
// The study-layout module offers the same three-step introduction to guests and members.

/* ---------- Tide-wave gauge colours: low tide (cheap) green, mid-tide blue, high tide (dear) coral ---------- */
function tideColors(score){
  // Three clear zones rather than a blend (mixing coral and blue reads as muddy purple); the CSS transition smooths changes.
  const s=Math.max(0,Math.min(5,score));
  return s>=3.5?['#34d399','#06b6d4']:s>1.5?['#38bdf8','#0e7490']:['#fb7185','#f59e0b'];
}
const tideRenderPosition=renderPosition;
renderPosition=function(){
  tideRenderPosition();
  const w=$('cupWater');if(!w)return;
  if(position){const [a,b]=tideColors(position.core);w.style.setProperty('--w1',a);w.style.setProperty('--w2',b)}
};

/* ---------- Tide radar inside the search sheet (precomputed daily for every ETF) ---------- */
let radar=null,radarFilter='all';
const RADAR_TESTS={low:x=>x.score>=4.5,bias:x=>x.bias60!=null&&x.bias60<=-10,rsi:x=>x.rsi!=null&&x.rsi<30,squeeze:x=>!!x.squeeze};
async function loadRadar(){if(radar)return radar;try{const r=await fetch('/api/radar'),d=await r.json();if(r.ok&&Array.isArray(d.rows))radar={...d,map:new Map(d.rows.map(x=>[x.code,x]))}}catch{}return radar}
const radarRenderList=renderList;
renderList=function(){
  radarRenderList();
  if(!radar)return;
  const rows=[...$('etfList').querySelectorAll('.etf-result')];let shown=0;
  for(const row of rows){
    const pick=row.querySelector('.candidate-pick'),code=pick.querySelector('strong').textContent.split(' · ')[0],x=radar.map.get(code);
    const ok=radarFilter==='all'||(x&&RADAR_TESTS[radarFilter](x));row.classList.toggle('hidden',!ok);if(ok)shown++;
    if(x&&x.score!=null&&!pick.querySelector('.radar-badge')){
      const b=document.createElement('span');b.className='radar-badge'+(x.score>=4?' hot':x.score<=1?' cold':'');
      b.textContent='水位 '+x.score.toFixed(1)+(radarFilter==='bias'?' · 乖離 '+x.bias60+'%':radarFilter==='rsi'?' · RSI '+x.rsi:'');pick.append(b);
    }
  }
  // Under a radar filter, the best candidates (highest water score) come first.
  if(radarFilter!=='all'){rows.filter(r=>!r.classList.contains('hidden')).sort((a,b)=>(radar.map.get(b.querySelector('strong').textContent.split(' · ')[0])?.score??-1)-(radar.map.get(a.querySelector('strong').textContent.split(' · ')[0])?.score??-1)).forEach(r=>$('etfList').append(r));
    $('searchCount').textContent='今日潮位雷達：符合 '+shown+' 檔（資料日 '+radar.latest+'）'}
};
$('radarChips').addEventListener('click',async e=>{const b=e.target.closest('[data-radar]');if(!b)return;radarFilter=b.dataset.radar;$('radarChips').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));await loadRadar();renderList()});
const radarOpenSearch=openSearch;
openSearch=function(){radarOpenSearch();loadRadar().then(()=>{if(!$('searchOverlay').classList.contains('hidden'))renderList()})};
for(const id of ['openSearch','openSearchTop'])$(id).addEventListener('click',()=>loadRadar().then(renderList));

/* ---------- User-defined inputs across the page ---------- */
// "自訂…" in a select opens a small number box; the typed value becomes a normal option.
function bindCustomSelect(select,{min,max,step=1,unit,label}){
  const box=document.createElement('span');box.className='custom-entry hidden';
  box.innerHTML=`<input type="number" min="${min}" max="${max}" step="${step}" inputmode="numeric" aria-label="${label}"><em>${unit}</em><button class="pill mini" type="button">套用</button><button class="pill mini" type="button">取消</button>`;
  select.closest('label').after(box);
  const [input,,ok,cancel]=box.children;let previous=select.value;
  select.addEventListener('focus',()=>{if(select.value!=='custom')previous=select.value});
  // Capture on the target runs before the page's own change handlers, so "custom" never reaches them.
  select.addEventListener('change',e=>{if(select.value!=='custom'){previous=select.value;return}e.stopImmediatePropagation();select.value=previous;input.value=Number(previous)||'';box.classList.remove('hidden');input.focus()},true);
  const apply=()=>{const v=Math.round(Number(input.value));if(!Number.isFinite(v)||v<min||v>max){input.setCustomValidity(`請輸入 ${min}–${max}`);input.reportValidity();return}
    input.setCustomValidity('');customOption(select,v,`${v} ${unit}（自訂）`);select.value=String(v);previous=select.value;box.classList.add('hidden');select.dispatchEvent(new Event('change',{bubbles:true}))};
  ok.addEventListener('click',apply);input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply()}if(e.key==='Escape')box.classList.add('hidden')});
  cancel.addEventListener('click',()=>box.classList.add('hidden'));
}
bindCustomSelect($('window'),{min:20,max:2400,unit:'交易日',label:'自訂觀察窗交易日數'});
bindCustomSelect($('btWindow'),{min:20,max:2400,unit:'交易日',label:'自訂回測觀察窗交易日數'});
bindCustomSelect($('btDcaPeriods'),{min:1,max:240,unit:'期',label:'自訂定期定額期數'});
if(!/^(60|120|200|240|400|600|1200|2400|all)$/.test(String(settings.window))&&Number(settings.window)>0){customOption($('window'),settings.window,settings.window+' 交易日（自訂）');$('window').value=String(settings.window)}

/* Chart range: custom dates. */
$('rangeSeg').addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;const on=b.dataset.range==='custom';$('rangeCustom').classList.toggle('hidden',!on);
  if(on&&bars.length){const last=bars.at(-1).date,d=new Date(last+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-3);$('rangeFrom').value=settings.chartFrom||d.toISOString().slice(0,10);$('rangeTo').value=settings.chartTo||last;$('rangeFrom').min=$('rangeTo').min=bars[0].date;$('rangeFrom').max=$('rangeTo').max=last}});
$('rangeApply').addEventListener('click',()=>{let a=$('rangeFrom').value,z=$('rangeTo').value;if(!a||!z)return;if(a>z)[a,z]=[z,a];settings.chartFrom=a;settings.chartTo=z;save();setRange('custom')});

/* Indicator parameters and K-line style. */
settings.chartType=['candle','ohlc','line'].includes(settings.chartType)?settings.chartType:'candle';
settings.colorScheme=settings.colorScheme==='intl'?'intl':'tw';
const IND_FIELDS=[['indMa1',s=>s.ma[0]],['indMa2',s=>s.ma[1]],['indMa3',s=>s.ma[2]],['indBbN',s=>s.bb[0]],['indBbK',s=>s.bb[1]],['indMacdF',s=>s.macd[0]],['indMacdS',s=>s.macd[1]],['indMacdG',s=>s.macd[2]],['indRsi',s=>s.rsi],['indKd',s=>s.kd]];
function fillIndicators(){
  for(const [id,get] of IND_FIELDS)$(id).value=get(settings.ind);$('chartType').value=settings.chartType;$('colorScheme').value=settings.colorScheme;
  // Overlay buttons and the help text name the periods the user chose.
  document.querySelectorAll('[data-overlay]').forEach(b=>{const j=['ma5','ma20','ma60'].indexOf(b.dataset.overlay);if(j>=0)b.lastChild.textContent=indName.ma(j)});
  document.body.classList.toggle('intl-colors',settings.colorScheme==='intl');
}
function readIndicators(){
  const v=id=>$(id).value;
  settings.ind=normInd({ma:[v('indMa1'),v('indMa2'),v('indMa3')],bb:[v('indBbN'),v('indBbK')],macd:[v('indMacdF'),v('indMacdS'),v('indMacdG')],rsi:v('indRsi'),kd:v('indKd')});
  settings.chartType=$('chartType').value;settings.colorScheme=$('colorScheme').value==='intl'?'intl':'tw';save();fillIndicators();drawChart(true);
}
$('indSettings').addEventListener('change',readIndicators);
$('indReset').addEventListener('click',()=>{settings.ind=normInd(null);settings.chartType='candle';settings.colorScheme='tw';save();fillIndicators();drawChart(true)});
function applyChartStyle(){
  if(!lwc)return;const s=lwc.s,up=settings.colorScheme==='intl'?FALL:RISE,down=settings.colorScheme==='intl'?RISE:FALL,clear='rgba(0,0,0,0)',t=settings.chartType;
  if(!s.ohlc){s.ohlc=lwc.main.addBarSeries({priceLineVisible:false,lastValueVisible:false,thinBars:false});s.closeLine=lwc.main.addLineSeries({color:'#19a7aa',lineWidth:2,priceLineVisible:false,lastValueVisible:false})}
  // The candle series stays (markers and price lines live on it) but turns transparent for the other styles.
  s.candle.applyOptions(t==='candle'?{upColor:up,downColor:down,borderUpColor:up,borderDownColor:down,wickUpColor:up,wickDownColor:down}:{upColor:clear,downColor:clear,borderUpColor:clear,borderDownColor:clear,wickUpColor:clear,wickDownColor:clear});
  s.ohlc.applyOptions({upColor:up,downColor:down,visible:t==='ohlc'});s.closeLine.applyOptions({visible:t==='line'});
  s.ohlc.setData(t==='ohlc'?lwc.data.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close})):[]);
  s.closeLine.setData(t==='line'?lwc.data.map(b=>({time:b.date,value:b.close})):[]);
}
const styleDrawChart=drawChart;
drawChart=function(keepView){styleDrawChart(keepView);applyChartStyle()};
fillIndicators();

/* Weight plan: type an exact percentage next to each slider. */
function syncWeightNumbers(){document.querySelectorAll('.w-num').forEach(n=>{if(document.activeElement!==n)n.value=$(n.dataset.for).value})}
document.querySelectorAll('.w-num').forEach(n=>n.addEventListener('input',()=>{const v=Math.max(0,Math.min(100,Math.round(Number(n.value)||0)));const s=$(n.dataset.for);s.value=v;s.dispatchEvent(new Event('input',{bubbles:true}))}));
const numUpdateWeights=updateWeights;
updateWeights=function(){numUpdateWeights();syncWeightNumbers()};
['wEtf','wIndex','wVolume','wBrent','wFx'].forEach(k=>$(k).addEventListener('input',syncWeightNumbers));
syncWeightNumbers();

/* Tide radar: adjustable water-score threshold. */
RADAR_TESTS.low=x=>x.score>=clampNum($('radarMin').value,0,5,4.5);
$('radarMin').addEventListener('change',()=>{if(radarFilter==='low')renderList()});

/* ---------- Homepage search field and popular searches ---------- */
// Typing in the homepage field opens the full search with the same text.
$('homeSearch').addEventListener('focus',()=>{if(restoringSearchFocus)return;openSearch();setTimeout(()=>{if(!$('searchOverlay').classList.contains('hidden')&&$('homeSearch').value){$('search').value=$('homeSearch').value;$('homeSearch').value='';renderList()}},40)});
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
  $('hotList').innerHTML=list.map(c=>{const e=catalog.find(x=>x.code===c);const r=etfRisk(c);return e?`<button class="pill mini" type="button" data-hot="${c}">${c} ${e.name}${r?`<span class="risk-tag ${r.kind}">${r.tag}</span>`:''}</button>`:''}).join('');
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

/* ---------- Beginner / expert mode for the backtest ---------- */
// Display mode only changes disclosure. It never changes money, installments or reference settings.
settings.uiMode=settings.studyMode==='full'?'expert':settings.studyMode==='basic'?'novice':settings.uiMode==='expert'?'expert':'novice';
function applyUiMode(){
  const novice=settings.uiMode==='novice';document.body.classList.toggle('novice',novice);
  $('btMode').querySelectorAll('[data-mode]').forEach(b=>{const on=b.dataset.mode===settings.uiMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
  settings.studyMode=novice?'basic':'full';window.dispatchEvent(new Event('chaowei-study-mode-changed'));
}
$('btMode').addEventListener('click',e=>{const t=e.target.closest('[data-mode]');if(!t)return;settings.uiMode=t.dataset.mode;save();applyUiMode()});
applyUiMode();

/* ---------- Plain-language scenarios for the observation window ---------- */
function markScenario(){$('scenarios').querySelectorAll('[data-win]').forEach(b=>b.classList.toggle('on',b.dataset.win===String(settings.window)))}
$('scenarios').addEventListener('click',e=>{
  const t=e.target.closest('[data-win]');if(!t)return;const sel=$('window');
  if(![...sel.options].some(o=>o.value===t.dataset.win))customOption(sel,t.dataset.win,t.dataset.win+' 交易日（自訂）');
  sel.value=t.dataset.win;sel.dispatchEvent(new Event('change',{bubbles:true}));markScenario();
});
$('window').addEventListener('change',()=>setTimeout(markScenario,0));
markScenario();

/* ---------- Weights: used in proportion, so any total works; live preview of the combined score ---------- */
const WEIGHT_LABELS=['本檔 ETF','大盤價格','大盤量能','布蘭特現貨','美元／新台幣'];
const shareUpdateWeights=updateWeights;
updateWeights=function(){
  shareUpdateWeights();
  const w=settings.weights||[],sum=w.reduce((a,b)=>a+b,0),share=w.map(x=>sum>0?x/sum:0);
  ['oEtf','oIndex','oVolume','oBrent','oFx'].forEach((k,i)=>$(k).textContent=Math.round(share[i]*100)+'%');
  $('weightStatus').textContent=sum===100?'權重合計 100%':sum>0?`權重合計 ${sum}%，已依比例換算成 100%`:'請至少設定一項權重';
  $('weightBar').innerHTML=share.map((s,i)=>s>0?`<span class="w${i}" style="width:${(s*100).toFixed(2)}%" title="${WEIGHT_LABELS[i]} ${Math.round(s*100)}%">${s>=0.12?WEIGHT_LABELS[i]+' '+Math.round(s*100)+'%':''}</span>`:'').join('');
  const vs=marketPosition?.volumeScore??0,v=settings.volumeDirection==='low'?5-vs:vs;
  const ready=[!!position,!!marketPosition,!!marketPosition&&settings.volumeDirection!=='off'&&marketPosition.volumeGrade!=null,!!brentPosition,!!fxPosition];
  if(!position||sum<=0||share.some((s,i)=>s>0&&!ready[i])){
    $('combined').textContent='—';$('combinedExtra').textContent=sum<=0?'請至少設定一項權重':'資料不足或量能方向未設定';$('weightPreview').textContent='';return}
  const core=[position.core,marketPosition?.index.core||0,v||0,brentPosition?.core||0,fxPosition?.core||0].reduce((a,x,i)=>a+share[i]*x,0);
  const ext=[position.raw,marketPosition?.index.raw||0,v||0,brentPosition?.raw||0,fxPosition?.raw||0].reduce((a,x,i)=>a+share[i]*x,0);
  $('combined').textContent=fmt(core,1)+' / 5';$('combinedExtra').textContent='延伸綜合分 '+fmt(ext,1);
  const d=core-position.core;
  $('weightPreview').innerHTML=`只看 ${selected}：<b>${fmt(position.core,1)}</b> 分  至  依你的權重：<b>${fmt(core,1)}</b> 分`+(Math.abs(d)>=0.05?`（${d>0?'偏向加碼':'偏向減碼'} ${fmt(Math.abs(d),1)} 分）`:'');
};
// The sliders were bound to the first version of updateWeights; run the current chain after them.
for(const id of ['wEtf','wIndex','wVolume','wBrent','wFx','volumeDirection','normalize'])$(id).addEventListener(id==='normalize'?'click':id==='volumeDirection'?'change':'input',()=>updateWeights());

/* ---------- Back to the observation area ---------- */
const toTop=document.createElement('button');toTop.type='button';toTop.className='to-top hidden';toTop.textContent='回到上方觀測區';
toTop.addEventListener('click',()=>{const t=document.querySelector('.toolbar');window.scrollTo({top:t.getBoundingClientRect().top+scrollY-12,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})});
document.body.append(toTop);
// Shown once the price chart has scrolled out of view, hidden while a sheet is open.
// (A scroll check, not an IntersectionObserver: a jump straight past the chart never changes its intersection.)
const chartCard=document.querySelector('.chart-card');let toTopFrame=0;
const placeToTop=()=>{toTopFrame=0;toTop.classList.toggle('hidden',!chartCard||chartCard.getBoundingClientRect().bottom>0)};
window.addEventListener('scroll',()=>{if(!toTopFrame)toTopFrame=requestAnimationFrame(placeToTop)},{passive:true});placeToTop();

// Shared market-factor scoring. Reference samples always precede the measured observation.
const MarketScoring=(()=>{
  const clamp=x=>Math.max(0,Math.min(1,x));
  function cdf(z){const t=1/(1+0.2316419*Math.abs(z)),p=0.3989422804014327*Math.exp(-z*z/2)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return z>=0?1-p:p}
  function stats(values){const a=values.filter(Number.isFinite);if(a.length<2)return null;const mean=a.reduce((s,x)=>s+x,0)/a.length,sd=Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/(a.length-1));return{mean,sd,count:a.length}}
  function evaluate(values,{window=120,method='normal',zero=false,higherBetter=false,span=20}={}){
    const a=values.filter(Number.isFinite),value=a.at(-1),prior=a.slice(-Math.max(20,window)-1,-1),st=stats(prior);
    if(!st||prior.length<20||!Number.isFinite(value))return null;
    const center=zero?0:st.mean,scale=zero?Math.sqrt(prior.reduce((s,x)=>s+x*x,0)/prior.length):st.sd;
    let z=scale>0?(value-center)/scale:value===center?0:Math.sign(value-center)*Infinity;
    const half=zero?(scale||Math.abs(value)||1)*2:Math.abs(center)*Math.max(1,span)/100;
    const raw=half>0?0.5+(value-center)/(2*half):0.5;
    const r=method==='normal'?cdf(z):clamp(raw),core=5*(higherBetter?r:1-r),grade=Math.max(1,Math.min(5,Math.ceil(core)));
    return{value,mean:st.mean,center,sd:st.sd,scale,count:st.count,z,r,raw,core,grade,half,extended:5*(higherBetter?raw:1-raw),deviation:center?(value/center-1)*100:null,method};
  }
  return{cdf,stats,evaluate};
})();

// Market factors have their own reference window, independent of the selected ETF's price window.
let bankDays=[],bankPosition=null;
settings.marketWindow=Math.max(20,Math.min(2400,Math.round(Number(settings.marketWindow)||120)));
settings.marketMethod=['mean','normal'].includes(settings.marketMethod)?settings.marketMethod:'normal';
settings.marketSpan=Math.max(1,Math.min(200,Number(settings.marketSpan)||20));
settings.bankRange=Number(settings.bankRange)||60;
const marketConfig=document.createElement('details');marketConfig.className='market-config';
marketConfig.innerHTML='<summary>原油・融資・官股的計分設定</summary><div class="controls"><label>參考筆數<select id="marketWindow"><option value="20">20 筆</option><option value="60">60 筆</option><option value="120">120 筆</option><option value="240">240 筆</option><option value="360">360 筆</option><option value="custom">自訂…</option></select></label><label>計分方式<select id="marketMethod"><option value="normal">常態分布（Z 分數）</option><option value="mean">均值比例五等分</option></select></label><label id="marketSpanWrap">均值上下範圍（%）<input id="marketSpan" type="number" min="1" max="200" step="1"></label></div><p class="small" id="marketMethodHelp"></p>';
$('factorRail').before(marketConfig);
function fillMarketConfig(){customOption($('marketWindow'),settings.marketWindow,settings.marketWindow+' 筆');$('marketWindow').value=settings.marketWindow;$('marketMethod').value=settings.marketMethod;$('marketSpan').value=settings.marketSpan;$('marketSpanWrap').classList.toggle('hidden',settings.marketMethod!=='mean');$('marketMethodHelp').textContent=settings.marketMethod==='normal'?'原油用前 N 筆標準差；融資與官股用前 N 筆的均方根衡量離零程度。均值／零軸為 2.5 分。常態模型 ±1／2／3σ 約涵蓋 68.27%／95.45%／99.73%，不是上漲機率；不足 N 用實際筆數，少於 20 筆停算。':'原油以歷史均值 ± 所選百分比切五段；融資增減與官股買賣超以零為中心、±2 倍歷史均方根切五段，顯示 0–5 連續分數；不足 N 用實際筆數。'}
function factorScore(values,zero=false,higherBetter=false){return MarketScoring.evaluate(values,{window:settings.marketWindow,method:settings.marketMethod,span:settings.marketSpan,zero,higherBetter})}
function signNum(v,d=1){return(v>0?'+':'')+fmt(v,d)}
function factorSpark(rows){const a=rows.slice(-30).map(x=>x.value),lo=Math.min(...a),hi=Math.max(...a),span=hi-lo||1;return a.length<2?'':`<svg viewBox="0 0 220 44" role="img" aria-label="近 30 筆走勢"><polyline points="${a.map((v,i)=>`${i*220/(a.length-1)},${40-(v-lo)/span*34}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>`}
function recomputeFactors(){computeMktMargin();computeBrent();computeBank();updateWeights();if(factorTrendKey)renderFactorTrend();if(btCtx){btCtx=null;btSchedule()}}
fillMarketConfig();
for(const id of ['marketWindow','marketMethod','marketSpan'])$(id).addEventListener('change',function(){
  if(id==='marketWindow'){let n=this.value;if(n==='custom'){n=prompt('參考筆數（20–2400）',settings.marketWindow);if(n===null){fillMarketConfig();return}}settings.marketWindow=Math.max(20,Math.min(2400,Math.round(Number(n)||120)))}
  if(id==='marketMethod')settings.marketMethod=this.value;
  if(id==='marketSpan')settings.marketSpan=Math.max(1,Math.min(200,Number(this.value)||20));
  fillMarketConfig();recomputeFactors();save();
});

if(shareView)for(const id of ['marketWindow','marketMethod','marketSpan'])$(id).disabled=true;

/* ---------- Market-wide margin balance (TWSE 信用交易統計) as a market factor ---------- */
// Scored from the daily balance change, centred on zero; rising leverage lowers the score.
let marginDays=[],mktMarginPosition=null;
{
  const tile=document.createElement('div');tile.className='factor';
  tile.innerHTML='<span class="factor-icon"></span><h4>大盤融資 · 每日增減</h4><strong id="mktMarginScore">—</strong><p id="mktMarginMeta">讀取證交所盤後資料中</p><div class="factor-spark" id="marginSpark"></div>';
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
  try{await btEnsureMargin();const d=btMarginSnapshot;if(!Array.isArray(d?.rows))throw Error('讀取失敗');
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
  $('brentScore').textContent=fmt(s.core,1)+' / 5';$('brentMeta').textContent=`${fmt(last.value,2)} 美元／桶 · ${last.date}（官方最新）· 均值 ${fmt(s.mean,2)} · 偏離 ${signNum(s.deviation)}%`;
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
{const note=document.createElement('p');note.className='factor-note';note.textContent='EIA 布蘭特現貨（經 FinMind）· 日資料，EIA 約每週三公布前一週，落後約一週';$('brentScore').before(note);$('brentMeta').insertAdjacentHTML('afterend','<div class="factor-spark" id="oilSpark"></div><p class="small oil-future" id="oilFutureMeta">盤中期貨參考：等待 Yahoo 報價</p>')}
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
  bankPanel.replaceChildren();const head=document.createElement('div');head.className='factor-trend-head';head.innerHTML='<h4>八大官股買賣超 · 全市場</h4><div class="segment" role="group" aria-label="官股趨勢期間">'+[20,60,120,0].map(n=>`<button type="button" data-bank-range="${n}" aria-pressed="${settings.bankRange===n}" class="${settings.bankRange===n?'active':''}">${n?n+' 日':'全部'}</button>`).join('')+'</div>';
  head.addEventListener('click',e=>{const b=e.target.closest('[data-bank-range]');if(b){settings.bankRange=Number(b.dataset.bankRange);save();renderBankTrend()}});bankPanel.append(head);
  const a=settings.bankRange?bankDays.slice(-settings.bankRange):bankDays;if(!a.length){bankPanel.append(document.createTextNode('正在讀取 HiStock 全市場資料…'));return}
  bankPanel.append(chipChart({title:'HiStock 八大行庫每日淨額',unit:'億元',width:Math.max(280,bankPanel.clientWidth||600),dates:a.map(x=>x.date),kind:'stack',series:[{name:'買超',color:RISE,data:a.map(x=>Math.max(0,x.value))},{name:'賣超',color:FALL,data:a.map(x=>Math.min(0,x.value))}],format:v=>signNum(v,2)+' 億元'}));
  const p=document.createElement('p');p.className='small';p.textContent=`HiStock 同一來源，共 ${bankDays.length} 日；正值買超、負值賣超，零軸為中性。平日約 23:15 單次更新，失敗保留原資料。這是全市場公股券商交易淨額，不是 ETF 或政府持有庫存。`;bankPanel.append(p);
}
async function loadBanks(){
  try{const r=await fetch('/api/bank'),d=await r.json();if(r.ok&&d.rows?.length)bankDays=d.rows.map(x=>({date:x[0],value:x[1],index:x[2]}))}catch{}
  computeBank();updateWeights();
  if(window.CHAOWEI_BANK)try{const d=await window.CHAOWEI_BANK();if(d.rows?.length){bankDays=mergeDays(bankDays,d.rows.map(x=>({date:x[0],value:x[1],index:x[2]})));computeBank();updateWeights()}}catch{}
}
const marketApplyProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{marketApplyProfile(p);settings.marketWindow=Math.max(20,Math.min(2400,Number(settings.marketWindow)||120));settings.marketMethod=settings.marketMethod==='mean'?'mean':'normal';fillMarketConfig();recomputeFactors()};
window.addEventListener('resize',()=>{clearTimeout(window.__bankResize);window.__bankResize=setTimeout(renderBankTrend,150)});
loadBanks();

/* Optional margin factors next to the five base weights: this ETF's margin balance and the market-wide balance.
   Absent data never becomes a zero score; a factor with weight but no data pauses the combined score. */
const EXTRA_FACTORS=[
  {id:'wMargin',setting:'marginWeight',label:'本檔融資餘額',name:'本檔融資',score:()=>marginScore()},
  {id:'wMktMargin',setting:'mktMarginWeight',label:'大盤融資每日增減',name:'大盤融資增減',score:()=>mktMarginPosition?.core??null},
  {id:'wBank',setting:'bankWeight',label:'八大官股（全市場）',name:'全市場官股',score:()=>bankPosition?.core??null}
];
for(const f of EXTRA_FACTORS){
  const row=document.createElement('div');row.className='weight';
  row.innerHTML=`<label for="${f.id}">${f.label}</label><input id="${f.id}" type="range" min="0" max="100" step="1" value="0"><input class="w-num" type="number" min="0" max="100" step="1" data-for="${f.id}" aria-label="${f.label}權重數值"><output id="o${f.id.slice(1)}">0%</output>`;
  $('weights').querySelector('.weights').append(row);f.row=row;
  settings[f.setting]=Math.max(0,Math.min(100,Number(settings[f.setting])||0));
  $(f.id).value=settings[f.setting];$(f.id).disabled=shareView;row.querySelector('.w-num').value=$(f.id).value;
  $(f.id).addEventListener('input',()=>{row.querySelector('.w-num').value=$(f.id).value;updateWeights()});
  row.querySelector('.w-num').addEventListener('input',e=>{$(f.id).value=Math.max(0,Math.min(100,Number(e.target.value)||0));updateWeights()});
}
const marginControls=document.createElement('div');marginControls.className='controls';
marginControls.innerHTML='<label>本檔融資解讀<select id="marginDirection"><option value="low">融資越低分越高</option><option value="high">融資越高分越高</option></select></label><span class="small">本檔融資用近 60 日餘額位置；大盤融資用每日增減，官股用全市場淨額。各因子分數依上方方向選單計算。</span>';
$('weights').querySelector('.weights').after(marginControls);
const bankHint=document.createElement('p');bankHint.className='small';bankHint.textContent='原油、融資增減與官股共用上方市場計分設定；這些因子是背景資料，並非本檔 ETF 的持股明細。';marginControls.after(bankHint);
settings.marginDirection=settings.marginDirection==='high'?'high':'low';
$('marginDirection').value=settings.marginDirection;$('marginDirection').disabled=shareView;
function marginScore(){
  if(chipCode!==selected)return null;
  const through=$('chipDate').value||chipRows.at(-1)?.[0];
  const values=chipRows.filter(r=>r[0]<=through).slice(-60).map(r=>r[7]).filter(Number.isFinite);
  if(values.length<20)return null;
  const low=Math.min(...values),high=Math.max(...values);if(high===low)return null;
  const r=(values.at(-1)-low)/(high-low);
  return 5*(settings.marginDirection==='low'?1-r:r);
}
// Factor order: ETF, index, volume, oil, FX, then EXTRA_FACTORS. Scores follow the chosen directions.
function factorScores(){
  const base=[position?.core,marketPosition?.index?.core,marketPosition?.volumeGrade==null||settings.volumeDirection==='off'?null:settings.volumeDirection==='low'?5-marketPosition.volumeScore:marketPosition.volumeScore,brentPosition?.core,fxPosition?.core];
  const scores=[...base,...EXTRA_FACTORS.map(f=>f.score())];
  if(polarityReady){for(const [i,key]of [[0,'etf'],[1,'index'],[2,'volume'],[3,'oil'],[4,'fx'],[6,'margin'],[7,'bank']])scores[i]=directionScore(key)}
  return scores;
}
// One weighted score for any weight list (the sliders, or a saved plan), always from the latest data.
function weightedScore(weights){
  const w=(weights||[]).map(x=>Math.max(0,Number(x)||0)),sum=w.reduce((a,b)=>a+b,0),scores=factorScores();
  if(sum<=0||!position)return{value:null,sum,scores,missing:-1};
  const missing=w.findIndex((x,i)=>x>0&&!Number.isFinite(scores[i]));if(missing>=0)return{value:null,sum,scores,missing};
  return{value:w.reduce((n,x,i)=>n+x*scores[i],0)/sum,sum,scores,missing:-1};
}
const currentWeights=()=>[...(settings.weights||[]).map(x=>Number(x)||0),...EXTRA_FACTORS.map(f=>Number($(f.id).value)||0)];
const fiveFactorWeights=updateWeights;
updateWeights=function(){
  fiveFactorWeights();
  const five=(settings.weights||[]).map(x=>Number(x)||0),extra=EXTRA_FACTORS.map(f=>Number($(f.id).value)||0),weights=[...five,...extra],sum=weights.reduce((a,b)=>a+b,0);
  EXTRA_FACTORS.forEach((f,i)=>settings[f.setting]=extra[i]);settings.marginDirection=$('marginDirection').value;
  const outs=['oEtf','oIndex','oVolume','oBrent','oFx',...EXTRA_FACTORS.map(f=>'o'+f.id.slice(1))];
  outs.forEach((id,i)=>$(id).textContent=sum?Math.round(weights[i]/sum*100)+'%':'0%');
  const names=['本檔 ETF','大盤價格','大盤量能','布蘭特現貨','美元／新台幣',...EXTRA_FACTORS.map(f=>f.name)];
  $('weightBar').innerHTML=weights.map((w,i)=>w>0&&sum>0?`<span class="w${i}" style="width:${(w/sum*100).toFixed(2)}%" title="${names[i]} ${Math.round(w/sum*100)}%">${w/sum>=0.12?names[i]+' '+Math.round(w/sum*100)+'%':''}</span>`:'').join('');
  $('weightStatus').textContent=sum===100?'權重合計 100%':sum>0?`權重合計 ${sum}%，依比例換算成 100%`:'請至少設定一項權重';
  const {value,scores,missing}=weightedScore(weights);
  if(value==null){$('combined').textContent='—';$('combinedExtra').textContent=sum<=0?'請至少設定一項權重':missing>=5?`${names[missing]}可用資料不足，暫停綜合分`:'選取的因子資料不足';$('weightPreview').textContent='';save();return}
  $('combined').textContent=fmt(value,1)+' / 5';
  $('combinedExtra').textContent=EXTRA_FACTORS.map((f,i)=>extra[i]>0?`${f.name} ${fmt(scores[5+i],1)} 分`:'').filter(Boolean).join(' · ')||'延伸綜合分請參照各項位置';
  const etfScore=polarityReady?directionScore('etf'):position.core,d=value-etfScore;
  $('weightPreview').innerHTML=`只看 ${selected}：<b>${fmt(etfScore,1)}</b> 分  至  依你的權重：<b>${fmt(value,1)}</b> 分`+(Math.abs(d)>=0.05?`（${d>0?'偏向增加':'偏向降低'} ${fmt(Math.abs(d),1)} 分）`:'');
  save();
};
$('marginDirection').addEventListener('change',updateWeights);
// Settings from the signed-in account arrive later; move the extra controls with them.
const marginApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{marginApplyProfile(profile);
  for(const f of EXTRA_FACTORS){$(f.id).value=Math.max(0,Math.min(100,Number(settings[f.setting])||0));f.row.querySelector('.w-num').value=$(f.id).value}
  $('marginDirection').value=settings.marginDirection==='high'?'high':'low';
  if($('mktMarginDirection')){$('mktMarginDirection').value=settings.mktMarginDirection==='high'?'high':'low';computeMktMargin()}
  updateWeights()};
updateWeights();

const IndicatorDirection=(()=>{
  const clamp=x=>Math.max(0,Math.min(5,x));
  const meta={
    etf:{name:'ETF 價格',modes:[['low_buy','價格越低分數越高'],['high_buy','價格越高分數越高']],default:'low_buy'},
    index:{name:'大盤價格',modes:[['low_buy','指數越低分數越高'],['high_buy','指數越高分數越高']],default:'low_buy'},
    volume:{name:'大盤量能',modes:[['low_buy','量縮分數越高'],['high_buy','量增分數越高'],['smart_pv','價量配合（實驗規則）']],default:'low_buy'},
    oil:{name:'布蘭特現貨',modes:[['low_buy','油價越低分數越高'],['high_buy','油價越高分數越高']],default:'low_buy'},
    fx:{name:'美元／新台幣',modes:[['twd_strong_buy','匯率低／台幣升分數越高'],['twd_weak_buy','匯率高／台幣貶分數越高']],default:'twd_strong_buy'},
    margin:{name:'大盤融資增減',modes:[['decrease_buy','融資減少分數越高'],['increase_buy','融資增加分數越高']],default:'decrease_buy'},
    bank:{name:'全市場官股',modes:[['buy_follow','官股買超分數越高'],['sell_follow','官股賣超分數越高']],default:'buy_follow'}
  };
  const presets={
    value:{etf:'low_buy',index:'low_buy',volume:'low_buy',oil:'low_buy',fx:'twd_weak_buy',margin:'decrease_buy',bank:'buy_follow'},
    trend:{etf:'high_buy',index:'high_buy',volume:'high_buy',oil:'low_buy',fx:'twd_strong_buy',margin:'increase_buy',bank:'sell_follow'},
    hedge:{etf:'low_buy',index:'high_buy',volume:'smart_pv',oil:'low_buy',fx:'twd_strong_buy',margin:'decrease_buy',bank:'buy_follow'}
  };
  function normalize(m={}){return Object.fromEntries(Object.entries(meta).map(([k,v])=>[k,v.modes.some(x=>x[0]===m?.[k])?m[k]:v.default]))}
  function score(key,base,mode,{rank,pricePosition}={}){
    if(key==='volume'){
      if(!Number.isFinite(rank))return null;
      if(mode==='smart_pv')return Number.isFinite(pricePosition)?clamp(2.5+10*(.5-pricePosition)*(rank-.3)):null;
      return clamp(5*(mode==='low_buy'?1-rank:rank));
    }
    if(!Number.isFinite(base))return null;
    const flip=mode==='high_buy'||mode==='increase_buy'||mode==='sell_follow'||key==='fx'&&mode==='twd_weak_buy';
    return clamp(flip?5-base:base);
  }
  function action(score){return !Number.isFinite(score)?{kind:'missing',text:'資料不足，暫不判讀'}:score>=4?{kind:'increase',text:'依設定：偏向增加配置'}:score<=2?{kind:'decrease',text:'依設定：偏向降低配置'}:{kind:'neutral',text:'依設定：維持觀察'}}
  return{meta,presets,normalize,score,action};
})();

// The price's raw position remains unchanged. Direction only changes the observation/weight score.
var polarityReady=false;
const DM=IndicatorDirection;
function migrateDirections(){
  const old=settings.factorModes;
  settings.factorModes=DM.normalize(old);
  if(!old){if(settings.fxDirection==='high')settings.factorModes.fx='twd_weak_buy';if(settings.volumeDirection==='high')settings.factorModes.volume='high_buy'}
}
migrateDirections();
const DKEYS=['etf','index','volume','oil','fx','margin','bank'];
function directionScore(key){
  if(!settings.factorModes||typeof settings.factorModes!=='object')settings.factorModes=DM.normalize();
  if(key==='volume'){
    if(!marketPosition||marketPosition.volumeGrade==null)return null;
    const last=marketPosition.last,n=settings.window==='all'?market.length:Number(settings.window),prior=market.filter(x=>x.date<last.date).slice(-n),range=scalarRange(prior.map(x=>x.index));
    const p=range?(last.index-range.low)/(range.high-range.low):null;
    return DM.score(key,null,settings.factorModes.volume,{rank:marketPosition.volumeScore/5,pricePosition:p});
  }
  const base={etf:position?.core,index:marketPosition?.index?.core,oil:brentPosition?.core,fx:fxPosition?(settings.fxDirection==='high'?5-fxPosition.core:fxPosition.core):null,margin:mktMarginPosition?.core,bank:bankPosition?.core}[key];
  return DM.score(key,base,settings.factorModes[key]);
}
const directionSelects=[];
function makeDirection(key,parent,before=null){
  const select=document.createElement('select');select.className='factor-direction';select.setAttribute('aria-label',DM.meta[key].name+'計分方向');select.dataset.direction=key;
  for(const[value,label]of DM.meta[key].modes)select.add(new Option(label,value));
  select.value=settings.factorModes[key];select.disabled=shareView;select.addEventListener('click',e=>e.stopPropagation());select.addEventListener('keydown',e=>e.stopPropagation());
  select.addEventListener('change',e=>{e.stopPropagation();settings.factorModes[key]=select.value;applyDirections()});
  before?parent.insertBefore(select,before):parent.append(select);directionSelects.push(select);return select;
}
const scoreIds={index:'indexScore',volume:'volumeScore',oil:'brentScore',fx:'fxScore',margin:'mktMarginScore',bank:'bankScore'};
makeDirection('etf',$('grade').parentElement,$('grade'));
for(const[key,id]of Object.entries(scoreIds)){const score=$(id),parent=score.closest('.factor');makeDirection(key,parent,score);const tag=document.createElement('p');tag.className='direction-action';tag.id='action-'+key;score.after(tag)}
const etfAction=document.createElement('p');etfAction.className='direction-action';etfAction.id='action-etf';$('waterText').after(etfAction);
for(const[key,id]of Object.entries({etf:'wEtf',index:'wIndex',volume:'wVolume',oil:'wBrent',fx:'wFx',margin:'wMktMargin',bank:'wBank'})){const row=$(id).closest('.weight'),wrap=document.createElement('div');wrap.className='weight-direction';makeDirection(key,wrap);row.append(wrap)}
// Keep old controls for existing saved plans and backtest code, but expose only the explicit wording above.
$('fxDirection').classList.add('hidden');$('volumeDirection').closest('label').classList.add('hidden');
const logic=document.createElement('div');logic.className='direction-presets';logic.innerHTML='<p class="small">分數高＝依你的規則偏向增加配置；分數低＝偏向降低。這是位置／規則讀數，不是勝率或固定持股比例。</p><div class="segment" role="group" aria-label="指標方向預設包"><button type="button" data-direction-preset="value"> 價值低接</button><button type="button" data-direction-preset="trend"> 順勢觀察</button><button type="button" data-direction-preset="hedge"> 債券／避險參考</button></div>';
$('market').querySelector('.card-heading').after(logic);
logic.addEventListener('click',e=>{const b=e.target.closest('[data-direction-preset]');if(!b||shareView)return;settings.factorModes={...DM.presets[b.dataset.directionPreset]};applyDirections()});
if(shareView)logic.querySelectorAll('button').forEach(b=>b.disabled=true);
function refreshDirectionViews(){
  if(!polarityReady)return;
  const ids={...scoreIds,etf:'grade'};
  for(const[key,id]of Object.entries(ids)){
    const s=directionScore(key),node=$(id);if(key==='etf'){node.innerHTML=Number.isFinite(s)?fmt(s,1)+'<small>/5</small>':'—<small>/5</small>';$('barGrade').textContent=Number.isFinite(s)?fmt(s,1)+' / 5':'—'}else node.textContent=Number.isFinite(s)?fmt(s,1)+' / 5':'—';
    const a=DM.action(s),tag=$('action-'+key);tag.className='direction-action '+a.kind;tag.textContent=a.text;
  }
  for(const select of directionSelects)select.value=settings.factorModes[select.dataset.direction];
  if(fxPosition)$('fxMeta').textContent=fmt(fxPosition.last.value,3)+' 新台幣／美元 · '+fxPosition.last.date+' · '+(settings.factorModes.fx==='twd_strong_buy'?'數字低＝台幣較強，分高':'數字高＝台幣較弱，分高');
  bankTile.querySelector('small').textContent=(settings.factorModes.bank==='buy_follow'?'買超加分':'賣超加分')+' · 平日約 23:15 單次擷取';
  const a=DM.action(Number.parseFloat($('combined').textContent));$('combinedAction').textContent=a.text;$('combinedAction').className='direction-action '+a.kind;
}
const combinedAction=document.createElement('p');combinedAction.id='combinedAction';$('combined').after(combinedAction);
const directionHelp=document.createElement('details');directionHelp.innerHTML='<summary><span>05</span> 方向、分數與配置傾向</summary><p>顯示分數為 0–5 分，4 分以上標示偏向增加配置、2 分以下偏向降低，其餘維持觀察；依各項方向設定判讀，不代表勝率或固定持股比例。價格圖與原始相對位置不會因方向反轉而改變。</p><p>匯率是 USD/TWD：數字變小表示台幣較強，變大表示台幣較弱。正反方向得分互補，合計 5 分；不能由匯率或官股單項推定外資流向。價量配合是實驗規則，使用大盤價格位置與成交股數百分位，尚未驗證預測能力。</p><p>油價使用美元現貨日資料，盤中期貨另列。融資用當日增減、官股用全市場淨額，以零為基準；常態模式採 Z 分數映射，並非報酬機率。方向可保存在權重方案；歷史策略的交易條件仍依回測區設定。</p>';
document.querySelector('.method-steps').append(directionHelp);
function applyDirections(){
  settings.fxDirection=settings.factorModes.fx==='twd_strong_buy'?'low':'high';$('fxDirection').value=settings.fxDirection;
  settings.volumeDirection=settings.factorModes.volume==='low_buy'?'low':'high';$('volumeDirection').value=settings.volumeDirection;
  computeFx();updateWeights();refreshDirectionViews();save();
  btCtx=null;btSchedule();
}
const directionUpdate=updateWeights;updateWeights=function(){directionUpdate();refreshDirectionViews()};
const directionRender=renderPosition;renderPosition=function(){directionRender();refreshDirectionViews()};
const directionProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{directionProfile(p);migrateDirections();applyDirections()};
polarityReady=true;applyDirections();

// Compact carousel on small screens, overview on wide screens; both remain user selectable.
(()=>{
  const rail=$('factorRail'),nav=document.querySelector('.factor-rail-nav');
  const controls=document.createElement('div');controls.className='market-view-tools';
  controls.innerHTML='<div class="segment" aria-label="市場卡片版面"><button type="button" data-market-view="grid">全覽</button><button type="button" data-market-view="rail">輪播</button></div><span class="small" id="marketCount"></span><div class="market-moves"><button type="button" class="pill" data-market-move="-1" aria-label="上一張市場刻度">上張</button><button type="button" class="pill" data-market-move="1" aria-label="下一張市場刻度">下張</button></div>';
  rail.before(controls);
  function count(){const cards=[...rail.children],visible=cards.filter(c=>c.offsetLeft+c.offsetWidth>rail.scrollLeft+cards[0].offsetLeft+2&&c.offsetLeft<rail.scrollLeft+cards[0].offsetLeft+rail.clientWidth-2),first=cards.indexOf(visible[0])+1,last=cards.indexOf(visible.at(-1))+1;$('marketCount').textContent=rail.classList.contains('is-grid')?`${cards.length} 項全覽`:`${first||1}–${last||1} / ${cards.length} 項`}
  function layout(){const mode=['grid','rail'].includes(settings.marketView)?settings.marketView:innerWidth>=700?'grid':'rail';rail.classList.toggle('is-grid',mode==='grid');nav.classList.toggle('hidden',mode==='grid');rail.setAttribute('aria-label',mode==='grid'?'市場刻度全覽':'市場刻度，可左右滑動');controls.querySelectorAll('[data-market-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.marketView===mode)));controls.querySelector('.market-moves').classList.toggle('hidden',mode==='grid');rail.nextElementSibling?.classList.toggle('grid-progress-hidden',mode==='grid');count()}
  controls.addEventListener('click',e=>{const view=e.target.closest('[data-market-view]'),move=e.target.closest('[data-market-move]');if(view){settings.marketView=view.dataset.marketView;layout();save()}if(move){rail.dispatchEvent(new Event('pointerdown'));rail.scrollBy({left:Number(move.dataset.marketMove)*(rail.children[0].offsetWidth+16),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}});
  rail.addEventListener('scroll',count,{passive:true});window.addEventListener('resize',layout);
  const prev=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{prev(p);layout()};layout();
  // Actual sticky heights, including larger fonts, determine anchor clearance.
  function offsets(){const header=document.querySelector('header'),toolbar=document.querySelector('.toolbar'),h=header?.getBoundingClientRect().height||72,style=toolbar&&getComputedStyle(toolbar),sticky=style&&['fixed','sticky'].includes(style.position),covered=sticky?Math.max(h,(parseFloat(style.top)||0)+toolbar.getBoundingClientRect().height):h,padding=parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)||0;document.documentElement.style.setProperty('--header-clearance',Math.max(0,h+12-padding)+'px');document.documentElement.style.setProperty('--anchor-clearance',Math.max(0,covered+12-padding)+'px')}
  const ro=new ResizeObserver(offsets);for(const el of [document.querySelector('header'),document.querySelector('.toolbar')])if(el)ro.observe(el);offsets();
  const aliases={method:'weights','wave-lab':'waveStudy',chips:'chipCard',backtest:'backtestCard'};function alias(){const id=aliases[location.hash.slice(1)];if(id)$(id)?.scrollIntoView({behavior:'instant'})}window.addEventListener('hashchange',alias);setTimeout(alias,300);
  const top=document.querySelector('.to-top');if(top){top.textContent='回到觀測區';top.setAttribute('aria-label','回到上方觀測區');top.title='回到上方觀測區'}
})();

// Use confirmed training segments only when a test start date is specified.
var waveBridgeData=null;
const WaveBacktestBridge=(()=>{
  function summarize(segments,cutoff){
    const sample=segments.filter(s=>!cutoff||s.availableDate<cutoff),up=sample.filter(s=>s.change>0),down=sample.filter(s=>s.change<0),mean=a=>a.length?a.reduce((n,s)=>n+Math.abs(s.change),0)/a.length:null;
    return{up:mean(up),down:mean(down),upCount:up.length,downCount:down.length,count:sample.length};
  }
  return{summarize};
})();
const bridge=document.createElement('div');bridge.className='wave-bridge';bridge.innerHTML='<p class="small" id="waveBridgeNote">完成波段計算後，可帶入回測。</p><button type="button" class="pill" id="waveToBacktest" disabled>套用平均波段至回測</button>';$('waveSummary').after(bridge);
function refreshWaveBridge(){
  const d=waveBridgeData,s=d&&d.code===selected?WaveBacktestBridge.summarize(d.segments,d.params.cutoff):null;
  const enoughTest=!d?.params.cutoff||bars.filter(b=>b.date>=d.params.cutoff).length>=41;
  $('waveToBacktest').disabled=!isMember||!s?.up||!s?.down||shareView||!enoughTest;
  $('waveBridgeNote').textContent=s?.up&&s?.down?`${d.params.cutoff?'僅用測試起日前確認的訓練段':'全段描述統計（樣本內）'}：上漲 ${s.upCount} 段均幅 ${fmt(s.up,1)}%，拉回 ${s.downCount} 段均幅 ${fmt(s.down,1)}%。帶入後仍以日 K 回測，不代表轉折可預知。`:'需要已確認的上漲及拉回段，才能帶入參數。';
  if(!enoughTest)$('waveBridgeNote').textContent+=' 測試期需至少 41 個交易日；請將起日往前調整。';
}
const bridgeRender=window.chaoweiWave.render;window.chaoweiWave.render=function(){waveBridgeData=null;bridgeRender();refreshWaveBridge()};
$('waveToBacktest').addEventListener('click',()=>{
  if(!isMember||!waveBridgeData||waveBridgeData.code!==selected)return;
  const d=waveBridgeData,s=WaveBacktestBridge.summarize(d.segments,d.params.cutoff);if(!s.up||!s.down)return;
  const round=x=>Math.round(x*10)/10;
  Object.assign(settings.bt,{family:'swing',preset:'custom',strategy:'classic',params:{...E.PARAMS.classic,entry:'drop',drop:Math.max(1,Math.min(90,round(s.down))),exit:'gain',rise:Math.min(300,round(s.up))},waveOrigin:{code:selected,interval:d.interval,cutoff:d.params.cutoff||'',upCount:s.upCount,downCount:s.downCount}});
  if(d.params.cutoff)Object.assign(settings.bt,{period:'custom',from:d.params.cutoff,to:bars.at(-1).date});
  save();btFillForm();btSchedule();renderWaveOrigin();$('backtestCard').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
});
const origin=document.createElement('p');origin.id='btWaveOrigin';origin.className='small wave-origin';$('btParams').after(origin);
function renderWaveOrigin(){const o=settings.bt.waveOrigin;origin.textContent=o&&settings.bt.strategy==='classic'?`參數來源：${o.code} ${o.interval} K 的 ${o.upCount} 段上漲／${o.downCount} 段拉回。${o.cutoff?'只用 '+o.cutoff+' 前確認資料；下方起日已設為測試期。':'全段樣本內統計，未構成樣本外驗證。'}帶入後可自行調整；方向選單不會改寫回測內原有的水位交易條件。`:''}
const bridgeFill=btFillForm;btFillForm=function(){bridgeFill();renderWaveOrigin()};refreshWaveBridge();renderWaveOrigin();
const bridgePreset=btApplyPreset;btApplyPreset=function(...args){delete settings.bt.waveOrigin;bridgePreset(...args)};

// An optional current-observation factor. Historical backtest entry rules remain independent.
const ChipResonance=(()=>{
  function evaluate(chips,holders,{days=3,holder='1000',mode='both',through='9999-12-31'}={}){
    const daily=chips.filter(r=>r[0]<=through).slice(-days),weekly=holders.filter(r=>r[0]<=through).slice(-2),net=daily.map(r=>r[4]),col=holder==='400'?2:3;
    const inst=daily.length===days&&net.every(Number.isFinite)?net.every(x=>x>0):null;
    const change=weekly.length===2&&weekly.every(r=>Number.isFinite(r[col]))?weekly[1][col]-weekly[0][col]:null,held=change==null?null:change>0;
    const enabled=mode==='institution'?[inst]:mode==='holder'?[held]:[inst,held],score=enabled.some(x=>x===null)?null:5*enabled.filter(Boolean).length/enabled.length;
    return{score,inst,held,change,dailyDate:daily.at(-1)?.[0],holderDate:weekly.at(-1)?.[0]};
  }
  return{evaluate};
})();
function normalizeResonance(){const p=settings.chipResonance||{};settings.chipResonance={days:[2,3,5,10].includes(Number(p.days))?Number(p.days):3,holder:p.holder==='400'?'400':'1000',mode:['both','institution','holder'].includes(p.mode)?p.mode:'both'}}
normalizeResonance();
const resonance=document.createElement('div');resonance.className='resonance-panel';resonance.innerHTML='<h4>籌碼共振 <span class="member-badge">會員</span></h4><div class="controls"><label>觀察規則<select id="resonanceMode"><option value="both">法人＋大戶</option><option value="institution">只看法人連買</option><option value="holder">只看大戶週增</option></select></label><label>法人連買<select id="resonanceDays"><option value="2">2 日</option><option value="3">3 日</option><option value="5">5 日</option><option value="10">10 日</option></select></label><label>大戶門檻<select id="resonanceHolder"><option value="1000">1,000 張以上</option><option value="400">400 張以上</option></select></label></div><p id="resonanceReading" aria-live="polite" class="small"></p><p class="small">法人以三大法人合計買賣超判斷；大戶比較最近兩筆集保比例。每項成立得 5 分、不成立 0 分，兩項取平均。這是自訂規則，非勝率；只納入當前綜合分，未接入歷史回測。</p>';
$('chipContents').after(resonance);
function resonanceScore(){if(!isMember||chipCode!==selected)return null;return ChipResonance.evaluate(chipRows,holderRowsByCode.get(selected)||[],{...settings.chipResonance,through:$('chipDate').value||chipRows.at(-1)?.[0]}).score}
const resonanceFactor={id:'wResonance',setting:'chipResonanceWeight',label:'ETF 籌碼共振（會員）',name:'籌碼共振',score:resonanceScore};EXTRA_FACTORS.push(resonanceFactor);
const resonanceRow=document.createElement('div');resonanceRow.className='weight';resonanceRow.innerHTML='<label for="wResonance">ETF 籌碼共振（會員）</label><input id="wResonance" type="range" min="0" max="100" step="1" value="0"><input class="w-num" type="number" min="0" max="100" step="1" data-for="wResonance" aria-label="籌碼共振權重數值"><output id="oResonance">0%</output>';$('weights').querySelector('.weights').append(resonanceRow);resonanceFactor.row=resonanceRow;
function resonanceView(){normalizeResonance();const p=settings.chipResonance;for(const [id,key]of [['resonanceMode','mode'],['resonanceDays','days'],['resonanceHolder','holder']]){$(id).value=p[key];$(id).disabled=!isMember||shareView}$('wResonance').disabled=!isMember||shareView;resonanceRow.querySelector('.w-num').disabled=!isMember||shareView;if(!isMember){$('resonanceReading').textContent='Google 登入後可查看並納入權重。';return}const r=ChipResonance.evaluate(chipRows,holderRowsByCode.get(selected)||[],{...p,through:$('chipDate').value||chipRows.at(-1)?.[0]});$('resonanceReading').textContent=`${Number.isFinite(r.score)?fmt(r.score,1)+' / 5':'資料不足，暫不計分'} · 法人 ${r.dailyDate||'—'}：${r.inst===null?'不足 '+p.days+' 筆':r.inst?'連買成立':'連買未成立'} · 集保 ${r.holderDate||'—'}：${r.change==null?'需兩週資料':(r.change>=0?'+':'')+fmt(r.change,2)+' 個百分點'}`}
for(const [id,key]of [['resonanceMode','mode'],['resonanceDays','days'],['resonanceHolder','holder']])$(id).addEventListener('change',()=>{settings.chipResonance[key]=key==='days'?Number($(id).value):$(id).value;updateWeights()});
function resonanceWeight(){settings.chipResonanceWeight=Math.max(0,Math.min(100,Number(settings.chipResonanceWeight)||0));$('wResonance').value=settings.chipResonanceWeight;resonanceRow.querySelector('.w-num').value=settings.chipResonanceWeight}
$('wResonance').addEventListener('input',()=>{resonanceRow.querySelector('.w-num').value=$('wResonance').value;updateWeights()});resonanceRow.querySelector('.w-num').addEventListener('input',e=>{$('wResonance').value=Math.max(0,Math.min(100,Number(e.target.value)||0));updateWeights()});
const resonanceUpdate=updateWeights;updateWeights=function(){resonanceUpdate();resonanceView()};
const resonanceChip=renderChip;renderChip=function(){resonanceChip();updateWeights()};
const resonanceHolders=renderHolders;renderHolders=function(...args){resonanceHolders(...args);updateWeights()};
const resonanceMember=window.chaoweiResearchMemberChanged;window.chaoweiResearchMemberChanged=signed=>{resonanceMember?.(signed);updateWeights()};
const resonanceProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{resonanceProfile(p);normalizeResonance();resonanceWeight();updateWeights()};resonanceWeight();updateWeights();

/* Coordinates choose endpoints; prices/dates, never rectangle pixel area, determine returns. */
const ChartMeasurement=(()=>{
  const dateNumber=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?Date.parse(d+'T00:00:00Z'):NaN;
  function measure(series,a,b){
    if(!a||!b||!Number.isFinite(a.price)||!Number.isFinite(b.price)||a.price<=0||b.price<=0)return null;
    const i=series.findIndex(x=>x.date===a.date),j=series.findIndex(x=>x.date===b.date);
    if(i<0||j<0)return null;
    const from=Math.min(i,j),to=Math.max(i,j);let high=-Infinity,low=Infinity,volume=0;
    for(let k=from;k<=to;k++){high=Math.max(high,series[k].high);low=Math.min(low,series[k].low);volume+=Number.isFinite(series[k].volume)?series[k].volume:0}
    const days=(dateNumber(b.date)-dateNumber(a.date))/86400000;if(!Number.isFinite(days))return null;
    return{change:b.price-a.price,percent:(b.price/a.price-1)*100,bars:j-i,inclusive:Math.abs(j-i)+1,days,high,low,volume};
  }
  function risk(entry,stop,target,side='long'){
    if(![entry,stop,target].every(x=>Number.isFinite(x)&&x>0))return null;
    const sign=side==='short'?-1:1,loss=(entry-stop)*sign,gain=(target-entry)*sign;
    if(loss<=0||gain<=0)return null;
    return{loss,gain,r:gain/loss,lossPct:loss/entry*100,gainPct:gain/entry*100};
  }
  function normalize(list){return Array.isArray(list)?list.filter(x=>x&&/^[0-9A-Z]{4,6}$/.test(x.code)&&['D','W','M'].includes(x.interval)&&[x.a,x.b].every(p=>p&&Number.isFinite(dateNumber(p.date))&&Number.isFinite(p.price)&&p.price>0)).slice(-50).map(x=>({id:String(x.id||'').replace(/[^a-zA-Z0-9-]/g,'').slice(0,40),code:x.code,interval:x.interval,a:{date:x.a.date,price:x.a.price,source:['open','high','low','close','free'].includes(x.a.source)?x.a.source:'close'},b:{date:x.b.date,price:x.b.price,source:['open','high','low','close','free'].includes(x.b.source)?x.b.source:'close'},basis:'split',provisional:!!x.provisional})):[]}
  return{measure,risk,normalize};
})();

/* Member-only local measurement. Pointer previews never fetch data or write cloud settings. */
(()=>{
  settings.chartMeasures=ChartMeasurement.normalize(settings.chartMeasures);
  settings.measureSnap=['close','ohlc','free'].includes(settings.measureSnap)?settings.measureSnap:'close';
  const panel=document.createElement('section');panel.className='measure-panel member-only';panel.id='measurePanel';
  panel.innerHTML=`<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員進階</span><h4>親手量出一段走勢</h4><p>登入後拖曳量測漲跌幅、K 棒與天數，保存並跨裝置同步。</p><button class="action" type="button" data-open-account>用 Google 登入解鎖</button></div></div>
  <div class="research-head"><div><p class="kicker teal">RANGE STUDIO</p><h4>區間量測</h4></div><button class="pill" type="button" id="measureToggle" aria-pressed="false"> 在圖上量測</button></div>
  <div class="controls"><label>端點價格<select id="measureSnap"><option value="close">吸附收盤價</option><option value="ohlc">吸附最近開高低收</option><option value="free">自由價格座標</option></select></label><span class="small" id="measureHint">開啟後拖出區間；也可依序點選起點、終點。</span></div>
  <details class="measure-help"><summary>如何量測？</summary><ol><li>先選日／週／月 K，放大到要研究的區段。</li><li>按「在圖上量測」，拖曳或點兩個端點。吸附模式使用該根 K 的實際價格；自由模式使用游標對應的價格。</li><li>核對下方起訖與漲跌幅，再按「儲存區間」。按 Esc 取消繪圖；量測完成後可繼續縮放、平移。</li></ol><p class="small">漲跌幅＝（終點價格 ÷ 起點價格 − 1）×100%。K 棒間隔＝兩端索引差；含首尾根數另列。日曆天數使用日期差，週末與休市日不等於交易日。矩形面積僅是視覺範圍，不是獲利金額。價格沿用圖表分割還原口徑；不含配息、費用或成交保證。含盤中價會明確標示暫定。</p></details>
  <details class="measure-manual"><summary>精確輸入起訖</summary><div class="measure-inputs"><label>起始 K 日期<input type="date" id="measureFrom"></label><label>起始價格<input type="number" id="measurePriceA" min="0.000001" step="any"></label><label>結束 K 日期<input type="date" id="measureTo"></label><label>結束價格<input type="number" id="measurePriceB" min="0.000001" step="any"></label></div><button class="pill mini" type="button" id="measureApply">計算此區間</button><p class="small">週／月 K 請選圖上該根 K 的起始交易日。自由模式才可自行輸入價格；日期必須落在實際已載入的 K 棒。</p></details>
  <div class="measure-reading" id="measureReading" aria-live="polite">尚未選取區間</div><div class="measure-actions"><button class="pill mini" type="button" id="measureSave" disabled>儲存區間</button><button class="pill mini" type="button" id="measureCancel">清除預覽</button><button class="pill mini" type="button" id="measureExport">匯出區間</button></div>
  <details class="measure-risk"><summary>風險報酬試算（不下單）</summary><div class="measure-inputs"><label>方向<select id="measureSide"><option value="long">做多假設</option><option value="short">做空假設</option></select></label><label>假設進場價<input type="number" step="any" id="measureEntry"></label><label>停損價<input type="number" step="any" id="measureStop"></label><label>目標價<input type="number" step="any" id="measureTarget"></label></div><p class="small" id="measureRiskReading">請輸入進場、停損與目標價。使用目前量測的時間區間顯示目標／停損帶。</p><p class="small">R＝目標價差 ÷ 停損價差，不代表成功機率；未計費用、滑價、借券或放空限制。</p></details>
  <div class="measure-list" id="measureList"></div>`;
  pinPanel.before(panel);
  const chart=$('chart'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),surface=document.createElement('div');
  svg.classList.add('measure-overlay');svg.setAttribute('aria-hidden','true');surface.className='measure-surface hidden';surface.setAttribute('aria-label','拖曳或點選兩個價格端點以量測');chart.append(svg,surface);
  let active=false,draft=null,complete=false,dragging=false,pointerStart=null,moveFrame=0,renderFrame=0,pending=null,bound=null,listKey='';
  const names={close:'收',open:'開',high:'高',low:'低',free:'自訂'};
  const list=()=>settings.chartMeasures.filter(x=>x.code===selected&&x.interval===interval);
  const current=()=>lwc?.data||[];
  function point(x,y){
    if(!current().length)return null;const logical=lwc.main.timeScale().coordinateToLogical(x),raw=lwc.s.candle.coordinateToPrice(y);if(logical==null||raw==null)return null;
    const bar=current()[Math.max(0,Math.min(current().length-1,Math.round(logical)))];let source=settings.measureSnap;
    if(source==='ohlc')source=['open','high','low','close'].reduce((a,b)=>Math.abs(bar[a]-raw)<=Math.abs(bar[b]-raw)?a:b);
    const price=source==='free'?Math.round(raw*1e6)/1e6:bar[source];return price>0?{date:bar.date,price,source}:null;
  }
  function mode(on){active=!!on&&isMember&&!shareView;surface.classList.toggle('hidden',!active);$('measureToggle').setAttribute('aria-pressed',String(active));$('measureToggle').textContent=active?' 取消繪圖':' 在圖上量測';$('measureHint').textContent=active?'拖曳兩端，或依序點選。Esc 取消；繪圖時暫停圖表平移。':'開啟後拖出區間；也可依序點選起點、終點。';if(active){chart.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});if(pinMode){pinMode=false;pinModeButton.setAttribute('aria-pressed','false')}}}
  function provisional(d){return [d.a,d.b].some(p=>liveQuote?.available&&p.date===liveQuote.date&&liveQuote.date>(bars.at(-1)?.date||''))}
  function fields(){if(!draft?.b)return;$('measureFrom').value=draft.a.date;$('measureTo').value=draft.b.date;$('measurePriceA').value=draft.a.price;$('measurePriceB').value=draft.b.price}
  function reading(){
    const m=draft?.b?ChartMeasurement.measure(current(),draft.a,draft.b):null;$('measureSave').disabled=!isMember||!m||!complete||shareView;
    if(!m){$('measureReading').textContent=draft?'已選起點；請選終點。':'尚未選取區間';return}
    $('measureReading').replaceChildren();const title=document.createElement('strong');title.className=m.percent>0?'price-up':m.percent<0?'price-down':'';title.textContent=`${signNum(m.percent,2)}% · ${signNum(m.change,4)} 元`;
    const ends=document.createElement('p');ends.className='small';ends.textContent=`${draft.a.date} ${names[draft.a.source]} ${fmt(draft.a.price,4)}  至  ${draft.b.date} ${names[draft.b.source]} ${fmt(draft.b.price,4)}`;
    const stats=document.createElement('p');stats.className='small';stats.textContent=`${m.bars} 根 K 間隔（含首尾 ${m.inclusive} 根） · ${m.days} 日曆天 · 區間高 ${fmt(m.high,4)}／低 ${fmt(m.low,4)} 元${provisional(draft)?' · 含盤中暫定價':''}`;
    $('measureReading').append(title,ends,stats);
  }
  function risk(){const e=Number($('measureEntry').value),s=Number($('measureStop').value),t=Number($('measureTarget').value),side=$('measureSide').value,r=ChartMeasurement.risk(e,s,t,side);$('measureRiskReading').textContent=r?`風險報酬 ${fmt(r.r,2)} R · 目標價差 ${fmt(r.gainPct,2)}% · 停損價差 ${fmt(r.lossPct,2)}%（未計成本）`:side==='long'?'做多：停損 < 進場 < 目標；三者都須為正價格。':'做空：目標 < 進場 < 停損；三者都須為正價格。';return r?{entry:e,stop:s,target:t,...r}:null}
  function shape(tag,attrs,text){const e=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;svg.append(e);return e}
  function draw(){
    renderFrame=0;svg.replaceChildren();if(!isMember||!lwc?.data.length)return;
    const scale=uiFontScale(),axis=lwc.main.priceScale('right').width(),w=Math.max(0,chart.clientWidth-axis),h=chart.clientHeight;surface.style.right=axis+'px';svg.setAttribute('viewBox',`0 0 ${chart.clientWidth} ${h}`);
    const drawBox=(d,preview=false)=>{
      const x1=lwc.main.timeScale().timeToCoordinate(d.a.date),x2=lwc.main.timeScale().timeToCoordinate(d.b.date),y1=lwc.s.candle.priceToCoordinate(d.a.price),y2=lwc.s.candle.priceToCoordinate(d.b.price);if([x1,x2,y1,y2].some(x=>x==null))return;
      const m=ChartMeasurement.measure(current(),d.a,d.b);if(!m)return;const color=m.change>=0?RISE:FALL,left=Math.max(0,Math.min(x1,x2)),right=Math.min(w,Math.max(x1,x2));if(right<left)return;
      shape('rect',{x:left,y:Math.min(y1,y2),width:Math.max(1,right-left),height:Math.max(1,Math.abs(y2-y1)),fill:color,'fill-opacity':preview?.13:.06,stroke:color,'stroke-width':preview?1.6:1,'stroke-dasharray':preview?'':'4 3'});
      if(preview){shape('line',{x1,y1,x2,y2,stroke:color,'stroke-width':1.4});for(const[x,y]of [[x1,y1],[x2,y2]])shape('circle',{cx:x,cy:y,r:4,fill:color,stroke:'white'});const bw=Math.min(w-4,190*scale),bh=40*scale,tx=Math.max(2,Math.min(w-bw-2,(left+right-bw)/2)),ty=Math.min(h-bh-4,Math.max(8,Math.min(y1,y2)-bh-6));shape('rect',{x:tx,y:ty,width:bw,height:bh,rx:12,fill:color});shape('text',{x:tx+bw/2,y:ty+16*scale,'text-anchor':'middle',fill:'white','font-weight':700},`${signNum(m.percent,2)}% · ${m.bars} 根`);shape('text',{x:tx+bw/2,y:ty+32*scale,'text-anchor':'middle',fill:'white'},`${m.days} 日曆天 · ${signNum(m.change,2)} 元`)}
    };
    for(const d of list().slice(-8))drawBox(d);
    if(draft?.b){const rr=risk();if(rr){const x1=lwc.main.timeScale().timeToCoordinate(draft.a.date),x2=lwc.main.timeScale().timeToCoordinate(draft.b.date);if(x1!=null&&x2!=null){const ye=lwc.s.candle.priceToCoordinate(rr.entry);for(const[p,label]of [[rr.target,'目標'],[rr.stop,'停損']]){const y=lwc.s.candle.priceToCoordinate(p),color=p>=rr.entry?RISE:FALL;if(y!=null&&ye!=null){shape('rect',{x:Math.max(0,Math.min(x1,x2)),y:Math.min(y,ye),width:Math.max(0,Math.min(w,Math.max(x1,x2))-Math.max(0,Math.min(x1,x2))),height:Math.abs(y-ye),fill:color,'fill-opacity':.09});shape('text',{x:Math.max(4,Math.min(x1,x2)+4),y:Math.min(h-4,Math.max(12,y)),fill:color,'font-size':11},`${label} ${fmt(p,2)}`)}}}}drawBox(draft,true)}
  }
  function schedule(){if(!renderFrame)renderFrame=requestAnimationFrame(draw)}
  function renderList(){
    const measures=list(),key=JSON.stringify([selected,interval,measures,isMember,shareView]);if(key===listKey)return;listKey=key;$('measureList').replaceChildren();
    const title=document.createElement('p');title.className='small';title.textContent=`此檔 ${interval} K 已存 ${measures.length} 段 · 圖上最多顯示最近 8 段 · 全帳號保留最近 50 段`;$('measureList').append(title);
    for(const d of measures.toReversed()){const row=document.createElement('div');row.className='measure-row';const text=document.createElement('span');text.textContent=`${d.a.date}  至  ${d.b.date} · ${signNum((d.b.price/d.a.price-1)*100,2)}%${d.provisional?'（盤中快照）':''}`;const view=document.createElement('button');view.className='pill mini';view.textContent='查看';view.type='button';view.addEventListener('click',()=>{draft=structuredClone(d);complete=true;fields();reading();const a=current().findIndex(x=>x.date===d.a.date),b=current().findIndex(x=>x.date===d.b.date);if(a>=0&&b>=0)lwc.main.timeScale().setVisibleLogicalRange({from:Math.min(a,b)-5,to:Math.max(a,b)+5});schedule()});const remove=document.createElement('button');remove.type='button';remove.className='pill mini';remove.textContent='移除';remove.disabled=shareView;remove.setAttribute('aria-label','移除量測 '+d.a.date+' 至 '+d.b.date);remove.addEventListener('click',()=>{settings.chartMeasures=settings.chartMeasures.filter(x=>x.id!==d.id);save();renderList();schedule()});row.append(text,view,remove);$('measureList').append(row)}
  }
  function sync(){if(bound!==lwc?.main&&lwc?.main){bound=lwc.main;bound.timeScale().subscribeVisibleLogicalRangeChange(schedule)}if(draft&&(draft.code!==selected||draft.interval!==interval)){draft=null;complete=false;mode(false)}renderList();reading();schedule()}
  $('measureToggle').addEventListener('click',()=>{if(!isMember){$('accountTop').click();return}if(!active){draft=null;complete=false;reading()}mode(!active);schedule()});
  pinModeButton.addEventListener('click',()=>{if(pinMode)mode(false)});
  $('measureSnap').value=settings.measureSnap;
  $('measureSnap').addEventListener('change',()=>{settings.measureSnap=$('measureSnap').value;$('measurePriceA').readOnly=$('measurePriceB').readOnly=settings.measureSnap!=='free';save()});$('measurePriceA').readOnly=$('measurePriceB').readOnly=settings.measureSnap!=='free';
  surface.addEventListener('pointerdown',e=>{if(!active||!isMember)return;e.preventDefault();surface.setPointerCapture(e.pointerId);dragging=true;pointerStart=[e.clientX,e.clientY];const r=chart.getBoundingClientRect(),p=point(e.clientX-r.left,e.clientY-r.top);if(!p)return;if(!draft||complete){draft={code:selected,interval,a:p,b:null};complete=false}else draft.b=p;reading();schedule()});
  surface.addEventListener('pointermove',e=>{if(!active||!draft||complete)return;const r=chart.getBoundingClientRect();pending=[e.clientX-r.left,e.clientY-r.top];if(moveFrame)return;moveFrame=requestAnimationFrame(()=>{moveFrame=0;const p=point(...pending);if(p){draft.b=p;reading();schedule()}})});
  surface.addEventListener('pointerup',e=>{if(!dragging)return;dragging=false;if(moveFrame){cancelAnimationFrame(moveFrame);moveFrame=0}const moved=pointerStart&&Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>4;if(moved||draft?.b){const r=chart.getBoundingClientRect(),p=point(e.clientX-r.left,e.clientY-r.top);if(p&&draft){draft.b=p;complete=true;mode(false);fields();reading();schedule()}}});
  surface.addEventListener('pointercancel',()=>{dragging=false;draft=null;complete=false;mode(false);reading();schedule()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){draft=null;complete=false;mode(false);reading();schedule()}});
  $('measureApply').addEventListener('click',()=>{if(!isMember)return;const p=(id,priceId)=>{const bar=current().find(b=>b.date===$(id).value);if(!bar)return null;const free=settings.measureSnap==='free';return{date:bar.date,price:free?Number($(priceId).value):bar.close,source:free?'free':'close'}};const a=p('measureFrom','measurePriceA'),b=p('measureTo','measurePriceB');if(!a||!b||!ChartMeasurement.measure(current(),a,b)){$('measureHint').textContent='請選實際已載入的 K 日期，且價格必須大於零。';return}draft={code:selected,interval,a,b};complete=true;mode(false);fields();reading();schedule()});
  $('measureSave').addEventListener('click',()=>{if(!isMember||!complete||!draft?.b||shareView)return;const d={...structuredClone(draft),id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),basis:'split',provisional:provisional(draft)};settings.chartMeasures=ChartMeasurement.normalize([...settings.chartMeasures,d]);save();draft=null;complete=false;reading();renderList();schedule();$('measureHint').textContent='已儲存；登入主網站時會同步到雲端。'});
  $('measureCancel').addEventListener('click',()=>{draft=null;complete=false;mode(false);reading();schedule()});
  $('measureExport').addEventListener('click',()=>{if(!isMember)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({code:selected,basis:'split',measurements:list()},null,2)],{type:'application/json'}));a.href=url;a.download=selected+'-measurements.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
  for(const id of ['measureEntry','measureStop','measureTarget','measureSide'])$(id).addEventListener('input',()=>{risk();schedule()});
  const prevDraw=drawChart;drawChart=function(...args){prevDraw(...args);sync()};
  const prevMember=window.chaoweiResearchMemberChanged;window.chaoweiResearchMemberChanged=signed=>{prevMember?.(signed);if(!signed){draft=null;complete=false;mode(false)}sync()};
  const prevProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{prevProfile(p);settings.chartMeasures=ChartMeasurement.normalize(settings.chartMeasures);settings.measureSnap=['close','ohlc','free'].includes(settings.measureSnap)?settings.measureSnap:'close';$('measureSnap').value=settings.measureSnap;$('measurePriceA').readOnly=$('measurePriceB').readOnly=settings.measureSnap!=='free';sync()};
  window.addEventListener('chaowei-typography-changed',schedule);new ResizeObserver(schedule).observe(chart);sync();
})();

const ViewportMath=(()=>{
  function clamp(range,n){if(!range||!n||![range.from,range.to].every(Number.isFinite))return null;const span=Math.max(Math.min(2,n),Math.min(n,Math.max(0,range.to-range.from))),from=Math.max(-.5,Math.min(n-.5-span,range.from));return{from,to:from+span}}
  function anchor(daily,display,index){if(!daily.length||!display.length)return-1;const next=display[Math.min(display.length-1,index)+1]?.date;let lo=0,hi=daily.length;while(lo<hi){const m=(lo+hi)>>1;if(!next||daily[m].date<next)lo=m+1;else hi=m}return lo-1}
  return{clamp,anchor};
})();

// Historical guide lines follow the rightmost visible bar; current cards and backtests keep their own dates.
(()=>{
  const tools=document.createElement('div');tools.className='viewport-tools';tools.innerHTML='<button class="pill mini" type="button" id="fitViewport">貼合畫面</button><button class="pill mini" type="button" id="latestViewport">回到最新區間</button><span class="small" id="viewportNote" aria-live="polite">圖上水位跟隨畫面最右側 K 棒。</span>';$('chartCard').querySelector('.level-tools').after(tools);
  let chart=null,frame=0,guard=false,bounds=null,key='',lines=[],source=null,ctx=null;
  function clear(){for(const line of lines)lwc?.s.candle.removePriceLine(line);lines=[]}
  function refresh(){
    frame=0;if(!lwc?.data.length){bounds=null;clear();return}const ts=lwc.main.timeScale(),r=ts.getVisibleLogicalRange(),safe=ViewportMath.clamp(r,lwc.data.length);if(!safe)return;
    if(!guard&&(Math.abs(safe.from-r.from)>.01||Math.abs(safe.to-r.to)>.01)){guard=true;ts.setVisibleLogicalRange(safe);guard=false}
    $('chart').dataset.fromIndex=safe.from;$('chart').dataset.toIndex=safe.to;$('chart').dataset.barCount=lwc.data.length;const daily=lwc.daily||bars;if(source!==daily){source=daily;ctx={n:daily.length,bars:daily,refCache:new Map()};key=''}
    const end=Math.max(0,Math.min(lwc.data.length-1,Math.floor(safe.to))),at=ViewportMath.anchor(daily,lwc.data,end),anchor=daily[at];if(!anchor)return;
    const next=[at,settings.window,settings.anchorMode,settings.anchorCount,settings.method,settings.showLevels].join('|');
    if(next!==key){key=next;clear();const ref=E.reference(ctx,settings.window,settings.anchorMode,settings.anchorCount),low=ref.lo[at],high=ref.hi[at];bounds=settings.showLevels&&Number.isFinite(low)&&Number.isFinite(high)&&high>low?{low,high}:null;
      if(bounds)for(const f of settings.method==='fib'?[0,.236,.382,.618,.786,1]:[0,.2,.4,.6,.8,1])lines.push(lwc.s.candle.createPriceLine({price:low+(high-low)*f,color:f===0||f===1?'#438d98':'#9abfc0',lineWidth:f===0||f===1?2:1,lineStyle:2,axisLabelVisible:true,title:`${Number((f*100).toFixed(1))}%`}));
    }
    lwc.visibleAnchor=end;updateLegend(end);const historical=at<daily.length-1;lwc.s.candle.applyOptions({lastValueVisible:!historical,priceLineVisible:!historical});if(historical)lwc.s.candle.applyOptions({title:''});else labelLastBar();
    $('viewportNote').textContent=`圖上錨點 ${anchor.date}${bounds?' · 前 '+(settings.window==='all'?at:settings.window)+' 交易日：'+fmt(bounds.low,2)+' 至 '+fmt(bounds.high,2):settings.showLevels?' · 前期資料不足，暫不畫水位線':' · 水位線未開啟'}${historical?'；上方卡片仍為最近報價。':'。'}`;
    $('viewportNote').dataset.anchor=anchor.date;$('viewportNote').dataset.low=bounds?.low??'';$('viewportNote').dataset.high=bounds?.high??'';
    lwc.main.priceScale('right').applyOptions({autoScale:true});
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(refresh)}
  function bind(){if(!lwc||chart===lwc.main)return;chart=lwc.main;chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);lwc.s.candle.applyOptions({autoscaleInfoProvider:original=>{const info=original();if(!info?.priceRange)return info;let{minValue:lo,maxValue:hi}=info.priceRange;if(bounds){lo=Math.min(lo,bounds.low);hi=Math.max(hi,bounds.high)}const pad=Math.max(hi-lo,Math.abs(hi)*.0001,.0001)*.06;return{priceRange:{minValue:lo-pad,maxValue:hi+pad}}}});chart.priceScale('right').applyOptions({scaleMargins:{top:0,bottom:0},autoScale:true})}
  function fit(){if(!lwc)return;bounds=null;key='';bind();refresh();lwc.main.priceScale('right').applyOptions({autoScale:true})}
  $('fitViewport').addEventListener('click',fit);$('latestViewport').addEventListener('click',()=>{setRange('1m');fit()});$('chart').addEventListener('dblclick',e=>{if(e.target.closest('.measure-surface'))return;fit()});
  const previous=drawChart;drawChart=function(...args){previous(...args);bind();key='';schedule()};
  window.chaoweiViewport={refresh:schedule};bind();schedule();
})();

(()=>{
  const note=document.createElement('p');note.className='small cache-note';note.id='cacheState';$('historyNote').after(note);
  window.addEventListener('chaowei-cache-storage',e=>{if(e.detail.path===`data/history/${selected}.json`){note.dataset.databaseRead=e.detail.read;if(e.detail.ms!=null)note.dataset.databaseMs=e.detail.ms.toFixed(2)}});
  window.addEventListener('chaowei-cache-status',e=>{const d=e.detail;if(d.path!==`data/history/${selected}.json`)return;note.textContent=d.source==='stale'?'背景核對未完成，沿用上方標示日期的歷史資料。':d.source==='network'?'歷史快照已核對；盤中報價另行更新。':'先顯示本機歷史快取，背景核對最新快照。';note.dataset.source=d.source;if(d.ms!=null){note.dataset.readMs=d.ms.toFixed(2);note.dataset.readSource=d.readSource||d.source}if(d.storage)note.dataset.storage=d.storage});
  const timers=new Map();
  function refresh(path){clearTimeout(timers.get(path));timers.set(path,setTimeout(()=>{if(path===`data/history/${selected}.json`)loadBars(true);else if(path==='data/history/market.json')loadMarket();else if(path==='data/oil-spot.json')loadBrent();else if(path==='data/fx.json')loadFx();else if(path==='data/history/margin.json')loadMktMargin();else if(path==='data/history/histock-bank.json')loadBanks();else if(path==='etf-catalog.json')fetch('/api/etfs').then(r=>r.json()).then(d=>{if(d.etfs?.length){catalog=d.etfs;renderList()}}).catch(()=>{})},0))}
  window.addEventListener('chaowei-snapshot-updated',e=>refresh(e.detail.path));window.addEventListener('chaowei-history-live',e=>{if(e.detail.code===selected)refresh(`data/history/${selected}.json`)});
})();

(()=>{
  settings.studyMode='full';
  const mode=document.createElement('div');mode.className='study-mode-bar';mode.innerHTML='<div class="segment" role="group" aria-label="研究檢視"><button type="button" data-study-mode="basic">基礎檢視</button><button type="button" data-study-mode="full">完整研究</button></div><button class="pill mini" id="quickTour" type="button">操作教學</button>';
  document.querySelector('.toolbar').after(mode);$('quickTour').addEventListener('click',startTour);
  const motion=$('motionToggle');mode.append(motion);motion.classList.add('pill','mini');
  const drawers=[];
  for(const [id,title]of [['measurePanel','區間量測'],['chipCard','法人與融資'],['holderCard','大戶持有分布'],['waveStudy','波段研究'],['weights','權重設定']]){const node=$(id),d=document.createElement('details');d.className='study-drawer';d.id='drawer-'+id;const s=document.createElement('summary');s.textContent=title;node.before(d);d.append(s,node);drawers.push(d)}
  const pin=document.querySelector('.wave-pin-panel');if(pin){const d=document.createElement('details');d.className='study-drawer';d.innerHTML='<summary>研究圖釘</summary>';pin.before(d);d.append(pin);drawers.push(d)}
  let lastMode='';
  function apply(){const basic=false;document.body.classList.toggle('basic-study',basic);mode.querySelectorAll('[data-study-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.studyMode==='basic')===basic)));if(lastMode!==settings.studyMode){drawers.forEach(d=>d.open=!basic);lastMode=settings.studyMode}settings.uiMode=basic?'novice':'expert';document.body.classList.toggle('novice',basic)}
  mode.addEventListener('click',e=>{const b=e.target.closest('[data-study-mode]');if(b){settings.studyMode=b.dataset.studyMode;apply();save()}});
  const cards=[...$('factorRail').children].filter(el=>el.querySelector('.factor-direction'));
  function refreshMeta(card){const meta=card.querySelector('p[id$="Meta"]');if(!meta)return;const plain=card.querySelector('.factor-plain');plain.textContent=meta.textContent.split(' · ').slice(0,2).join(' · ')}
  for(const card of cards){const meta=card.querySelector('p[id$="Meta"]');if(!meta)continue;meta.classList.add('factor-detail');const plain=document.createElement('p');plain.className='factor-plain';meta.before(plain);const button=document.createElement('button');button.type='button';button.className='pill mini factor-detail-toggle';button.textContent='設定與細節';button.setAttribute('aria-expanded','false');button.addEventListener('click',e=>{e.stopPropagation();const on=card.classList.toggle('details-open');button.setAttribute('aria-expanded',String(on));button.textContent=on?'收起細節':'設定與細節'});card.append(button);new MutationObserver(()=>refreshMeta(card)).observe(meta,{childList:true,characterData:true,subtree:true});refreshMeta(card)}
  const intro=document.createElement('div');intro.className='first-visit';intro.innerHTML='<p>第一次使用？10 步認識分數、圖表與歷史驗證。</p><button class="pill mini" type="button" id="introStart">開始導覽</button><button class="pill mini" type="button" id="introLater">稍後</button>';mode.after(intro);
  function introState(){intro.classList.toggle('hidden',!!settings.tourDone||!!settings.quickTourDone||sessionStorage.getItem('chaowei-tour-deferred')==='yes')}
  $('introStart').addEventListener('click',()=>{intro.classList.add('hidden');startTour()});$('introLater').addEventListener('click',()=>{sessionStorage.setItem('chaowei-tour-deferred','yes');introState()});
  const aliases={method:'weights','wave-lab':'waveStudy',chips:'chipCard',backtest:'backtestCard'};
  function followHash(){const id=aliases[location.hash.slice(1)]||location.hash.slice(1),node=$(id);if(!node)return;let parent=node.closest('details.study-drawer');while(parent){parent.open=true;parent=parent.parentElement.closest('details.study-drawer')}if(id&&node.closest('.study-drawer'))requestAnimationFrame(()=>node.scrollIntoView({behavior:'instant',block:'start'}))}
  window.addEventListener('hashchange',followHash);
  const oldTour=endTour;endTour=function(){oldTour();settings.quickTourDone=true;save();introState()};
  const oldProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{oldProfile(p);settings.studyMode='full';apply();introState();followHash()};
  window.addEventListener('chaowei-study-mode-changed',apply);$('btMode').hidden=true;apply();introState();followHash();
})();

const VisualMetrics=(()=>{
  function range(rows,from,to){if(!rows.length)return null;let a=rows.findIndex(r=>r.time>=from),b=rows.length-1;while(b>=0&&rows[b].time>to)b--;return a>=0&&b>=a?{a,b}:null}
  function period(rows,a,b,navExtremes=false){a=Math.max(0,Math.ceil(a));b=Math.min(rows.length-1,Math.floor(b));if(b<a||!(rows[a]?.nav>0))return null;let peak=rows[a].nav,mdd=0,high=a,low=a;const key=navExtremes?'nav':'value';for(let i=a;i<=b;i++){peak=Math.max(peak,rows[i].nav);mdd=Math.max(mdd,1-rows[i].nav/peak);if(rows[i][key]>rows[high][key])high=i;if(rows[i][key]<rows[low][key])low=i}return{a,b,from:rows[a].time,to:rows[b].time,bars:b-a+1,ret:rows[b].nav/rows[a].nav-1,mdd,high,low,startValue:rows[a].value,endValue:rows[b].value}}
  function histogram(values,bins=10){const a=values.filter(Number.isFinite);if(!a.length)return null;const max=Math.max(...a,1e-9),width=max/bins,counts=Array(bins).fill(0);a.forEach(x=>counts[Math.min(bins-1,Math.max(0,Math.floor(x/width)))]++);return{counts,width,max,mean:a.reduce((s,v)=>s+v,0)/a.length,n:a.length}}
  function attribution(r){const price=r.equity-r.contributed-r.dividends-r.interest+r.fees;return{price,dividends:r.dividends,interest:r.interest,fees:-r.fees,net:r.equity-r.contributed}}
  function ratios(rows,key='alpha'){const usable=rows.filter(r=>Number.isFinite(r[key])),wins=usable.filter(r=>r[key]>1e-10).length,ties=usable.filter(r=>Math.abs(r[key])<=1e-10).length;return{total:usable.length,wins,ties,losses:usable.length-wins-ties,average:usable.length?usable.reduce((s,r)=>s+r[key],0)/usable.length:null}}
  function crossing(a,b,c,d){const x=a-b,y=c-d;return x*y<0?x/(x-y):null}
  return{range,period,histogram,attribution,ratios,crossing};
})();

/* A chart viewport is an inspection of the existing simulation, not a new entry date. */
(()=>{
  let current=null,logical=null,bound=null,frame=0,busy=false,reindex=false,marks=false,shade=true,projected=null,projectedMode=null,projectedAnchor=-1;
  const controls=document.createElement('details');controls.className='metric-detail subperiod-controls';controls.id='subperiodControls';controls.innerHTML='<summary>放大查看某段時間</summary><div class="subperiod-quick">'+[['all','全部'],['1','近 1 年'],['3','近 3 年'],['5','近 5 年']].map(([v,t])=>`<button type="button" class="pill mini" data-bt-view="${v}">${t}</button>`).join('')+'</div><div class="controls"><label>起始日期<input type="date" id="viewFrom"></label><label>結束日期<input type="date" id="viewTo"></label><button class="pill mini" id="viewApply" type="button">查看自訂區間</button></div><label class="bt-check"><input type="checkbox" id="viewReindex">以視窗起點歸零（時間加權報酬）</label><label class="bt-check"><input type="checkbox" id="viewMarks">標示區段高低點</label><label class="bt-check"><input type="checkbox" id="viewShade" checked>顯示策略與定額差額底色</label><p class="small" id="viewMessage">拖曳平移、滾輪縮放；圖表視窗不會重設原策略的持倉。</p>';
  $('btEquity').closest('.bt-equity-wrap').before(controls);controls.querySelector('.subperiod-quick').before(controls.querySelector('.controls'));const banner=document.createElement('div');banner.id='visibleMetrics';banner.className='visible-metrics';controls.append(banner);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('spread-overlay');svg.setAttribute('aria-hidden','true');$('btEquity').append(svg);
  function setWindow(from,to){if(!current||!btCharts)return;const r=VisualMetrics.range(current.series,from,to);if(!r||r.b-r.a<1){$('viewMessage').textContent='這段日期不在本次回測資料中，請調整日期或先延長回測期間。';return}$('viewMessage').textContent='顯示 '+current.series[r.a].time+' 至 '+current.series[r.b].time+'；僅沿用這次回測的既有部位。';btCharts.top.timeScale().setVisibleLogicalRange({from:r.a,to:r.b});schedule()}
  controls.addEventListener('click',e=>{const b=e.target.closest('[data-bt-view]');if(!b||!current)return;const v=b.dataset.btView,last=current.series.at(-1).time,d=new Date(last+'T00:00:00Z');if(v==='all')setWindow(current.start,current.end);else{d.setUTCFullYear(d.getUTCFullYear()-Number(v));setWindow(d.toISOString().slice(0,10),last)}});
  $('viewApply').addEventListener('click',()=>{if(!$('viewFrom').value||!$('viewTo').value){$('viewMessage').textContent='請填寫起始與結束日期。';return}if($('viewFrom').value>$('viewTo').value){$('viewMessage').textContent='起日需早於迄日。';return}setWindow($('viewFrom').value,$('viewTo').value)});$('viewReindex').addEventListener('change',e=>{reindex=e.target.checked;schedule()});$('viewMarks').addEventListener('change',e=>{marks=e.target.checked;schedule()});$('viewShade').addEventListener('change',e=>{shade=e.target.checked;schedule()});
  function project(r,a){if(!btCharts)return;const fmtValue=reindex?v=>fmt(v,1)+'%':v=>fmt(v/1e4,1)+' 萬';for(const[s,data]of[[btCharts.s,r.series],[btCharts.d,r.dca.series],[btCharts.h,r.bh.series]]){const base=data[a]?.nav;s.setData(data.map(x=>({time:x.time,value:reindex&&base>0?(x.nav/base-1)*100:x.value})));s.applyOptions({priceFormat:{type:'custom',formatter:fmtValue}})}btCharts.c.setData(reindex?[]:r.series.map(x=>({time:x.time,value:x.contributed})));}
  function spread(a,b){svg.replaceChildren();if(!shade||!current||!btCharts)return;const w=$('btEquity').clientWidth,h=$('btEquity').clientHeight;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);const as=current.series[a].nav,bs=current.dca.series[a].nav,val=(row,base)=>reindex?(row.nav/base-1)*100:row.value;
    for(let i=Math.max(0,a);i<b;i++){const one=current.series[i],two=current.series[i+1],d1=current.dca.series[i],d2=current.dca.series[i+1],x1=btCharts.top.timeScale().timeToCoordinate(one.time),x2=btCharts.top.timeScale().timeToCoordinate(two.time),s1=val(one,as),s2=val(two,as),v1=val(d1,bs),v2=val(d2,bs),ys1=btCharts.s.priceToCoordinate(s1),ys2=btCharts.s.priceToCoordinate(s2),yd1=btCharts.d.priceToCoordinate(v1),yd2=btCharts.d.priceToCoordinate(v2);if([x1,x2,ys1,ys2,yd1,yd2].some(v=>v==null)||Math.abs(s1-v1)<1e-8&&Math.abs(s2-v2)<1e-8)continue;
      const draw=(points,positive)=>{const p=document.createElementNS(svg.namespaceURI,'polygon');p.setAttribute('points',points.map(p=>p.join(',')).join(' '));p.setAttribute('fill',positive?'rgba(8,145,178,.16)':'rgba(217,119,6,.15)');svg.append(p)},t=VisualMetrics.crossing(s1,v1,s2,v2);if(t!=null){const x=x1+(x2-x1)*t,y=ys1+(ys2-ys1)*t;draw([[x1,ys1],[x,y],[x1,yd1]],s1>=v1);draw([[x,y],[x2,ys2],[x2,yd2]],s2>=v2)}else draw([[x1,ys1],[x2,ys2],[x2,yd2],[x1,yd1]],s1>=v1);
    }
  }
  function refresh(){const started=performance.now();frame=0;if(!current||!btCharts||busy)return;let range=btCharts.top.timeScale().getVisibleLogicalRange();if(!range)return;const bounded=ViewportMath.clamp(range,current.series.length);if(bounded&&(Math.abs(bounded.from-range.from)>.01||Math.abs(bounded.to-range.to)>.01)){busy=true;try{btCharts.top.timeScale().setVisibleLogicalRange(bounded);btCharts.under.timeScale().setVisibleLogicalRange(bounded)}finally{busy=false}range=bounded;}$('btEquity').dataset.fromIndex=range.from;$('btEquity').dataset.toIndex=range.to;$('btEquity').dataset.barCount=current.series.length;const a=Math.max(0,Math.min(current.series.length-1,Math.ceil(range.from))),b=Math.max(a,Math.min(current.series.length-1,Math.floor(range.to))),s=VisualMetrics.period(current.series,a,b,reindex),d=VisualMetrics.period(current.dca.series,a,b);if(!s||!d)return;logical={...range};busy=true;try{if(projected!==current||projectedMode!==reindex||reindex&&projectedAnchor!==a){projected=current;projectedMode=reindex;projectedAnchor=a;project(current,a);btCharts.top.timeScale().setVisibleLogicalRange(range);btCharts.under.timeScale().setVisibleLogicalRange(range)}const legends=document.querySelectorAll('.bt-equity-legend:not(.sub) span');if(legends.length===4){legends[0].textContent=reindex?'策略報酬':'策略資產';legends[3].hidden=reindex}const under=document.querySelector('.bt-equity-legend.sub');if(under?.querySelector('.s')&&under?.querySelector('.d')){under.querySelector('.s').textContent='策略全期回落';under.querySelector('.d').textContent='定額全期回落'}const alpha=s.ret-d.ret;banner.innerHTML=`<p class="small">檢視 ${s.from} 至 ${s.to} · ${s.bars} 個交易日</p><strong>策略 ${pctText(s.ret)} <span>／定額 ${pctText(d.ret)}</span></strong><p class="${alpha>=0?'relative-ahead':'relative-behind'}">${alpha>=0?'領先':'落後'} ${fmt(Math.abs(alpha)*100,2)} 個百分點 · 區間回落 ${fmt(s.mdd*100,1)}%</p><p class="small">時間加權、排除新增入金；沿用原部位。原本的全期年化指標不變；下方回落線仍依全期高點計算。</p>`;banner.dataset.from=s.from;banner.dataset.to=s.to;banner.dataset.strategy=s.ret;banner.dataset.benchmark=d.ret;banner.dataset.mdd=s.mdd;
      const high=current.series[s.high],low=current.series[s.low];btCharts.s.setMarkers(marks?[{time:high.time,position:'aboveBar',shape:'circle',color:'#0891b2',text:'高 '+(reindex?pctText(high.nav/current.series[a].nav-1):money(high.value))},{time:low.time,position:'belowBar',shape:'circle',color:'#d97706',text:'低 '+(reindex?pctText(low.nav/current.series[a].nav-1):money(low.value))}].sort((x,y)=>x.time.localeCompare(y.time)):[]);$('viewFrom').value=s.from;$('viewTo').value=s.to;spread(a,b);
    }finally{banner.dataset.computeMs=(performance.now()-started).toFixed(2);busy=false}}
  function schedule(){if(!frame)frame=requestAnimationFrame(refresh)}
  const old=btDrawCharts;btDrawCharts=function(r){const same=current&&current.start===r.start&&current.end===r.end&&current.series.length===r.series.length;current=r;projected=null;old(r);const c=btCharts;if(!c)return;c.s.applyOptions({color:document.body.classList.contains('dark')?'#22d3ee':'#087f96',lineWidth:3});c.d.applyOptions({color:'#d99116',lineWidth:2});c.h.applyOptions({color:'#9b83d5',lineWidth:2,lineStyle:2});if(bound!==c.top){bound=c.top;c.top.timeScale().subscribeVisibleLogicalRangeChange(schedule);c.under.timeScale().subscribeVisibleLogicalRangeChange(schedule)}if(same&&logical)c.top.timeScale().setVisibleLogicalRange(logical);schedule()};
  window.addEventListener('chaowei-typography-changed',schedule);new ResizeObserver(schedule).observe($('btEquity'));if(btResult)btDrawCharts(btResult);
})();

/* All SVG chip/holder/market history charts share the same zoom, pan and date controls. */
(()=>{
  const original=chipChart;chipChart=function(input){if(input.dates.length<3)return original(input);const outer=document.createElement('div');outer.className='zoomable-history';const tools=document.createElement('div');tools.className='history-zoom-tools';tools.innerHTML='<button class="pill mini" type="button" data-zoom="in">放大</button><button class="pill mini" type="button" data-zoom="out">縮小</button><button class="pill mini" type="button" data-zoom="all">全部</button><label>起<input type="date" class="history-from" aria-label="'+input.title+'起日"></label><label>迄<input type="date" class="history-to" aria-label="'+input.title+'迄日"></label><button class="pill mini" type="button" data-zoom="date">查看</button>';const host=document.createElement('div');host.className='history-zoom-host';const disclosure=document.createElement('details');disclosure.className='metric-detail history-zoom-controls';disclosure.innerHTML='<summary>縮放與日期</summary>';disclosure.append(tools);outer.append(disclosure,host);let a=0,b=input.dates.length-1,raf=0,drag=null;const from=tools.querySelector('.history-from'),to=tools.querySelector('.history-to');
    function paint(){raf=0;const cut=s=>s?{...s,data:s.data.slice(a,b+1)}:s;host.replaceChildren(original({...input,dates:input.dates.slice(a,b+1),series:input.series.map(cut),line:cut(input.line),right:cut(input.right)}));from.value=input.dates[a];to.value=input.dates[b];outer.dataset.from=from.value;outer.dataset.to=to.value}
    function draw(){if(!raf)raf=requestAnimationFrame(paint)}function bounds(x,y){const n=input.dates.length,span=Math.max(2,Math.min(n-1,Math.round(y-x))),start=Math.max(0,Math.min(n-1-span,Math.round(x)));a=start;b=start+span;draw()}
    function zoom(focus,factor){const span=b-a,next=Math.max(2,Math.min(input.dates.length-1,span*factor)),left=a+span*focus-next*focus;bounds(left,left+next)}tools.addEventListener('click',e=>{const v=e.target.closest('[data-zoom]')?.dataset.zoom;if(v==='in')zoom(.5,.65);if(v==='out')zoom(.5,1.5);if(v==='all')bounds(0,input.dates.length-1);if(v==='date'){const rows=input.dates.map(time=>({time})),r=VisualMetrics.range(rows,from.value,to.value);if(r&&r.b>r.a)bounds(r.a,r.b);else{from.setCustomValidity('此區間沒有至少兩筆資料');from.reportValidity();setTimeout(()=>from.setCustomValidity(''),0)}}});
    host.addEventListener('wheel',e=>{e.preventDefault();const r=host.getBoundingClientRect();zoom(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),e.deltaY>0?1.2:.8)},{passive:false});host.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,a,b,id:e.pointerId};host.setPointerCapture(e.pointerId)});host.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(e.pointerType==='touch'&&Math.abs(dy)>Math.abs(dx)+10){drag=null;return}if(Math.abs(dx)<6)return;const shift=Math.round(-dx/Math.max(1,host.clientWidth)*(drag.b-drag.a));bounds(drag.a+shift,drag.b+shift)});for(const event of ['pointerup','pointercancel'])host.addEventListener(event,()=>{drag=null});host.tabIndex=0;host.setAttribute('aria-label',input.title+'，加減鍵縮放、左右鍵平移');host.addEventListener('keydown',e=>{if(['+','=','-','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();if(e.key==='+'||e.key==='=')zoom(.5,.65);else if(e.key==='-')zoom(.5,1.5);else{const step=Math.max(1,Math.round((b-a)/4))*(e.key==='ArrowRight'?1:-1);bounds(a+step,b+step)}}});paint();return outer};
  // Replace charts already drawn before this module was installed.
  if(chipRows.length)renderChip();if(holderRowsByCode.has(selected))renderHolders(selected,holderRowsByCode.get(selected));renderBankTrend();
})();

/* Progressive disclosure: one overview, then independent money/risk/transactions panels. */
(()=>{
  const NS='http://www.w3.org/2000/svg';
  function svgNode(tag,attrs={},text){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;return e}
  function detail(label,id){const d=document.createElement('details');d.className='metric-detail';if(id)d.id=id;const s=document.createElement('summary');s.textContent=label;d.append(s);return d}
  function meter(value,label,other,readout){const n=Math.max(0,Math.min(1,value||0)),d=document.createElement('div');d.className='metric-meter';d.setAttribute('role','img');d.setAttribute('aria-label',label+' '+(readout??fmt(n*100,1)+'%')+(other?'；'+other:''));const i=document.createElement('i');i.style.width=n*100+'%';d.append(i);return d}
  function visualStats(r){
    let host=$('financialDetails');if(!host){host=detail('資金、風險與收支','financialDetails');$('btKpis').after(host)}host.replaceChildren(host.firstElementChild);const grid=document.createElement('div');grid.className='visual-stat-grid';host.append(grid);
    function card(title,html){const d=document.createElement('article');d.className='visual-stat';d.innerHTML='<h4>'+title+'</h4>'+html;grid.append(d);return d}
    const alloc=card('平均配置',`<strong>${fmt(r.utilization*100,0)}% 持股</strong><p class="small">現金約 ${fmt((1-r.utilization)*100,0)}% · 期間平均，不是目前部位</p>`);alloc.append(meter(r.utilization,'平均持股'));
    const risk=card('風險調整',`<p>Calmar <b>${r.calmar==null?'—':fmt(r.calmar,2)}</b></p><p>Sharpe <b>${r.sharpe==null?'—':fmt(r.sharpe,2)}</b></p>`);for(const[key,v]of[['Calmar',r.calmar],['Sharpe',r.sharpe]])if(Number.isFinite(v)){risk.append(meter(v/3,key+'（圖示刻度 0–3）',null,fmt(v,2)))}
    const a=VisualMetrics.attribution(r),items=[['價差（含未實現）',a.price],['配息',a.dividends],['停泊利息',a.interest],['費用與稅',a.fees]],max=Math.max(...items.map(x=>Math.abs(x[1])),1),cash=card('收益與成本',`<strong>淨損益 ${money(a.net)}</strong>`);for(const[label,v]of items){const row=document.createElement('div');row.className='attribution-row';row.innerHTML=`<span>${label}</span><b class="${v>0?'up':v<0?'down':''}">${v>0?'+':''}${money(v)}</b><i style="width:${Math.abs(v)/max*100}%;background:${v>=0?RISE:FALL}"></i>`;cash.append(row)}
    const trade=card('已實現賣出',r.sells?`<strong>${fmt(r.wins/r.sells*100,1)}% 獲利</strong><p class="small">${r.wins} 次獲利／${r.sells-r.wins} 次非獲利 · 未平倉不計</p>`:'<p>尚無可比較的賣出交易</p>');if(r.sells)trade.append(meter(r.wins/r.sells,'已實現賣出獲利比例'));
    const facts=document.createElement('dl');facts.className='financial-facts';for(const[k,v]of[['回測日期',r.start+' 至 '+r.end],['資金基數',money(r.contributed)],['期末現金',money(r.cash)],['基準費用','定額 '+money(r.dca.fees)+'／持有 '+money(r.bh.fees)],['交易筆數',r.buys+' 買／'+r.sells+' 賣']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;facts.append(dt,dd)}host.append(facts);alloc.remove();risk.remove();trade.remove();
  }
  function actionDetails(){const node=$('btNow');if(!node.firstElementChild)return;node.querySelector('h4').textContent='規則試算';const extra=detail('看條件、目前部位與觸發價','actionDetails');const main=node.querySelector('.bt-act-main');if(main){const summary=document.createElement('p');summary.className='action-summary';const t=main.textContent;summary.textContent=t.length>84?t.slice(0,84)+'…':t;main.before(summary);extra.append(main)}const existing=node.querySelector('dl');if(existing)extra.append(existing);const meta=node.querySelector('.bt-act-meta');if(meta)extra.append(meta);node.append(extra);const ruler=document.createElement('div');ruler.className='action-ruler';extra.append(ruler);const r=btResult,ctx=btCtx;if(!r||!ctx)return;const i=ctx.bars.findIndex(b=>b.date===r.end),cfg=r.cfg;if(i<0)return;
    const end=ctx.bars.slice(0,i+1),rr={n:end.length+1,bars:[...end,{...end.at(-1)}],refCache:new Map()},ref=E.reference(rr,cfg.ref.window,cfg.ref.anchorMode,cfg.ref.anchorCount),lo=ref.lo.at(-1),hi=ref.hi.at(-1),price=ctx.close[i];if(!(hi>lo)){ruler.textContent='參考窗不足，暫不畫觸發尺。';return}
    const cuts=cfg.ref.method==='fib'?[0,.236,.382,.618,.786,1]:[0,.2,.4,.6,.8,1],score=E.score((price-lo)/(hi-lo),cfg.ref.method);ruler.innerHTML='<p class="small">價格與規則位階 · '+r.end+'</p><div class="five-track">'+cuts.slice(1).map(()=>'<i></i>').join('')+`<span class="track-pointer" style="left:${Math.max(0,Math.min(100,(price-lo)/(hi-lo)*100))}%"></span></div><p class="ruler-price">收盤 ${fmt(price,2)} 元 · ${fmt(score.core,1)} 分</p>`;
    const ticks=document.createElement('div');ticks.className='ruler-ticks';for(const f of cuts){const s=document.createElement('span');s.textContent=fmt(lo+(hi-lo)*f,2);ticks.append(s)}ruler.append(ticks);
    const s=cfg.strategy,p=cfg.params;if(['smart_dca_water','core_satellite'].includes(s)&&score.grade<4){const f=cfg.ref.method==='fib'?.382:.4,target=lo+(hi-lo)*f,note=document.createElement('p');note.className='small';note.textContent=`低於 ${fmt(target,2)} 元進入至少 4 分位階，距收盤 ${pctText(target/price-1)}；採用目前回測規則。`;ruler.append(note)}else{const p=document.createElement('p');p.className='small';p.textContent='這是價格位置尺。此策略的買賣條件請看上方說明，不能單憑水位線判定。';ruler.append(p)}
  }
  let rollingKey='',rollingGeneration=0;const rollingCache=new Map();
  function renderRolling(rows){const host=$('btRolling');host.replaceChildren();for(const year of [1,3]){const a=rows.filter(x=>x.years===year),stats=VisualMetrics.ratios(a),cal=VisualMetrics.ratios(a,'calAlpha'),card=document.createElement('div');card.className='rolling-visual';card.innerHTML=`<h4>持有 ${year} 年</h4>`;if(!stats.total){card.append(document.createTextNode('完整持有期資料不足'));host.append(card);continue}
      const p=document.createElement('p');p.textContent=`${stats.total} 個每月起點 · 年化勝出 ${fmt(stats.wins/stats.total*100,1)}%`;card.append(p);const bar=document.createElement('div');bar.className='rolling-share';for(const[k,n]of[['win',stats.wins],['tie',stats.ties],['loss',stats.losses]]){const i=document.createElement('i');i.className=k;i.style.width=n/stats.total*100+'%';bar.append(i)}const mid=document.createElement('span');mid.className='half-line';bar.append(mid);card.append(bar);const note=document.createElement('p');note.className='small';note.textContent=`勝出 ${stats.wins}／相同 ${stats.ties}／落後 ${stats.losses} · 平均年化差 ${pctText(stats.average)} · Calmar 勝出 ${cal.total?fmt(cal.wins/cal.total*100,1)+'%':'無可比較樣本'}`;card.append(note);
      const svg=svgNode('svg',{viewBox:'0 0 660 128',role:'img',tabindex:'0','aria-label':`${year} 年滾動起點年化差，左右鍵查看各月`}),max=Math.max(.001,...a.map(x=>Math.abs(x.alpha))),bw=640/a.length;svg.append(svgNode('line',{x1:10,x2:650,y1:58,y2:58,stroke:'var(--muted)'}));a.forEach((x,i)=>{const h=Math.abs(x.alpha)/max*48,rect=svgNode('rect',{x:10+i*bw,y:x.alpha>=0?58-h:58,width:Math.max(.8,bw*.75),height:Math.max(1,h),fill:Math.abs(x.alpha)<1e-10?'#819397':x.alpha>0?RISE:FALL});rect.append(svgNode('title',{},`${x.date}：策略 ${pctText(x.strategy)}；定額 ${pctText(x.dca)}；差 ${pctText(x.alpha)}`));svg.append(rect)});svg.append(svgNode('text',{x:10,y:124},a[0].date.slice(0,7)),svgNode('text',{x:650,y:124,'text-anchor':'end'},a.at(-1).date.slice(0,7)));card.append(svg);const tip=document.createElement('p');tip.className='small rolling-tip';tip.setAttribute('aria-live','polite');let at=a.length-1;function show(n){at=Math.max(0,Math.min(a.length-1,n));const x=a[at];tip.textContent=`${x.date} 至 ${x.end} · 策略年化 ${pctText(x.strategy)}／定額 ${pctText(x.dca)} · 差 ${pctText(x.alpha)}`};svg.addEventListener('pointermove',e=>{const r=svg.getBoundingClientRect();show(Math.floor((e.clientX-r.left)/r.width*a.length))});svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();show(at+(e.key==='ArrowRight'?1:-1))}});show(at);card.append(tip);host.append(card)}const n=document.createElement('p');n.className='small';n.textContent='每月首個交易日起算，結束取週年日後首個可用交易日；資金池顯示 CAGR 差、月薪模式顯示 XIRR 差，不是未來勝率。平手獨立列示，無法計算的 Calmar 不列入分母。';host.append(n)}
  btRenderRolling=async function(){const ctx=btContext(),cfg=btCfg(),code=selected,key=JSON.stringify([code,ctx.bars,cfg]);if(rollingCache.has(key)){renderRolling(rollingCache.get(key));return}if(key===rollingKey&&$('btRolling').dataset.busy==='true')return;rollingKey=key;const gen=++rollingGeneration;const node=$('btRolling');node.dataset.busy='true';node.textContent='分批計算每月起點，其他操作仍可使用…';const rows=[];let count=0;for(const years of [1,3])for(let i=0;i<ctx.n;i++){if(gen!==rollingGeneration||selected!==code||ctx.bars!==bars)return;if(!ctx.monthStart[i])continue;const target=new Date(ctx.bars[i].date+'T00:00:00Z');target.setUTCFullYear(target.getUTCFullYear()+years);const date=target.toISOString().slice(0,10);let j=i;while(j<ctx.n&&ctx.bars[j].date<date)j++;if(j>=ctx.n)break;const r=E.run(ctx,cfg,i,j);if(Number.isFinite(btAnnual(r))&&Number.isFinite(btAnnual(r.dca,r.monthly)))rows.push({years,date:r.start,end:r.end,strategy:btAnnual(r),dca:btAnnual(r.dca,r.monthly),alpha:btAnnual(r)-btAnnual(r.dca,r.monthly),calAlpha:r.calmar!=null&&r.dca.mdd>0?r.calmar-r.dca.cagr/r.dca.mdd:null});if(++count%4===0)await new Promise(resolve=>setTimeout(resolve,0))}if(gen!==rollingGeneration)return;node.dataset.busy='false';rollingCache.set(key,rows);if(rollingCache.size>4)rollingCache.delete(rollingCache.keys().next().value);renderRolling(rows)};
  function waveDistribution(){const data=waveBridgeData;if(!data||data.code!==selected||!$('waveSummary'))return;let host=$('waveDistribution');if(!host){host=detail('看上漲與拉回分布','waveDistribution');$('waveSummary').after(host)}host.replaceChildren(host.firstElementChild);const grid=document.createElement('div');grid.className='visual-stat-grid';for(const sign of [-1,1]){const list=data.segments.filter(s=>sign*s.change>0),h=VisualMetrics.histogram(list.map(s=>Math.abs(s.change))),card=document.createElement('article');card.innerHTML='<h4>'+ (sign<0?'拉回幅度':'上漲幅度')+'</h4>';if(!h){card.append(document.createTextNode('已確認樣本不足'));grid.append(card);continue}const svg=svgNode('svg',{viewBox:'0 0 340 150',role:'img','aria-label':`${list.length} 段，平均 ${fmt(h.mean,2)}%`}),top=Math.max(...h.counts,1);h.counts.forEach((n,i)=>{const ht=n/top*100,r=svgNode('rect',{x:12+i*31,y:118-ht,width:25,height:Math.max(1,ht),fill:sign>0?RISE:FALL});r.append(svgNode('title',{},`${fmt(i*h.width,1)}% 至 ${fmt((i+1)*h.width,1)}%：${n} 段`));svg.append(r)});const pending=Number.isFinite(data.latestChange)&&sign*data.latestChange>0?Math.abs(data.latestChange):null;if(pending!=null){const px=12+Math.min(1,pending/h.max)*310;svg.append(svgNode('line',{x1:px,x2:px,y1:8,y2:120,stroke:'#b47721','stroke-width':2}));const tip=svgNode('title',{},`目前未確認段 ${fmt(pending,2)}%，${data.pivotDate} 至 ${data.lastDate}`);svg.append(tip)}const x=12+h.mean/h.max*310;svg.append(svgNode('line',{x1:x,x2:x,y1:8,y2:120,stroke:'var(--ink)','stroke-dasharray':'4 3'}),svgNode('text',{x:12,y:143},'0%'),svgNode('text',{x:322,y:143,'text-anchor':'end'},fmt(h.max,1)+'%'));card.append(svg);const p=document.createElement('p');p.className='small';p.textContent=`${h.n} 段 · 平均 ${fmt(h.mean,2)}%（虛線）`+(pending!=null?` · 目前未確認 ${fmt(pending,2)}%（金線${pending>h.max?'，超出圖示上限':''}）`:'');card.append(p);grid.append(card)}host.append(grid);const n=document.createElement('p');n.className='small';n.textContent='採目前日／週／月設定下所有已確認且未略過的波段，含訓練及測試；未確認段不混入歷史樣本。';host.append(n)}
  const oldWave=waveRender;waveRender=function(...a){oldWave(...a);waveDistribution()};window.chaoweiWave.render=waveRender;
  function factorVisuals(){for(const id of ['indexScore','volumeScore','brentScore','fxScore','mktMarginScore','bankScore']){const score=$(id),card=score.closest('.factor');let track=card.querySelector('.factor-track');if(!track){track=document.createElement('div');track.className='five-track factor-track';track.innerHTML='<i></i><i></i><i></i><i></i><i></i><span class="track-pointer"></span>';score.after(track)}let fill=track.querySelector('.factor-score-fill');if(!fill){fill=document.createElement('b');fill.className='factor-score-fill';track.append(fill)}const n=parseFloat(score.textContent);fill.style.width=(Number.isFinite(n)?Math.max(0,Math.min(100,n/5*100)):0)+'%';track.classList.toggle('hidden',!Number.isFinite(n));track.setAttribute('role','img');track.setAttribute('aria-label',`0 至 5 分中位於 ${score.textContent}`);track.querySelector('.track-pointer').style.left=Math.max(0,Math.min(100,n/5*100))+'%'}
    for(const[id,list]of[['indexScore',market.map(x=>({value:x.index}))],['volumeScore',market.map(x=>({value:x.volume}))],['fxScore',fx]]){const card=$(id).closest('.factor');let spark=card.querySelector('.extra-spark');if(!spark){spark=document.createElement('div');spark.className='extra-spark';card.append(spark)}spark.innerHTML=list.length>1?factorSpark(list):''}}
  let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;factorVisuals()})}for(const id of ['indexScore','volumeScore','brentScore','fxScore','mktMarginScore','bankScore'])new MutationObserver(schedule).observe($(id),{childList:true,subtree:true,characterData:true});schedule();
  function kpiDetails(){for(const card of $('btKpis').querySelectorAll('.bt-big>div')){const span=card.querySelector('span');if(!span||span.closest('details'))continue;const d=detail('總報酬與期末值');d.classList.add('kpi-detail');if(card===card.parentElement.lastElementChild)d.firstElementChild.textContent='與定額比較';span.before(d);d.append(span)}}
  const grade=$('barGrade');function gradeUnit(){if(grade.querySelector('small'))return;const parts=grade.textContent.split(' / ');if(parts.length!==2)return;grade.replaceChildren(document.createTextNode(parts[0]));const small=document.createElement('small');small.textContent='/ '+parts[1];grade.append(small)}new MutationObserver(gradeUnit).observe(grade,{childList:true});gradeUnit();
  const oldRender=renderBacktest;renderBacktest=function(...args){oldRender(...args);if(!btResult)return;visualStats(btResult);actionDetails();kpiDetails();$('btKpis').querySelector('.bt-small')?.classList.add('hidden');$('btNow').querySelectorAll('b').forEach(e=>e.classList.add('action-key'))};
  // Form setup is independently expandable; keep the existing controls and membership gate intact.
  const config=detail('調整資金與策略條件','backtestConfig');$('btFamilies').before(config);for(const id of ['btFamilies','btPresets','btSummary'])config.append($(id));document.querySelectorAll('#backtestCard .bt-steps,#backtestCard #btAdvanced').forEach(e=>config.append(e));
  $('btVerdict').classList.add('compact-verdict');document.querySelectorAll('.factor-detail-toggle').forEach(b=>{b.textContent='設定與細節'});
  if(btResult){visualStats(btResult);actionDetails();kpiDetails();$('btKpis').querySelector('.bt-small')?.classList.add('hidden')}
})();

/* Date-only holdout: selection sees no bars, dividends or macro values after training. */
const TrainingMath=(()=>{
  function defaults(bars){const first=bars[0]?.date,last=bars.at(-1)?.date;if(bars.length<2||!first)return null;if(first<'2021-01-01'&&last>='2023-01-01')return{from:'2017-01-01',until:'2021-12-31',testFrom:'2022-01-01',testTo:last};const i=Math.max(1,Math.min(bars.length-1,Math.floor(bars.length*.6)));return{from:first,until:bars[i-1].date,testFrom:bars[i].date,testTo:last}}
  function bounds(bars,p){if(!p.from||!p.until||!p.testFrom||!p.testTo||p.from>p.until||p.until>=p.testFrom||p.testFrom>p.testTo)throw Error('訓練期須早於驗證期，日期不可重疊。');const train=VisualMetrics.range(bars.map(b=>({time:b.date})),p.from,p.until),test=VisualMetrics.range(bars.map(b=>({time:b.date})),p.testFrom,p.testTo);if(!train||train.b-train.a+1<60)throw Error('實際訓練資料至少需要 60 個交易日。');if(!test||test.b-test.a+1<20)throw Error('實際驗證資料至少需要 20 個交易日。');if(train.b>=test.a)throw Error('訓練與驗證資料重疊。');return{train,test}}
  function context(engine,ctx,end){const rows=ctx.bars.slice(0,end+1),div=[];for(let i=0;i<rows.length;i++)if(ctx.div[i])div.push([rows[i].date,ctx.div[i]]);return engine.prepare(rows,div,ctx.macro?Array.from(ctx.macro).slice(0,end+1):null,{marginDrop5:ctx.marginDrop5?.slice(0,end+1)})}
  function candidates(engine,base,scope){const windows=scope==='search'?[...new Set(['60','120','240',String(base.ref.window)])]:[String(base.ref.window)],out=[];for(const p of engine.PRESETS){const usesWater=['classic','smart_dca_water','core_satellite','macro_regime','margin_fear_contrarian'].includes(p.strategy);for(const w of usesWater?windows:[String(base.ref.window)])out.push({p,w,usesWater,cfg:{...base,params:JSON.parse(JSON.stringify({...engine.PARAMS[p.strategy],...p.params})),strategy:p.strategy,ref:{...base.ref,window:w}}})}return out}
  function rank(rows,metric){return rows.filter(x=>Number.isFinite(x.r[metric])).sort((a,b)=>b.r[metric]-a.r[metric]||a.p.id.localeCompare(b.p.id)||String(a.w).localeCompare(String(b.w)))}
  function annual(rows){const groups=new Map();for(const row of rows){const y=row.time.slice(0,4);if(!groups.has(y))groups.set(y,[]);groups.get(y).push(row)}return[...groups].map(([year,a])=>({year,from:a[0].time,to:a.at(-1).time,days:a.length,mean:a.filter(x=>Number.isFinite(x.score)).reduce((s,x)=>s+x.score,0)/Math.max(1,a.filter(x=>Number.isFinite(x.score)).length),buys:a.filter(x=>x.buy).length,sells:a.filter(x=>x.sell).length,valid:a.filter(x=>Number.isFinite(x.score)).length}))}
  return{defaults,bounds,context,candidates,rank,annual};
})();

/* Member holdout experiment. Nothing is selected using validation performance. */
(()=>{
  const panel=document.createElement('details');panel.className='metric-detail training-lab';panel.id='trainingLab';panel.innerHTML='<summary>站在歷史當下驗證</summary><p>用前段資料選一次規則，鎖定後才驗證後段。日期、目標與候選範圍由你決定。</p><div class="training-flow"><span>1 訓練期選規則</span><span>2 鎖定條件</span><span>3 後段獨立驗證</span></div><div class="training-fields"><label>訓練起日<input type="date" id="trainFrom"></label><label>訓練迄日<input type="date" id="trainUntil"></label><label>驗證起日<input type="date" id="testFrom"></label><label>驗證迄日<input type="date" id="testUntil"></label><label>只按訓練期選擇<select id="trainMetric"><option value="annual">年化報酬最高</option><option value="calmar">Calmar 最高</option></select></label><label>參考窗候選<select id="trainScope"><option value="fixed">固定目前觀察窗</option><option value="search">另比較 60／120／240 日</option></select></label></div><div class="training-actions"><button class="pill" type="button" id="trainRun">鎖定規則並驗證</button><button class="pill mini" type="button" id="trainCancel" disabled>取消計算</button></div><p class="small" id="trainStatus" aria-live="polite">訓練至少 60 日、驗證至少 20 日；新 ETF 會使用實際可得資料。</p><div id="trainingResult"></div><details><summary>怎麼讀這個實驗？</summary><p class="small">驗證首日以同樣資金、空手開始，持倉不承接訓練期。只比較既有固定策略與選定觀察窗；不是未來最佳策略的保證。日期切割不代表樣本外結果一定較好；反覆看驗證成績再調參，也可能過度配適。沿用回測的成交時點（預設 T+1 開盤＋滑價）、配息、費用與入金假設；使用目前整理的分割還原歷史，並非當年逐日保存的原始資料版本。</p></details>';
  $('btKpis').before(panel);const runner=createOptimizerRunner();let generation=0,code='',signature='',locked=null;
  const ids=['trainFrom','trainUntil','testFrom','testUntil','trainMetric','trainScope'];
  function fill(){if(!bars.length)return;const sig=selected+'|'+bars[0].date+'|'+bars.at(-1).date;if(signature===sig)return;signature=sig;generation++;runner.cancel();code=selected;locked=null;$('trainRun').disabled=false;$('trainCancel').disabled=true;$('trainingResult').replaceChildren();const d=TrainingMath.defaults(bars);if(!d)return;const saved=settings.holdout?.code===selected?settings.holdout:null;for(const[id,k]of[['trainFrom','from'],['trainUntil','until'],['testFrom','testFrom'],['testUntil','testTo']])$(id).value=saved?.[k]||d[k];$('trainMetric').value=saved?.metric==='calmar'?'calmar':'annual';$('trainScope').value=saved?.scope||'fixed';$('trainStatus').textContent=`${selected} 實際日 K ${bars[0].date} 至 ${bars.at(-1).date}；本實驗與上方全期排行獨立。`}
  function params(){return{code:selected,from:$('trainFrom').value,until:$('trainUntil').value,testFrom:$('testFrom').value,testTo:$('testUntil').value,metric:$('trainMetric').value,scope:$('trainScope').value}}
  for(const id of ids)$(id).addEventListener('change',()=>{generation++;runner.cancel();$('trainRun').disabled=false;$('trainCancel').disabled=true;locked=null;$('trainApply')?.setAttribute('disabled','');$('trainStatus').textContent='條件已變更，請重新鎖定規則並驗證。';settings.holdout=params();save()});
  function cancel(){generation++;runner.cancel();$('trainRun').disabled=false;$('trainCancel').disabled=true;$('trainStatus').textContent='已取消；尚未套用任何策略。'}$('trainCancel').addEventListener('click',cancel);
  $('trainRun').addEventListener('click',async()=>{
    if(!isMember){$('accountTop').click();return}fill();const mine=++generation,p=params(),asset=selected,rows=bars;locked=null;$('trainingResult').replaceChildren();$('trainRun').disabled=true;$('trainCancel').disabled=false;
    try{await btEnsureDividends();if(mine!==generation||asset!==selected)return;const full=btContext(),b=TrainingMath.bounds(rows,p),train=TrainingMath.context(E,full,b.train.b),test=TrainingMath.context(E,full,b.test.b),base=btCfg(),candidates=TrainingMath.candidates(E,base,p.scope),key=JSON.stringify([asset,{from:p.from,until:p.until,metric:p.metric,scope:p.scope},base,train.bars,Array.from(train.div),Array.from(train.macro||[]),Array.from(train.marginDrop5||[])]);
      $('trainStatus').textContent='只讀取訓練截止日以前的資料，正在背景選擇規則…';
      const out=await runner.run(key,train,candidates,b.train.a,b.train.b,(done,total)=>{if(mine===generation)$('trainStatus').textContent=`訓練 ${done} / ${total} 組；驗證資料尚未用於選擇。`});if(mine!==generation||asset!==selected||rows!==bars)return;
      const ranked=TrainingMath.rank(out.rows,p.metric),winner=ranked[0];if(!winner)throw Error('訓練資料無法計算選定指標；可改選年化報酬或延長資料。');const chosen=[],seen=new Set();for(const row of ranked)if(!seen.has(row.p.id)){seen.add(row.p.id);chosen.push(candidates.find(c=>c.p.id===row.p.id&&c.w===row.w))}const validation=await runner.run(key+'|validation|'+JSON.stringify([p.testFrom,p.testTo,test.bars,Array.from(test.div),Array.from(test.macro||[])]),test,chosen,b.test.a,b.test.b,(done,total)=>{if(mine===generation)$('trainStatus').textContent=`驗證 ${done} / ${total} 種方法；沿用訓練排序，不依驗證挑選。`});if(mine!==generation||asset!==selected||rows!==bars)return;const comparisons=chosen.map((c,i)=>{const tr=ranked.find(x=>x.p.id===c.p.id&&x.w===c.w),vr=validation.rows.find(x=>x.p.id===c.p.id&&x.w===c.w);return{rank:i+1,preset:c.p.id,name:c.p.name,cfg:JSON.parse(JSON.stringify(c.cfg)),train:tr.r.annual,trainDca:tr.r.monthly?tr.r.dca.xirr:tr.r.dca.cagr,test:vr.r.annual,dca:vr.r.monthly?vr.r.dca.xirr:vr.r.dca.cagr,mdd:vr.r.mdd}});const candidate=candidates.find(c=>c.p.id===winner.p.id&&c.w===winner.w),cfg=JSON.parse(JSON.stringify(candidate.cfg)),r=E.run(test,cfg,b.test.a,b.test.b);locked={comparisons,code:asset,preset:candidate.p.id,cfg,result:r,train:JSON.parse(JSON.stringify(winner.r)),parameters:p,dates:{trainFrom:train.bars[b.train.a].date,trainUntil:train.bars.at(-1).date}};settings.holdout=p;save();render(locked,out,ranked.length);
    }catch(e){if(e.name!=='AbortError'&&mine===generation)$('trainStatus').textContent=e.message}finally{if(mine===generation){$('trainRun').disabled=false;$('trainCancel').disabled=true}}
  });
  function render(x,out,count){const r=x.result,name=E.PRESETS.find(p=>p.id===x.preset)?.name||x.preset,node=$('trainingResult');node.innerHTML=`<div class="locked-rule"><p class="kicker teal">鎖定規則</p><h4>${name}</h4><p class="small">${x.cfg.ref.window==='all'?'全部歷史':x.cfg.ref.window+' 日'} · ${x.cfg.ref.method==='fib'?'黃金分割':'等距'} · ${x.cfg.ref.anchorMode==='average'?'高低價平均':x.cfg.ref.anchorMode==='close'?'收盤極值':'最高最低價'}</p><p class="small">訓練 ${x.dates.trainFrom} 至 ${x.dates.trainUntil}；驗證 ${r.start} 至 ${r.end}</p></div><div class="holdout-kpis">${[['訓練年化',pctText((x.train.annual))],['驗證年化',pctText(btAnnual(r))],['驗證定額年化',pctText(btAnnual(r.dca,r.monthly))],['驗證最大回落',fmt(r.mdd*100,1)+'%']].map(([label,v])=>`<div><small>${label}</small><strong>${v}</strong></div>`).join('')}</div><p class="small">驗證年化差 ${pctText(shownPct(btAnnual(r)-btAnnual(r.dca,r.monthly)))}；共 ${r.buys} 次買進、${r.trades.filter(t=>t.type==='sell').length} 次賣出。依日期切割，驗證期沒有參與排行。</p><button class="pill" type="button" id="trainApply">在回測圖表檢視這次驗證</button><details><summary>查看鎖定參數與驗證假設</summary><pre id="lockedJson"></pre></details>`;$('lockedJson').textContent=JSON.stringify({strategy:x.cfg.strategy,params:x.cfg.params,reference:x.cfg.ref,capital:x.cfg.capital,capitalMode:x.cfg.capitalMode,installments:x.cfg.dcaPeriods,fee:x.cfg.fee,discount:x.cfg.discount,tax:x.cfg.tax,parking:x.cfg.parking,drip:x.cfg.drip,wholeShares:x.cfg.wholeShares,fill:x.cfg.fill,slipBps:x.cfg.slipBps,funding:x.cfg.funding,actualFunding:r.funding,annualMetric:r.monthly?'XIRR':'CAGR'},null,2);node.dataset.trainUntil=x.dates.trainUntil;node.dataset.testFrom=r.start;node.dataset.testTo=r.end;node.dataset.preset=x.preset;node.dataset.validationXirr=r.xirr;node.dataset.validationAnnual=btAnnual(r);node.dataset.trainingXirr=x.train.xirr;node.dataset.trainingAnnual=x.train.annual;renderComparison(x);$('trainStatus').textContent=`只用訓練期 ${count} 組有效結果選擇；${out.executor==='memory'?'讀取同條件快取':out.executor==='worker'?'背景運算':'分批運算'}，${fmt(out.elapsedMs,0)} ms。驗證期 ${r.series.length} 個交易日。`;
    $('trainApply').addEventListener('click',()=>{if(!locked||locked.code!==selected)return;const z=locked;settings.uiMode='expert';applyUiMode();btApplyPreset(z.preset,{...z.cfg,preset:z.preset,ref:{...z.cfg.ref},params:JSON.parse(JSON.stringify(z.cfg.params)),sync:false,period:'custom',from:z.result.start,to:z.result.end});window.chaoweiNavigate?.('etf','backtestCard');$('subperiodControls').open=true;$('subperiodControls').scrollIntoView({behavior:'smooth',block:'start'})});
  }

  function renderComparison(x){const sign=v=>Number.isFinite(v)?`<strong class="${v>0?'up':v<0?'down':''}">${pctText(v)}</strong>`:'—',rows=x.comparisons||[],table=a=>'<div class="paired-training"><table><thead><tr><th>方法 · 訓練排名</th><th>訓練年化</th><th>驗證年化</th><th>驗證定額差</th><th>前後表現</th></tr></thead><tbody>'+a.map(r=>{const alpha=shownPct(r.test-r.dca),old=shownPct(r.train-r.trainDca),label=alpha===0?'後段持平':alpha>0?(old>0?'兩段均領先':'後段領先'):'後段未領先';return `<tr><td><span class="rank">#${r.rank}</span> ${r.name}<small> · ${r.cfg.ref.window} 日</small></td><td>${sign(r.train)}</td><td>${sign(r.test)}</td><td>${sign(alpha)}</td><td>${label}</td></tr>`}).join('')+'</tbody></table></div>';const div=document.createElement('section');div.className='training-comparison';div.innerHTML=`<h4>同一方法，前後對照</h4><div class="split-timeline"><span>訓練 ${x.dates.trainFrom} 至 ${x.dates.trainUntil}<br>只在這段選參數</span><span>驗證 ${x.result.start} 至 ${x.result.end}<br>沿用同一規則</span></div><p class="small">每種方法只保留訓練期最好的觀察窗，依訓練排名排列。驗證成績不參與選擇；這是固定一次切割，非逐年再訓練。</p>${table(rows.slice(0,5))}${rows.length>5?`<details class="metric-detail"><summary>查看全部 ${rows.length} 種方法</summary>${table(rows.slice(5))}</details>`:''}<p class="small">前後領先只是這次區間的觀察，不等於統計驗證通過或未來仍會勝出。</p>`;$('trainingResult').append(div);const stats=$('trainingResult').querySelectorAll('.holdout-kpis strong');[(x.train.annual),btAnnual(x.result),btAnnual(x.result.dca,x.result.monthly),-x.result.mdd].forEach((v,i)=>{stats[i]?.classList.toggle('up',v>0);stats[i]?.classList.toggle('down',v<0)});}
  const old=renderBacktest;renderBacktest=function(...a){old(...a);fill()};panel.addEventListener('toggle',()=>{if(panel.open)fill()});if(bars.length)fill();
})();

/* One dated grid for assets, drawdown and historical daily price-position score. */
(()=>{
  const label=document.createElement('label');label.className='bt-check';label.innerHTML='<input type="checkbox" id="showDailyScore">顯示歷史每日水位與進出點';$('viewMessage').before(label);
  const section=document.createElement('div');section.id='dailyScorePanel';section.hidden=true;section.innerHTML='<h4>每日歷史水位與交易</h4><p class="small">依這次回測的價格觀察窗計算，僅使用當天以前的日 K；不是包含所有市場因子的綜合分。紅點買進、綠點賣出；缺乏完整觀察窗時留白。</p><div id="dailyScoreChart"></div><details class="metric-detail"><summary>逐年摘要</summary><div id="dailyScoreYears" class="year-score-grid"></div></details>';$('btUnder').after(section);
  const readout=document.createElement('p');readout.id='linkedChartReadout';readout.className='linked-chart-readout small';readout.setAttribute('aria-live','off');$('btEquity').closest('.bt-equity-wrap').before(readout);
  let result=null,scoreChart=null,scoreSeries=null,bound=null,dates=[],daily=[],index=new Map(),syncing=false,moving=false,raf=0;
  function show(){section.hidden=!$('showDailyScore').checked;if(scoreChart&&!section.hidden){scoreChart.resize(section.clientWidth,200);const r=btCharts?.top.timeScale().getVisibleLogicalRange();if(r)scoreChart.timeScale().setVisibleLogicalRange(r)}requestAnimationFrame(align)}
  $('showDailyScore').checked=settings.showDailyScore===true;$('showDailyScore').addEventListener('change',()=>{settings.showDailyScore=$('showDailyScore').checked;save();show()});
  function panes(){return btCharts?[[btCharts.top,btCharts.s],[btCharts.under,btCharts.sd],...(scoreChart&&!section.hidden?[[scoreChart,scoreSeries]]:[])]:[]}
  function align(){raf=0;const all=panes();if(!all.length||!$('btEquity').clientWidth)return;const width=Math.max(Math.round(72*uiFontScale()),...all.map(([c])=>c.priceScale('right').width()));all.forEach(([c])=>c.priceScale('right').applyOptions({minimumWidth:width}));const range=btCharts.top.timeScale().getVisibleLogicalRange();if(range){syncing=true;try{all.forEach(([c])=>c.timeScale().setVisibleLogicalRange(range))}finally{syncing=false}}}
  function scheduleAlign(){if(!raf)raf=requestAnimationFrame(align)}
  function bind(chart,series){chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(syncing||!r)return;syncing=true;try{panes().forEach(([c])=>{if(c!==chart)c.timeScale().setVisibleLogicalRange(r)})}finally{syncing=false}});chart.subscribeCrosshairMove(p=>{if(moving||!result)return;moving=true;try{const i=index.get(p.time);if(i==null){panes().forEach(([c])=>{if(c!==chart)c.clearCrosshairPosition()});return}for(const[c,s]of panes()){if(c===chart)continue;const data=s.dataByIndex(i),value=data?.value;if(Number.isFinite(value))c.setCrosshairPosition(value,p.time,s);else c.clearCrosshairPosition()}const d=daily[i],r=result.series[i],benchmark=result.dca.series[i];readout.textContent=`${p.time} · 策略 ${money(r.value)} · 定額 ${money(benchmark.value)} · 回落 ${fmt(r.dd*100,1)}% · 水位 ${Number.isFinite(d.score)?fmt(d.score,2)+' / 5':'資料不足'}${d.buy?' · 買進':''}${d.sell?' · 賣出':''}`;for(const [chart]of panes()){const host=chart===btCharts.top?$('btEquity'):chart===btCharts.under?$('btUnder'):$('dailyScoreChart');host.dataset.cursorX=String(chart.timeScale().timeToCoordinate(p.time));host.dataset.cursorDate=p.time}readout.dataset.date=p.time;section.dataset.cursorDate=p.time;$('btEquity').dataset.cursorDate=p.time;$('btUnder').dataset.cursorDate=p.time;}finally{moving=false}})}
  function paint(r){result=r;const c=btCharts;if(!c)return;if(!scoreChart){scoreChart=LightweightCharts.createChart($('dailyScoreChart'),{...chartOptions(),height:200});scoreSeries=scoreChart.addLineSeries({color:'#179e9d',lineWidth:2,priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:5}}),priceFormat:{type:'price',precision:1,minMove:.1}});scoreChart.priceScale('right').applyOptions({scaleMargins:{top:.05,bottom:.05}});for(const v of [0,2.5,5])scoreSeries.createPriceLine({price:v,color:'#8ca5a555',lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});bind(scoreChart,scoreSeries)}if(bound!==c.top){bound=c.top;bind(c.top,c.s);bind(c.under,c.sd)}
    const ctx=btCtx,w=E.water(ctx,r.cfg.ref),source=new Map(ctx.bars.map((b,i)=>[b.date,i])),trades=new Map();for(const t of r.trades){const old=trades.get(t.date)||{};old[t.type]=true;trades.set(t.date,old)}dates=r.series.map(x=>x.time);index=new Map(dates.map((d,i)=>[d,i]));daily=dates.map(time=>{const j=source.get(time),score=j==null?NaN:w.core[j],t=trades.get(time)||{};return{time,score:Number.isFinite(score)?score:null,buy:!!t.buy,sell:!!t.sell}});scoreSeries.setData(daily.map(x=>Number.isFinite(x.score)?{time:x.time,value:x.score}:{time:x.time}));scoreSeries.setMarkers(daily.flatMap(x=>!Number.isFinite(x.score)?[]:[...(x.buy?[{time:x.time,position:'belowBar',shape:'circle',color:'#cf3f47',text:'買'}]:[]),...(x.sell?[{time:x.time,position:'aboveBar',shape:'circle',color:'#238862',text:'賣'}]:[])]));
    $('dailyScoreYears').replaceChildren();for(const y of TrainingMath.annual(daily)){const b=document.createElement('button');b.type='button';b.className='pill';b.textContent=`${y.year} · ${y.valid?'均分 '+fmt(y.mean,1):'資料不足'} · 買進日 ${y.buys} / 賣出日 ${y.sells}`;b.addEventListener('click',()=>{const a=index.get(y.from),z=index.get(y.to);c.top.timeScale().setVisibleLogicalRange({from:a,to:z})});$('dailyScoreYears').append(b)}section.dataset.rows=daily.length;section.dataset.valid=daily.filter(x=>Number.isFinite(x.score)).length;readout.textContent='移到任一折線圖，同步對照當天資產、回落與水位。';show();scheduleAlign();
  }
  const old=btDrawCharts;btDrawCharts=function(r){old(r);paint(r)};new ResizeObserver(scheduleAlign).observe($('btEquity'));window.addEventListener('chaowei-typography-changed',()=>{if(scoreChart)scoreChart.applyOptions({layout:chartOptions().layout});scheduleAlign()});window.addEventListener('chaowei-page-changed',()=>{show();scheduleAlign()});if(btResult)paint(btResult);
})();

/* Navigation and motion only. Market data and scoring remain in their own modules. */
(()=>{
  const $=id=>document.getElementById(id);
  const menu=$('siteMenu'),open=$('openSiteMenu'),close=$('closeSiteMenu');
  let returnFocus=null;
  function setMenu(shown){
    menu.classList.toggle('hidden',!shown);
    document.body.classList.toggle('menu-open',shown);
    open.setAttribute('aria-expanded',String(shown));
    if(shown){returnFocus=document.activeElement;close.focus();}
    else returnFocus?.focus?.({preventScroll:true});
  }
  open.addEventListener('click',()=>setMenu(true));
  close.addEventListener('click',()=>setMenu(false));
  menu.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');
    if(link){setMenu(false);return;}
    if(event.target.closest('[data-menu-account]')){setMenu(false);$('accountTop').click();}
  });
  document.addEventListener('keydown',event=>{
    if(menu.classList.contains('hidden'))return;
    if(event.key==='Escape'){event.preventDefault();setMenu(false);}
    if(event.key==='Tab'){
      const items=[...menu.querySelectorAll('a,button')].filter(el=>!el.disabled);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-rail]').forEach(button=>button.remove());
  function initRail({id,head,interval,label,dotsAfter}){
    const rail=$(id),nav=document.querySelector(head),tiles=[...rail.children];
    if(tiles.length<2)return;
    let visible=false,paused=false,index=0,manualUntil=0,frame=0,moving=false;
    const button=document.createElement('button');
    button.type='button';button.className='pill story-arrow story-autoplay';
    nav.querySelector('div').append(button);
    const caption=nav.querySelector('span');
    const syncButton=()=>{
      button.textContent=paused?'播放':'暫停';
      button.setAttribute('aria-label',(paused?'播放':'暫停')+label+'輪播');
      button.setAttribute('aria-pressed',String(paused));
      button.classList.toggle('hidden',reduced.matches);
      caption.textContent=reduced.matches?'左右滑動探索':paused?'輪播已暫停 · 可左右滑動':'自動探索 · 可左右滑動';
    };
    button.addEventListener('click',()=>{paused=!paused;syncButton()});
    const progress=document.createElement('div');
    progress.className='story-progress'+(id==='factorRail'?' factor-progress':'');
    progress.setAttribute('role','group');
    progress.setAttribute('aria-label',label+'位置');
    const dots=tiles.map((_,i)=>{
      const dot=document.createElement('button');dot.type='button';
      dot.setAttribute('aria-label','顯示第 '+(i+1)+' 張'+label);
      dot.addEventListener('click',()=>{manual();goTo(i)});
      progress.append(dot);return dot;
    });
    (dotsAfter==='nav'?nav:rail).after(progress);
    const syncDots=()=>dots.forEach((dot,i)=>dot.setAttribute('aria-current',i===index?'true':'false'));
    const position=i=>tiles[i].offsetLeft-tiles[0].offsetLeft;
    const cancel=()=>{
      if(frame)cancelAnimationFrame(frame);
      frame=0;moving=false;rail.style.scrollSnapType='';
    };
    const manual=()=>{manualUntil=Date.now()+6500;cancel()};
    function goTo(next){
      index=(next+tiles.length)%tiles.length;syncDots();cancel();
      const target=position(index),start=rail.scrollLeft;
      if(reduced.matches||Math.abs(target-start)<1){rail.scrollTo({left:target,behavior:'instant'});return}
      const begun=performance.now(),duration=340;
      moving=true;rail.style.scrollSnapType='none';
      const step=now=>{
        const t=Math.min(1,(now-begun)/duration),ease=1-Math.pow(1-t,3);
        rail.scrollLeft=start+(target-start)*ease;
        if(t<1)frame=requestAnimationFrame(step);
        else{frame=0;rail.scrollLeft=target;rail.style.scrollSnapType='';requestAnimationFrame(()=>{moving=false})}
      };
      frame=requestAnimationFrame(step);
    }
    syncDots();syncButton();
    reduced.addEventListener?.('change',()=>{cancel();syncButton()});
    ['pointerdown','touchstart','wheel'].forEach(type=>rail.addEventListener(type,manual,{passive:true}));
    rail.addEventListener('focusin',manual);
    rail.addEventListener('keydown',event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
      event.preventDefault();manual();goTo(index+(event.key==='ArrowRight'?1:-1));
    });
    rail.addEventListener('scroll',()=>{
      if(moving)return;
      index=tiles.reduce((best,_,i)=>Math.abs(position(i)-rail.scrollLeft)<Math.abs(position(best)-rail.scrollLeft)?i:best,0);
      syncDots();
    },{passive:true});
    if('IntersectionObserver' in window){
      new IntersectionObserver(entries=>{visible=entries[0].isIntersecting},{threshold:.35}).observe(rail);
    }else visible=true;
    setInterval(()=>{
      if(rail.classList.contains('is-grid')||!visible||document.hidden||paused||reduced.matches||
         document.body.classList.contains('motion-paused')||Date.now()<manualUntil||
         rail.matches(':hover')||rail.contains(document.activeElement))return;
      goTo(index+1);
    },interval);
  }
  initRail({id:'storyRail',head:'.story-rail-head',interval:3300,label:'觀測卡片',dotsAfter:'rail'});
  initRail({id:'factorRail',head:'.factor-rail-nav',interval:3800,label:'市場卡片',dotsAfter:'nav'});
  const toggle=$('motionToggle');
  toggle.addEventListener('click',()=>{
    const paused=document.body.classList.toggle('motion-paused');
    toggle.setAttribute('aria-pressed',String(paused));
    toggle.setAttribute('aria-label',paused?'播放頁面動畫':'暫停頁面動畫');
    toggle.innerHTML=paused?' <span>播放動態</span>':' <span>暫停動態</span>';
    if(paused)document.querySelectorAll('.reveal').forEach(el=>el.classList.add('is-visible'));
  });
  toggle.setAttribute('aria-label','暫停頁面動畫');
  if('IntersectionObserver' in window&&!reduced.matches){
    const groups=['.story-tile','.score-grid > .card','.method-steps details'];
    document.querySelectorAll('.story-rail-head,.section-heading,.search-launch,.quick.inline,.chart-card,.factor-card,.method-intro')
      .forEach(el=>el.classList.add('reveal'));
    groups.forEach(selector=>document.querySelectorAll(selector).forEach((el,i)=>{
      el.classList.add('reveal');el.style.setProperty('--reveal-delay',Math.min(i,3)*85+'ms');
    }));
    document.body.classList.add('js-motion');
    const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target);}
    }),{rootMargin:'0px 0px -8% 0px',threshold:.05});
    document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
  }
})();

/* Four destinations, one persistent selected ETF. Hash links remain shareable. */
(()=>{
 const assets=window.CHAOWEI_HOST==='apps-script'?'https://lee200202.github.io/chaowei-etf-observatory/assets/':'./assets/';
 const main=document.querySelector('main'),home=document.createElement('section'),marketPage=document.createElement('section'),guide=document.createElement('section'),etf=$('explore');home.id='homePage';marketPage.id='marketPage';guide.id='guidePage';const boardPage=document.createElement('section');boardPage.id='strategyBoardPage';main.append(boardPage);for(const node of [home,etf,marketPage,boardPage,guide])node.classList.add('route-page');
 main.prepend(home);main.append(marketPage,guide);home.append(document.querySelector('.hero'));
 const art=home.querySelector('.hero-art');art.removeAttribute('aria-label');art.replaceChildren();art.classList.add('editorial-art');art.innerHTML='<img class="studio-image" src="'+assets+'research-studio.webp" alt="研究者在桌前觀察抽象 K 線的情境插畫" width="1536" height="1024" fetchpriority="high"><span class="illustration-note">研究情境插畫 · 非實際行情</span>';
 const artPause=document.createElement('button');artPause.type='button';artPause.className='pill art-pause';artPause.id='homeMotion';const syncMotion=()=>{const off=document.body.classList.contains('motion-paused');artPause.textContent=off?'播放插畫動態':'暫停插畫動態';artPause.setAttribute('aria-pressed',String(off))};artPause.addEventListener('click',()=>{$('motionToggle').click();syncMotion()});home.querySelector('.hero').append(artPause);new MutationObserver(syncMotion).observe(document.body,{attributes:true,attributeFilter:['class']});syncMotion();
 const matrix=document.createElement('section');matrix.id='matrixView';matrix.className='section matrix-section';matrix.innerHTML='<div class="section-heading"><div><p class="kicker teal">MATRIX VIEW</p><h2>從一眼總覽，開始觀測。</h2><p class="sub">先選一檔，再打開它的走勢與研究工具。</p></div><button type="button" class="pill" id="matrixSearch">搜尋全部 ETF</button></div><div id="matrixFilters" class="segment" role="group" aria-label="總覽篩選"><button data-matrix="all" type="button" class="active">候選總覽</button><button data-matrix="active" type="button">主動型</button><button data-matrix="passive" type="button">被動型</button></div><p class="small" id="matrixDate">正在讀取盤後總覽…</p><div class="matrix-grid" id="matrixCards"></div><p class="small">總覽採前 240 日高低價、等距刻度；歷史較短時採可得資料。此處為盤後快照，進入觀測頁可自訂條件；分數不是勝率。</p>';home.append(matrix);const boardEntry=home.querySelector('.hero-actions a.secondary');boardEntry.href='#strategyBoardPage';boardEntry.textContent='建立策略白板';const lesson=document.createElement('button');lesson.type='button';lesson.className='pill';lesson.id='homeTour';lesson.textContent='10 步使用教學';lesson.addEventListener('click',startTour);home.querySelector('.hero-actions').append(lesson);$('matrixSearch').addEventListener('click',openSearch);
 const features=document.createElement('section');features.className='section feature-gallery';features.innerHTML='<div class="section-heading"><div><p class="kicker teal">YOUR RESEARCH STUDIO</p><h2>把問題，交給圖表。</h2></div></div><div class="feature-grid">'+[['etf-observation','ETF 觀測','價格、日 K 與技術指標，一起看。','chartCard'],['market-context','市場背景','從量能、油價與匯率補齊視角。','market'],['wave-research','波段研究','標記峰谷，看看幅度與時間。','waveStudy'],['historical-validation','歷史驗證','前段選規則，後段獨立驗證。','trainingLab'],['custom-weights','策略白板','拖拉條件，組合自己的研究規則。','strategyBoardPage'],['member-watchlist','我的收藏','登入保存追蹤、偏好與研究。','account']].map(([asset,title,desc,target])=>`<a class="feature-entry" href="#${target}" ${target==='account'?'data-home-account':''}><figure><img src="${assets}${asset}.webp" width="1536" height="1024" loading="lazy" decoding="async" alt="${title}情境插畫"></figure><div><h3>${title}</h3><p>${desc}</p><span class="entry-caption">${['waveStudy','trainingLab','weights','account'].includes(target)?'會員研究功能':'開啟觀測'}</span></div></a>`).join('')+'</div><p class="small">插畫為概念示意；所有行情與統計以工具內的資料日期為準。</p>';home.append(features,document.querySelector('.member-story'));features.querySelector('[data-home-account]').addEventListener('click',e=>{e.preventDefault();$('accountTop').click()});
 marketPage.className+=' section market-page';marketPage.innerHTML='<div class="section-heading"><div><p class="kicker teal">MARKET CONTEXT</p><h2>市場的其他刻度</h2><p class="sub">各項資料保留來源與更新日期；需要時再展開計分條件。</p></div><a href="#weights" class="pill">前往 ETF 權重</a></div>';marketPage.append($('market'));
 const stories=document.querySelector('.story-stage');guide.append($('method-story'));if(stories)guide.append(stories);const help=document.querySelector('.indicator-help');if(help){const link=document.createElement('a');link.className='pill mini guide-link';link.href='#technicalGuide';link.textContent='技術指標說明';help.before(link);help.id='technicalGuide';help.classList.add('metric-detail');guide.append(help)}
 const nav=document.createElement('nav');nav.id='pageNav';nav.className='page-nav';nav.setAttribute('aria-label','內容分頁');nav.innerHTML=[['homePage','首頁'],['explore','ETF 觀測'],['market','市場刻度'],['strategyBoardPage','策略白板'],['method-story','方法說明']].map(([id,t])=>`<a href="#${id}">${t}</a>`).join('');$('siteHeader').append(nav);const panels={home,etf,market:marketPage,board:boardPage,guide};let current='';
 const aliases={method:'weights','wave-lab':'waveStudy',chips:'chipCard',backtest:'backtestCard',top:'homePage',home:'homePage',board:'strategyBoardPage'};
 function destination(id){if(['homePage','matrixView','top',''].includes(id))return'home';if(id==='strategyBoardPage'||boardPage.contains($(id)))return'board';if(id==='market'||id==='marketPage'||marketPage.contains($(id)))return'market';if(id==='method-story'||id==='guidePage'||guide.contains($(id)))return'guide';return'etf'}
 function activate(key,id,scroll=true){const changed=current!==key;if(changed&&current==='etf')window.chaoweiChartRouteView?.save();current=key;for(const[k,p]of Object.entries(panels)){p.hidden=k!==key;p.setAttribute('aria-hidden',String(k!==key));p.classList.toggle('route-active',k===key)}document.body.dataset.page=key;nav.querySelectorAll('a').forEach(a=>{const on=destination(a.hash.slice(1))===key;a.classList.toggle('active',on);on?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current')});if(changed){window.dispatchEvent(new Event('resize'));requestAnimationFrame(()=>requestAnimationFrame(()=>{window.dispatchEvent(new Event('chaowei-page-changed'));if(key==='etf')window.chaoweiChartRouteView?.restore()}))}if(scroll){requestAnimationFrame(()=>{const target=$(id)||panels[key];let parent=target.closest('details');while(parent){parent.open=true;parent=parent.parentElement.closest('details')}target.scrollIntoView({block:'start',behavior:'instant'})})}}
 function follow(){const raw=decodeURIComponent(location.hash.slice(1)),id=aliases[raw]||raw||'homePage';activate(destination(id),id)}
 let tourReturn=null;window.chaoweiBeginTour=()=>{tourReturn={key:current,y:scrollY}};window.chaoweiEndTour=()=>{if(tourReturn){activate(tourReturn.key,'',false);window.scrollTo({top:tourReturn.y,behavior:'instant'});tourReturn=null}};
 window.chaoweiTourTarget=target=>{if(!target)return;const panel=target.closest('.route-page');if(panel){const key=Object.keys(panels).find(k=>panels[k]===panel);activate(key,target.id||panel.id,false)}let d=target.closest('details');while(d){d.open=true;d=d.parentElement.closest('details')}};
 window.chaoweiNavigate=(key,id)=>{const anchor=id||({home:'homePage',etf:'explore',market:'market',board:'strategyBoardPage',guide:'method-story'})[key];if(location.hash==='#'+anchor)activate(key,anchor);else location.hash=anchor};window.addEventListener('hashchange',follow);const oldPick=pick;pick=function(code){activate('etf','explore',false);if(!etf.contains($(location.hash.slice(1))))history.pushState(null,'','#explore');oldPick(code)};
 let filter='all';async function paintMatrix(){const r=await loadRadar();if(!r||!catalog.length){$('matrixDate').textContent='盤後總覽暫時無法載入，仍可搜尋 ETF。';return}const watch=Array.isArray(settings.watchlist)&&settings.watchlist.length?settings.watchlist:['0050','0056','00878','00919','00981A','009816'];const preferred=[...new Set([...watch,...r.rows.map(x=>x.code)])];const assets=preferred.map(code=>catalog.find(e=>e.code===code)).filter(Boolean).filter(e=>filter==='all'||(filter==='active'?e.type==='active':e.type!=='active')).slice(0,8);$('matrixCards').replaceChildren();for(const e of assets){const d=r.map.get(e.code),b=document.createElement('button');b.type='button';b.className='matrix-card';const score=Number.isFinite(d?.score)?d.score:null;b.innerHTML=`<span class="matrix-code">${e.code}</span><h3></h3><div class="matrix-price">${d?fmt(d.close,2):'—'}<small class="${d?.chg>=0?'up':'down'}">${d?pctText(d.chg/100):'尚無日資料'}</small></div><div class="matrix-meter"><i style="width:${score==null?0:score/5*100}%"></i></div><p class="small">${score==null?'資料不足':'水位 '+fmt(score,1)+' / 5'}${d?.date&&d.date!==(r.latest||r.rows.at(-1)?.date)?' · '+d.date:''}</p>`;b.querySelector('h3').textContent=e.name;b.addEventListener('click',()=>pick(e.code));$('matrixCards').append(b)}$('matrixDate').textContent=`盤後快照 ${r.latest||r.rows.at(-1)?.date||'—'} · 線圖為近一個月收盤（縱軸依區間高低），虛線 MA960；紅漲綠跌 · 點卡片進入觀測`;}
 $('matrixFilters').addEventListener('click',e=>{const b=e.target.closest('[data-matrix]');if(!b)return;filter=b.dataset.matrix;$('matrixFilters').querySelectorAll('button').forEach(n=>n.classList.toggle('active',n===b));paintMatrix()});const oldList=renderList;renderList=function(...a){const ret=oldList(...a);paintMatrix();return ret};paintMatrix();follow();
 const motion=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('scene-in-view',e.isIntersecting)),{threshold:.15});motion.observe(art);features.querySelectorAll('.feature-entry').forEach((el,i)=>{el.dataset.scene=String(i);el.querySelector('figure').insertAdjacentHTML('beforeend','<span class="scene-motion" aria-hidden="true"><i></i><b></b></span>');motion.observe(el)});document.addEventListener('visibilitychange',()=>document.body.classList.toggle('page-background',document.hidden));
})();

/* Typed DAG and causal indicators; no eval, no brokerage access. */
const StrategyBoard=(()=>{
 const kinds=['asset','condition','logic','allocation','portfolio'];
 const metrics=['water','ma','rsi','flow','ao','strength','trend'];
 const copy=x=>JSON.parse(JSON.stringify(x));
 function clean(input){if(!input||!Array.isArray(input.nodes)||!Array.isArray(input.edges)||input.nodes.length>40||input.edges.length>80)throw Error('白板最多 40 張卡、80 條連線。');const seen=new Set(),nodes=input.nodes.map((n,i)=>{if(!n||!kinds.includes(n.type)||typeof n.id!=='string'||!/^[\w-]{1,50}$/.test(n.id)||seen.has(n.id))throw Error('卡片識別有誤或重複。');seen.add(n.id);const raw=n.params||{},p={};if(n.type==='asset')p.code=/^[0-9A-Z]{4,6}$/.test(raw.code)?raw.code:'0050';if(n.type==='condition'){p.metric=metrics.includes(raw.metric)?raw.metric:'water';p.op=['gte','lte','gt','lt'].includes(raw.op)?raw.op:'gte';p.value=finite(raw.value,4,-10000,10000);p.period=Math.round(finite(raw.period,240,2,2400));p.window=Math.round(finite(raw.window,240,20,2400));p.method=raw.method==='fib'?'fib':'equal';p.offset=finite(raw.offset,0,-1000,1000)}if(n.type==='logic')p.mode=raw.mode==='any'?'any':'all';if(n.type==='allocation'){p.weight=finite(raw.weight,100,0,100);p.installments=Math.round(finite(raw.installments,0,0,240));p.on=finite(raw.on,80,0,100);p.off=finite(raw.off,20,0,100);p.preset=['buyHold','dca','coreSwing','smartDca','bias','coreSat','regime','chandelier','trendPullback','kdGolden','marginFear','chatLadder','chatAnnual'].includes(raw.preset)?raw.preset:'';p.strategyParams=raw.strategyParams&&typeof raw.strategyParams==='object'?Object.fromEntries(Object.entries(raw.strategyParams).filter(([k,v])=>['core','parts','bias','cooldown','low','high','trim','marginDrop','minScore','drop','step','takeProfit','window'].includes(k)&&Number.isFinite(v)).map(([k,v])=>[k,Math.max(0,Math.min(k==='window'?2400:k==='takeProfit'?300:100,v))])):{}}if(n.type==='portfolio')p.name=String(raw.name||'我的研究組合').slice(0,30);return{id:n.id,type:n.type,x:finite(n.x,40+i*260,0,4000),y:finite(n.y,80,0,2600),params:p}}),edges=input.edges.map(e=>({from:String(e.from),to:String(e.to)}));if(edges.some(e=>!seen.has(e.from)||!seen.has(e.to)))throw Error('連線包含不存在的卡片。');return{v:1,nodes,edges}}
 function finite(x,d,min,max){return Number.isFinite(Number(x))?Math.max(min,Math.min(max,Number(x))):d}
 function inspect(input){const b=clean(input),by=new Map(b.nodes.map(n=>[n.id,n])),incoming=new Map(b.nodes.map(n=>[n.id,[]])),outgoing=new Map(b.nodes.map(n=>[n.id,[]])),errors=[],warnings=[],unique=new Set();for(const e of b.edges){const a=by.get(e.from),z=by.get(e.to),key=e.from+'>'+e.to;if(!a||!z){errors.push('有連線找不到卡片。');continue}if(unique.has(key)){errors.push('同一條連線不可重複。');continue}unique.add(key);if(a.id===z.id){errors.push('卡片不能連回自己。');continue}const allowed=z.type==='portfolio'?a.type==='allocation':z.type==='asset'?false:z.type==='allocation'?['asset','condition','logic'].includes(a.type):['asset','condition','logic'].includes(a.type);if(!allowed)errors.push('連線方向不合：ETF／條件 → 判斷 → 配置 → 組合。');incoming.get(z.id).push(a.id);outgoing.get(a.id).push(z.id)}
 const state=new Map(),order=[];function visit(id){if(state.get(id)===1){errors.push('連線形成循環，請移除其中一條。');return}if(state.get(id)===2)return;state.set(id,1);for(const from of incoming.get(id))visit(from);state.set(id,2);order.push(id)}b.nodes.forEach(n=>visit(n.id));const roots=b.nodes.filter(n=>n.type==='portfolio');if(roots.length!==1)errors.push('請保留一張「我的組合」卡。');const root=roots[0],used=new Set();function mark(id){if(used.has(id))return;used.add(id);incoming.get(id)?.forEach(mark)}if(root)mark(root.id);
 for(const n of b.nodes){const inc=incoming.get(n.id);if(!used.has(n.id)){warnings.push('未接入：'+title(n));continue}if(n.type==='asset'&&inc.length)errors.push('ETF 卡不接受輸入。');if(['condition','allocation'].includes(n.type)&&inc.length!==1)errors.push(title(n)+'需要且只能接入一張卡。');if(n.type==='logic'&&inc.length<2)errors.push('全部／任一判斷至少連入兩個條件。');if(n.type==='portfolio'&&!inc.length)errors.push('組合尚未連入配置卡。')}
 const allocations=b.nodes.filter(n=>n.type==='allocation'&&used.has(n.id)),total=allocations.reduce((s,n)=>s+n.params.weight,0);if(total>100+1e-9)errors.push('配置預算合計超過 100%，請調低比例。');if(total===0&&allocations.length)errors.push('配置比例不能全部為零。');return{board:b,by,incoming,outgoing,order,root,used,allocations,total,errors:[...new Set(errors)],warnings:[...new Set(warnings)]}}
 function canConnect(b,from,to){const next=copy(b);next.edges.push({from,to});const info=inspect(next),hard=info.errors.find(e=>/循環|方向|自己|重複/.test(e));if(hard)return hard;for(const n of info.board.nodes)if(['condition','allocation'].includes(n.type)&&info.incoming.get(n.id).length>1)return'這張卡只能接入一張上游卡，請先使用全部／任一判斷。';return null}
 function title(n){if(!n)return'已移除卡片';return n.type==='asset'?'ETF '+n.params.code:n.type==='condition'?({water:'價格水位',ma:'均線分界',rsi:'RSI',flow:'K 棒力道',ao:'AO 動量',strength:'千分強度',trend:'4／13MA 轉強'})[n.params.metric]:n.type==='logic'?(n.params.mode==='any'?'任一符合':'全部符合'):n.type==='allocation'?'持股配置':n.params.name}
 function sma(a,w){const out=Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=w)s-=a[i-w];if(i>=w-1)out[i]=s/w}return out}
 function rank(value,prior){if(!Number.isFinite(value)||prior.length===0||prior.some(x=>!Number.isFinite(x)))return null;return prior.reduce((s,x)=>s+(x<value?1:x===value?.5:0),0)/prior.length}
 function series(bundle,p,E){const ctx=bundle.ctx,key=JSON.stringify(p);bundle.metricCache||=new Map();if(bundle.metricCache.has(key))return bundle.metricCache.get(key);let values,detail=null;if(p.metric==='water')values=Array.from(E.water(ctx,{window:String(p.period),anchorMode:'wick',anchorCount:5,method:p.method}).core,x=>Number.isFinite(x)?x:null);else if(p.metric==='rsi')values=Array.from(ctx.rsi,x=>Number.isFinite(x)?x:null);else if(p.metric==='ma'){const ma=sma(ctx.close,p.period);values=ma.map((v,i)=>v==null?null:ctx.close[i]-(v+p.offset))}else if(p.metric==='flow'){const forces=ctx.bars.map(b=>b.high>b.low?Math.max(-1,Math.min(1,(b.close-b.open)/(b.high-b.low))):0);values=sma(forces,p.period).map(x=>x==null?null:x*p.period)}else if(p.metric==='ao'){const mid=ctx.bars.map(b=>(b.high+b.low)/2),a=sma(mid,5),b=sma(mid,34);values=a.map((v,i)=>b[i]==null?null:v-b[i])}else if(p.metric==='trend'){const a=sma(ctx.close,4),b=sma(ctx.close,13);values=a.map((v,i)=>b[i]==null||b[i-1]==null?null:Number(ctx.close[i]>=v&&ctx.close[i]>=b[i]&&v>=b[i]&&b[i]>b[i-1]))}else{const ma=sma(ctx.close,p.period),bias=ma.map((v,i)=>v>0?ctx.close[i]/v-1:null),turn=ctx.bars.map((b,i)=>b.close*b.volume*(bundle.meta?.adjustments||[]).reduce((f,a)=>b.date<a.date?f*a.factor:f,1)),a=[],z=[];values=bias.map((v,i)=>{const x=i>=p.window?rank(v,bias.slice(i-p.window,i)):null,y=i>=p.window?rank(turn[i],turn.slice(i-p.window,i)):null;a[i]=x==null?null:Math.round(700*x);z[i]=y==null?null:Math.round(300*y);return x==null||y==null?null:a[i]+z[i]});detail={ma:a,value:z}}const result={values,detail};bundle.metricCache.set(key,result);return result}
 function compare(a,op,b){if(a==null||!Number.isFinite(a))return null;return op==='gte'?a>=b:op==='lte'?a<=b:op==='gt'?a>b:a<b}
 const and=a=>a.some(v=>v===false)?false:a.some(v=>v==null)?null:true,or=a=>a.some(v=>v===true)?true:a.some(v=>v==null)?null:false;
 function compile(input,bundles,E){const info=inspect(input);if(info.errors.length)throw Error(info.errors[0]);const result=new Map(),plans=[],assetCodes=new Set();for(const id of info.order){if(!info.used.has(id))continue;const n=info.by.get(id),up=info.incoming.get(id).map(x=>result.get(x));if(n.type==='asset'){const data=bundles.get(n.params.code);if(!data?.ctx?.n)throw Error(n.params.code+' 尚無已確認日 K。');result.set(id,{code:n.params.code,bundle:data,flags:Array(data.ctx.n).fill(true)})}else if(n.type==='portfolio')continue;else{if(!up.length)throw Error(title(n)+' 尚未接上 ETF。');if(up.some(x=>x.code!==up[0].code))throw Error('同一個判斷只能合併同一 ETF 的條件；不同 ETF 請分別接配置卡。');const r={...up[0]};if(n.type==='condition'){const data=series(r.bundle,n.params,E);r.metric=data.values;r.detail=data.detail;r.flags=data.values.map((v,i)=>and([r.flags[i],compare(v,n.params.op,n.params.value)]))}if(n.type==='logic')r.flags=r.flags.map((_,i)=>(n.params.mode==='any'?or:and)(up.map(x=>x.flags[i])));if(n.type==='allocation'){if(assetCodes.has(r.code))throw Error('同一 ETF 請合併為一條配置支線，避免重複預算。');assetCodes.add(r.code);const ruleIds=[];function trace(x){for(const a of info.incoming.get(x)||[]){if(info.by.get(a).type==='condition'&&!ruleIds.includes(a))ruleIds.push(a);trace(a)}}trace(n.id);if(ruleIds.length&&n.params.preset&&!['chatLadder','trendPullback','kdGolden','marginFear'].includes(n.params.preset))throw Error('此預設使用自身規則，不能忽略上游條件。請改選進階／對話策略或依條件配置。');plans.push({id:n.id,code:r.code,bundle:r.bundle,flags:r.flags,ruleIds,ruleNames:ruleIds.map(x=>title(info.by.get(x))),rulePeriods:ruleIds.map(x=>info.by.get(x)).filter(n=>n.params.metric==='ma').map(n=>n.params.period),...n.params})}result.set(id,r)}}return{...info,result,plans}}
 function install(E){if(E.STRATEGIES.board_rule)return;E.STRATEGIES.board_rule={day(i,ctx,cfg,acc,st,h,inflow){const p=cfg.params,flag=cfg.fill==='nextClose'?p.flags[i]:i>0?p.flags[i-1]:null,target=flag==null?0:(flag?p.on:p.off)/100;if(st.last!==target||inflow){acc.toWeight(i,target,'白板：前一收盤條件'+(flag==null?'資料不足':flag?'成立':'未成立'));st.last=target}}}}
 function aggregate(runs,capital,reserve,parking){if(!runs.length)throw Error('尚無組合結果。');const calendars=runs.map(r=>new Set(r.series.map(x=>x.time))),common=runs[0].series.map(x=>x.time).filter(d=>calendars.every(c=>c.has(d)));if(common.length<2)throw Error('共同交易日不足。');const maps=runs.map(r=>({r,s:new Map(r.series.map(x=>[x.time,x])),d:new Map(r.dca.series.map(x=>[x.time,x]))}));let peak=capital,mdd=0,prev=capital;const first=Date.parse(common[0]),series=common.map(time=>{const cash=reserve*Math.pow(1+parking/100,(Date.parse(time)-first)/86400000/365),value=maps.reduce((s,x)=>s+x.s.get(time).value,cash),dca=maps.reduce((s,x)=>s+x.d.get(time).value,cash);peak=Math.max(peak,value);mdd=Math.max(mdd,1-value/peak);const row={time,value,dca,nav:value/capital,dd:value/peak-1,return:value/prev-1,exposure:maps.reduce((s,x)=>s+x.s.get(time).value*x.s.get(time).exposure,0)/value};prev=value;return row});return{series,mdd,cagr:(series.at(-1).value/capital)**(365.25/((Date.parse(common.at(-1))-first)/86400000))-1,benchmarkCagr:(series.at(-1).dca/capital)**(365.25/((Date.parse(common.at(-1))-first)/86400000))-1,utilization:series.reduce((s,x)=>s+x.exposure,0)/series.length,ret:series.at(-1).value/capital-1,xirr:runs.length?((series.at(-1).value/capital)**(365/((Date.parse(common.at(-1))-first)/86400000))-1):null,benchmarkRet:series.at(-1).dca/capital-1,benchmarkXirr:(series.at(-1).dca/capital)**(365/((Date.parse(common.at(-1))-first)/86400000))-1,from:common[0],to:common.at(-1),fees:runs.reduce((s,r)=>s+r.fees,0),trades:runs.flatMap(r=>r.trades.map(t=>({...t,code:r.code}))).sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code))}}
 function example(two=false){const nodes=[{id:'etf-a',type:'asset',x:30,y:100,params:{code:'0050'}},{id:'condition-a',type:'condition',x:320,y:100,params:{metric:'water',period:240,op:'gte',value:4}},{id:'allocation-a',type:'allocation',x:610,y:100,params:{weight:100,on:80,off:20}},{id:'portfolio',type:'portfolio',x:900,y:100,params:{name:'我的研究組合'}}],edges=[{from:'etf-a',to:'condition-a'},{from:'condition-a',to:'allocation-a'},{from:'allocation-a',to:'portfolio'}];if(two){nodes.splice(1,1);nodes.find(x=>x.id==='allocation-a').params={weight:60,on:100,off:100};nodes.find(x=>x.id==='portfolio').y=230;nodes.push({id:'etf-b',type:'asset',x:30,y:380,params:{code:'0056'}},{id:'allocation-b',type:'allocation',x:610,y:380,params:{weight:40,on:100,off:100}});edges.splice(0,2,{from:'etf-a',to:'allocation-a'});edges.push({from:'etf-b',to:'allocation-b'},{from:'allocation-b',to:'portfolio'})}return clean({nodes,edges})}
 function template(mode){const strength=mode==='strength',metric=strength?{metric:'strength',period:960,window:240,op:'gte',value:800}:{metric:'ma',period:960,offset:13,op:'lt',value:0};return clean({nodes:[{id:'etf-a',type:'asset',x:30,y:170,params:{code:'0050'}},{id:'condition-a',type:'condition',x:320,y:30,params:metric},{id:'condition-b',type:'condition',x:320,y:330,params:{metric:'flow',period:13,op:'gt',value:0}},{id:'all',type:'logic',x:610,y:170,params:{mode:'all'}},{id:'allocation-a',type:'allocation',x:900,y:170,params:{weight:100,on:strength?100:85,off:60}},{id:'portfolio',type:'portfolio',x:1190,y:170,params:{name:strength?'千分強度配置研究':'均線力道配置研究'}}],edges:[{from:'etf-a',to:'condition-a'},{from:'etf-a',to:'condition-b'},{from:'condition-a',to:'all'},{from:'condition-b',to:'all'},{from:'all',to:'allocation-a'},{from:'allocation-a',to:'portfolio'}]})}

 function recipeFor(p,E){if(p.preset==='chatAnnual')return{id:'chatAnnual',name:'年線體制配置（MA240）',strategy:'chat_annual_regime',params:{}};return p.preset==='chatLadder'?{id:'chatLadder',name:'對話回檔分批',strategy:'chat_ladder',params:{...E.PARAMS.chat_ladder}}:E.PRESETS.find(x=>x.id===p.preset)}
 function runConfig(p,base,capital,E){const recipe=recipeFor(p,E),params=recipe?{...recipe.params,...p.strategyParams}:{flags:p.flags,on:p.on,off:p.off};
   // Imported editable params receive the same bounds as the form; preserve whole tranche counts.
   if(recipe&&['trendPullback','kdGolden','marginFear','chatLadder'].includes(p.preset)){params.core=Math.max(p.preset==='chatLadder'?0:10,Math.min(90,params.core));params.parts=Math.max(p.preset==='chatLadder'?1:2,Math.min(p.preset==='chatLadder'?10:4,Math.round(params.parts)));if('cooldown' in params)params.cooldown=Math.max(1,Math.min(60,Math.round(params.cooldown))); const bounds={bias:recipe.strategy==='trend_pullback_ma60'?[.5,20]:[1,30],low:[5,50],high:[60,95],trim:[5,50],marginDrop:[.1,20],minScore:[0,5],drop:[1,90],step:[1,50],takeProfit:[0,300],window:[20,2400]};for(const [k,[lo,hi]] of Object.entries(bounds))if(k in params)params[k]=Math.max(lo,Math.min(hi,params[k]))}
   return{...base,capital:capital*p.weight/100,capitalMode:'pool',funding:undefined,dcaPeriods:p.installments>0?p.installments:'auto',fill:'nextClose',slipBps:0,strategy:recipe?.strategy||'board_rule',params,entryFlags:recipe?p.flags:undefined,ref:{window:p.preset==='chatLadder'?String(Math.max(20,Math.min(2400,Math.round(params.window)))):'240',anchorMode:'wick',anchorCount:5,method:'equal'}};
 }
 function executions(r,p,ctx){const rows=new Map(r.series.map(x=>[x.time,x]));return r.trades.map(t=>({...t,signalDate:ctx.bars[t.signal??(r.fill==='close'&&r.cfg.strategy!=='board_rule'?t.i:Math.max(0,t.i-1))]?.date,ruleIds:p.ruleIds||[],ruleNames:p.ruleNames||[],exposure:rows.get(t.date)?.exposure??null}));}
 return{recipeFor,runConfig,executions,clean,inspect,canConnect,title,series,compile,install,aggregate,example,template,rank,and,or};
})();

/* One actual execution ledger powers markers, hover details and the trade table. */
function createChaoweiBoardStage(host,options={}){
 let chart=null,observer=null,current=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function clear(){observer?.disconnect();observer=null;chart?.remove();chart=null;current=null}
 function render(runs){clear();host.querySelector('.board-execution-stage')?.remove();const root=document.createElement('section');root.className='board-execution-stage';root.innerHTML='<div class="card-heading"><div><p class="kicker teal">EXECUTION REVIEW</p><h3>每次成交，對回當時走勢。</h3></div></div><div class="board-target-tabs" role="tablist" aria-label="白板標的"></div><div class="board-leg-kpis"></div><p class="small board-leg-assumptions"></p><div class="board-stage-tools"><label><input type="checkbox" data-board-dca> 同期定投點</label><label><input type="checkbox" data-board-ma60 checked> MA60</label><label><input type="checkbox" data-board-ma960> MA960</label><button type="button" class="pill mini" data-board-month>近一個月</button><button type="button" class="pill mini" data-board-fit>全部區間</button></div><p class="small board-stage-legend" aria-live="polite"></p><div class="board-candle-chart" aria-label="白板標的日 K 與實際成交" role="img"></div><p class="small">B 買進（紅）／S 賣出（綠）；標記是成交日，並非訊號當日。配息再投入列於明細。</p><details class="metric-detail"><summary>如何核對成交</summary><ol class="small"><li>選一檔 ETF，查看自己的預算及同期定投。</li><li>縮放或拖曳 K 線，B／S 對照實際成交日期。</li><li>指向 K 棒查看價與當日交易；展開明細核對股數、金額與規則。</li><li class="board-fill-help">成交依本次設定，期末沒有下一根時不成交。</li></ol></details><details class="metric-detail board-trade-details"><summary>逐筆成交明細</summary><div class="board-execution-table"></div></details>';
 host.append(root);if(options.fullControls){root.querySelector('.board-stage-tools').innerHTML='<div class="quant-range-tools">'+[['1m','近1個月'],['60','短線60日'],['240','存股240日'],['600','景氣600日'],['5y','近5年'],['all','全部區間']].map(([v,t])=>'<button type="button" class="pill mini" data-board-range="'+v+'">'+t+'</button>').join('')+'</div><details class="quant-indicator-tools"><summary>均線與水位</summary><label><input type="checkbox" data-board-dca> 同期定投點</label>'+[5,10,20,60,120,240,960].map(n=>'<label><input type="checkbox" data-board-ma'+n+(n===60?' checked':'')+'> MA'+n+'</label>').join('')+'<label><input type="checkbox" data-board-fib> 黃金分割水位（前240日）</label></details>'}const tabs=root.querySelector('.board-target-tabs'),plot=root.querySelector('.board-candle-chart'),legend=root.querySelector('.board-stage-legend'),dca=root.querySelector('[data-board-dca]');
 runs.forEach((r,i)=>{const b=document.createElement('button');b.type='button';b.className='pill';b.setAttribute('role','tab');b.textContent=r.code+' · '+r.plan.weight+'% · '+pctText(r.cagr);b.onclick=()=>select(i);tabs.append(b)});
 function select(index){observer?.disconnect();chart?.remove();current=runs[index];const r=current,p=r.plan,ctx=r.ctx,rows=ctx.bars.filter(b=>b.date>=r.start&&b.date<=r.end),dates=rows.map(b=>b.date);tabs.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-selected',String(i===index)));
  root.querySelector('.board-fill-help').textContent=r.fill==='nextOpen'?'訊號收盤確認，下一交易日開盤成交，計入 '+r.slipBps+' bps 滑價；期末沒有下一根時不成交。':r.fill==='nextClose'?'訊號收盤確認，下一交易日收盤成交；期末沒有下一根時不成交。':'當日收盤為理想成交對照，並非盤後還能以該價下單。';root.dataset.code=r.code;root.dataset.annual=r.cagr;root.dataset.dca=r.dca.cagr;root.dataset.fill=r.fill;root.dataset.trades=r.trades.length;root.dataset.firstTrade=r.trades[0]?.date||'';root.dataset.firstPrice=r.trades[0]?.price??'';
  const recipe=StrategyBoard.recipeFor(p,E);root.querySelector('.board-leg-assumptions').textContent=recipe?recipe.name+(Number.isFinite(r.cfg.params.core)&&Number.isFinite(r.cfg.params.parts)?' · 核心 '+r.cfg.params.core+'%／加碼池 '+r.cfg.params.parts+' 批':' · 費用與成交依本次設定')+(p.preset==='marginFear'?' · 融資可用 '+Array.from(ctx.marginDrop5.slice(ctx.bars.findIndex(b=>b.date===r.start),ctx.bars.findIndex(b=>b.date===r.end)+1)).filter(Number.isFinite).length+'／'+r.series.length+' 日；缺資料不加碼。':''):'依指定規則比較同一支線本金；成交時點請看本次計算說明。';const gap=r.cagr-r.dca.cagr;root.querySelector('.board-leg-kpis').innerHTML=[['本支線本金',money(r.cfg.capital),null],['策略年化',pctText(r.cagr),r.cagr],['定投年化',pctText(r.dca.cagr),r.dca.cagr],['年化差',(gap>0?'+':'')+fmt(gap*100,2)+' 個百分點',gap]].map(([label,v,sign])=>'<div><small>'+label+'</small><strong class="'+(sign>0?'up':sign<0?'down':'')+'">'+v+'</strong></div>').join('');
  chart=LightweightCharts.createChart(plot,{...chartOptions(),height:360,width:plot.clientWidth,handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:{time:true,price:false},mouseWheel:true,pinch:true},timeScale:{...chartOptions().timeScale,rightOffset:1,fixLeftEdge:true,fixRightEdge:true}});
  const candle=chart.addCandlestickSeries({upColor:RISE,downColor:FALL,borderUpColor:RISE,borderDownColor:FALL,wickUpColor:RISE,wickDownColor:FALL,priceLineVisible:false});candle.setData(rows.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close})));
  const periods=[...new Set([...(options.fullControls?[5,10,20,60,120,240,960]:[60,960]),...(p.rulePeriods||[])])];
  const lines=new Map();for(const period of periods){const values=E.lineFlow(ctx,{ma:period,offset:0,flow:13}).line,line=chart.addLineSeries({color:period===60?'#c99536':'#9c88d7',lineWidth:2,priceLineVisible:false,lastValueVisible:false});line.setData(ctx.bars.flatMap((b,i)=>b.date>=r.start&&b.date<=r.end&&Number.isFinite(values[i])?[{time:b.date,value:values[i]}]:[]));lines.set(period,line)}
  function paint(){for(const [n,line] of lines)line.applyOptions({visible:root.querySelector('[data-board-ma'+n+']')?.checked??true});const markers=r.executions.filter(t=>t.kind!=='drip').map(t=>({time:t.date,position:t.type==='buy'?'belowBar':'aboveBar',color:t.type==='buy'?RISE:FALL,shape:t.type==='buy'?'arrowUp':'arrowDown',text:t.type==='buy'?'B':'S'}));if(dca.checked)markers.push(...r.dca.trades.filter(t=>t.kind!=='drip').map(t=>({time:t.date,position:'belowBar',color:'#87959e',shape:'circle',text:''})));markers.sort((a,b)=>a.time.localeCompare(b.time));candle.setMarkers(markers);root.dataset.markers=markers.length;root.dataset.dcaMarkers=String(dca.checked)}
  for(const input of root.querySelectorAll('.board-stage-tools input'))input.onchange=paint;paint();
  const label=date=>{const b=rows.find(x=>x.date===date)||rows.at(-1),trades=r.executions.filter(t=>t.date===b.date);legend.textContent=b.date+' · 開 '+fmt(b.open,2)+' 高 '+fmt(b.high,2)+' 低 '+fmt(b.low,2)+' 收 '+fmt(b.close,2)+(trades.length?' · '+trades.map(t=>(t.type==='buy'?'買':'賣')+' '+fmt(t.shares,2)+' 股 @ '+fmt(t.price,4)+' 元 · '+money(t.amount)).join('；'):' · 當日無成交')};label(rows.at(-1).date);chart.subscribeCrosshairMove(e=>{if(typeof e.time==='string')label(e.time)});
  const table=root.querySelector('.board-execution-table');table.innerHTML='<table><thead><tr>'+['成交日／訊號日','方向／觸發條件','成交價','股數','金額','成交後持股','已實現損益'].map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+r.executions.map(t=>'<tr><td>'+esc(t.date)+'<small>'+esc(t.signalDate)+'</small></td><td><b class="'+(t.type==='buy'?'up':'down')+'">'+(t.type==='buy'?'買進':'賣出')+'</b><small>'+esc(t.reason)+(t.ruleNames.length?' · '+esc(t.ruleNames.join('＋')):'')+'</small></td><td>'+fmt(t.price,4)+'</td><td>'+fmt(t.shares,2)+'</td><td>'+money(t.amount)+'</td><td>'+(t.exposure==null?'—':fmt(t.exposure*100,1)+'%')+'</td><td class="'+(t.pnl>0?'up':t.pnl<0?'down':'')+'">'+(Number.isFinite(t.pnl)?(t.pnl>0?'+':'')+money(t.pnl)+'<small>'+pctText(t.ret)+'</small>':'—')+'</td></tr>').join('')+'</tbody></table>';root.querySelector('.board-trade-details summary').textContent='逐筆成交明細（'+r.executions.length+' 筆）';
  let guides=[],rangeBusy=false;const ref=options.fullControls?E.reference(ctx,'240','wick',5):null;
  function guideFib(){for(const line of guides)candle.removePriceLine(line);guides=[];if(!ref||!root.querySelector('[data-board-fib]')?.checked)return;const vr=chart.timeScale().getVisibleLogicalRange(),last=rows[Math.max(0,Math.min(rows.length-1,Math.floor(vr?.to??rows.length-1)))],anchor=ctx.bars.findIndex(b=>b.date===last.date),lo=ref.lo[anchor],hi=ref.hi[anchor];if(!(hi>lo))return;for(const f of [0,.236,.382,.618,.786,1])guides.push(candle.createPriceLine({price:lo+(hi-lo)*f,color:'#63a4a0',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:fmt(f*100,1)+'%'}));root.dataset.fibAnchor=last.date}
  root.querySelector('[data-board-fib]')?.addEventListener('change',guideFib);
  chart.timeScale().subscribeVisibleLogicalRangeChange(v=>{if(!v||plot.clientWidth<2)return;const a=rows[Math.max(0,Math.min(rows.length-1,Math.ceil(v.from)))],b=rows[Math.max(0,Math.min(rows.length-1,Math.floor(v.to)))];root.dataset.visibleFrom=a.date;root.dataset.visibleTo=b.date;guideFib();if(!rangeBusy)options.onRange?.(v)});
  function applyRange(value){let from=0;if(value==='1m'||value==='5y'){const d=new Date(r.end+'T00:00:00Z');if(value==='1m')d.setUTCMonth(d.getUTCMonth()-1);else d.setUTCFullYear(d.getUTCFullYear()-5);from=Math.max(0,rows.findIndex(b=>b.date>=d.toISOString().slice(0,10)))}else if(value!=='all')from=Math.max(0,rows.length-Number(value));chart.priceScale('right').applyOptions({autoScale:true});chart.timeScale().setVisibleLogicalRange({from:from-.5,to:rows.length-.5});root.dataset.viewport=String(value);options.onRange?.({from:from-.5,to:rows.length-.5});root.querySelectorAll('[data-board-range]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.boardRange===String(value))))}
  root._setRange=v=>{rangeBusy=true;try{chart.timeScale().setVisibleLogicalRange(v)}finally{rangeBusy=false}};
  if(options.fullControls)root.querySelectorAll('[data-board-range]').forEach(b=>b.onclick=()=>applyRange(b.dataset.boardRange));else{root.querySelector('[data-board-fit]').onclick=()=>applyRange('all');root.querySelector('[data-board-month]').onclick=()=>applyRange('1m')}
  observer=new ResizeObserver(()=>{if(chart&&plot.isConnected&&plot.clientWidth>1)chart.applyOptions({width:plot.clientWidth})});observer.observe(plot);applyRange(options.fullControls?'240':'1m');

 }
 select(0);
 }
 return{render,clear,setVisibleRange:v=>host.querySelector('.board-execution-stage')?._setRange?.(v),refresh:()=>chart?.applyOptions(chartOptions())};
}

/* A local research canvas. Pointer gestures and native controls have identical operations. */
(()=>{
 const B=StrategyBoard,host=$('strategyBoardPage');host.classList.add('section','strategy-board-page');host.innerHTML=`<div class="section-heading"><div><p class="kicker teal">STRATEGY CANVAS</p><h2>把想法，連成規則。</h2><p class="sub">加卡片、接圓點，再用歷史檢查。</p></div><button type="button" class="pill" id="boardHelp">操作教學</button></div><div class="board-surface card"><div class="board-top"><div class="board-palette" aria-label="加入卡片">${[['asset','ETF'],['condition','條件'],['logic','判斷'],['allocation','配置'],['portfolio','組合']].map(([type,t])=>`<button type="button" class="pill" data-board-add="${type}" title="點選加入，或拖到白板">${t}</button>`).join('')}</div><div class="board-doc-actions"><button class="pill mini" id="boardUndo" type="button">撤銷</button><button class="pill mini" id="boardRedo" type="button">重做</button><button class="pill mini" id="boardSave" type="button">保存至帳號</button></div></div><div class="board-subtools"><div class="segment" aria-label="白板檢視"><button data-board-view="canvas" type="button">白板</button><button data-board-view="list" type="button">步驟清單</button></div><div class="board-zoom"><button class="pill mini" id="boardZoomOut" aria-label="縮小白板" type="button">縮小</button><span id="boardZoomValue">100%</span><button class="pill mini" id="boardZoomIn" aria-label="放大白板" type="button">放大</button><button class="pill mini" id="boardFit" type="button">貼合</button><button class="pill mini" id="boardArrange" type="button">自動整理</button></div><label class="board-template">範例<select id="boardExample"><option value="">自己開始</option><option value="one">單檔水位配置</option><option value="two">雙 ETF 預算分配</option><option value="boundary">均線力道配置研究</option><option value="strength">千分強度配置研究</option></select></label></div><div class="board-workspace"><div class="board-viewport" id="boardViewport" tabindex="0" aria-label="策略白板，拖空白處移動；點卡片編輯，拖標題移動"><div class="board-stage" id="boardStage"><svg class="board-wires" id="boardWires" aria-label="條件連線"></svg><div id="boardNodes"></div></div><div class="board-empty" id="boardEmpty"><h3>先放一張 ETF 卡</h3><p>點上方 ETF，或直接拖進來。</p><button class="action" type="button" id="boardFirst">加入 ETF</button></div></div><div id="boardList" class="board-list" hidden></div><aside id="boardInspector" class="board-inspector" aria-label="卡片設定" hidden></aside></div><p id="boardStatus" class="board-status" role="status">空白白板 · 尚未執行</p><details class="metric-detail board-connections"><summary>管理連線與草稿</summary><div class="board-link-form"><label>從<select id="boardConnectFrom"></select></label><label>接到<select id="boardConnectTo"></select></label><button class="pill" type="button" id="boardConnect">連接</button></div><div id="boardLinkList"></div><div class="board-doc-actions"><button class="pill mini" type="button" id="boardLoadCloud">載入帳號版本</button><button class="pill mini" type="button" id="boardExport">匯出 JSON</button><label class="pill mini board-import">匯入 JSON<input type="file" id="boardImport" accept="application/json,.json"></label><button class="pill mini" type="button" id="boardClear">清空白板</button></div></details></div><section class="card board-run-panel"><div class="card-heading"><div><h3>用歷史驗證這張白板</h3><p class="small">同樣資金、同期定額，檢查差異。</p></div><button class="action" id="boardRun" type="button">執行研究回測</button></div><div class="board-run-fields"><label>起始日期<input type="date" id="boardFrom"></label><label>結束日期<input type="date" id="boardTo"></label><label>一筆新台幣預算（元）<input type="number" min="10000" max="100000000" step="10000" value="1200000" id="boardCapital"></label></div><p id="boardRunStatus" class="small" aria-live="polite">登入可回測與保存；白板可先自由編輯。</p><div id="boardRunResult"></div><details class="metric-detail"><summary>成交、費用與資料口徑</summary><p class="small">條件依已確認日 K 計算，下一交易日收盤再調整持股。每支線使用自己的預算，未配置預算留現金；不互相借款。沿用 ETF 回測的手續費、稅、股利再投入與停泊利率。只在條件改變或入金時調整，無放空、無下單。共同資料不足會標明實際起訖；原油、法人與大戶的現況分數不會冒充十年歷史條件。</p><div id="boardAssumptions" class="small"></div></details></section>`;
 const stageView=createChaoweiBoardStage($('boardRunResult'));function clearStage(){stageView.clear()}function renderStage(runs){stageView.render(runs)}
 let board={v:1,nodes:[],edges:[]},revision=0,selectedNode=null,pending=null,gesture=null,camera={x:20,y:40,z:1},undo=[],redo=[],dirty=false,view=innerWidth<700?'list':'canvas',timer=0,previewGen=0,runGen=0,compiled=null,result=null,chart=null,sLine=null,dLine=null,paintFrame=0;const bundles=new Map(),loads=new Map();
 try{const draft=JSON.parse(localStorage.getItem('chaowei-board-draft')||'null');if(draft?.nodes){board=B.clean(draft);dirty=true;}else if(settings.strategyBoard)board=B.clean(settings.strategyBoard)}catch{}
 const viewport=$('boardViewport'),stage=$('boardStage'),nodes=$('boardNodes'),wires=$('boardWires'),inspector=$('boardInspector');const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const note=t=>{$('boardStatus').textContent=t};const cp=x=>JSON.parse(JSON.stringify(x));
 function checkpoint(){undo.push(cp(board));if(undo.length>40)undo.shift();redo=[]}
 function commit(message){clearStage();revision++;runGen++;previewGen++;dirty=true;compiled=null;result=null;for(const k of Object.keys($('boardRunResult').dataset))delete $('boardRunResult').dataset[k];$('boardRunStatus').textContent='白板已變更，請重新執行研究。';$('boardRunResult').replaceChildren();chart?.remove();chart=null;sLine=null;dLine=null;try{localStorage.setItem('chaowei-board-draft',JSON.stringify(board))}catch{}render();note(message||'草稿已存本機');clearTimeout(timer);timer=setTimeout(preview,180)}
 function replace(next,message){checkpoint();board=B.clean(next);selectedNode=null;inspector.hidden=true;commit(message);fit()}
 function add(type,pos){checkpoint();const id='n-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),p=type==='asset'?{code:selected}:type==='condition'?{metric:'water',value:4,period:240,op:'gte'}:type==='logic'?{mode:'all'}:type==='allocation'?{weight:100,on:80,off:20}:{name:'我的研究組合'};board.nodes.push(B.clean({nodes:[{id,type,x:pos?.x??40+(board.nodes.length%4)*280,y:pos?.y??80+Math.floor(board.nodes.length/4)*250,params:p}],edges:[]}).nodes[0]);selectedNode=id;commit('已加入'+B.title(board.nodes.at(-1)));edit(id)}
 function connect(from,to){if(!from||!to)return;const error=B.canConnect(board,from,to);if(error){note(error);return}checkpoint();board.edges.push({from,to});pending=null;commit('已連接，正在核對條件。')}
 function remove(id){checkpoint();board.nodes=board.nodes.filter(n=>n.id!==id);board.edges=board.edges.filter(e=>e.from!==id&&e.to!==id);selectedNode=null;inspector.hidden=true;commit('已移除卡片，可撤銷還原。')}
 function summary(n){const p=n.params;if(n.type==='asset')return catalog.find(x=>x.code===p.code)?.name||'選擇台灣 ETF';if(n.type==='logic')return p.mode==='all'?'每個條件都成立':'至少一個條件成立';if(n.type==='allocation'&&p.preset)return `預算 ${p.weight}% · ${B.recipeFor(p,E)?.name||'進階策略'} · 條件限制加碼`;if(n.type==='allocation')return `預算 ${p.weight}% · 成立持股 ${p.on}% · 否則 ${p.off}%`;if(n.type==='portfolio')return '接入各 ETF 的配置支線';const op={gte:'≥',lte:'≤',gt:'>',lt:'<'}[p.op];return p.metric==='water'?`前 ${p.period} 日 · 分數 ${op} ${p.value}`:p.metric==='ma'?`收盤 −（MA${p.period} + ${p.offset}）${op} ${p.value}`:p.metric==='flow'?`${p.period} 期 K 棒力道 ${op} ${p.value}`:p.metric==='strength'?`MA${p.period} · 前 ${p.window} 日 · ${op} ${p.value}`:p.metric==='trend'?'4MA ≥ 13MA，且 13MA 上彎':`${p.metric==='ao'?'AO(5,34)':'RSI(14)'} ${op} ${p.value}`}
 function status(n){if(n.type==='portfolio')return compiled?'配置已核對':'尚未核對';const r=compiled?.result.get(n.id);if(!r)return'尚未核對';const i=r.bundle.ctx.n-1,flag=r.flags[i];if(n.type==='asset')return'收盤 '+r.bundle.ctx.bars[i].date;if(n.type==='allocation'&&n.params.preset)return '依策略管理配置';if(n.type==='allocation')return flag==null?'資料不足':`目前目標持股 ${flag?n.params.on:n.params.off}%`;return flag==null?'資料不足':flag?'條件成立':'條件未成立'}
 function nodeHTML(n,list=false){return `<${list?'article':'div'} class="board-node ${selectedNode===n.id?'selected':''}" data-node="${n.id}" data-kind="${n.type}" ${list?'':`style="left:${n.x}px;top:${n.y}px"`}><div class="board-node-head" tabindex="0" role="button" aria-label="移動或編輯 ${esc(B.title(n))}" data-drag="${n.id}"><span class="node-kind">${({asset:'ETF',condition:'條件',logic:'判斷',allocation:'配置',portfolio:'組合'})[n.type]}</span><strong>${esc(B.title(n))}</strong></div><p>${esc(summary(n))}</p><span class="node-state">${esc(status(n))}</span><div class="node-actions"><button type="button" data-edit="${n.id}">編輯</button><button type="button" data-remove="${n.id}" aria-label="移除 ${esc(B.title(n))}">移除</button></div>${list?'':`${n.type!=='asset'?`<button class="board-port input-port" data-input="${n.id}" aria-label="接入 ${esc(B.title(n))}" title="接入"><i></i></button>`:''}${n.type!=='portfolio'?`<button class="board-port output-port ${pending===n.id?'pending':''}" data-output="${n.id}" aria-label="連出 ${esc(B.title(n))}" title="拖到另一張卡的接入點，或先點此再點接入"><i></i></button>`:''}`}</${list?'article':'div'}>`}
 function render(){nodes.innerHTML=board.nodes.map(n=>nodeHTML(n)).join('');let order;try{const i=B.inspect(board);order=i.order.map(id=>i.by.get(id))}catch{order=board.nodes}$('boardList').innerHTML=order.map(n=>nodeHTML(n,true)).join('');$('boardEmpty').hidden=board.nodes.length>0;viewport.hidden=view!=='canvas';$('boardList').hidden=view!=='list';host.querySelectorAll('[data-board-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.boardView===view)));$('boardUndo').disabled=!undo.length;$('boardRedo').disabled=!redo.length;for(const id of ['boardConnectFrom','boardConnectTo']){const sel=$(id),v=sel.value;sel.replaceChildren(new Option('選擇卡片',''));board.nodes.filter(n=>id==='boardConnectFrom'?n.type!=='portfolio':n.type!=='asset').forEach(n=>sel.add(new Option(B.title(n)+' · '+n.id.slice(-4),n.id)));sel.value=v}$('boardLinkList').innerHTML=board.edges.map((e,i)=>`<p>${esc(B.title(board.nodes.find(n=>n.id===e.from)))} → ${esc(B.title(board.nodes.find(n=>n.id===e.to)))} <button class="pill mini" type="button" data-unlink="${i}">移除連線</button></p>`).join('')||'<p class="small">尚無連線。</p>';position();drawWires();host.dataset.revision=revision;host.dataset.nodes=board.nodes.length;host.dataset.edges=board.edges.length}
 function position(){stage.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;$('boardZoomValue').textContent=Math.round(camera.z*100)+'%'}
 function drawWires(){if(paintFrame)return;paintFrame=requestAnimationFrame(()=>{paintFrame=0;wires.replaceChildren();wires.setAttribute('viewBox','0 0 4600 3200');for(const e of board.edges){const a=nodes.querySelector(`[data-node="${e.from}"]`),b=nodes.querySelector(`[data-node="${e.to}"]`);if(!a||!b)continue;path(a.offsetLeft+a.offsetWidth,a.offsetTop+a.offsetHeight/2,b.offsetLeft,b.offsetTop+b.offsetHeight/2)}if(gesture?.kind==='connect'){const a=nodes.querySelector(`[data-node="${gesture.id}"]`);if(a)path(a.offsetLeft+a.offsetWidth,a.offsetTop+a.offsetHeight/2,gesture.to.x,gesture.to.y,true)}})}
 function path(x,y,z,w,draft=false){const p=document.createElementNS('http://www.w3.org/2000/svg','path'),bend=Math.max(55,Math.abs(z-x)*.45);p.setAttribute('d',`M${x},${y} C${x+bend},${y} ${z-bend},${w} ${z},${w}`);p.setAttribute('class',draft?'draft':'');wires.append(p)}
 function fit(){if(!board.nodes.length){camera={x:20,y:40,z:1};position();return}const minX=Math.min(...board.nodes.map(n=>n.x)),minY=Math.min(...board.nodes.map(n=>n.y)),maxX=Math.max(...board.nodes.map(n=>n.x+248)),maxY=Math.max(...board.nodes.map(n=>n.y+(nodes.querySelector(`[data-node="${n.id}"]`)?.offsetHeight||230)));camera.z=Math.max(.5,Math.min(1,(viewport.clientWidth-60)/(maxX-minX),(viewport.clientHeight-60)/(maxY-minY)));camera.x=Math.max(30,(viewport.clientWidth-(maxX-minX)*camera.z)/2)-minX*camera.z;camera.y=Math.max(30,(viewport.clientHeight-(maxY-minY)*camera.z)/2)-minY*camera.z;position()}
 function zoom(factor){camera.z=Math.max(.5,Math.min(1.7,camera.z*factor));position()}
 function world(x,y){const r=viewport.getBoundingClientRect();return{x:(x-r.left-camera.x)/camera.z,y:(y-r.top-camera.y)/camera.z}}
 function field(label,key,value,kind='number',extra=''){return `<label>${label}<input data-param="${key}" type="${kind}" value="${esc(value)}" ${extra}></label>`}
 function edit(id){const n=board.nodes.find(n=>n.id===id);if(!n)return;selectedNode=id;inspector.hidden=false;const p=n.params;let form='';if(n.type==='asset'){form='<label>搜尋名稱或代號<input type="search" id="boardAssetSearch" placeholder="0050、台灣50…"></label><label>ETF<select id="boardAssetSelect" data-param="code"></select></label><button class="pill mini" type="button" id="boardOpenETF">開啟這檔觀測頁</button>'}else if(n.type==='condition'){form=`<label>指標<select data-param="metric">${[['water','價格水位 0–5'],['ma','均線＋價差'],['rsi','RSI(14)'],['flow','K 棒力道'],['ao','AO(5,34)'],['strength','MA700＋成交額300'],['trend','4／13MA 轉強']].map(([v,t])=>`<option value="${v}" ${p.metric===v?'selected':''}>${t}</option>`).join('')}</select></label>`;if(['water','ma','flow','strength'].includes(p.metric))form+=field(p.metric==='flow'?'力道期數':p.metric==='water'?'觀察交易日':'均線期數','period',p.period,'number','min="2" max="2400"');if(p.metric==='ma')form+=field('均線加價差（元）','offset',p.offset,'number','min="-1000" max="1000" step="0.1"');if(p.metric==='strength')form+=field('百分位參考交易日','window',p.window,'number','min="20" max="2400"');if(p.metric==='water')form+=`<label>刻度<select data-param="method"><option value="equal" ${p.method==='equal'?'selected':''}>等距</option><option value="fib" ${p.method==='fib'?'selected':''}>黃金分割</option></select></label>`;if(p.metric!=='trend')form+=`<label>比較<select data-param="op">${[['gte','大於或等於'],['lte','小於或等於'],['gt','大於'],['lt','小於']].map(([v,t])=>`<option value="${v}" ${p.op===v?'selected':''}>${t}</option>`).join('')}</select></label>`+field('門檻','value',p.value,'number','step="0.1"');const explain={water:'依前 N 日高低價計分，價格越低分越高。',ma:'比較值＝收盤價 −（均線＋價差）。大於 0 代表在分界上方。這與「均線往右平移 13 根」不同。',rsi:'Wilder RSI(14)，有效範圍 0–100。',flow:'K 棒實體／高低差的 N 期加總，並非實際法人籌碼。',ao:'高低價中點的 SMA5 − SMA34。',strength:'本站時序版：前 N 日相對均線乖離百分位 ×700，加成交額百分位 ×300。同值取中間名次；只用此前資料。歷史未滿均線＋排名窗時留白，非原站專有公式。',trend:'收盤不低於 4MA、13MA，4MA ≥13MA，且 13MA 較前一日上升。'};form+=`<details><summary>公式與口徑</summary><p class="small">${explain[p.metric]}</p></details>`}else if(n.type==='logic')form=`<label>合併方式<select data-param="mode"><option value="all" ${p.mode==='all'?'selected':''}>全部符合（AND）</option><option value="any" ${p.mode==='any'?'selected':''}>任一符合（OR）</option></select></label><p class="small">同一 ETF 的不同條件可合併。跨 ETF 請各接一張配置卡。</p>`;else if(n.type==='allocation')form=field('占整體預算（%）','weight',p.weight,'number','min="0" max="100"')+field('定投對照期數（0＝自動）','installments',p.installments,'number','min="0" max="240"')+field('條件成立時持股（%）','on',p.on,'number','min="0" max="100"')+field('條件不成立時持股（%）','off',p.off,'number','min="0" max="100"')+'<p class="small">各支線獨立使用指定預算，未用部分留現金，不互相借款。</p>';else form=field('組合名稱','name',p.name,'text','maxlength="30"');inspector.innerHTML=`<div class="inspector-head"><h3>${esc(B.title(n))}</h3><button class="pill mini" type="button" id="boardInspectorClose">完成</button></div>${form}<p class="small">修改保存為本機草稿；歷史結果需重新執行。</p>`;$('boardInspectorClose').onclick=()=>{inspector.hidden=true;selectedNode=null;render()};if(n.type==='allocation'){const select=document.createElement('label');select.innerHTML='執行方式<select data-param="preset"><option value="">依條件調整持股</option>'+[...E.PRESETS.filter(x=>['trendPullback','kdGolden','marginFear',p.preset].includes(x.id)),...(p.preset==='chatLadder'?[B.recipeFor(p,E)]:[])].map(x=>'<option value="'+x.id+'" '+(p.preset===x.id?'selected':'')+'>'+x.name+'</option>').join('')+'</select>';inspector.querySelector('.inspector-head').after(select);if(p.preset){inspector.querySelectorAll('[data-param=on],[data-param=off]').forEach(x=>x.closest('label').hidden=true);const recipe=B.recipeFor(p,E),params={...recipe.params,...p.strategyParams},group=document.createElement('div');group.innerHTML=(['chatLadder','trendPullback','kdGolden','marginFear'].includes(p.preset)?BT_SCHEMA[recipe.strategy]:[]).map(f=>btFieldHtml(f,params).replaceAll('data-k=','data-recipe=')).join('')+'<p class="small">核心按入金建立；上游條件只限制衛星加碼。'+BT_EXPLAIN[recipe.strategy]+'</p>';inspector.append(group);group.querySelectorAll('[data-recipe]').forEach(el=>el.onchange=()=>{checkpoint();n.params.strategyParams={...p.strategyParams,[el.dataset.recipe]:Math.max(Number(el.min),Math.min(Number(el.max),Number(el.value)))};board=B.clean(board);commit('策略參數已修改，請重新回測。');edit(id)})}}if(n.type==='asset'){function choices(q=''){const sel=$('boardAssetSelect');sel.replaceChildren();catalog.filter(e=>!/[KMSC]$/.test(e.code)&&(e.code.includes(q.toUpperCase())||e.name.includes(q))).forEach(e=>sel.add(new Option(e.code+' '+e.name,e.code)));sel.value=p.code}choices();$('boardAssetSearch').oninput=e=>choices(e.target.value.trim());$('boardOpenETF').onclick=()=>{window.chaoweiNavigate('etf','explore');pick(n.params.code)}}inspector.querySelectorAll('[data-param]').forEach(el=>el.addEventListener('change',()=>{checkpoint();const key=el.dataset.param;n.params[key]=el.type==='number'?Number(el.value):el.value;if(key==='preset')n.params.strategyParams={};if(key==='metric'){const m=el.value;n.params.value=m==='water'?4:m==='rsi'?30:m==='strength'?800:m==='trend'?1:0;n.params.period=m==='flow'?13:m==='strength'?960:240;n.params.op=m==='rsi'?'lte':m==='ma'?'lt':'gte'}board=B.clean(board);commit('條件已修改，歷史結果已失效。');edit(id)}));render()}
 host.addEventListener('click',e=>{const addButton=e.target.closest('[data-board-add]');if(addButton&&performance.now()-(addButton._dragEnd||0)>350)add(addButton.dataset.boardAdd);const editButton=e.target.closest('[data-edit]');if(editButton)edit(editButton.dataset.edit);const removeButton=e.target.closest('[data-remove]');if(removeButton)remove(removeButton.dataset.remove);const output=e.target.closest('[data-output]');if(output&&performance.now()-(output._dragEnd||0)>350){pending=output.dataset.output;render();note('再點另一張卡左側的接入點。')}const input=e.target.closest('[data-input]');if(input&&pending)connect(pending,input.dataset.input);const unlink=e.target.closest('[data-unlink]');if(unlink){checkpoint();board.edges.splice(Number(unlink.dataset.unlink),1);commit('已移除連線。')}const mode=e.target.closest('[data-board-view]');if(mode){view=mode.dataset.boardView;render()}});
 host.addEventListener('pointerdown',e=>{if(e.button!==0)return;const palette=e.target.closest('[data-board-add]'),out=e.target.closest('[data-output]'),head=e.target.closest('[data-drag]');if(palette){gesture={kind:'add',type:palette.dataset.boardAdd,x:e.clientX,y:e.clientY,element:palette};palette.setPointerCapture(e.pointerId)}else if(out){const r=world(e.clientX,e.clientY);gesture={kind:'connect',id:out.dataset.output,x:e.clientX,y:e.clientY,to:r,element:out};out.setPointerCapture(e.pointerId)}else if(head){const n=board.nodes.find(n=>n.id===head.dataset.drag);gesture={kind:'move',id:n.id,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y,before:cp(board),element:head};head.setPointerCapture(e.pointerId);head.focus()}else if(e.target.closest('#boardViewport')&&!e.target.closest('.board-node')){gesture={kind:'pan',x:e.clientX,y:e.clientY,ox:camera.x,oy:camera.y};viewport.setPointerCapture(e.pointerId)}if(gesture)e.preventDefault()});
 host.addEventListener('pointermove',e=>{if(!gesture)return;const g=gesture,dx=e.clientX-g.x,dy=e.clientY-g.y;g.moved=Math.abs(dx)+Math.abs(dy)>7;if(g.kind==='move'){const n=board.nodes.find(n=>n.id===g.id);n.x=Math.max(0,Math.min(4000,g.ox+dx/camera.z));n.y=Math.max(0,Math.min(2600,g.oy+dy/camera.z));const el=nodes.querySelector(`[data-node="${n.id}"]`);el.style.left=n.x+'px';el.style.top=n.y+'px';drawWires()}else if(g.kind==='pan'){camera.x=g.ox+dx;camera.y=g.oy+dy;position()}else if(g.kind==='connect'){g.to=world(e.clientX,e.clientY);drawWires()}else if(g.kind==='add')note('放開即可加入白板。')});
 host.addEventListener('pointerup',e=>{if(!gesture)return;const g=gesture;gesture=null;if(g.kind==='move'){if(g.moved){undo.push(g.before);redo=[];commit('卡片位置已保存。')}else edit(g.id)}if(g.kind==='connect'){g.element._dragEnd=performance.now();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-input]');if(target)connect(g.id,target.dataset.input);else if(!g.moved){pending=g.id;render();note('點另一張卡左側的接入點完成連線。')}else{note('未接上卡片；可再試或使用管理連線。');drawWires()}}if(g.kind==='add'){g.element._dragEnd=performance.now();const r=viewport.getBoundingClientRect();if(g.moved&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)add(g.type,world(e.clientX,e.clientY));else if(!g.moved)add(g.type)} });host.addEventListener('pointercancel',()=>{if(gesture?.kind==='move')board=gesture.before;gesture=null;render()});
 nodes.addEventListener('keydown',e=>{const head=e.target.closest('[data-drag]');if(!head)return;const n=board.nodes.find(x=>x.id===head.dataset.drag);if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();checkpoint();const s=e.shiftKey?64:16;n.x=Math.max(0,n.x+(e.key==='ArrowLeft'?-s:e.key==='ArrowRight'?s:0));n.y=Math.max(0,n.y+(e.key==='ArrowUp'?-s:e.key==='ArrowDown'?s:0));commit('卡片已移動。');nodes.querySelector(`[data-drag="${n.id}"]`).focus()}if(e.key==='Enter'||e.key===' '){e.preventDefault();edit(n.id)}if(e.key==='Delete'){e.preventDefault();remove(n.id)}});document.addEventListener('keydown',e=>{if(document.body.dataset.page!=='board')return;if(e.key==='Escape'){pending=null;inspector.hidden=true;render()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();(e.shiftKey?$('boardRedo'):$('boardUndo')).click()}});
 viewport.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(e.deltaY>0?.9:1.1)},{passive:false});$('boardFirst').onclick=()=>add('asset');$('boardZoomOut').onclick=()=>zoom(.85);$('boardZoomIn').onclick=()=>zoom(1.15);$('boardFit').onclick=fit;$('boardConnect').onclick=()=>connect($('boardConnectFrom').value,$('boardConnectTo').value);$('boardUndo').onclick=()=>{if(!undo.length)return;redo.push(cp(board));board=undo.pop();inspector.hidden=true;commit('已撤銷。')};$('boardRedo').onclick=()=>{if(!redo.length)return;undo.push(cp(board));board=redo.pop();inspector.hidden=true;commit('已重做。')};$('boardClear').onclick=()=>replace({nodes:[],edges:[]},'已清空，可用撤銷還原。');$('boardExample').onchange=e=>{if(e.target.value)replace(['boundary','strength'].includes(e.target.value)?B.template(e.target.value):B.example(e.target.value==='two'),'已載入範例，可自由修改。');e.target.value=''};$('boardArrange').onclick=()=>{checkpoint();const i=B.inspect(board),depth=new Map();i.order.forEach(id=>depth.set(id,Math.max(0,...i.incoming.get(id).map(x=>(depth.get(x)||0)+1))));const rowHeight=Math.max(220,...Array.from(nodes.querySelectorAll('.board-node'),n=>n.offsetHeight))+40,levels=new Map();for(const n of board.nodes){const d=depth.get(n.id)||0,count=levels.get(d)||0;n.x=30+d*290;n.y=60+count*rowHeight;levels.set(d,count+1)}commit('已依連線順序整理。');fit()};
 function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}$('boardLoadCloud').onclick=()=>{if(!isMember){$('accountTop').click();return}if(!settings.strategyBoard){note('帳號尚未保存白板。');return}replace(settings.strategyBoard,'已載入帳號版本，可撤銷還原。')};$('boardExport').onclick=()=>download('chaowei-strategy-board.json',JSON.stringify(board,null,2));$('boardImport').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>200000)throw Error('匯入檔案過大。');replace(JSON.parse(await file.text()),'已匯入草稿。')}catch(err){note('匯入失敗：'+err.message)}e.target.value=''};$('boardSave').onclick=()=>{if(!isMember){$('accountTop').click();return}settings.strategyBoard=B.clean(board);save();dirty=false;note('已保存至帳號；同步狀態可於右上帳號查看。')};
 async function load(code){if(bundles.has(code))return bundles.get(code);if(loads.has(code))return loads.get(code);const promise=(async()=>{const response=await fetch('/api/history?code='+code),meta=await response.json();if(meta.error)throw Error(meta.error);const final=(meta.bars||[]).filter(b=>!b.intraday&&(!meta.snapshotLatest||b.date<=meta.snapshotLatest));if(!final.length)throw Error(code+' 尚無已確認快照。');await btEnsureDividends();const div=(btDivs?.[code]||[]).map(([date,v])=>[date,v/(meta.adjustments||[]).reduce((f,a)=>date<a.date?f*a.factor:f,1)]),bundle={meta,ctx:E.prepare(final,div,null,{marginDrop5:E.marginHistory(final,btMarginRows)})};bundles.set(code,bundle);return bundle})();loads.set(code,promise);try{return await promise}finally{loads.delete(code)}}
 async function prepare(){const info=B.inspect(board);if(info.errors.length)throw Error(info.errors[0]);const codes=[...new Set(info.board.nodes.filter(n=>n.type==='asset'&&info.used.has(n.id)).map(n=>n.params.code))];if(codes.length>8)throw Error('同一次研究最多 8 檔 ETF。');for(const code of codes){if(!catalog.some(e=>e.code===code))throw Error(code+' 不在目前台灣 ETF 名錄。');if(/[KMSC]$/.test(code))throw Error('白板組合目前只合併新台幣報價 ETF；外幣掛牌需另計匯率。')}await Promise.all(codes.map(load));return B.compile(board,bundles,E)}
 async function preview(){const mine=++previewGen;if(!board.nodes.length){note('空白白板 · 從一張 ETF 卡開始');return}try{const info=B.inspect(board);if(info.errors.length){note(info.errors[0]);return}const c=await prepare();if(mine!==previewGen)return;compiled=c;render();const valid=c.plans.every(p=>p.flags.at(-1)!=null);note((valid?'條件已核對':'有條件歷史不足')+' · 確認收盤 '+[...new Set(c.plans.map(p=>p.bundle.ctx.bars.at(-1).date))].join('／')+(c.warnings.length?' · '+c.warnings.length+' 張未接入':''));}catch(e){if(mine===previewGen)note(e.message)}}
 $('boardRun').onclick=async()=>{if(!isMember){$('accountTop').click();return}const mine=++runGen,rev=revision;$('boardRun').disabled=true;$('boardRunStatus').textContent='核對條件與共同資料…';try{const c=await prepare();if(mine!==runGen||rev!==revision)return;const from=$('boardFrom').value,to=$('boardTo').value,capital=Number($('boardCapital').value);if(!from||!to||from>=to)throw Error('請輸入先後正確的日期。');if(!(capital>=10000&&capital<=100000000))throw Error('研究預算須在一萬至一億元之間。');const firsts=c.plans.map(p=>{const i=p.flags.findIndex(v=>v!=null);return i<0?null:p.bundle.ctx.bars[Math.min(p.bundle.ctx.n-1,i)].date});if(firsts.some(x=>x==null))throw Error('有條件尚無足夠歷史；可縮短均線／觀察窗或換 ETF。');const actualFrom=[from,...firsts].sort().at(-1),actualTo=[to,...c.plans.map(p=>p.bundle.ctx.bars.at(-1).date)].sort()[0];if(actualFrom>=actualTo)throw Error('條件成熟日期晚於結束日，請調整區間。');B.install(E);const calendars=c.plans.map(p=>new Set(p.bundle.ctx.bars.map(b=>b.date))),common=c.plans[0].bundle.ctx.bars.map(b=>b.date).filter(d=>d>=actualFrom&&d<=actualTo&&calendars.every(set=>set.has(d)));if(common.length<20)throw Error('共同交易日不足 20 日。');const sharedFrom=common[0],sharedTo=common.at(-1),base=btCfg(),runs=[];for(const p of c.plans){const ctx=p.bundle.ctx,a=ctx.bars.findIndex(b=>b.date>=sharedFrom),z=ctx.bars.findLastIndex(b=>b.date<=sharedTo);if(z-a<19)throw Error(p.code+' 在所選區間不足 20 個交易日。');ctx.tradeTax=Float64Array.from(ctx.bars,b=>/B$/.test(p.code)&&b.date>='2017-01-01'&&b.date<='2026-12-31'?0:base.tax/100);const cfg=B.runConfig(p,base,capital,E);if(cfg.capital>0){const out=E.run(ctx,cfg,a,z);runs.push({...out,code:p.code,plan:p,ctx,executions:B.executions(out,p,ctx)})}await new Promise(r=>setTimeout(r,0));if(mine!==runGen||rev!==revision)return}result=B.aggregate(runs,capital,capital*(1-c.total/100),base.parking);renderResult(result,c,base,from,actualFrom,runs);compiled=c;render();}catch(e){if(mine===runGen)$('boardRunStatus').textContent=e.message}finally{$('boardRun').disabled=false}};
 function renderResult(r,c,base,requested,actual,runs){clearStage();$('boardRunResult').innerHTML=`<div class="board-result-kpis">${[['研究年化',pctText(r.cagr),r.cagr],['同期定額',pctText(r.benchmarkCagr),r.benchmarkCagr],['最大回落',(r.mdd?'−':'')+fmt(r.mdd*100,1)+'%',-r.mdd],['平均持股／交易',fmt(r.utilization*100,0)+'% · '+r.trades.length+' 筆',0]].map(([a,b,v])=>`<div><small>${a}</small><strong class="${v>0?'up':v<0?'down':''}">${b}</strong></div>`).join('')}</div><p class="small">${r.from} 至 ${r.to} · ${r.series.length} 個共同交易日 · ${c.plans.map(p=>p.code+' '+p.weight+'%').join('、')} · 未配置現金 ${fmt(100-c.total,0)}%</p><div class="board-result-chart" id="boardResultChart" aria-label="白板研究與同期定額資產曲線"></div><div class="bt-equity-legend"><span class="s">白板研究</span><span class="d">同期定額</span></div><details class="metric-detail"><summary>交易與條件覆蓋</summary><p class="small">共 ${r.trades.length} 筆調整，費稅 ${money(r.fees)}。條件當日已知，次日收盤成交；與回測區預設的 T+1 開盤成交不同，請看本區基準。</p><div>${c.plans.map(p=>`<p class="small">${p.code}：${p.preset?(B.recipeFor(p,E)?.name+(p.ruleIds.length?'；上游條件限制衛星加碼':'；依自身策略規則')):'成立持股 '+p.on+'%／不成立 '+p.off+'%'}；前段資料不足時不進場。</p>`).join('')}</div><button class="pill mini" type="button" id="boardTradesExport">匯出交易 CSV</button></details>`;chart?.remove();chart=LightweightCharts.createChart($('boardResultChart'),{...chartOptions(),height:290});sLine=chart.addLineSeries({color:'#148c9a',lineWidth:3,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>fmt(v/10000,1)+'萬'}});dLine=chart.addLineSeries({color:'#c18c25',lineWidth:2,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>fmt(v/10000,1)+'萬'}});sLine.setData(r.series.map(x=>({time:x.time,value:x.value})));dLine.setData(r.series.map(x=>({time:x.time,value:x.dca})));chart.timeScale().fitContent();$('boardTradesExport').onclick=()=>{const rows=['日期,ETF,方向,價格,股數,金額,理由',...r.trades.map(t=>[t.date,t.code,t.type,t.price,t.shares,t.amount,t.reason].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(','))];const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.join('\n')],{type:'text/csv;charset=utf-8'}));a.download='chaowei-board-trades.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};$('boardRunStatus').textContent=(actual>requested?'依條件可用日期縮至 '+actual+' 起。':'')+'完成；結果是歷史研究，不保證勝過定額。';$('boardAssumptions').textContent=`股票型稅率採所選假設；原型債券 ETF 在 2017–2026 日資料採免稅。手續費 ${base.fee}% × ${base.discount}% 折扣、交易稅 ${base.tax}%、停泊年息 ${base.parking}%、${base.drip?'股利再投入':'股利留現金'}、${base.wholeShares?'整股':'允許小數股'}。`;renderStage(runs);const out=$('boardRunResult');Object.assign(out.dataset,{xirr:r.xirr,benchmark:r.benchmarkXirr,mdd:r.mdd,exposure:r.utilization,from:r.from,to:r.to,trades:r.trades.length});}
 window.chaoweiImportBoard=(input,meta={})=>{replace(input,'已帶入對話規則；請確認預算、日期後執行。');if(meta.from)$('boardFrom').value=meta.from;if(meta.to)$('boardTo').value=meta.to;if(meta.capital)$('boardCapital').value=meta.capital;window.chaoweiNavigate('board','strategyBoardPage')};
 $('boardHelp').onclick=()=>{let d=$('boardGuide');if(d){d.open=!d.open;return}d=document.createElement('details');d.id='boardGuide';d.className='metric-detail';d.open=true;d.innerHTML='<summary>四步完成一張白板</summary><ol><li>加入 ETF 卡，點編輯選標的。</li><li>加入條件卡，設定指標與門檻。</li><li>連右側圓點到下一張左側圓點；先點連出、再點接入也可以。</li><li>條件接配置，配置接組合；確認預算不超過 100%，再選日期回測。</li></ol><p class="small">拖卡片標題移動，拖空白處平移；Ctrl／Command＋滾輪縮放。鍵盤可用方向鍵移動卡片；不方便拖曳時，使用步驟清單與管理連線。未連入組合的卡片不參與計算。</p>';$('boardStatus').after(d)};
 $('boardTo').value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});$('boardFrom').value=String(new Date().getFullYear()-5)+'-01-01';for(const id of ['boardFrom','boardTo','boardCapital'])$(id).addEventListener('change',()=>{runGen++;result=null;$('boardRunResult').replaceChildren();chart?.remove();chart=null;$('boardRunStatus').textContent='日期或預算已變更，請重新執行。'});
 const oldProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{oldProfile(p);if(!dirty&&settings.strategyBoard){try{board=B.clean(settings.strategyBoard);render();preview()}catch{}}};window.addEventListener('chaowei-page-changed',()=>{if(document.body.dataset.page==='board'){render();preview();chart?.resize($('boardResultChart')?.clientWidth||300,290)}});window.addEventListener('chaowei-typography-changed',()=>{drawWires();chart?.applyOptions(chartOptions())});window.addEventListener('chaowei-snapshot-updated',e=>{const m=/history\/([0-9A-Z]{4,6})\.json/.exec(e.detail.path);if(m&&bundles.has(m[1])){bundles.delete(m[1]);if(document.body.dataset.page==='board')preview()}});new ResizeObserver(drawWires).observe(nodes);setInterval(()=>{if(document.body.dataset.page==='board'&&!document.hidden){bundles.clear();preview()}},300000);render();preview();
})();

/* Transparent research formula, independent of the 0–5 water score and proprietary vendors. */
(()=>{
 const d=document.createElement('details');d.className='metric-detail signal-study';d.id='strengthStudy';d.innerHTML='<summary>均線與千分強度研究</summary><div class="controls"><label>均線期數<select id="strengthPeriod"><option value="960">960 日</option><option value="240">240 日</option></select></label><label>加價差（元）<input type="number" id="strengthOffset" min="-1000" max="1000" step="0.1" value="13"></label></div><div id="strengthBody"></div><details><summary>公式與訊號口徑</summary><p class="small">本站研究版，未驗證為 960 Trading 的專有原式。分界＝SMA(N)＋價差；力道＝近 13 根 (收−開)/(高−低) 加總，不是實際法人買賣。分界下且力道正為低接條件，分界上且力道負為轉弱條件。強度是自身前 240 日的均線乖離百分位 ×700，加成交額百分位 ×300；同值取中間名次，僅用此前資料。原始成交額以分割因子還原收盤價再乘原始股數。歷史不足不替代均線，0–5 水位與千分強度不混算。訊號後價格變化未含配息及費用，不是實際持有損益。</p></details>';$('techRead').after(d);
 let cachedBars=null,cachedMeta=null,cachedBundle=null;
 function render(){if(!d.open)return;const rows=bars.filter(b=>!b.intraday&&(!historyMeta?.snapshotLatest||b.date<=historyMeta.snapshotLatest)),period=Number($('strengthPeriod').value),offset=Number($('strengthOffset').value);if(!rows.length){$('strengthBody').textContent='尚無已確認日 K。';return}if(cachedBars!==bars||cachedMeta!==historyMeta){cachedBars=bars;cachedMeta=historyMeta;cachedBundle={ctx:E.prepare(rows,[]),meta:historyMeta}}const bundle=cachedBundle,params={metric:'strength',period,window:240},score=StrategyBoard.series(bundle,params,E),maDiff=StrategyBoard.series(bundle,{metric:'ma',period,offset:0},E).values,flow=StrategyBoard.series(bundle,{metric:'flow',period:13},E).values,i=rows.length-1;let last=null,prior=null,state='觀望';for(let j=0;j<rows.length;j++){if(maDiff[j]==null||flow[j]==null)continue;const boundary=rows[j].close-maDiff[j]+offset,signal=rows[j].close<boundary&&flow[j]>0?'低接條件':rows[j].close>boundary&&flow[j]<0?'轉弱條件':'觀望';if(j===i)state=signal;if(signal!=='觀望'&&signal!==prior){last={date:rows[j].date,price:rows[j].close,type:signal};prior=signal}}const value=score.values[i],ma=maDiff[i]==null?null:rows[i].close-maDiff[i],pnl=last?rows[i].close/last.price-1:null;$('strengthBody').innerHTML=`<p class="small">${selected} · ${rows[i].date} 確認收盤 · 自身歷史時序排名</p><div class="signal-summary"><div><small>千分強度</small><strong class="${value==null?'':value>=500?'up':'down'}">${value==null?'資料不足':fmt(value,0)+' / 1000'}</strong><p class="small">${value==null?'需至少 '+(period+240)+' 根日 K，目前 '+rows.length+' 根':'MA '+score.detail.ma[i]+' ＋ 成交額 '+score.detail.value[i]}</p></div><div><small>目前條件</small><strong>${state}</strong><p class="small">${ma==null?'均線歷史不足':'MA'+period+' '+fmt(ma,2)+' · 分界 '+fmt(ma+offset,2)}</p></div></div><div class="strength-meter" aria-hidden="true"><i style="width:${value==null?0:score.detail.ma[i]/10}%"></i><i style="width:${value==null?0:score.detail.value[i]/10}%"></i></div>${last?`<p class="small">最近${last.type}：${last.date}，收盤 ${fmt(last.price,2)}；其後價格變化 <span class="${pnl>=0?'up':'down'}">${pctText(pnl)}</span>。</p>`:''}<a class="pill mini" href="#strategyBoardPage">在白板設定條件</a>`;}
 d.addEventListener('toggle',render);$('strengthPeriod').onchange=render;$('strengthOffset').onchange=render;const old=drawChart;drawChart=function(...a){const r=old(...a);render();return r};
 // Financial returns are coloured by their numeric meaning, not by their text length.
 const btOld=renderBacktest;renderBacktest=function(...a){const out=btOld(...a);if(btResult){const values=[btAnnual(btResult),-btResult.mdd,btResult.sharpe,btResult.utilization],els=$('btKpis').querySelectorAll('.bt-big>div>b');values.forEach((v,i)=>{els[i]?.classList.toggle('up',v>0);els[i]?.classList.toggle('down',v<0)})}return out};
})();

/* Concept illustrations; figures here are definitions, never market readings. */
(()=>{
 const ns='http://www.w3.org/2000/svg',rows=[
 {target:document.querySelector('.method-steps details'),title:'水位映射示意',svg:'<path d="M30 108 Q95 20 165 66 T390 30" stroke="#4c9d9d" stroke-width="3" fill="none"/><path class="motion-path" d="M30 130 H390" stroke="#a7b9b9" stroke-width="2"/><text x="28" y="160">低價 · 5 分</text><text x="285" y="160">高價 · 0 分</text><circle cx="165" cy="66" r="7" fill="#d9b76d"/><text x="135" y="30">目前位置</text>'},
 {id:'strengthMethod',heading:'06 千分強度怎麼組成？',text:'本站時序研究版：均線乖離在自身前 240 日的百分位乘 700，加上成交額百分位乘 300。這是另一種強度讀數，不是 0–5 水位，也不是勝率；歷史不足留白。',title:'MA 與成交額配分示意',svg:'<rect x="18" y="20" width="132" height="48" rx="18" fill="#badbd5"/><rect x="18" y="96" width="132" height="48" rx="18" fill="#e1d2ab"/><text x="34" y="50" fill="#183d43">MA 上限 700</text><text x="30" y="126" fill="#183d43">成交額 300</text><path class="motion-path" d="M150 44 H220 Q240 44 240 82 H282 M150 120 H220 Q240 120 240 82" stroke="#5e9997" stroke-width="3" fill="none"/><rect x="282" y="58" width="120" height="48" rx="18" fill="#315a67"/><text x="297" y="88" fill="#f1f8f4">上限 1000</text>'},
 {id:'validationMethod',heading:'07 歷史當下怎麼驗證？',text:'先固定訓練與驗證日期，只用訓練期選規則與觀察窗，再鎖定參數檢查後段。各方法按訓練排名逐列對照；看完驗證結果再調參屬新一輪探索，不再是原先那次獨立驗證。',title:'訓練截止與後段驗證示意',svg:'<rect x="24" y="45" width="176" height="60" rx="18" fill="#94bfb6"/><rect x="220" y="45" width="176" height="60" rx="18" fill="#9aaecd"/><text x="58" y="82" fill="#173f45">已知：訓練</text><text x="254" y="82" fill="#173f45">後段：驗證</text><path d="M210 18 V142" stroke="#d6b265" stroke-width="3"/><text x="154" y="165">鎖定參數</text><path class="motion-path" d="M30 122 H194 M226 122 H390" stroke="#5e9997" stroke-width="2"/>'}
 ];const target=document.querySelector('.method-steps'),observe=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('diagram-visible',e.isIntersecting)),{threshold:.15});for(const row of rows){let d=row.target;if(!d){d=document.createElement('details');d.id=row.id;d.innerHTML='<summary>'+row.heading+'</summary><p>'+row.text+'</p>';target.append(d)}const wrap=document.createElement('div');wrap.className='method-figure';wrap.innerHTML='<svg class="method-diagram" viewBox="0 0 420 185" role="img" aria-label="'+row.title+'"><title>'+row.title+'，概念示意</title>'+row.svg+'</svg><button class="pill mini diagram-toggle" type="button" aria-pressed="false">暫停圖解</button>';d.querySelector('summary').after(wrap);const button=wrap.querySelector('button');button.onclick=()=>{const paused=wrap.classList.toggle('diagram-paused');button.textContent=paused?'播放圖解':'暫停圖解';button.setAttribute('aria-pressed',String(paused))};observe.observe(wrap)}
 const foot=document.querySelector('footer>div:first-child');if(foot){const d=document.createElement('details');d.className='source-footer';d.innerHTML='<summary>資料來源與使用說明</summary>';foot.before(d);d.append(foot)}
})();

/* Sizing comparison uses the same account, dates and deposits; only the entry sizing changes. */
(()=>{
 const label=document.createElement('label');label.className='entry-sizing-field';label.innerHTML='資金分幾等分<select id="btEntryTranches"><option value="0">依策略預設</option><option value="2">分 2 等分（每份 50%）</option><option value="3">分 3 等分（每份 33%）</option><option value="4">分 4 等分（每份 25%）</option></select>';$('btSplit').before(label);
 const panel=document.createElement('details');panel.id='fundingComparison';panel.className='metric-detail';panel.innerHTML='<summary>資金運用與分批試算</summary><div id="fundingUsage"></div><p id="fundingCompareIntro" class="small">只改資金分批，同一段日期、同樣入金、費用與交易條件。</p><button class="pill" id="runFundingCompare" type="button">比較各種等分</button><p class="small" id="fundingCompareStatus" role="status"></p><div id="fundingCompareResult"></div>'; $('btNow').after(panel);
 let generation=0;
 function refresh(){generation++;const cfg=btCfg(),f=E.fundingInfo(cfg);$('btEntryTranches').value=String(cfg.entryTranches||0);{const p=settings.bt.params,parts=cfg.strategy==='classic'?(p.entry==='fib'?p.levels.length:1+p.adds):0;$('btEntryTranches').options[0].textContent=parts?'依策略預設（'+parts+' 等分）':'依方法原規則';}label.hidden=!f.supported;label.firstChild.textContent=cfg.params.core&&cfg.params.basePct>0?'底倉以外資金分幾批':'資金分幾等分';if(cfg.params.core&&cfg.params.basePct>0){for(const o of label.querySelectorAll('option'))if(Number(o.value)>0)o.textContent='剩餘資金分 '+o.value+' 批';}else{for(const o of label.querySelectorAll('option'))if(Number(o.value)>0)o.textContent='分 '+o.value+' 等分（每份 '+(100/Number(o.value)).toFixed(0)+'%）';}panel.hidden=false;$('fundingCompareIntro').hidden=!f.supported;$('runFundingCompare').hidden=!f.supported;delete panel.dataset.rows;const r=btResult;if(r){const u=E.positionUsage(r);$('fundingUsage').innerHTML='<div class="usage-grid"><div><small>有部位的交易日</small><b>'+fmt(u.participation*100,1)+'%</b></div><div><small>持有時平均配置</small><b>'+fmt(u.heldWeight*100,1)+'%</b></div><div><small>最長連續空手</small><b>'+u.longestIdle+' 日</b></div></div><p class="small">'+(u.firstBuy?'首次買進 '+u.firstBuy+'。':'整段未曾買進。')+'平均持股 '+fmt(u.average*100,1)+'% ＝ 有部位日占比 × 持有時平均配置；不是目前部位。'+(u.participation<.5?' 主要限制是長時間空手；增加每批金額不會讓條件更早觸發。':u.heldWeight<.5?' 有進場但配置偏少，可比較兩／三批的實際差異。':'')+'</p><p class="small">進場幅度、觀察窗與出場條件可在上方調整；若想避免長時間空手，可勾選「第 1 份當底倉」或選「底倉＋回檔加碼」。本站不會為提高報酬自動放寬條件。</p>'}else $('fundingUsage').replaceChildren();$('fundingCompareResult').replaceChildren();$('fundingCompareStatus').textContent=!f.supported?'此方法依目標持股比例或既有規則配置，不套用固定分批。':f.tranches?'目前採 '+f.tranches+' 批；切換後請重新比較。':'可比較策略預設與 2／3／4 等分。';$('runFundingCompare').disabled=false;}
 // Size comparison drawn from the reader's own numbers: N small monthly installments vs k equal parts.
 // Circle area is proportional to the amount; the base part (if any) is filled solid.
 const art=document.createElement('figure');art.className='tranche-art';art.setAttribute('aria-hidden','true');$('btSplit').after(art);
 function drawArt(){
  const b=settings.bt,p=b.params,N=btN();if(b.strategy!=='classic'||p.basePct>0||b.capitalMode==='monthly'||b.funding?.type==='annual'||!N){art.hidden=true;return}
  const k=p.entry==='fib'?Math.min(p.levels.length,Number(b.entryTranches)||p.levels.length):(Number(b.entryTranches)||1+p.adds),C=b.capital,small=C/N,big=C/k;
  // Two rows so it reads in a narrow column: installments on top, equal parts below.
  const W=300,R=22,shown=Math.min(N,20),r=Math.min(5.5,Math.max(2,R*Math.sqrt(small/big))),gap=(W-12-2*r)/Math.max(1,shown-1);
  const dots=Array.from({length:shown},(_,i)=>`<circle cx="${(6+r+i*gap).toFixed(1)}" cy="34" r="${r.toFixed(1)}" class="ta-dca" style="animation-delay:${(i*0.12).toFixed(2)}s"/>`).join('');
  const balls=Array.from({length:k},(_,i)=>`<circle cx="${(6+R+i*(2*R+10)).toFixed(1)}" cy="100" r="${R}" class="ta-part${p.core&&i===0?' core':''}" style="animation-delay:${(i*0.5).toFixed(1)}s"/>`).join('');
  art.innerHTML=`<svg viewBox="0 0 ${W} 150" role="presentation"><text x="6" y="14" class="ta-label">定期定額 ${N} 期 × ${fmt(Math.round(small),0)} 元</text>${dots}<text x="6" y="66" class="ta-label">本策略 ${k} 份 × ${fmt(Math.round(big),0)} 元</text>${balls}<text x="6" y="144" class="ta-note">圓面積＝單次金額${p.core?'，實心＝底倉':''}</text></svg>`;
  art.hidden=false;
 }
 const fill=btFillForm;btFillForm=function(...a){fill(...a);refresh();drawArt()};
 $('btEntryTranches').onchange=e=>{settings.bt.entryTranches=Number(e.target.value);save();btFillForm();renderBacktest()};
 $('runFundingCompare').onclick=async()=>{if(!isMember){$('accountTop').click();return}const mine=++generation,code=selected;const button=$('runFundingCompare');button.disabled=true;$('fundingCompareStatus').textContent='計算中…';try{await btEnsureDividends();const ctx=btContext(),original=btCfg(),base={...original,params:JSON.parse(JSON.stringify(settings.bt.params))},start=btStart(settings.bt.period),end=btEnd(),rows=[];for(const k of [0,2,3,4]){const cfg={...base,entryTranches:k,params:JSON.parse(JSON.stringify(base.params))};if(k&&cfg.strategy==='classic'){if(cfg.params.entry==='fib')cfg.params.levels=cfg.params.levels.slice(0,k);else cfg.params.adds=k-1}const r=E.run(ctx,cfg,start,end),buys=r.trades.filter(t=>t.type==='buy'&&t.kind!=='drip'),signals=buys.filter(t=>['entry','add'].includes(t.kind));rows.push({k,r,max:Math.max(0,...signals.map(t=>t.amount)),average:buys.reduce((s,t)=>s+t.amount,0)/Math.max(1,buys.length)});await new Promise(resolve=>setTimeout(resolve,0));if(mine!==generation||code!==selected)return}
 const table=document.createElement('div');table.className='sizing-table';table.innerHTML='<table><thead><tr><th>進場規則</th><th>策略年化</th><th>平均持股</th><th>最大回落</th><th>最大進場／加碼</th><th>套用</th></tr></thead><tbody>'+rows.map(({k,r,max})=>'<tr><td>'+(k?k+' 等分':'策略預設')+'</td><td class="'+(btAnnual(r)>0?'up':'down')+'">'+pctText(btAnnual(r))+'</td><td>'+fmt(r.utilization*100,1)+'%</td><td>'+fmt(r.mdd*100,1)+'%</td><td>'+money(max)+'</td><td><button class="pill mini" data-use-sizing="'+k+'">套用</button></td></tr>').join('')+'</tbody></table>';$('fundingCompareResult').replaceChildren(table);table.querySelectorAll('[data-use-sizing]').forEach(b=>b.onclick=()=>{$('btEntryTranches').value=b.dataset.useSizing;$('btEntryTranches').dispatchEvent(new Event('change'))});const r=rows[0].r;$('fundingCompareStatus').textContent=(r.funding?.type==='annual'?'定額每期平均 ':'定額每期 ')+money(r.base)+'，共 '+r.N+' 期；定額年化 '+pctText(btAnnual(r.dca,r.monthly))+'；全部方法本金 '+money(r.contributed)+'。賣出資金可循環使用，總買進額可能超過本金。';panel.dataset.rows=JSON.stringify(rows.map(({k,r,max,average})=>({k,xirr:r.xirr,annual:btAnnual(r),dca:btAnnual(r.dca,r.monthly),mdd:r.mdd,utilization:r.utilization,max,average,contributed:r.contributed,N:r.N})));}catch(e){if(mine===generation)$('fundingCompareStatus').textContent=e.message}finally{if(mine===generation)button.disabled=false}};
 const render=renderBacktest;renderBacktest=function(...a){const out=render(...a);refresh();return out};refresh();
})();

/* Layout preference, kept on this device only: 「電腦版」 makes a phone render the full desktop layout (as a
   1280px-wide page it can zoom), and on a computer a button opens the site in a phone-sized window, where the
   real mobile layout applies (it follows the window width, so a narrow column inside this page would not). */
(()=>{
 const meta=document.querySelector('meta[name=viewport]'),narrow=matchMedia('(max-width: 760px)');
 settings.layoutMode=settings.layoutMode==='desktop'?'desktop':'auto';
 const apply=()=>{meta.setAttribute('content',settings.layoutMode==='desktop'?'width=1280':'width=device-width,initial-scale=1');$('layoutMode').value=settings.layoutMode};
 $('layoutMode').addEventListener('change',e=>{settings.layoutMode=e.target.value==='desktop'?'desktop':'auto';save();apply()});
 const phoneButton=()=>{$('openPhoneView').hidden=narrow.matches||settings.layoutMode==='desktop'&&screen.width<760};
 $('openPhoneView').addEventListener('click',()=>window.open(location.href,'chaoweiPhoneView','width=400,height=860'));
 narrow.addEventListener('change',phoneButton);apply();phoneButton();
})();
/* Shared disclosure and FAQ markup. No financial settings are changed here. */
(()=>{
 const marketHeading=$('market').querySelector('h3');if(marketHeading){marketHeading.textContent='觀測因子';marketHeading.previousElementSibling?.remove()}
 const group=document.querySelector('.method-steps');for(const summary of group.querySelectorAll(':scope > details > summary')){const m=summary.textContent.trim().match(/^(\d{2})\s*(.+)$/);if(!m)continue;const num=document.createElement('span'),title=document.createElement('strong'),state=document.createElement('span');num.className='faq-number';num.textContent=m[1];title.className='faq-question';title.textContent=m[2];state.className='faq-state';state.textContent=summary.parentElement.open?'收起':'展開';state.setAttribute('aria-hidden','true');summary.replaceChildren(num,title,state);summary.parentElement.addEventListener('toggle',()=>state.textContent=summary.parentElement.open?'收起':'展開')}
 for(const a of document.querySelectorAll('#pageNav a')){const text=a.textContent.trim(),short=({'首頁':'首頁','ETF 觀測':'ETF','市場刻度':'市場','策略白板':'白板','方法說明':'說明'})[text];if(short){a.setAttribute('aria-label',text);const full=document.createElement('span'),small=document.createElement('span');full.className='nav-full';full.textContent=text;small.className='nav-short';small.textContent=short;small.setAttribute('aria-hidden','true');a.replaceChildren(full,small)}}
 const form=document.querySelector('.view-card'),advanced=document.createElement('details');advanced.className='metric-detail observation-settings';advanced.id='observationSettings';advanced.innerHTML='<summary>觀察設定與收藏</summary>';const fields=form.querySelector('.controls'),fav=$('favBar');fields.before(advanced);advanced.append(fields,fav);if(settings.studyMode==='full')advanced.open=true;
 // Range remains available on the chart; repeated mode choices are represented by the single study bar.
 $('btMode').hidden=true;$('btMode').setAttribute('aria-hidden','true');
 const originalPosition=computePosition;function observationTitle(){const w=$('window').value,m=$('method').value;advanced.querySelector('summary').textContent='觀察設定 · '+(w==='all'?'全部':w+' 日')+'／'+(m==='fib'?'黃金分割':'等距')}computePosition=function(...args){const r=originalPosition(...args);observationTitle();return r};observationTitle();
 const range=$('rangeSeg'),more=document.createElement('select');more.id='chartRangeMore';more.setAttribute('aria-label','其他顯示期間');more.add(new Option('其他期間',''));const extraButtons=new Map();for(const b of range.querySelectorAll('[data-range]'))if(!['1m','3m','1','all'].includes(b.dataset.range)){extraButtons.set(b.dataset.range,b);more.add(new Option(b.textContent.trim(),b.dataset.range));b.hidden=true}range.append(more);more.onchange=()=>{extraButtons.get(more.value)?.click()};const oldRange=setRange;setRange=function(v,...args){const r=oldRange(v,...args);more.value=extraButtons.has(v)?v:'';return r};
 const indicators=document.createElement('details');indicators.id='chartIndicatorSettings';indicators.className='metric-detail';indicators.innerHTML='<summary>技術指標與圖表設定</summary>';const indicatorTools=$('chartCard').querySelector('.indicator-tools');indicatorTools.before(indicators);indicators.append(indicatorTools,$('chartCard').querySelector('.level-tools'),$('indSettings'));
 const step=$('btParams').closest('.bt-step'),title=step.querySelector('h4');if(title)title.innerHTML='<b>2</b> 觸發條件';
 const label=$('btDcaPeriods').closest('label');label.classList.remove('expert-only');$('btCapitalMode').closest('label').classList.remove('expert-only');
 for(const details of group.children)if(details.tagName==='DETAILS')details.addEventListener('toggle',()=>{if(details.open)for(const other of group.children)if(other!==details&&other.tagName==='DETAILS')other.open=false});
 // The chart pans and zooms by wheel, drag and pinch; the four step buttons move into the chart settings so the
 // toolbar keeps only the ranges plus 貼合畫面／回到最新區間. They stay available for keyboard users there.
 const zoom=$('chartCard').querySelector('.zoom-controls'),settingsPanel=$('chartIndicatorSettings');
 if(zoom&&settingsPanel){const box=document.createElement('div');box.className='zoom-moved';box.innerHTML='<span class="small">移動與縮放（也可用滑鼠滾輪、拖曳或雙指）</span>';box.append(zoom);settingsPanel.querySelector(':scope > summary').after(box)}
})();

/* ---------- Saved weight plan drives the main water level ----------
   「儲存並套用到水位」 keeps the current weights on this device. While a plan is applied, the top bar, the big water
   number and the gauge show that plan's weighted score, recomputed from the latest data on every refresh,
   instead of this ETF's own price position. Moving the sliders afterwards does not change the main screen until
   the plan is saved again. Scoring directions stay the global settings. A shared plan link shows its own weights. */
(()=>{
  const valid=p=>p&&Array.isArray(p.weights)&&p.weights.some(x=>Number(x)>0);
  if(!valid(settings.appliedPlan))delete settings.appliedPlan;
  const plan=()=>shareView?{weights:currentWeights(),name:'分享的方案'}:settings.appliedPlan||null;
  const box=document.createElement('div');box.className='applied-plan';box.innerHTML='<p class="small" id="appliedStatus" aria-live="polite"></p><div><button class="action" type="button" id="applyWeights">儲存並套用到水位</button><button class="pill" type="button" id="clearApplied">改回只看本檔</button></div>';
  $('weightPreview').after(box);
  const label=$('grade').closest('.water-copy').querySelector('.overline'),plainLabel=label.textContent;
  const note=document.createElement('p');note.className='small applied-note hidden';$('grade').after(note);
  const barLabel=$('barGrade').previousElementSibling,plainBar=barLabel?.textContent;
  const same=(a,b)=>JSON.stringify((a||[]).map(Number))===JSON.stringify((b||[]).map(Number));
  function status(){
    const p=settings.appliedPlan,changed=p&&!same(p.weights,currentWeights());
    $('appliedStatus').textContent=shareView?'檢視分享的方案：主畫面水位依這組權重計算。':p?`主畫面水位使用「${p.name}」（${p.savedAt} 儲存）`+(changed?'；目前滑桿與已套用的不同，按「儲存並套用到水位」更新。':'。'):'主畫面水位目前只看本檔價格位置；按下按鈕後改用這組權重，並隨最新資料更新。';
    $('clearApplied').hidden=!p||shareView;$('applyWeights').hidden=shareView;
  }
  function show(){
    frame=0;status();const p=plan();
    if(!p){label.textContent=plainLabel;if(barLabel)barLabel.textContent=plainBar;note.classList.add('hidden');return}
    const r=weightedScore(p.weights);
    if(r.value==null){label.textContent=plainLabel;if(barLabel)barLabel.textContent=plainBar;note.textContent='「'+p.name+'」部分因子資料不足，暫時顯示本檔價格水位。';note.classList.remove('hidden');return}
    const v=r.value,own=r.scores[0];
    $('grade').innerHTML=fmt(v,1)+'<small>/5</small>';$('barGrade').textContent=fmt(v,1)+' / 5';
    // The gauge fills like the price gauge: a high score (favourable) is a low water line.
    const cup=$('cupWater');cup.style.height=Math.max(0,Math.min(1,1-v/5))*100+'%';const [a,b]=tideColors(v);cup.style.setProperty('--w1',a);cup.style.setProperty('--w2',b);
    label.textContent='綜合水位 · 我的權重';if(barLabel)barLabel.textContent='我的水位';
    // The suggestion tag follows the plan score; the range sentence below still describes the ETF's own price.
    const tag=$('action-etf');if(tag&&typeof DM!=='undefined'){const act=DM.action(v);tag.className='direction-action '+act.kind;tag.textContent=act.text}
    const wt=$('waterText');if(wt&&wt.textContent&&!wt.textContent.startsWith('本檔價格'))wt.textContent='本檔價格'+wt.textContent;
    const ex=$('extended');if(ex&&ex.textContent.startsWith('水位'))ex.textContent='本檔價格位置'+ex.textContent.slice(2);
    note.textContent=`依「${p.name}」計算；本檔價格水位 ${Number.isFinite(own)?fmt(own,1):'—'} 分。`;note.classList.remove('hidden');
  }
  let frame=0;const schedule=()=>{if(!frame)frame=requestAnimationFrame(show)};
  // Every path that rewrites the ETF score is followed by the plan score.
  const rp=renderPosition;renderPosition=function(...a){const out=rp(...a);schedule();return out};
  const uw=updateWeights;updateWeights=function(...a){const out=uw(...a);schedule();return out};
  if(typeof refreshDirectionViews==='function'){const rd=refreshDirectionViews;refreshDirectionViews=function(...a){const out=rd(...a);schedule();return out}}
  function apply(name){settings.appliedPlan={weights:currentWeights(),name:name||'我的權重',savedAt:new Date().toISOString().slice(0,10)};save();schedule()}
  $('applyWeights').addEventListener('click',()=>apply(settings.appliedPlan?.name));
  $('clearApplied').addEventListener('click',()=>{delete settings.appliedPlan;save();renderPosition();if(typeof refreshDirectionViews==='function')refreshDirectionViews();schedule()});
  window.chaoweiPlanApplied=name=>{updateWeights();apply(name)};
  schedule();
})();

/* ph8 visual rebuild. Move the existing controls: one source of data, no duplicate settings. */
(()=>{
 document.body.classList.add('editorial-site');
 const make=(tag,cls,html)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(html)n.innerHTML=html;return n};
 const figure=(name)=>{
  const defs={price:'<path class="rd-draw" d="M15 130Q50 130 72 100T125 105T185 65T245 45T305 22"/><path class="rd-gridline" d="M15 155H305M15 100H305M15 45H305"/>',market:'<circle class="rd-ring rd-ring-a" cx="160" cy="90" r="64"/><circle class="rd-ring rd-ring-b" cx="160" cy="90" r="44"/><circle class="rd-ring rd-ring-c" cx="160" cy="90" r="22"/>',board:'<path class="rd-wire" d="M65 55H130Q160 55 160 90T200 125H245"/><rect x="18" y="28" width="70" height="54" rx="12"/><rect x="124" y="65" width="70" height="54" rx="12"/><rect x="232" y="101" width="70" height="54" rx="12"/>',learn:'<rect class="rd-leaf leaf-a" x="70" y="20" width="180" height="75" rx="14"/><rect class="rd-leaf leaf-b" x="70" y="53" width="180" height="75" rx="14"/><rect class="rd-leaf leaf-c" x="70" y="86" width="180" height="75" rx="14"/>'};
  return `<svg viewBox="0 0 320 180" aria-hidden="true">${defs[name]}</svg>`;
 };
 const home=$('homePage'),hero=home.querySelector('.hero');
 hero.querySelector('.kicker').textContent='TAIWAN ETF OBSERVATORY';
 hero.querySelector('.hero-desc').textContent='先看位置，再定節奏。把價格、市場背景與自己的規則，放在同一張研究桌上。';
 hero.querySelector('.hero-foot').innerHTML='<span>價格位置 · 自訂配置 · 歷史驗證</span><span>向下開始探索</span>';
 const doors=make('section','purpose-section');doors.id='purposeDoors';
 doors.innerHTML='<div class="section-heading"><div><p class="kicker teal">CHOOSE YOUR PERSPECTIVE</p><h2>今天，想先看什麼？</h2></div><p class="sub">從一個問題開始，不必一次學會全部。</p></div><div class="purpose-deck" role="group" aria-label="四種探索入口"></div>';
 const purposes=[['price','看 ETF 的位置','從價格走勢，讀懂現在水位。','explore','打開 ETF 觀測'],['market','看市場背景','量能、油價與匯率，補齊視角。','market','打開市場刻度'],['board','組合研究','在空白白板，把條件連成規則。','strategyBoardPage','打開策略白板'],['learn','學會怎麼看','由水位到驗證，每一步都看得見。','guidePage','打開方法說明']];
 purposes.forEach(([art,title,desc,target,action],i)=>{const card=make('article','purpose-door'+(i===0?' is-active':''));card.dataset.purpose=String(i);card.innerHTML=`<button class="purpose-select" type="button" aria-pressed="${i===0}" aria-label="展開${title}"><span class="purpose-index">0${i+1}</span><div class="purpose-art">${figure(art)}</div><h3>${title}</h3></button><div class="purpose-body"><p>${desc}</p><a href="#${target}" class="purpose-link">${action}</a></div>`;doors.querySelector('.purpose-deck').append(card);const activate=()=>{doors.querySelectorAll('.purpose-door').forEach((e,j)=>{e.classList.toggle('is-active',i===j);e.querySelector('button').setAttribute('aria-pressed',String(i===j))})};card.querySelector('button').onclick=activate;card.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')activate()});card.addEventListener('focusin',activate)});
 hero.after(doors);

 // Reuse the original six destinations as a single, pausable tool preview gallery.
 const gallery=home.querySelector('.feature-gallery'),grid=gallery.querySelector('.feature-grid');
 gallery.classList.add('tool-preview-section');gallery.querySelector('h2').textContent='好問題，值得一張好圖表。';
 const labels=['price','market','price','learn','board','learn'];
 grid.classList.add('tool-preview-rail');grid.querySelectorAll('.feature-entry').forEach((a,i)=>{a.querySelector('figure').innerHTML=figure(labels[i]);a.querySelector('figure').setAttribute('aria-label','功能操作概念示意');a.querySelector('figure').className='tool-preview-art';a.querySelectorAll('.scene-motion').forEach(x=>x.remove());a.classList.remove('scene-in-view')});
 const galleryButtons=make('div','tool-preview-controls','<p class="small">概念預覽；點選後使用實際資料。</p><button type="button" class="pill mini" aria-pressed="false">暫停預覽</button>');grid.before(galleryButtons);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),railMotion={visible:false,hover:false,focus:false,manual:false,frame:0,last:0,direction:1};
 const pauseRail=galleryButtons.querySelector('button');pauseRail.onclick=()=>{railMotion.manual=!railMotion.manual;pauseRail.setAttribute('aria-pressed',String(railMotion.manual));pauseRail.textContent=railMotion.manual?'播放預覽':'暫停預覽'};
 grid.addEventListener('pointerenter',()=>railMotion.hover=true);grid.addEventListener('pointerleave',()=>railMotion.hover=false);grid.addEventListener('focusin',()=>railMotion.focus=true);grid.addEventListener('focusout',()=>railMotion.focus=false);grid.addEventListener('pointerdown',()=>{railMotion.manual=true;pauseRail.setAttribute('aria-pressed','true');pauseRail.textContent='播放預覽'});
 function glide(t){const elapsed=Math.min(40,t-(railMotion.last||t));railMotion.last=t;if(railMotion.visible&&!railMotion.hover&&!railMotion.focus&&!railMotion.manual&&!reduced.matches&&!document.hidden&&!document.body.classList.contains('motion-paused')&&document.body.dataset.page==='home'){const end=grid.scrollWidth-grid.clientWidth;if(end>2){if(grid.scrollLeft>=end-1)railMotion.direction=-1;if(grid.scrollLeft<=1)railMotion.direction=1;grid.scrollLeft+=elapsed*.022*railMotion.direction}}railMotion.frame=requestAnimationFrame(glide)}
 new IntersectionObserver(e=>{railMotion.visible=e[0].isIntersecting;if(railMotion.visible&&!railMotion.frame)railMotion.frame=requestAnimationFrame(glide);if(!railMotion.visible&&railMotion.frame){cancelAnimationFrame(railMotion.frame);railMotion.frame=0;railMotion.last=0}},{threshold:.1}).observe(gallery);

 // The persistent ETF context stays above one stable chart and three research panels.
 const content=$('explore').querySelector('.content'),consoleNode=make('div','quiet-research-desk');consoleNode.id='researchDesk';
 const mainStage=make('div','research-chart-stage'),aside=make('aside','research-side');aside.setAttribute('aria-label','ETF 研究重點');
 const tabs=make('div','research-side-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','研究面板');
 const panes=[];for(const[i,title]of ['概覽','風險','驗證'].entries()){const id='researchPane'+i,b=make('button','',`<span>0${i+1}</span>${title}`);b.id='researchTab'+i;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls',id);const pane=make('section','research-side-pane');pane.id=id;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',b.id);tabs.append(b);panes.push(pane);b.onclick=()=>sideTab(i);b.onkeydown=e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;sideTab(n);$('researchTab'+n).focus()}}}
 aside.append(tabs,...panes);consoleNode.append(mainStage,aside);const view=document.querySelector('.view-card');view.before(consoleNode);mainStage.append(view,$('status'),$('chartCard'));
 const scoreGrid=document.querySelector('.score-grid');panes[0].append(scoreGrid);
 const techDetail=make('details','study-drawer');techDetail.id='deskTechnical';techDetail.innerHTML='<summary>技術讀數與動量</summary>';techDetail.append($('techRead'));const momentum=document.querySelector('.momentum-panel');if(momentum)techDetail.append(momentum);if($('strengthStudy'))techDetail.append($('strengthStudy'));panes[0].append(techDetail);
 for(const id of ['drawer-chipCard','drawer-holderCard'])if($(id))panes[0].append($(id));
 const risk=make('div','rd-risk-card member-only');risk.id='researchRisk';risk.innerHTML='<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員研究</span><h4>看懂回落與資金參與</h4><p>登入後，對照目前策略的風險與回撤恢復時間。</p><button class="action" type="button" data-open-account>使用 Google 登入</button></div></div><div id="researchRiskContent" data-member-gated><p class="small">使用下方策略回測後顯示。</p></div>';panes[1].append(risk);
 const training=make('div','rd-training-card member-only');training.innerHTML='<div class="member-lock"><div class="member-lock-box"><span class="member-badge">會員研究</span><h4>站在歷史當下驗證</h4><p>前段選規則，鎖定後再看後段結果。</p><button class="action" type="button" data-open-account>使用 Google 登入</button></div></div><div class="rd-training-content" data-member-gated></div>';panes[2].append(training);training.querySelector('.rd-training-content').append($('trainingLab'));$('trainingLab').open=true;
 let activeSide=0;function sideTab(i){activeSide=i;panes.forEach((p,j)=>{p.hidden=i!==j;const b=$('researchTab'+j);b.setAttribute('aria-selected',String(i===j));b.tabIndex=i===j?0:-1});if(i===1)paintRisk();window.dispatchEvent(new Event('resize'))}sideTab(0);

 // Deeper tools share one shelf instead of stacking three long pages.
 const shelf=make('section','research-workbench');shelf.id='researchWorkbench';const shelfTabs=make('div','research-work-tabs');shelfTabs.setAttribute('role','tablist');shelfTabs.setAttribute('aria-label','進階研究工具');const shelfPanes=[];
 for(const[i,title]of ['策略與回測','波段與量測','配置與權重'].entries()){const b=make('button','',title),p=make('div','research-work-pane');b.type='button';b.id='workTab'+i;p.id='workPane'+i;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',b.id);b.setAttribute('role','tab');b.setAttribute('aria-controls',p.id);b.onclick=()=>workTab(i);b.onkeydown=e=>{if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();const n=(i+(e.key==='ArrowRight'?1:2))%3;workTab(n);$('workTab'+n).focus()}};shelfTabs.append(b);shelfPanes.push(p)}
 shelf.append(shelfTabs,...shelfPanes);consoleNode.after(shelf);shelfPanes[0].append($('backtestCard'));for(const id of ['drawer-waveStudy','drawer-measurePanel'])if($(id))shelfPanes[1].append($(id));const pins=document.querySelector('.wave-pin-panel')?.closest('.study-drawer');if(pins)shelfPanes[1].append(pins);const weightDrawer=$('drawer-weights');if(weightDrawer)shelfPanes[2].append(weightDrawer);else shelfPanes[2].append($('weights'));
 function workTab(i){shelfPanes.forEach((p,j)=>{p.hidden=i!==j;const b=$('workTab'+j);b.setAttribute('aria-selected',String(i===j));b.tabIndex=i===j?0:-1});window.dispatchEvent(new Event('resize'));requestAnimationFrame(()=>window.dispatchEvent(new Event('chaowei-page-changed')))}workTab(0);
 function revealTarget(node){if(!node)return;panes.forEach((p,i)=>{if(p.contains(node))sideTab(i)});shelfPanes.forEach((p,i)=>{if(p.contains(node)){workTab(i);let d=node.closest('details');while(d){d.open=true;d=d.parentElement.closest('details')}}})}
 const previousTour=window.chaoweiTourTarget;window.chaoweiTourTarget=node=>{revealTarget(node);previousTour?.(node)};
 function onHash(){const aliases={method:'weights',backtest:'backtestCard','wave-lab':'waveStudy',chips:'chipCard'};revealTarget($(aliases[location.hash.slice(1)]||location.hash.slice(1)))}window.addEventListener('hashchange',onHash);onHash();

 function paintRisk(){const node=$('researchRiskContent'),r=btResult;if(!r){node.innerHTML='<h3>先完成一次回測</h3><p class="small">這裡會使用同一個回測結果，顯示風險與資金參與。</p><a class="pill" href="#backtestCard">前往策略與回測</a>';return}
  const info=r.sharpeInfo,events=r.drawdowns||[],usage=E.positionUsage(r),held=Math.round(r.utilization*100);
  node.innerHTML=`<p class="kicker teal">RISK / ${selected}</p><h3>跌多深，也看等多久。</h3><p class="small">${r.start} 至 ${r.end} · 依目前回測規則</p><div class="rd-risk-values"><div><small>最大回落</small><strong class="down">${fmt(r.mdd*100,1)}%</strong></div><div><small>Sharpe</small><strong>${r.sharpe==null?'不適用':fmt(r.sharpe,2)}</strong></div></div><p class="small">${r.sharpe==null?info?.reason||'有效樣本不足':'超額報酬按相同日曆區間扣除現金基準；年化 245 期。'}</p><h4>平均配置</h4><div class="rd-exposure" role="img" aria-label="期間平均持股 ${held}%，現金 ${100-held}%"><i style="width:${held}%"></i></div><p class="small">持股 ${held}% · 現金 ${100-held}%（期間平均）</p><div class="rd-risk-mini"><span>買進 <b>${r.buys} 次</b></span><span>有部位 <b>${usage.held} 日</b></span></div><a class="pill mini" href="#fundingComparison">查看資金與分批試算</a><h4>主要回撤</h4><div class="rd-drawdown-list"></div><details class="metric-detail"><summary>計算口徑與交易假設</summary><p class="small">回撤以排除外部入金的 NAV 計算。恢復定義為回到或超過前高；交易日與日曆天分開。成交依回測設定：預設訊號於 T 日收盤確認、T+1 開盤成交並計入單邊滑價（可改為 T 日收盤理想對照），仍非可保證的成交價。完整實驗規則見下方回測設定。</p></details>`;
  const list=node.querySelector('.rd-drawdown-list');if(!events.length)list.textContent='此段淨值沒有可辨識的回撤事件。';const deepest=events[0]?.depth||1;for(const event of events.slice(0,3)){const e=make('details','rd-drawdown');e.innerHTML=`<summary><span class="down">−${fmt(event.depth*100,1)}%</span><i class="rd-dd-bar" aria-hidden="true"><i style="width:${Math.round(event.depth/deepest*100)}%"></i></i><b>${event.ongoing?'尚未恢復':event.tradingDays+' 個交易日'}</b></summary><dl><dt>前高</dt><dd>${event.peak}</dd><dt>谷底</dt><dd>${event.trough}</dd><dt>恢復</dt><dd>${event.recovery||'至期末仍未恢復'}</dd><dt>歷時</dt><dd>${event.tradingDays} 個交易日／${event.calendarDays} 天</dd></dl>`;list.append(e)}
 }
 const oldBacktest=renderBacktest;renderBacktest=function(...args){const out=oldBacktest(...args);paintRisk();return out};
 const previousMember=window.chaoweiSetMember;window.chaoweiSetMember=value=>{previousMember(value);paintRisk()};window.chaoweiSetMember(isMember);

 // Turn the existing institutional snapshot into signed bars; null stays missing.
 const oldChip=renderChip;renderChip=function(...args){const out=oldChip(...args),row=chipRows.find(r=>r[0]===$('chipDate').value)||chipRows.at(-1),grid=$('chipContents').querySelector('.chip-grid');if(!row||!grid)return out;
  grid.classList.add('rd-flow-chart');grid.replaceChildren();const max=Math.max(1,...row.slice(1,5).filter(Number.isFinite).map(Math.abs));['外陸資','投信','自營商','合計'].forEach((label,i)=>{const v=row[i+1],line=make('div','rd-flow-row');line.innerHTML='<span></span><div class="rd-flow-axis"><i></i></div><b></b>';line.firstChild.textContent=label;const b=line.lastChild;b.textContent=Number.isFinite(v)?(v>0?'+':'')+fmt(v/1000,1)+' 張':'未公布';if(Number.isFinite(v)){const w=Math.abs(v)/max*48,bar=line.querySelector('i');bar.style.width=w+'%';bar.style.left=(v>=0?50:50-w)+'%';bar.className=v>=0?'rd-positive':'rd-negative';b.className=v>0?'up':v<0?'down':''}grid.append(line)});grid.setAttribute('role','img');grid.setAttribute('aria-label',row[0]+' 三大法人買賣超，左側賣超、右側買超，單位張');return out};if(chipRows.length)renderChip();

 // All historical context is computed from acquired data. No synthetic 5-year history.
 const marketHeader=make('div','market-overview');marketHeader.id='marketOverview';marketHeader.innerHTML='<div><p class="kicker teal">THE BIGGER PICTURE</p><h3>背景不同，讀數各有節奏。</h3><p class="small">保留各來源發布頻率；分數方向由你設定。</p></div><div class="market-overview-stats"><div><small>可用因子</small><strong id="rdAvailable">—</strong></div></div><div class="rd-factor-bars" id="rdFactorBars" role="img"></div>';$('market').prepend(marketHeader);
 const factorDefs=[['indexScore',()=>market.map(x=>({date:x.date,value:x.index})),v=>fmt(v,2)+' 點'],['volumeScore',()=>market.map(x=>({date:x.date,value:x.volume/1e8})),v=>fmt(v,2)+' 億股'],['brentScore',()=>oilDays,v=>fmt(v,2)+' 美元／桶'],['fxScore',()=>fx,v=>fmt(v,3)+' 新台幣／美元'],['mktMarginScore',()=>marginDays.slice(1).map((x,i)=>({date:x.date,value:x.value-marginDays[i].value})),v=>signNum(v,1)+' 億元'],['bankScore',()=>bankDays,v=>signNum(v,2)+' 億元']];
 function paintFactors(){let available=0;for(const[id,get,format]of factorDefs){const card=$(id)?.closest('.factor');if(!card)continue;card.classList.add('rd-market-card');let graph=card.querySelector('.rd-factor-context');if(!graph){graph=make('div','rd-factor-context');card.querySelector('h4').after(graph)}const all=get().filter(x=>Number.isFinite(x.value)),last=all.at(-1);if(!last){graph.innerHTML='<p class="small">尚無可用歷史資料</p>';continue}const cutoff=new Date(last.date+'T00:00:00Z');cutoff.setUTCFullYear(cutoff.getUTCFullYear()-5);const prior=all.filter(x=>x.date>=cutoff.toISOString().slice(0,10)&&x.date<last.date),rank=prior.length>=20?prior.filter(x=>x.value<=last.value).length/prior.length:null;if(Number.isFinite(parseFloat($(id).textContent)))available++;
   // Taiwan colours on the 30-point line: levels compare with 30 points ago, flows (margin, bank) use today's sign.
   const flow=id==='mktMarginScore'||id==='bankScore',dir=Math.sign(flow?last.value:last.value-all.slice(-30)[0].value),tone=dir>0?' rise':dir<0?' fall':'';
   graph.innerHTML=`<strong class="factor-value${flow?(dir>0?' up':dir<0?' down':''):''}" data-number="${last.value}" data-final="${format(last.value)}">${format(last.value)}</strong><span class="rd-source-date">${last.date}</span>${!flow&&all.length>1?`<span class="rd-factor-change ${dir>0?'up':dir<0?'down':''}">近 ${Math.min(30,all.length)} 筆 ${signNum((last.value/all.slice(-30)[0].value-1)*100,1)}%</span>`:''}<div class="rd-spark${tone}">${factorSpark(all)}</div><div class="rd-percentile"><span>${prior.length>=20?'歷史位置 · '+prior.length+' 筆':'歷史樣本不足'}</span><b>${rank==null?'—':'P'+Math.round(rank*100)}</b></div><div class="rd-percentile-track" role="img" aria-label="${rank==null?'歷史百分位不足':prior.length+' 筆樣本中位於第 '+Math.round(rank*100)+' 百分位'}"><b class="ph10-percentile-fill" style="width:${rank==null?0:rank*100}%"></b><i style="left:${rank==null?0:rank*100}%" ${rank==null?'hidden':''}></i></div>`;
   // Taller trend: stretch the 30-point line to the card's plot height, keeping a constant stroke width.
   const svg=graph.querySelector('.rd-spark svg');if(svg){svg.setAttribute('preserveAspectRatio','none');svg.querySelector('polyline')?.setAttribute('vector-effect','non-scaling-stroke')}
  }$('rdAvailable').textContent=available+' / '+factorDefs.length;
  // One bar per factor score (0-5). The colour follows the suggestion tag: 4+ red (add), 2 or less green (trim).
  const short={indexScore:'加權',volumeScore:'成交',brentScore:'原油',fxScore:'匯率',mktMarginScore:'融資',bankScore:'官股'},bars=$('rdFactorBars'),said=[];bars.replaceChildren();for(const[id]of factorDefs){const v=parseFloat($(id)?.textContent),col=make('div','rd-factor-bar'+(v>=4?' rise':v<=2?' fall':''));col.innerHTML='<b></b><span><i></i></span><small></small>';col.querySelector('b').textContent=Number.isFinite(v)?fmt(v,1):'—';col.querySelector('i').style.height=(Number.isFinite(v)?v/5*100:0)+'%';col.querySelector('small').textContent=short[id];said.push(short[id]+(Number.isFinite(v)?' '+fmt(v,1)+' 分':' 無資料'));bars.append(col)}bars.setAttribute('aria-label','各因子分數，滿分 5：'+said.join('、'));
 }
 let factorFrame=0;const factorsChanged=()=>{if(!factorFrame)factorFrame=requestAnimationFrame(()=>{factorFrame=0;paintFactors()})};for(const[id]of factorDefs)new MutationObserver(factorsChanged).observe($(id),{childList:true,subtree:true,characterData:true});factorsChanged();

 // Matrix trends fetch through the same cached history API, at most two concurrent requests.
 const matrixCache=new Map();let matrixQueue=[],matrixRunning=0;
 // The vertical scale follows the 60 closes only, so a quiet stretch still shows its swings. MA960 is drawn
 // when it sits inside that range; otherwise a label says whether it lies above or below and at what level.
 function spark(values,average){if(values.length<2)return'<span class="small">可用走勢不足</span>';const lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo)*.08||hi*.002||1,min=lo-pad,span=hi+pad-min;const ma=average.filter(Number.isFinite),inside=ma.length&&ma.every(v=>v>=min&&v<=min+span),points=a=>a.map((v,i)=>Number.isFinite(v)?`${6+i*288/(a.length-1)},${100-(v-min)/span*94}`:null).filter(Boolean).join(' ');
  const maLine=inside?'<polyline fill="none" stroke="var(--rd-amber)" stroke-dasharray="4 3" stroke-width="1.7" vector-effect="non-scaling-stroke" points="'+points(average)+'"/>':'',maNote=ma.length&&!inside?`<span class="rd-ma-note">MA960 ${fmt(ma.at(-1),2)} 在${ma.at(-1)<min?'下方':'上方'}</span>`:'';
  return`<svg viewBox="0 0 300 104" preserveAspectRatio="none" role="img" aria-label="近 ${values.length} 筆收盤走勢，縱軸 ${fmt(lo,2)} 至 ${fmt(hi,2)}${ma.length?'；MA960 '+fmt(ma.at(-1),2):''}"><polyline fill="none" stroke="currentColor" stroke-width="2.2" vector-effect="non-scaling-stroke" points="${points(values)}"/>${maLine}</svg><span class="rd-spark-range"><span>${fmt(hi,2)}</span><span>${fmt(lo,2)}</span></span>${maNote}`}
 function applyMatrix(card,rows){let graph=card.querySelector('.rd-matrix-spark');if(!graph){graph=make('div','rd-matrix-spark');card.querySelector('.matrix-meter').before(graph)}const cutoff=new Date(rows.at(-1).date+'T00:00:00Z');cutoff.setUTCMonth(cutoff.getUTCMonth()-1);const monthStartIdx=rows.findIndex(x=>x.date>=cutoff.toISOString().slice(0,10)),from=Math.max(0,monthStartIdx),list=rows.slice(from),avg=list.map((_,j)=>{const i=from+j;if(i<959)return null;let sum=0;for(let k=i-959;k<=i;k++)sum+=rows[k].close;return sum/960});graph.innerHTML=spark(list.map(x=>x.close),avg);graph.dataset.loaded='true';
  // Taiwan colours over the displayed month; only missing MA960 needs a per-card note.
  const first=list[0]?.close,last=list.at(-1)?.close;graph.classList.toggle('rise',last>first);graph.classList.toggle('fall',last<first);
  if(!avg.some(Number.isFinite)){const note=make('small','rd-matrix-note');note.textContent='MA960 歷史不足';graph.append(note)}}
 function drain(){while(matrixRunning<2&&matrixQueue.length){const task=matrixQueue.shift();matrixRunning++;fetch('/api/history?code='+encodeURIComponent(task.code)).then(r=>{if(!r.ok)throw Error('history unavailable');return r.json()}).then(d=>{const rows=(d.bars||[]).filter(b=>b&&Number.isFinite(b.close)&&!b.intraday);matrixCache.set(task.code,rows);if(task.card.isConnected)applyMatrix(task.card,rows)}).catch(()=>{if(task.card.isConnected){const n=make('p','small');n.textContent='趨勢暫不可用';task.card.append(n)}}).finally(()=>{matrixRunning--;drain()})}}
 const matrixObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const card=e.target,code=card.querySelector('.matrix-code')?.textContent.trim();matrixObserver.unobserve(card);if(matrixCache.has(code))applyMatrix(card,matrixCache.get(code));else{matrixQueue.push({card,code});drain()}}},{rootMargin:'200px'});
 const matrixMutation=new MutationObserver(()=>{$('matrixCards').querySelectorAll('.matrix-card:not([data-rd-observed])').forEach(card=>{card.dataset.rdObserved='true';matrixObserver.observe(card)})});matrixMutation.observe($('matrixCards'),{childList:true});$('matrixCards').querySelectorAll('.matrix-card').forEach(card=>{card.dataset.rdObserved='true';matrixObserver.observe(card)});

 // Method: a small teaching theatre, followed by the original questions in one column.
 const guide=$('guidePage'),theatre=make('section','method-theatre');theatre.id='methodTheatre';theatre.innerHTML='<div><p class="kicker teal">LEARN BY SEEING</p><h2>先看懂，再設定。</h2><p>三個觀念，從價格位置走到歷史驗證。</p><div class="method-scenes" role="tablist" aria-label="原理教學"></div><button type="button" class="pill mini" id="methodAutoPause" aria-pressed="false">暫停教學</button></div><div class="method-scene-stage" id="methodSceneStage" aria-live="off"></div>';guide.prepend(theatre);
 const guideNav=$('pageNav').querySelector('a[href="#method-story"]');if(guideNav)guideNav.href='#guidePage';
 const marketNav=$('pageNav').querySelector('a[href="#market"]');if(marketNav)marketNav.href='#marketPage';
 const scenes=[['價格與水位','price','從已選觀察窗量出相對位置。低價分高是預設方向；切換方向時，分數跟著重算。'],['分批與配置','board','資金只分配一次。分幾批與每批目標可自己設定；實際金額仍受可用現金限制。'],['歷史驗證','learn','先在前段選規則，再鎖定檢查後段。看完驗證再改條件，就是新的實驗。']];let scene=0,sceneVisible=false,scenePaused=false,sceneFocus=false;
 const sceneButtons=theatre.querySelector('.method-scenes');function paintScene(i){scene=i;sceneButtons.querySelectorAll('button').forEach((b,j)=>{b.setAttribute('aria-selected',String(i===j));b.tabIndex=i===j?0:-1});$('methodSceneStage').innerHTML='<div class="method-large-figure">'+figure(scenes[i][1])+'</div><p class="kicker">0'+(i+1)+' / 03</p><h3>'+scenes[i][0]+'</h3><p>'+scenes[i][2]+'</p>'}
 scenes.forEach(([title],i)=>{const b=make('button','',`0${i+1} ${title}`);b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls','methodSceneStage');b.onclick=()=>{scenePaused=true;syncPause();paintScene(i)};b.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const j=(i+(e.key==='ArrowRight'?1:2))%3;sceneButtons.children[j].click();sceneButtons.children[j].focus()}};sceneButtons.append(b)});paintScene(0);
 const methodPause=$('methodAutoPause');function syncPause(){methodPause.textContent=scenePaused?'播放教學':'暫停教學';methodPause.setAttribute('aria-pressed',String(scenePaused))}methodPause.onclick=()=>{scenePaused=!scenePaused;syncPause()};theatre.addEventListener('focusin',()=>sceneFocus=true);theatre.addEventListener('focusout',()=>sceneFocus=false);new IntersectionObserver(e=>sceneVisible=e[0].isIntersecting,{threshold:.25}).observe(theatre);setInterval(()=>{if(sceneVisible&&!scenePaused&&!sceneFocus&&!document.hidden&&!reduced.matches&&!document.body.classList.contains('motion-paused')&&document.body.dataset.page==='guide')paintScene((scene+1)%3)},6500);
 const faq=document.querySelector('.method-steps'),faqFilters=make('div','segment method-filters');faqFilters.setAttribute('role','group');faqFilters.setAttribute('aria-label','方法說明分類');const questions=[...faq.children].filter(e=>e.tagName==='DETAILS');questions.forEach((e,i)=>e.dataset.topic=i<5?'water':'research');[['all','全部問題'],['water','水位與分數'],['research','技術與驗證']].forEach(([id,label])=>{const b=make('button','',label);b.type='button';b.setAttribute('aria-pressed',String(id==='all'));b.onclick=()=>{questions.forEach(e=>e.hidden=id!=='all'&&e.dataset.topic!==id);faqFilters.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))};faqFilters.append(b)});faq.before(faqFilters);
 // Route aliases retain all old URLs, and #board now has an explicit destination.
 if(location.hash==='#board')window.chaoweiNavigate('board');
 document.querySelectorAll('a[href="#board"]').forEach(a=>a.href='#strategyBoardPage');
 // The retained old intro rail is redundant with the new theatre; its text is kept in an expandable note.
 const oldStory=guide.querySelector('.story-stage');if(oldStory){const archive=make('details','method-original');archive.innerHTML='<summary>再看三種觀測視角</summary>';oldStory.before(archive);archive.append(oldStory)}
 // Resize the original charts after moving them; keep all ranges, markers, settings and auth contracts.
 requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
 document.documentElement.dataset.designVersion='ph8-editorial-1';
})();

/* ph9: one place for each decision. Existing controls and charts are moved, never cloned. */
(()=>{
 document.body.classList.add('subtraction-site');
 const node=(tag,cls,html='')=>{const n=document.createElement(tag);n.className=cls;n.innerHTML=html;return n},drawer=(title,id)=>{const d=node('details','metric-detail');d.id=id;d.append(node('summary','',title));return d};
 // Three home sections. Stop the removed preview's animation without replacing real market data.
 $('homePage').querySelector('.feature-gallery')?.remove();$('homePage').querySelector('.member-story')?.remove();
 const hero=$('homePage').querySelector('.hero-actions');hero.querySelector('a').textContent='開始觀測 ETF';hero.querySelector('a.secondary').textContent='進入策略白板';
 const lesson=$('homeTour'),motion=$('homeMotion');lesson.remove();
 // Motion and the existing tutorial live in the account appearance panel, away from the three header tools.
 const motionIcon=node('button','pill motion-control');motionIcon.type='button';motionIcon.id='pageMotion';motionIcon.onclick=()=>motion.click();$('displayMenu').append(motionIcon);motion.hidden=true;
 function motionLabel(){const off=document.body.classList.contains('motion-paused'),label=off?'播放頁面動畫':'暫停頁面動畫';motionIcon.setAttribute('aria-label',label);motionIcon.title=label;motionIcon.textContent=label;motionIcon.setAttribute('aria-pressed',String(off))};new MutationObserver(motionLabel).observe(document.body,{attributes:true,attributeFilter:['class']});motionLabel();
 // The observation header contains only the selected ETF. Candidate choices stay inside Search.
 const ticker=node('section','compact-ticker');ticker.id='compactTicker';ticker.setAttribute('aria-label','目前觀測 ETF');const toolbar=document.querySelector('.toolbar');$('researchDesk').before(ticker);ticker.append(toolbar);
 const search=node('button','pill mini ticker-search','搜尋 ETF');search.type='button';search.onclick=openSearch;toolbar.append(search);$('quickInline').hidden=true;
 // Search is global: a dialog inside a hidden route cannot open from Home, Market or Guide.
 $('top').append($('searchOverlay'));
 const menuAccount=document.querySelector('[data-menu-account]');menuAccount.textContent='我的帳號與外觀';
 const originalHot=renderHot;renderHot=function(){originalHot();const buttons=[...$('hotList').querySelectorAll('[data-hot]')];$('hotSearches').hidden=buttons.length>0&&buttons.every(b=>settings.watchlist.includes(b.dataset.hot))};renderHot();
 $('openSearch').hidden=true;const sectionHeading=$('explore').querySelector(':scope > .section-heading');if(sectionHeading)sectionHeading.hidden=true;
 document.querySelector('.study-mode-bar').hidden=true;document.querySelector('.first-visit').hidden=true;
 if($('observationSettings'))$('observationSettings').open=false;
 // Only today's diagnosis remains at the right. Risk and holdout have one home below the backtest.
 const side=document.querySelector('.research-side');side.querySelector('.research-side-tabs').hidden=true;$('researchPane0').hidden=false;
 const training=$('trainingLab'),trainingWrapper=training.closest('.member-only');$('backtestCard').append(trainingWrapper);training.open=false;
 $('researchPane1').hidden=true;$('researchPane2').hidden=true;$('researchRisk').hidden=true;
 document.querySelectorAll('.study-drawer').forEach(d=>d.open=false);
 const riskDetail=drawer('回撤事件與計算假設','backtestRiskDetails');$('backtestCard').append(riskDetail);riskDetail.append($('researchRiskContent'));$('researchRiskContent').removeAttribute('data-member-gated');
 // Three tabs, one plot stage. Both original charts retain their data and shared time/crosshair hooks.
 const wrap=$('btEquity').closest('.bt-equity-wrap'),topLegend=wrap.querySelector('.bt-equity-legend'),underLegend=wrap.querySelector('.bt-equity-legend.sub');
 const actionDrawer=drawer('依規則查看下一步','nextActionDetails');wrap.after(actionDrawer);actionDrawer.append($('btNow'));
 $('btVerdict').hidden=true;
 const chartTabs=node('div','backtest-chart-tabs');chartTabs.setAttribute('role','tablist');chartTabs.setAttribute('aria-label','回測圖表');wrap.before(chartTabs);
 const scoreDrawer=drawer('每日水位與交易對照','scoreHistoryDetails');wrap.after(scoreDrawer);scoreDrawer.append($('showDailyScore').closest('label'),$('dailyScorePanel'));
 let chartMode=0,cashSeries=null,chartOwner=null;
 const titles=['累積資產','持股與現金','回撤與交易'];titles.forEach((title,i)=>{const b=node('button','',title);b.id='btPlotTab'+i;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls',i===0?'btEquity':'btUnder');b.onclick=()=>selectPlot(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;selectPlot(next);$('btPlotTab'+next).focus()}};chartTabs.append(b)});
 function selectPlot(i){const c=btCharts,range=c&&(chartMode===0?c.top:c.under).timeScale().getVisibleLogicalRange();chartMode=i;chartTabs.querySelectorAll('button').forEach((b,j)=>{b.setAttribute('aria-selected',String(j===i));b.tabIndex=i===j?0:-1});$('btEquity').hidden=i!==0;topLegend.hidden=i!==0;$('btUnder').hidden=i===0;underLegend.hidden=i===0;
  underLegend.innerHTML=i===1?'<span class="e">持股比例（左軸）</span><span class="cash">現金池（右軸，元）</span>':'<span class="s">策略回落</span><span class="d">定投回落</span><span>紅點買進 · 綠點賣出</span>';
  if(c){if(chartOwner!==c){chartOwner=c;cashSeries=c.under.addLineSeries({priceScaleId:'right',color:'#b78636',priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:v=>money(v)}})}
   const axisFormat={type:'custom',formatter:i===1?v=>money(v):v=>fmt(v,1)+'%'};
   c.sd.applyOptions({visible:i===2,priceFormat:axisFormat});c.dd.applyOptions({visible:i===2,priceFormat:axisFormat});c.e.applyOptions({visible:i===1,lineColor:'#248b97',lineWidth:2,priceFormat:{type:'custom',formatter:v=>fmt(v,0)+'%'},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});cashSeries.applyOptions({visible:i===1});c.under.priceScale('left').applyOptions({visible:i===1,autoScale:true});c.under.priceScale('right').applyOptions({visible:true,autoScale:true});
   if(btResult){cashSeries.setData(btResult.series.map(x=>({time:x.time,value:Math.max(0,x.value*(1-x.exposure))})));c.sd.setMarkers(i===2?btResult.trades.map(t=>({time:t.date,position:t.type==='buy'?'belowBar':'aboveBar',color:t.type==='buy'?'#e44960':'#139974',shape:'circle',text:''})).sort((a,b)=>a.time.localeCompare(b.time)):[])}
   requestAnimationFrame(()=>{const active=i===0?c.top:c.under,host=i===0?$('btEquity'):$('btUnder');if(host.clientWidth>0){active.resize(host.clientWidth,310);active.applyOptions({timeScale:{visible:true}});if(range){c.top.timeScale().setVisibleLogicalRange(range);c.under.timeScale().setVisibleLogicalRange(range)}else active.timeScale().fitContent()}})
  }wrap.dataset.plot=String(i);
 }
 scoreDrawer.addEventListener('toggle',()=>window.dispatchEvent(new Event('chaowei-page-changed')));
 function scorecard(r){const annual=btAnnual(r),dca=btAnnual(r.dca,r.monthly),rounds=r.rounds,events=r.drawdowns||[],longest=events.reduce((a,b)=>!a||b.tradingDays>a.tradingDays?b:a,null),rate=rounds?.total?rounds.wins/rounds.total:null;
  const k=[['總資金'+(r.monthly?'年化 · XIRR':'年化 · CAGR'),pctText(annual),(sameBaseline(r)?'定投≈買進持有 '+pctText(dca):'定投 '+pctText(dca)+' · 持有 '+pctText(btAnnual(r.bh,r.funding?r.monthly:false))),annual],['最大回落','−'+fmt(r.mdd*100,1)+'%',longest?'最長水下 '+longest.tradingDays+' 交易日'+(longest.ongoing?'（尚未恢復）':''):'沒有回撤事件',-r.mdd],['風險調整',r.sharpe==null?'—':fmt(r.sharpe,2),'Sharpe · Calmar '+(r.calmar==null?'—':fmt(r.calmar,2)),r.sharpe],['平均持股',fmt(r.utilization*100,0)+'%',rate==null?'完整回合尚無已結束樣本':'完整回合勝率 '+fmt(rate*100,0)+'% · '+rounds.total+' 回合',r.utilization]];
  $('btKpis').innerHTML='<p class="bt-kpi-note">'+(r.monthly?'依實際到帳日，以 XIRR 比較；新資金不算報酬。三組對照共用入金排程。':'同一筆期初本金、相同停泊利率與成交成本。CAGR 包含閒置現金與第一筆費用。')+'</p><div class="bt-big">'+k.map(([label,value,detail,v])=>'<div><small>'+label+'</small><b class="'+(v>0?'up':v<0?'down':'')+'">'+value+'</b><span>'+detail+'</span></div>').join('')+'</div><div class="bt-small hidden"></div>';
  const alpha=annual-dca,against=annual-btAnnual(r.bh,r.funding?r.monthly:false);const note=node('p','scorecard-baseline small','年化差：對定投 '+(Math.abs(alpha)<5e-5?'0.00':(alpha>0?'+':'−')+fmt(Math.abs(alpha)*100,2))+' 個百分點'+(!r.monthly?'；對買進持有 '+(against>0?'+':'')+fmt(against*100,2)+' 個百分點':'。入金時點與預算均已對齊'+(sameBaseline(r)?'；分期到帳時定投與買進持有都在到帳日買進，兩條基準幾乎相同，只列一次。':'。')));$('btKpis').append(note);
  if(r.utilization<.3)$('btKpis').append(node('p','exposure-warning','平均持股不足 30%，可能長時間等待訊號。可檢查進場條件、觀察窗與底倉設定；增加每批金額不會讓訊號提早出現。'));
  const facts=$('financialDetails')?.querySelector('.financial-facts');if(facts){facts.querySelectorAll('[data-ph9-xirr]').forEach(n=>n.remove());const dt=node('dt','','現金流 XIRR'),dd=node('dd','',pctText(r.xirr)+'（依實際入金）');dt.dataset.ph9Xirr='';dd.dataset.ph9Xirr='';facts.append(dt,dd)}
  // Keep recovery events and methodology, remove repeated headline metrics.
  const risk=$('researchRiskContent');risk.querySelector('.rd-risk-values')?.remove();risk.querySelector('.rd-exposure')?.remove();risk.querySelector('.rd-risk-mini')?.remove();risk.querySelector('a[href="#fundingComparison"]')?.remove();risk.querySelectorAll(':scope > h3,:scope > h4,:scope > .kicker,:scope > p').forEach(el=>{if(el.textContent==='主要回撤')return;el.remove()});
 }
 const old=renderBacktest;renderBacktest=function(...args){const out=old(...args);if(btResult){scorecard(btResult);selectPlot(chartMode)}return out};
 // Daily overview, not a second bank factor. The timestamp stays with source status.
 const refresh=$('refreshClock').closest('.factor');refresh.classList.add('market-refresh-status');$('factorNote').after(refresh);
 const bankDetails=drawer('官股每日買賣超長條圖','bankTrendDetails');$('bankScore').closest('.factor').append(bankDetails);bankDetails.append($('bankMarketTrend'));bankDetails.addEventListener('toggle',()=>{if(bankDetails.open)renderBankTrend()});
 $('factorRail').classList.add('is-grid');$('factorRail').setAttribute('aria-label','六大市場刻度');document.querySelector('.market-view-tools').hidden=true;document.querySelector('.factor-rail-nav').hidden=true;
 // Restore the chosen graph after font/theme and route changes, keeping the date span.
 window.addEventListener('chaowei-page-changed',()=>selectPlot(chartMode));window.addEventListener('chaowei-typography-changed',()=>selectPlot(chartMode));
 const memberBefore=window.chaoweiSetMember;window.chaoweiSetMember=value=>{memberBefore(value);if(btResult)scorecard(btResult)};
 window.chaoweiSetMember(isMember);selectPlot(0);if(btResult)scorecard(btResult);
})();

/* ph10: measured execution views, semantic signs and motion tied to real data. */
(()=>{
 document.body.dataset.release='ph10';
 const control=document.createElement('label');control.className='ph10-dca-control';control.innerHTML='<input type="checkbox" id="btDcaMarkers"> 同期定投點（灰）';$('btMarkers').after(control);
 const previous=applyMarkers;applyMarkers=function(){previous();if(!lwc||!isMember||!btResult||!$('btDcaMarkers').checked)return;const dates=lwc.data.map(b=>b.date),extra=[];for(const t of btResult.dca.trades||[]){if(t.kind==='drip')continue;let lo=0,hi=dates.length-1,at=-1;while(lo<=hi){const m=(lo+hi)>>1;if(dates[m]<=t.date){at=m;lo=m+1}else hi=m-1}if(at>=0)extra.push({time:dates[at],position:'belowBar',color:'#87959e',shape:'circle',text:''})}const old=lwc.s.candle.markers();lwc.s.candle.setMarkers([...old,...extra].sort((a,b)=>a.time.localeCompare(b.time)))};
 $('btDcaMarkers').onchange=applyMarkers;
 const oldRender=renderBacktest;renderBacktest=function(...args){const out=oldRender(...args);if(btResult&&['trend_pullback_ma60','kd_oversold_golden_dca','margin_fear_contrarian'].includes(btResult.cfg.strategy)){let note=$('advancedStrategyStatus');if(!note){note=document.createElement('p');note.id='advancedStrategyStatus';note.className='small';$('btSummary').after(note)}const r=btResult,p=r.cfg.params,ctx=btContext(),from=ctx.bars.findIndex(b=>b.date===r.start),to=ctx.bars.findIndex(b=>b.date===r.end),valid=r.cfg.strategy==='margin_fear_contrarian'?Array.from(ctx.marginDrop5.slice(from,to+1)).filter(Number.isFinite).length:null;note.textContent='核心 '+p.core+'%；剩餘現金分 '+p.parts+' 批。核心不受上游加碼條件限制。'+(valid==null?'':('融資可用 '+valid+'／'+r.series.length+' 日；缺資料日不加碼。'))+'是否勝過定投依同區間實測，不保證未來結果。';note.hidden=false}else if($('advancedStrategyStatus'))$('advancedStrategyStatus').hidden=true;return out};
 // Keep informational labels exact; animate only the drawn fills, not their calculation or layout width.
 const selector='.matrix-meter>i,.strength-meter>i,.metric-meter>i,.rd-flow-axis>i,.bt-fill-bar>i,.attribution-row>i,.ph10-percentile-fill,.rd-factor-bars i,.factor-score-fill,#bankSpark svg rect,#bankMarketTrend svg rect,#waveDistribution svg rect',parents=new Map(),records=new WeakMap(),reduce=matchMedia('(prefers-reduced-motion: reduce)');let frame=0;
 const paused=()=>reduce.matches||document.body.classList.contains('motion-paused');
 function play(el){const rec=records.get(el);if(!rec)return;rec.anim?.cancel();if(paused())return;const svg=el.namespaceURI==='http://www.w3.org/2000/svg',negative=el.classList.contains('rd-negative');if(svg)el.style.transformBox='fill-box';el.style.transformOrigin=svg?(el.closest('#bankSpark,#bankMarketTrend')&&el.getAttribute('fill')===FALL?'center top':'center bottom'):negative?'right center':'left center';rec.anim=el.animate([{transform:svg?'scaleY(0)':'scaleX(0)'},{transform:svg?'scaleY(1)':'scaleX(1)'}],{duration:820,easing:'cubic-bezier(.22,1,.36,1)'});el.dataset.growthRuns=String(Number(el.dataset.growthRuns||0)+1)}
 const io=new IntersectionObserver(entries=>{for(const e of entries){const group=parents.get(e.target);if(!group)continue;group.visible=e.isIntersecting;if(e.isIntersecting)for(const el of group.bars)play(el)}},{threshold:.12});
 function scan(){frame=0;for(const [parent,group] of parents){if(!parent.isConnected){io.unobserve(parent);parents.delete(parent)}else for(const el of group.bars)if(!el.isConnected)group.bars.delete(el)}for(const el of document.querySelectorAll(selector)){const parent=el.parentElement;if(!parent)continue;let group=parents.get(parent);if(!group){group={bars:new Set(),visible:false};parents.set(parent,group);io.observe(parent)}group.bars.add(el);const sig=(el.style.width||el.getAttribute('height')||'')+'|'+el.className.baseVal+'|'+el.getAttribute('class');let rec=records.get(el);if(!rec){rec={sig};records.set(el,rec);if(group.visible)play(el)}else if(rec.sig!==sig){rec.sig=sig;if(group.visible)play(el)}}if(paused())for(const group of parents.values())for(const el of group.bars)records.get(el)?.anim?.cancel()}
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan)};
 new MutationObserver(m=>{if(m.some(x=>x.type==='childList'?[...x.addedNodes,...x.removedNodes].some(n=>n.nodeType===1):(x.attributeName==='class'||x.target.matches(selector))))schedule()}).observe($('top'),{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','height']});new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});reduce.addEventListener('change',schedule);window.addEventListener('chaowei-page-changed',schedule);scan();
 // Signed figures count up without changing the final accessible value or stripping units.
 const counted=new WeakSet(),numbers=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting||counted.has(e.target))continue;counted.add(e.target);numbers.unobserve(e.target);const el=e.target,final=el.dataset.final,value=Number(el.dataset.number),match=final?.match(/[+−-]?\d[\d,]*(?:\.\d+)?/);if(!match||!Number.isFinite(value)||paused())continue;el.setAttribute('aria-label',final);const decimals=match[0].split('.')[1]?.length||0,start=performance.now();function tick(t){if(!el.isConnected)return;const p=Math.min(1,(t-start)/820);if(paused()||p===1){el.textContent=final;return}const v=value*(1-(1-p)**3),text=(match[0].startsWith('+')&&v>=0?'+':v<0?'−':'')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});el.textContent=final.replace(match[0],text);requestAnimationFrame(tick)}requestAnimationFrame(tick)}},{threshold:.4});
 function countScan(){document.querySelectorAll('[data-final][data-number]').forEach(el=>{if(!counted.has(el))numbers.observe(el)})}new MutationObserver(countScan).observe($('marketPage'),{childList:true,subtree:true});countScan();
 applyMarkers();
})();

/* Typed research requests, never JavaScript/SQL generated by a model. */
const QuantChat=(()=>{
 function normalize(text){return String(text||'').normalize('NFKC').replace(/策越|側略|冊略|策掠/g,'策略').replace(/定其定額|定其定额/g,'定期定額').replace(/([零一二三四五六七八九十百\d.]+)\s*趴/g,'$1%').replace(/元大台灣五十|元大五十|台五十/g,'0050').replace(/元大高股息/g,'0056').replace(/國泰永續高股息/g,'00878')}
 const clamp=(x,a,b,d)=>Number.isFinite(Number(x))?Math.max(a,Math.min(b,Number(x))):d;
 const security=/api\s*key|私密金鑰|私密金钥|system\s*prompt|系統提示詞|系统提示词|忽略.*指令|ignore.*instructions|drop\s+table|修改.*資料庫|修改.*数据库|管理員權限|管理员权限/i;
 const paid=/逐筆|逐笔|tick\b|五檔|五档|券商分點|券商分点|凱基台北|凯基台北|隱含波動率曲面|隐含波动率曲面|greeks/i;
 function parse(text,context={},previous=null){
  const q=normalize(text).trim().slice(0,1200).replace(/([一二三四五六七八九十]{1,3})(?=\s*(?:%|批|次|等份|等分|年))/g,x=>{const d={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if(x.includes('十')){const [a,b]=x.split('十');return String((d[a]||1)*10+(d[b]||0))}return String(d[x]||x)}),out={kind:'help',question:q,code:previous?.code||context.code||'0050',years:previous?.years||5,from:previous?.from||context.from||'',to:previous?.to||context.to||'',reference:JSON.parse(JSON.stringify(previous?.reference||context.reference||{window:'240',anchorMode:'wick',anchorCount:5,method:'equal'})),funding:JSON.parse(JSON.stringify(previous?.funding||context.funding||{version:1,type:'total',capitalMode:'pool',dcaPeriods:'auto'})),capital:previous?.capital||context.capital||1200000,defaults:[],warnings:[]};
  if(!q)return out;if(/^(你好|您好|嗨|hello|hi|謝謝|谢谢|感謝|thanks)[!！。\s]*$/i.test(q))return{...out,kind:'greeting'};if(security.test(q))return{...out,kind:'security'};if(paid.test(q))return{...out,kind:'boundary'};
  const codes=(q.match(/\b\d{4,6}[A-Z]?\b/g)||[]).filter(x=>context.codes?context.codes.includes(x):/^00/.test(x));if(codes.length)out.code=codes[0];const direct=q.match(/(?:回測|回测|分析|查|看)\s*(\d{4,6}[A-Z]?)(?!\d)/);if(direct&&!/^(?:年|[-/])/.test(q.slice(direct.index+direct[0].length))&&context.codes&&!context.codes.includes(direct[1]))return{...out,kind:'scope'};if(/(?:股票|個股|个股|代號|代号)\s*(?!00)\d{4}/.test(q))return{...out,kind:'scope'};
  const leading=q.match(/^(\d{4,6}[A-Z]?)(?!\d)/);if(leading&&context.codes&&!context.codes.includes(leading[1])&&!/^(?:年|月|日|[-/]|元|萬|万)/.test(q.slice(leading[0].length).trim()))return{...out,kind:'scope'};
  const dates=q.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/g);if(dates?.length){out.from=dates[0].replaceAll('/','-').split('-').map((x,i)=>i?x.padStart(2,'0'):x).join('-');out.to=dates[1]?.replaceAll('/','-').split('-').map((x,i)=>i?x.padStart(2,'0'):x).join('-')||'';}
  const yearSpan=q.match(/(20\d{2})\s*年?\s*(?:到|至|[-~～–—])\s*(20\d{2})\s*年?/);if(yearSpan&&!dates?.length){out.from=yearSpan[1]+'-01-01';out.to=yearSpan[2]+'-12-31'}
  const years=q.match(/(?:近|過去|过去|回測|回测)\s*(\d{1,2})\s*年/);if(years){out.years=clamp(years[1],1,20,5);if(!dates?.length&&!yearSpan){out.from='';out.to=''}}
  const cap=q.match(/(?:本金|資金|资金|預算|预算)\s*(?:改為|改为|改成|設為|设为|是|為|为)?\s*([\d,.]+)\s*(萬|万|元)?/);if(cap)out.capital=clamp(Number(cap[1].replaceAll(',',''))*(/[萬万]/.test(cap[2])?10000:1),10000,1e8,1200000);
  const fund=out.funding;fund.version=1;fund.years={...fund.years};
  const annual=q.match(/(?:每年|年度預算|年度预算)\s*([\d,.]+)\s*(萬|万|元)?/),salary=q.match(/每月(?:入金|投入|存入)\s*([\d,.]+)\s*(萬|万|元)?/),amount=m=>clamp(Number(m[1].replaceAll(',',''))*(/[萬万]/.test(m[2])?10000:1),0,1e9,240000);
  if(annual||salary){fund.type='annual';fund.arrival='monthly';fund.annualAmount=annual?amount(annual):amount(salary)*12;fund.years={}}
  for(const m of q.matchAll(/(20\d{2})年(?:預算|预算|投入|新增)\s*([\d,.]+)\s*(萬|万|元)?/g)){fund.type='annual';fund.arrival||='monthly';fund.years[m[1]]=clamp(Number(m[2].replaceAll(',',''))*(/[萬万]/.test(m[3])?10000:1),0,1e9,0)}
  if(/整段總預算|整段总预算|總預算|总预算/.test(q))fund.type='total';
  if(/全期間分期|全期间分期|整段期間分期|整段期间分期|整段分期/.test(q))fund.dcaPeriods='auto';
  if(/首年投完|一年投完|首年分期|前12個月|前12个月/.test(q))fund.dcaPeriods=12;
  if(/每月到帳|每月到账|按月到帳|按月到账/.test(q)){fund.arrival='monthly';fund.capitalMode='monthly'}
  if(/年初到帳|年初到账|各年一次到帳/.test(q)){if(fund.type==='annual')fund.arrival='yearStart';else{fund.arrival='upfront';fund.capitalMode='pool'}}
  if(/獲利再投入|获利再投入|損益再投入|损益再投入/.test(q))fund.recycleGains=true;
  if(/期初到位|期初已有/.test(q)){fund.arrival='upfront';fund.capitalMode='pool'}
  if(/回饋|反馈|反饋|錯誤回報|错误回报|建議新增|建议新增/.test(q)&&!/回測|回测/.test(q))return{...out,kind:'feedback'};
  if(/訓練|训练|樣本外|样本外|驗證|验证/.test(q))return{...out,kind:'validation'};if(/(?:上網|上网|搜尋|搜索|查詢最新|查询最新|新聞|新闻|近期事件|資料來源|数据来源)/.test(q))return{...out,kind:'research'};
  if(/最高|最賺|最赚|第一名|冠軍|冠军|最佳|打敗|打败|勝過|胜过|比較.*策略|比较.*策略|動量|动量|動能|动能|順勢|顺势|對沖|对冲|避險|避险|核心衛星|核心卫星/.test(q)&&!/(?:每跌|下跌|回檔|回档)\s*\d+\s*%/.test(q))return{...out,kind:'compare',focus:/動量|动量|動能|动能|順勢|顺势/.test(q)?'momentum':/對沖|对冲|避險|避险|核心衛星|核心卫星/.test(q)?'defensive':'all'};
  if(/(?:什麼|什么|如何理解|怎麼用|怎么用|怎樣|怎样|如何操作|解釋|解释|介紹|介绍|意思|說明|说明)/.test(q)&&!/回測|回测|買|买|加碼|加码|賣|卖/.test(q))return{...out,kind:'explain'};
  if(/水位|外資|外资|投信|法人|現價|现价|收盤|收盘/.test(q)&&!/回測|回测|加碼|加码|買|买|策略/.test(q))return{...out,kind:'quote'};
  if(/打敗|打败|勝過|胜过|比較.*策略|比较.*策略|最佳策略/.test(q))return{...out,kind:'compare'};
  if(/(?:改為|改为|改成|加上|剛剛|刚刚|同樣|同样|不建底倉|不建底仓)/.test(q)&&previous){Object.assign(out,{kind:previous.kind,recipe:previous.recipe,params:previous.params,indicator:previous.indicator});if(codes.length)out.code=codes[0];if(years)out.years=clamp(years[1],1,20,5);if(cap)out.capital=clamp(Number(cap[1].replaceAll(',',''))*(/[萬万]/.test(cap[2])?10000:1),10000,1e8,1200000);}
  const numberAfter=(re,def)=>{const m=q.match(re);return m?Number(m[1]):def};
  if(/KD/i.test(q)&&/回測|回测|買|买|加碼|加码|金叉/.test(q)){out.kind='backtest';out.recipe='kdGolden';out.params={low:numberAfter(/K\s*(?:<|低於|低于)\s*(\d+)/i,25)};return out}
  if(/融資|融资/.test(q)&&/回測|回测|加碼|加码|買|买/.test(q)){out.kind='backtest';out.recipe='marginFear';out.params={};return out}
  if(/季線|季线/.test(q)&&/收斂|收敛/.test(q)){out.kind='backtest';out.recipe='trendPullback';out.params={};return out}
  if(/MACD|RSI|威廉|Williams|ATR|(?:MA\s*\d+)|(?:\d+\s*(?:日|期)?均線)/i.test(q)&&/回測|回测|買|买|加碼|加码|進場|进场/.test(q)){
   const kind=/MACD/i.test(q)?'macd':/RSI/i.test(q)?'rsi':/威廉|Williams/i.test(q)?'williams':/ATR/i.test(q)?'atr':'ma';out.kind='technical';out.indicator=kind;out.params={period:numberAfter(/MA\s*(\d+)|(\d+)\s*(?:日|期)?均線/i,60),threshold:kind==='rsi'?numberAfter(/(?:低於|低于|<)\s*(\d+)/,30):kind==='williams'?-80:0,core:0,parts:1};if(kind==='ma'){const m=q.match(/MA\s*(\d+)|(\d+)\s*(?:日|期)?均線/i);out.params.period=clamp(m?.[1]||m?.[2],2,2400,60);out.params.below=/跌破|低於|低于/.test(q)}if(kind==='atr'){out.kind='explain';out.warnings.push('ATR 衡量波動，尚未指定買賣條件；不自行假設方向。')}else out.defaults.push('技術訊號以日 K 計算，無核心；反向訊號出場，所有交易依所選成本。');return out;
  }
  if(/跌|回檔|回档|回落/.test(q)&&/買|买|加碼|加码|回測|回测|改為|改为|改成|分\s*\d+\s*(?:批|次)/.test(q)||out.recipe==='chatLadder'){
   out.kind='backtest';out.recipe='chatLadder';const p={core:40,parts:3,drop:10,step:10,takeProfit:0,window:240,...(out.recipe==='chatLadder'&&previous?.recipe==='chatLadder'?previous.params:{})};
   const drop=q.match(/(?:每(?:再)?跌|下跌|跌|回檔|回档)\s*(\d+(?:\.\d+)?)\s*%/);if(drop){p.drop=Number(drop[1]);p.step=p.drop}else out.defaults.push('首次較前期高點跌 '+p.drop+'%，之後按同一高點等距加碼。');
   const parts=q.match(/(?:分(?:成)?|拆成|拆|最多(?:加碼|加码)?|買進|买进)\s*(\d+)\s*(?:等份|等分|次|批|份)/);if(parts)p.parts=Number(parts[1]);else out.defaults.push('加碼池 '+p.parts+' 批');
   const core=q.match(/(\d+(?:\.\d+)?)\s*%\s*(?:底倉|底仓|核心)/);if(core)p.core=Number(core[1]);else if(/不建底|無底倉|无底仓|0%底|純粹|纯粹/.test(q))p.core=0;else out.defaults.push('保留 '+p.core+'% 核心');
   const take=q.match(/(?:獲利|获利|賺|赚|停利|上?漲|上?涨)\s*(?:滿|满|到)?\s*(\d+(?:\.\d+)?)\s*%/);if(take)p.takeProfit=Number(take[1]);else if(/長線持有|长线持有|不賣|不卖/.test(q))p.takeProfit=0;else out.defaults.push(p.takeProfit?'衛星獲利 '+p.takeProfit+'% 出場':'長線持有，不設停利');
   const win=q.match(/(?:觀察|观察|參考|参考)\s*(\d+)\s*(?:天|日)/);if(win)p.window=Number(win[1]);out.params=cleanLadder(p);return out;
  }
  return out;
 }
 function cleanLadder(p={}){return{core:clamp(p.core,0,90,40),parts:Math.round(clamp(p.parts,1,10,3)),drop:clamp(p.drop,1,90,10),step:clamp(p.step,1,50,10),takeProfit:clamp(p.takeProfit,0,300,0),window:Math.round(clamp(p.window,20,2400,240))}}
 function bounds(rows,p){if(!rows.length)throw Error('尚無確認收盤資料');let to=p.to||rows.at(-1).date,from=p.from;if(!from){const d=new Date(to+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-p.years);from=d.toISOString().slice(0,10)}const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;if(!valid(from)||!valid(to))throw Error('日期不存在，請重新輸入。');if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>=to)throw Error('請提供先後正確的日期');const a=rows.findIndex(x=>x.date>=from),b=rows.findLastIndex(x=>x.date<=to);if(a<0||b-a<19)throw Error('此區間至少需要 20 個已確認交易日');return{a,b,requestedFrom:from,from:rows[a].date,to:rows[b].date}}
 function technical(ctx,p){const n=ctx.n,buy=Array(n).fill(false),sell=Array(n).fill(false),values=new Float64Array(n).fill(NaN);if(p.indicator==='rsi')values.set(ctx.rsi);else if(p.indicator==='ma'){values.set(EmaSma(ctx.close,p.params.period))}else if(p.indicator==='williams'){for(let i=13;i<n;i++){let hi=-Infinity,lo=Infinity;for(let j=i-13;j<=i;j++){hi=Math.max(hi,ctx.high[j]);lo=Math.min(lo,ctx.low[j])}values[i]=hi>lo?-100*(hi-ctx.close[i])/(hi-lo):-50}}else{const fast=ema(ctx.close,12),slow=ema(ctx.close,26),dif=fast.map((x,i)=>x-slow[i]),signal=ema(dif,9);for(let i=33;i<n;i++)values[i]=dif[i]-signal[i]}
  for(let i=1;i<n;i++){const v=values[i],prev=values[i-1];if(!Number.isFinite(v)||!Number.isFinite(prev))continue;if(p.indicator==='ma'){const below=p.params.below;buy[i]=below?ctx.close[i]<v&&ctx.close[i-1]>=prev:ctx.close[i]>v&&ctx.close[i-1]<=prev;sell[i]=below?ctx.close[i]>v&&ctx.close[i-1]<=prev:ctx.close[i]<v&&ctx.close[i-1]>=prev}else if(p.indicator==='macd'){buy[i]=v>0&&prev<=0;sell[i]=v<0&&prev>=0}else{buy[i]=v<p.params.threshold&&prev>=p.params.threshold;const high=p.indicator==='rsi'?70:-20;sell[i]=v>high&&prev<=high}}
  return{buy,sell,values};
 }
 function EmaSma(a,w){const out=new Float64Array(a.length).fill(NaN);let sum=0;for(let i=0;i<a.length;i++){sum+=a[i];if(i>=w)sum-=a[i-w];if(i>=w-1)out[i]=sum/w}return out}
 function ema(a,w){const out=new Float64Array(a.length);for(let i=0;i<a.length;i++)out[i]=i?out[i-1]+2/(w+1)*(a[i]-out[i-1]):a[i];return out}
 function install(E){if(!E.STRATEGIES.chat_annual_regime)E.STRATEGIES.chat_annual_regime={day(i,ctx,cfg,acc,st,h,inflow){if(!ctx.chatMa240)ctx.chatMa240=EmaSma(ctx.close,240);const ma=ctx.chatMa240[i];if(!Number.isFinite(ma))return;const on=ctx.close[i]>=ma,target=on?.9:.3;if(st.on!==on||inflow>0)acc.toWeight(i,target,on?'確認收盤站上MA240：90%持股':'確認收盤跌破MA240：30%持股、其餘現金');st.on=on}};if(E.STRATEGIES.chat_indicator)return;E.STRATEGIES.chat_indicator={day(i,ctx,cfg,acc,st){const p=cfg.params;if(p.sell[i]&&acc.shares>0){acc.sell(i,acc.shares,'對話技術規則：反向訊號','exit')}else if(p.buy[i]&&acc.shares<1e-8)acc.buy(i,acc.cash,'對話技術規則：確認日 K 訊號','entry')}}}
 function config(E,p,base){const {ctx,...clean}=base;if(p.kind==='technical'){const signal=technical(ctx,p);return{...clean,entryTranches:0,dcaPeriods:clean.dcaPeriods??'auto',strategy:'chat_indicator',params:signal}}const recipe=p.recipe==='chatLadder'?{strategy:'chat_ladder',params:cleanLadder(p.params)}:presets(E).find(x=>x.id===p.recipe);if(!recipe)throw Error('請選擇支援的規則');return{...clean,entryTranches:0,dcaPeriods:clean.dcaPeriods??'auto',strategy:recipe.strategy,params:{...recipe.params,...p.params},ref:p.recipe==='chatLadder'?{window:String(p.params.window||240),anchorMode:'wick',anchorCount:5,method:'equal'}:{...clean.ref}}}
 const explanations={rsi:'RSI(14) 比較近期平均漲幅與跌幅，採 Wilder 平滑。低讀數不等於一定反彈；此處技術試算預設跌破門檻買進、升破 70 出場。',macd:'MACD 的 DIF 是 EMA12 減 EMA26；訊號線是 DIF 的 EMA9。此處以柱值穿越零作交叉訊號，至少 35 根日 K 才可能確認第一組交叉。',kd:'KD(9,3,3) 由近九根高低價計算 RSV，再平滑成 K、D。低檔交叉只是一個歷史條件；本站 KD 分批策略還會保留核心。',atr:'ATR 衡量真實波幅，含當日高低與相對前收的跳空。它本身沒有買賣方向，請補充要用幾倍 ATR 停損或調整配置。',sharpe:'Sharpe 比較扣除停泊利率後的平均超額報酬與波動；本站以排除外部入金的每日 NAV 計算。數值高不保證未來獲利。',drawdown:'最大回落是 NAV 從過去高點到後續低點的最大跌幅；水下期是尚未回到前高的時間。新入金不算資產成長。',williams:'威廉 %R(14) 是收盤距近十四根最高價的相對位置，範圍 −100 到 0；不是預測機率。',water:'水位比較當時以前的參考區間。0–5 分是依所選方向的條件讀數，不是成功機率，也不是固定持股建議。'};
 function explain(q){if(/搜尋|搜索/.test(q))return '右上角搜尋按鈕可用 ETF 名稱或代號找候選；Enter 選第一筆，Esc 關閉回原頁。';if(/外觀|外观|字體|字体|深色|淺色|浅色/.test(q))return '右上帳號圖示內的「外觀與偏好」可改字級、深淺色與暫停動畫；Google 登入後可同步偏好。';if(/白板|拖曳|拖拉|連線|连线/.test(q))return '先加入 ETF、條件、配置和組合卡。連出圓點接到下一張接入點；不方便拖曳可用步驟清單。預算合計不能超過100%，回測後可逐檔核對成交。';if(/訓練|训练|驗證|验证/.test(q))return '先指定歷史截止日，只用截止以前選規則，再鎖定參數看後段驗證。不能看完驗證成績再反覆調參，卻仍稱為未知未來。';if(/縮放|缩放|拖曳.*圖|拖曳.*图/.test(q))return 'K線先顯示近一個月；可用滾輪或雙指縮放、拖曳平移，也可選全部或自訂日期。「貼合」恢復目前資料的價格範圍。';if(/布林|Bollinger/i.test(q))return '布林通道預設中軌為20期簡單均線，上下軌為該窗價格母體標準差的正負2倍；站上或跌破不代表必然反轉，需指定可回測的條件。';if(/均線|均线|\bMA\b/i.test(q)&&!/MACD/i.test(q))return '簡單均線是最近N根收盤的算術平均。日、週、月K的每一期不同；尚未滿N根不提供成熟數值，不能偷補未來價格。';const matched=[[/MACD/i,'macd'],[/RSI/i,'rsi'],[/KD/i,'kd'],[/ATR/i,'atr'],[/夏普|Sharpe/i,'sharpe'],[/回落|回撤|水下/,'drawdown'],[/威廉|Williams/i,'williams']].filter(([re])=>re.test(q));if(matched.length>1)return matched.slice(0,4).map(([,key])=>explanations[key]).join('\n\n');const key=/MACD/i.test(q)?'macd':/RSI/i.test(q)?'rsi':/KD/i.test(q)?'kd':/ATR/i.test(q)?'atr':/威廉|Williams/i.test(q)?'williams':/夏普|Sharpe/i.test(q)?'sharpe':/回落|回撤|水下/.test(q)?'drawdown':/水位|分數|分数|價格位置|价格位置/.test(q)?'water':null;return key?explanations[key]:'這個問題尚未收錄在本機教學；可開啟 Gemini 解讀，或到方法說明依主題查看。'}
 function verifyNarrative(text,facts){if(!facts)return{ok:true};const safety=String(text).replace(/(?:不|不能|無法|无法|並不|并不)保[證证][^。；\n]{0,20}[獲获]利/g,'');if(/保證.*獲利|保证.*获利|穩賺|稳赚|必勝|必胜|一定.*賺|一定.*赚/.test(safety))return{ok:false,reason:'保證性敘述'};const allowed=['annual','dcaAnnual','buyHoldAnnual','mdd','dcaMdd','exposure'].map(k=>Number(facts[k])*100).filter(Number.isFinite);if(Number.isFinite(facts.annual)&&Number.isFinite(facts.dcaAnnual))allowed.push((facts.annual-facts.dcaAnnual)*100);for(const [key,v] of Object.entries(facts.parameters||{}))if(['core','drop','step','takeProfit','low','high','trim','bias','marginDrop'].includes(key)&&Number.isFinite(v))allowed.push(v);for(const row of facts.ranking||[])for(const k of ['annual','mdd'])if(Number.isFinite(row[k]))allowed.push(row[k]*100);for(const match of String(text).matchAll(/([+−-]?\d+(?:\.\d+)?)\s*(?:%|％|個百分點|个百分点)/g)){const n=Number(match[1].replace('−','-')),digits=match[1].split('.')[1]?.length||0,tolerance=.5*10**(-digits)+1e-8;if(!allowed.some(v=>Math.abs(n-v)<=tolerance)&&![facts.mdd,facts.dcaMdd,...(facts.ranking||[]).map(x=>x.mdd)].filter(Number.isFinite).some(v=>n<=0&&Math.abs(n+v*100)<=tolerance))return{ok:false,reason:'未核對數值'}}return{ok:true}}

 function presets(E){return [...E.PRESETS,{id:'chatAnnual',family:'trend',name:'年線體制配置（MA240）',strategy:'chat_annual_regime',params:{}}]}
 function category(recipe){if(recipe.family==='benchmark')return{type:'基準對照',defense:recipe.id==='dca'?'分散投入時間':'長期持有'};if(recipe.id==='coreSat')return{type:'核心衛星配置',defense:'核心70%，衛星可留現金'};if(recipe.id==='regime')return{type:'順勢動量',defense:'MA20／60，90%／25%持股'};if(recipe.id==='chatAnnual')return{type:'順勢動量',defense:'MA240，90%／30%持股'};if(recipe.family==='trend')return{type:'趨勢與風險調節',defense:recipe.id==='chandelier'?'移動停利回收現金':'保留核心、條件加碼'};return{type:'左側分批',defense:'依規則投入與回收現金'}}
 function compare(E,ctx,base,a,b){return presets(E).map(recipe=>({recipe,...category(recipe),r:E.run(ctx,{...base,strategy:recipe.strategy,params:{...recipe.params}},a,b)})).map(x=>({...x,buyCount:x.r.trades.filter(t=>t.type==='buy').length,sellCount:x.r.trades.filter(t=>t.type==='sell').length})).sort((x,y)=>(y.r.monthly?y.r.xirr:y.r.cagr)-(x.r.monthly?x.r.xirr:x.r.cagr))}
 return{normalize,presets,category,compare,parse,bounds,cleanLadder,technical,install,config,explain,verifyNarrative,security,paid};
})();

/* Fast local calculation first; Gemini can plan/explain/research, never execute app code. */
(()=>{
 document.body.dataset.release='ph13';QuantChat.install(E);
 const desk=$('researchDesk'),stage=desk.querySelector('.research-chart-stage'),side=desk.querySelector('.research-side'),observation=$('observationSettings').parentElement;
 const heading=document.createElement('h3');heading.className='full-observation-heading';heading.textContent='觀察設定';observation.prepend(heading);desk.prepend(observation);desk.insertBefore(side,stage);
 const reading=document.createElement('div');reading.className='full-research-reading';$('chartCard').after(reading);for(const id of ['deskTechnical','drawer-chipCard','drawer-holderCard'])if($(id))reading.append($(id));
 const launcher=document.createElement('button');launcher.type='button';launcher.className='quant-launcher';launcher.id='openQuantChat';launcher.setAttribute('aria-label','問策略問題');launcher.title='問策略問題';launcher.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.3"/></svg>';
 const dialog=document.createElement('section');dialog.id='aiChatDrawer';dialog.className='quant-dialog';dialog.hidden=true;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','quantChatTitle');dialog.innerHTML='<header class="quant-header"><div><h2 id="quantChatTitle">策略研究對話室</h2><p>先算清楚，再一起理解。</p></div><div class="quant-header-actions"><button type="button" class="pill mini" id="quantFeedbackOpen">回饋</button><button type="button" class="pill mini" id="quantClear">清除對話</button><button type="button" class="quant-close" id="quantClose" aria-label="關閉策略對話"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><div class="quant-messages" id="quantMessages" role="log" aria-live="polite"></div><form class="quant-composer" id="quantForm"><label class="sr-only" for="quantQuestion">輸入 ETF 或策略問題</label><textarea id="quantQuestion" maxlength="1200" rows="2" placeholder="例如：0050 每跌 10% 加碼，分三批，績效如何？"></textarea><div class="quant-compose-actions"><div><label><input type="checkbox" id="quantUseGemini">使用 Gemini 解讀／公開網頁查詢</label><span class="quant-service" id="quantService">本機計算可直接使用；Gemini 需會員登入與站長設定。</span></div><button type="submit" class="action" id="quantSend">送出問題</button></div><p class="small quant-data-note">開啟後，問題與摘要送至 Google 模型，不附帳戶資料。對話留在此分頁；模型結果暫存5分鐘供取回。</p></form>';
 document.body.append(launcher,dialog);const log=$('quantMessages'),input=$('quantQuestion');let generation=0,busy=false,previous=null,abort=null,overflow='',service=null,history=[],charts=[],refreshers=new Set(),cached=new Map(),richCleanups=new WeakMap(),pendingTimers=new Set();
 const suggestions=['0050 每跌 10% 加碼，分三批','比較 0050 哪些策略勝過定投','什麼是 RSI、MACD 和最大回落？','00878 的水位與法人買賣超','上網查原油價格近期變化及來源'];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function buttons(parent,list){const row=document.createElement('div');row.className='quant-suggestions';for(const text of list){const b=document.createElement('button');b.type='button';b.className='pill mini';b.textContent=text;b.onclick=()=>{input.value=text;submit(text)};row.append(b)}parent.append(row)}
 function welcome(){const n=document.createElement('section');n.className='quant-welcome';n.innerHTML='<svg class="quant-wave" viewBox="0 0 60 72" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M17 40V17c0-6 7-6 7 0v18V9c0-6 7-6 7 0v25V12c0-6 7-6 7 0v23V20c0-6 7-6 7 0v24c0 14-9 23-21 23-8 0-13-6-16-14L3 39c-2-6 5-9 8-4l6 10"/></svg><h3>你好，一起把投資想法算清楚。</h3><p class="quant-answer">可以問操作方式、技術指標，或說出你的 ETF 與加碼規則。回測會列出代填參數、實際日期與比較基準；不保證勝過定投。</p>';buttons(n,suggestions);guided(n);log.append(n)}
 function message(text,cls='assistant'){const n=document.createElement('article');n.className='quant-message '+cls;const p=document.createElement('p');p.className='quant-answer';p.textContent=text;const badge=document.createElement('span');badge.className='quant-avatar';badge.textContent=cls==='user'?'您':'AI';n.append(badge,p);log.append(n);n.scrollIntoView({block:'start',behavior:'smooth'});return n}
 function flow(n){const d=document.createElement('div');d.className='quant-workflow';for(const label of ['01 判讀需求','02 查核資料','03 量化計算','04 解讀核對']){const s=document.createElement('span');s.textContent=label;d.append(s)}n.prepend(d);return(index,status,ms)=>{const s=d.children[index];s.className=status;if(ms!=null)s.textContent=s.textContent.replace(/ · .*$/,'')+' · '+Math.round(ms)+' ms'}}
 async function status(){try{const url=new URL(window.CHAOWEI_AI_ENDPOINT);url.searchParams.set('api','ai-status');service=await(await fetch(url)).json();$('quantService').textContent=service.configured?'Gemini 已設定 · '+service.model+'；開啟後才送出問題。':'Gemini 尚未設定；本機教學與回測仍可使用。'}catch{$('quantService').textContent='無法取得 Gemini 狀態；本機功能仍可使用。'}}
 launcher.onclick=()=>{if(!dialog.hidden)return;if(!$('searchOverlay').classList.contains('hidden'))closeSearch(false);if(!$('accountOverlay').classList.contains('hidden'))$('closeAccount').click();launcher.hidden=true;dialog.hidden=false;overflow=document.body.style.overflow;document.body.style.overflow='hidden';$('top').inert=true;if(!log.children.length)welcome();(innerWidth<700?$('quantClose'):input).focus();status()};
 function close(){dialog.hidden=true;launcher.hidden=false;$('top').inert=false;document.body.style.overflow=overflow;launcher.focus()}
 $('quantClose').onclick=close;dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){close();return}if(e.key==='Tab'){const a=[...dialog.querySelectorAll('button,input,textarea,select,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length),first=a[0],last=a.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
 $('quantClear').onclick=()=>{for(const t of pendingTimers)clearTimeout(t);pendingTimers.clear();generation++;abort?.abort();busy=false;$('quantSend').disabled=false;for(const c of charts)c();charts=[];history=[];previous=null;log.replaceChildren();welcome()};
 async function remote(mode,question,facts,deadline=Date.now()+22000){if(deadline-Date.now()<1000)return{available:false,text:'本機結果已完成；本次等待時間已達上限，可稍後再問解讀。'};const idToken=await window.chaoweiGetIdToken?.();if(!idToken)return{available:false,text:'請先在主網站 Google 登入，才能使用 Gemini。'};const jobCapable=service?.background===true,requestId=crypto.randomUUID(),controller=new AbortController();abort=controller;const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(mode==='plan'||!jobCapable?22000:12000,deadline-Date.now())));try{const response=await fetch(window.CHAOWEI_AI_ENDPOINT,{method:'POST',body:new URLSearchParams({action:'aiChat',payload:JSON.stringify({idToken,requestId,mode,question,facts,context:{code:previous?.code||selected,capital:previous?.capital||Number(settings.bt?.capital)||1200000,previousRule:previous?{recipe:previous.recipe,params:previous.params}:null},history:history.slice(-4)})}),signal:controller.signal,credentials:'omit'});return await response.json()}catch(e){if(e.name==='AbortError'&&mode!=='plan'&&jobCapable)return{available:false,pending:true,text:'解讀仍在處理，將在背景取回；可以繼續看圖與提問。',poll:async()=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),8000);try{const r=await fetch(window.CHAOWEI_AI_ENDPOINT,{method:'POST',body:new URLSearchParams({action:'aiResult',payload:JSON.stringify({idToken,requestId})}),signal:c.signal,credentials:'omit'});return await r.json()}finally{clearTimeout(t)}}};return{available:false,text:e.name==='AbortError'?'回應較久，可補充條件或稍後重送；本機功能仍可用。':'Gemini 連線暫不可用，本機計算已保留。'}}finally{clearTimeout(timer);if(abort===controller)abort=null}}
 async function bundle(code){if(!catalog.some(e=>e.code===code))throw Error('目前只支援名錄內的台灣 ETF；請先搜尋確認代號。');if(cached.has(code)&&Date.now()-cached.get(code).at<300000)return cached.get(code).value;await btEnsureDividends();let meta,rows;if(code===selected&&bars.length){meta=historyMeta;rows=bars}else{meta=await(await fetch('/api/history?code='+code)).json();rows=meta.bars}rows=(rows||[]).filter(b=>!b.intraday&&(!meta?.snapshotLatest||b.date<=meta.snapshotLatest));if(rows.length<20)throw Error('已確認日 K 不足 20 筆。');const div=(btDivs?.[code]||[]).map(([date,v])=>[date,v/(meta?.adjustments||[]).reduce((s,a)=>date<a.date?s*a.factor:s,1)]),value={ctx:E.prepare(rows,div,null,{marginDrop5:E.marginHistory(rows,btMarginRows)}),meta};cached.set(code,{at:Date.now(),value});if(cached.size>6)cached.delete(cached.keys().next().value);return value}
 function base(ctx,p){const current=btCfg(),f=p.funding||{};return{...current,ctx,capital:p.capital,capitalMode:f.capitalMode||current.capitalMode,dcaPeriods:f.dcaPeriods??current.dcaPeriods,funding:{...current.funding,...f,version:1},entryTranches:0,ref:{...(p.reference||current.ref)}}}
 function guided(parent){const d=document.createElement('details');d.className='quant-budget-builder';d.innerHTML='<summary>用選項組合問題，也能自行輸入</summary><div class="quant-budget-grid"><label>ETF<input data-guide="code" value="'+selected+'" inputmode="numeric" maxlength="6"></label><label>研究方式<select data-guide="kind"><option value="compare">比較最佳策略</option><option value="ladder">回檔分批買進</option></select></label><label>預算口徑<select data-guide="budget"><option value="total">整段總預算</option><option value="annual">每年新增預算</option></select></label><label>金額（元）<input data-guide="amount" type="number" min="0" max="1000000000" value="'+(settings.bt.funding.type==='annual'?settings.bt.funding.annualAmount:settings.bt.capital)+'"></label><label>資金到帳<select data-guide="arrival"><option value="monthly">每月到帳</option><option value="upfront">期初到位</option><option value="yearStart">年度額度可用</option></select></label><label data-guide-horizon>總預算分期期間<select data-guide="horizon"><option value="auto">整段期間</option><option value="12">首年12個月</option></select></label><label>開始日期<input data-guide="from" type="date" value="'+(bars[btStart(settings.bt.period)]?.date||'')+'"></label><label>結束日期<input data-guide="to" type="date" value="'+(bars[btEnd()]?.date||'')+'"></label><label>每跌多少加碼（%）<input data-guide="drop" type="number" min="1" max="90" value="10"></label><label>分幾批<input data-guide="parts" type="number" min="1" max="10" value="3"></label></div><div class="funding-years" data-guide-years></div><p class="small">年度金額可逐年修改，也可在問題後補「2022年預算30萬元，2023年預算60萬元」。圖表仍保留各次使用的日期、價格與完整預算。</p><div class="quant-budget-actions"><button type="button" class="pill mini" data-guide-action="compose">填入輸入框</button><button type="button" class="pill mini" data-guide-action="run">依選項計算</button></div>';const get=k=>d.querySelector('[data-guide="'+k+'"]');get('budget').value=settings.bt.funding.type;get('arrival').value=settings.bt.funding.type==='annual'?settings.bt.funding.arrival:settings.bt.capitalMode==='monthly'?'monthly':'upfront';get('horizon').value=settings.bt.dcaPeriods==='auto'?'auto':'12';const refreshYears=()=>{const box=d.querySelector('[data-guide-years]'),old=Object.fromEntries([...box.querySelectorAll('input')].map(el=>[el.dataset.year,el.value]));box.replaceChildren();box.hidden=get('budget').value!=='annual';if(box.hidden)return;const a=Number(get('from').value.slice(0,4)),z=Number(get('to').value.slice(0,4));if(!(z>=a&&z-a<=30))return;for(let y=a;y<=z;y++){const l=document.createElement('label');l.textContent=y+' 年新增預算';const n=document.createElement('input');n.type='number';n.min='0';n.max='1000000000';n.step='10000';n.dataset.year=y;n.value=old[y]??settings.bt.funding.years?.[y]??get('amount').value;l.append(n);box.append(l)}};const toggleBudget=()=>{const annual=get('budget').value==='annual';d.querySelector('[data-guide-horizon]').hidden=annual;refreshYears()};get('budget').onchange=()=>{if(get('budget').value==='total'&&get('arrival').value==='yearStart')get('arrival').value='upfront';toggleBudget()};get('arrival').onchange=()=>{if(get('arrival').value==='yearStart'){get('budget').value='annual';toggleBudget()}};get('from').onchange=refreshYears;get('to').onchange=refreshYears;get('amount').onchange=()=>{for(const n of d.querySelectorAll('[data-guide-years] input'))n.value=get('amount').value};toggleBudget();const compose=()=>{const val=k=>get(k).value,year=val('budget')==='annual';return val('code')+' '+(val('kind')==='compare'?'比較最佳策略':'每跌 '+val('drop')+'% 加碼，分 '+val('parts')+' 批')+'，'+val('from')+' 至 '+val('to')+'，'+(year?'每年':'整段總預算')+val('amount')+'元，'+(val('arrival')==='monthly'?'每月到帳':val('arrival')==='yearStart'?'年初到帳':'期初到位')+(year?'，'+[...d.querySelectorAll('[data-guide-years] input')].map(n=>n.dataset.year+'年預算'+n.value+'元').join('，'):'，'+(val('horizon')==='auto'?'全期間分期':'首年分期'))};d.querySelector('[data-guide-action="compose"]').onclick=()=>{input.value=compose();input.focus()};d.querySelector('[data-guide-action="run"]').onclick=()=>{input.value=compose();submit(input.value)};parent.append(d)}
 function clearResult(n){const old=n.querySelector('.quant-result');if(old){const fn=richCleanups.get(old);fn?.();charts=charts.filter(x=>x!==fn);richCleanups.delete(old);old.remove()}}
 function resultCard(n,r,ctx,p){clearResult(n);const card=document.createElement('div');card.className='quant-result';card.dataset.code=p.code;card.dataset.annual=btAnnual(r);card.dataset.dca=btAnnual(r.dca,r.monthly);card.dataset.mdd=r.mdd;card.dataset.from=r.start;card.dataset.to=r.end;card.innerHTML='<h3>'+esc(p.code+' '+(catalog.find(x=>x.code===p.code)?.name||''))+' · 歷史試算</h3><div class="quant-result-metrics">'+[['策略年化',pctText(btAnnual(r)),btAnnual(r)],['同期定投',pctText(btAnnual(r.dca,r.monthly)),btAnnual(r.dca,r.monthly)],['最大回落','−'+fmt(r.mdd*100,1)+'%',-r.mdd],['平均持股',fmt(r.utilization*100,0)+'%',null]].map(([label,v,s])=>'<div><small>'+label+'</small><strong class="'+(s>0?'up':s<0?'down':'')+'">'+v+'</strong></div>').join('')+'</div><div class="metric-meter" role="img" aria-label="平均持股 '+fmt(r.utilization*100,1)+'%"><i style="width:'+Math.max(0,Math.min(100,r.utilization*100))+'%"></i></div><p class="quant-assumptions">'+r.start+' 至 '+r.end+' · '+r.series.length+' 個確認交易日 · '+esc(btFundingText(r))+' · '+(r.fill==='nextOpen'?'T+1 開盤＋'+r.slipBps+' bps':'T 日收盤理想成交')+' · '+(r.cfg.drip?'股利再投入':'股利留現金')+'。圖先顯示近240個交易日，績效涵蓋上述完整區間。'+(r.years<1?'實際歷史不足一年，年化不能當成長期證據。':'')+'</p><div class="quant-chart-tabs" role="tablist" aria-label="對話回測圖表"><button class="pill mini" type="button" role="tab" aria-selected="true" data-chat-plot="candle">K 線買賣點</button><button class="pill mini" type="button" role="tab" aria-selected="false" data-chat-plot="asset">累積資產</button></div><div class="quant-chat-stage"></div><div class="quant-asset-panel" hidden><div class="quant-assets" aria-label="策略、定投與買進持有資產曲線"></div><p class="small">青綠：策略 · 金色：定投 · 紫色：買進持有；與價格主圖的縱軸不同。</p></div>';n.append(card);card.querySelector('h3').textContent=p.code+' '+(catalog.find(x=>x.code===p.code)?.name||'')+' · '+(p.recipe==='chatLadder'?'對話回檔分批':QuantChat.presets(E).find(x=>x.id===p.recipe)?.name||'技術條件')+'歷史試算';if(p.kind==='backtest'&&!n.querySelector('.quant-comparison')){const label=document.createElement('label');label.className='quant-strategy-select';label.textContent='檢視策略';const select=document.createElement('select');select.setAttribute('aria-label','對話圖表策略');const choices=QuantChat.presets(E);if(p.recipe==='chatLadder')choices.unshift({id:'chatLadder',name:'本次對話回檔分批',params:p.params});for(const x of choices){const o=document.createElement('option');o.value=x.id;o.textContent=x.name;o.selected=x.id===p.recipe;select.append(o)}select.onchange=()=>{const recipe=choices.find(x=>x.id===select.value),next={...p,recipe:recipe.id,params:recipe.params};const a=ctx.bars.findIndex(x=>x.date===r.start),z=ctx.bars.findIndex(x=>x.date===r.end),result=E.run(ctx,QuantChat.config(E,next,base(ctx,next)),a,z);previous=next;resultCard(n,result,ctx,next);n.querySelectorAll('.quant-ai-explanation').forEach(el=>el.hidden=el.dataset.recipe!==recipe.id)};label.append(select);card.querySelector('h3').after(label)}const rule=document.createElement('details');rule.className='metric-detail';rule.innerHTML='<summary>查看本次規則與假設</summary>';const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=JSON.stringify({strategy:r.cfg.strategy,parameters:p.kind==='technical'?{indicator:p.indicator,...p.params}:r.cfg.params,reference:r.cfg.ref,capital:r.cfg.capital,installments:r.N,funding:r.cfg.funding,capitalMode:r.cfg.capitalMode,latestConfirmedPrice:{date:ctx.bars.at(-1).date,close:ctx.close.at(-1)},endPrice:{date:r.end,close:ctx.close[ctx.bars.findIndex(b=>b.date===r.end)]},fee:r.cfg.fee,discount:r.cfg.discount,tax:r.cfg.tax,parking:r.cfg.parking,fill:r.cfg.fill,slipBps:r.cfg.slipBps},null,2);rule.append(pre);card.append(rule);
  let asset=null,syncing=false,viewRange=null;const stageView=createChaoweiBoardStage(card.querySelector('.quant-chat-stage'),{fullControls:true,onRange:v=>{if(syncing)return;viewRange=v;if(asset&&!card.querySelector('.quant-asset-panel').hidden){syncing=true;try{asset.timeScale().setVisibleLogicalRange(v)}finally{syncing=false}}}}),plan={weight:100,preset:p.recipe||'',strategyParams:p.params,ruleIds:[],ruleNames:[]};stageView.render([{...r,code:p.code,plan,ctx,executions:StrategyBoard.executions(r,plan,ctx)}]);
  const plot=card.querySelector('.quant-assets');asset=LightweightCharts.createChart(plot,{...chartOptions(),width:plot.clientWidth||900,height:340});const series=[];for(const [rows,color,width] of [[r.series,'#148c9a',3],[r.dca.series,'#c18c25',2],[r.bh.series,'#9c88d7',2]]){const s=asset.addLineSeries({color,lineWidth:width,priceLineVisible:false});s.setData(rows.map(x=>({time:x.time,value:x.value})));series.push(s)}asset.timeScale().setVisibleLogicalRange(viewRange||{from:Math.max(-.5,r.series.length-240-.5),to:r.series.length-.5});asset.timeScale().subscribeVisibleLogicalRangeChange(v=>{if(v&&!syncing&&!card.querySelector('.quant-asset-panel').hidden&&plot.clientWidth>1){viewRange=v;syncing=true;try{stageView.setVisibleRange(v)}finally{syncing=false}}});const ro=new ResizeObserver(()=>asset.applyOptions({width:plot.clientWidth||900}));ro.observe(plot);const refresh=()=>{stageView.refresh();asset.applyOptions(chartOptions())};refreshers.add(refresh);const cleanup=()=>{refreshers.delete(refresh);stageView.clear();ro.disconnect();asset.remove()};richCleanups.set(card,cleanup);charts.push(cleanup);card.querySelectorAll('[data-chat-plot]').forEach(b=>b.onclick=()=>{const saved=viewRange,candle=b.dataset.chatPlot==='candle';card.querySelector('.quant-chat-stage').classList.toggle('show-assets',!candle);card.querySelector('.quant-asset-panel').hidden=candle;card.querySelectorAll('[data-chat-plot]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));asset.applyOptions({width:plot.clientWidth||900});requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!saved||!card.isConnected)return;syncing=true;try{viewRange=saved;asset.timeScale().setVisibleLogicalRange(saved);stageView.setVisibleRange(saved)}finally{syncing=false}}))});
  if(p.kind==='backtest'&&r.funding?.type!=='annual'&&!r.monthly&&String(r.cfg.ref.window)==='240'&&r.cfg.ref.method==='equal'&&r.cfg.ref.anchorMode==='wick'){const b=document.createElement('button');b.type='button';b.className='pill mini';b.textContent='將規則帶入策略白板';b.onclick=()=>{const next=StrategyBoard.example();next.nodes=next.nodes.filter(x=>x.type!=='condition');next.edges=[{from:'etf-a',to:'allocation-a'},{from:'allocation-a',to:'portfolio'}];next.nodes.find(x=>x.type==='asset').params.code=p.code;const a=next.nodes.find(x=>x.type==='allocation');a.params={weight:100,on:100,off:0,preset:p.recipe,strategyParams:p.params,installments:r.cfg.dcaPeriods==='auto'?0:r.cfg.dcaPeriods};close();window.chaoweiImportBoard(next,{from:r.start,to:r.end,capital:r.cfg.capital})};card.append(b)}const apply=document.createElement('button');apply.type='button';apply.className='pill mini';apply.textContent='將規則與預算帶入 ETF 回測';apply.onclick=async()=>{close();if(selected!==p.code){selected=p.code;await loadBars()}Object.assign(settings.bt,{...Object.fromEntries(['fee','discount','tax','fill','slipBps','parking','drip','wholeShares','entryTranches'].map(k=>[k,r.cfg[k]])),sync:false,ref:{...r.cfg.ref},capital:r.cfg.capital,capitalMode:r.cfg.capitalMode,dcaPeriods:r.cfg.dcaPeriods,funding:JSON.parse(JSON.stringify(r.cfg.funding)),strategy:r.cfg.strategy,params:{...r.cfg.params},preset:QuantChat.presets(E).some(x=>x.id===p.recipe)?p.recipe:'custom',period:'custom',from:r.start,to:r.end});save();btFillForm();renderBacktest();window.chaoweiNavigate('etf','backtestCard')};if(p.kind!=='technical')card.append(apply);if(r.funding?.type==='annual'||r.monthly){const note=document.createElement('p');note.className='small';note.textContent='此預算含後續入金，請帶入 ETF 回測；白板目前使用期初資金池，避免匯入後變更到帳方式。';card.append(note)}return{code:p.code,recipe:p.recipe,from:r.start,to:r.end,capital:r.cfg.capital,annual:btAnnual(r),dcaAnnual:btAnnual(r.dca,r.monthly),buyHoldAnnual:btAnnual(r.bh,r.funding?r.monthly:false),mdd:r.mdd,dcaMdd:r.dca.mdd,exposure:r.utilization,buys:r.trades.filter(t=>t.type==='buy').length,sells:r.trades.filter(t=>t.type==='sell').length,clientComputed:true,parameters:Object.fromEntries(Object.entries(r.cfg.params).filter(([,v])=>typeof v==='number'&&Number.isFinite(v))),assumptions:r.cfg.fill+';'+r.slipBps+'bps;'+r.N+' installments;'+JSON.stringify(r.cfg.funding)};
 }
 async function submit(question){if(busy)return;const mine=++generation;busy=true;$('quantSend').disabled=true;input.value='';message(question,'user');const n=message(''),answer=n.querySelector('.quant-answer'),step=flow(n),start=performance.now(),deadline=Date.now()+22000;let p=QuantChat.parse(question,{code:selected,capital:Number(settings.bt?.capital)||1200000,from:bars[btStart(settings.bt.period)]?.date,to:bars[btEnd()]?.date,reference:{...btRef()},funding:{...settings.bt.funding,capitalMode:settings.bt.capitalMode,dcaPeriods:settings.bt.dcaPeriods},codes:catalog.map(x=>x.code)},previous);n.dataset.turnStarted=String(Date.now());history.push({role:'user',text:question});try{
   step(0,'active');if(p.kind==='validation'){answer.textContent='固定訓練／後段驗證請用站內歷史驗證工具，先鎖定截止日與規則，再看後段成績。對話的全段排行不會冒充樣本外證據。';const b=document.createElement('button');b.className='pill';b.type='button';b.textContent='前往歷史驗證';b.onclick=()=>{close();$('workTab0').click();window.chaoweiNavigate('etf','trainingLab');$('trainingLab').open=true};n.append(b);return}if(p.kind==='greeting'){answer.textContent='你好，我可以協助理解網站、釐清規則，再用實際資料試算。想先看哪檔 ETF？';buttons(n,suggestions);return}if(p.kind==='security'){answer.textContent='研究員只能查詢與計算，不具備金鑰讀取、管理權限、資料庫修改或下單工具。';return}if(p.kind==='boundary'){answer.textContent='本站未收錄盤中逐筆、五檔、單一券商分點及隱含波動率曲面，不能計算這些數值。可改問 ETF 法人合計或日 K 技術條件。';buttons(n,['0050 的水位與法人買賣超','0050 每跌 10% 加碼，分三批']);return}if(p.kind==='scope'){answer.textContent='目前研究範圍是台灣 ETF，請選擇名錄中的 ETF 代號。';return}if(p.kind==='feedback'){answer.textContent='可在下方填寫遇到的問題或新增功能建議；送出前會列出目的地。';feedback(question);return}
   if(p.kind==='help'&&$('quantUseGemini').checked){const plan=await remote('plan',question,null,deadline);if(mine!==generation)return;if(plan.plan)p={...plan.plan,question};else{answer.textContent=plan.text||'這個條件尚不能轉成支援的規則。請補充買進、賣出與資金條件。';step(0,'done',performance.now()-start);buttons(n,suggestions);return}}
   step(0,'done',performance.now()-start);if(['help','explain','research'].includes(p.kind)){answer.textContent=p.kind==='research'?($('quantUseGemini').checked?'正在查公開資料並核對來源。':'可以請 Gemini 查公開資料並附來源；請開啟下方 Gemini 選項。'):p.kind==='help'?'這句話尚未轉成支援的條件。可以補充 ETF、買賣條件、資金與期間，或選範例；Gemini 也能協助釐清。':p.warnings?.join(' ')||QuantChat.explain(question);if(p.kind==='help')buttons(n,suggestions);if($('quantUseGemini').checked){step(3,'active');const t=performance.now(),out=await remote(p.kind==='research'?'research':'explain',question,null,deadline);if(mine!==generation)return;aiText(n,out);step(3,'done',performance.now()-t)}return}
   if(!isMember){answer.textContent='歷史回測與進階籌碼為會員功能。可先詢問教學，或用 Google 登入後研究。';const b=document.createElement('button');b.className='pill';b.type='button';b.textContent='前往 Google 登入';b.onclick=()=>{close();$('accountTop').click()};n.append(b);return}
   step(1,'active');const dataAt=performance.now(),{ctx}=await bundle(p.code);if(mine!==generation)return;step(1,'done',performance.now()-dataAt);
   if(p.kind==='quote'){const ref={window:String(settings.window),anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,method:settings.method},water=E.water(ctx,ref).core.at(-1),last=ctx.bars.at(-1),chips=await(await fetch('/api/chips?code='+p.code)).json(),row=chips.rows?.at(-1);answer.textContent=p.code+' · '+last.date+' 確認收盤 '+fmt(last.close,2)+' 元；價格位置分數 '+(Number.isFinite(water)?fmt(water,1):'資料不足')+'／5（低價分高，未套權重）。'+(row?' 法人日期 '+row[0]+'：外陸資 '+fmt(row[1]/1000,1)+' 張、投信 '+fmt(row[2]/1000,1)+' 張、自營商 '+fmt(row[3]/1000,1)+' 張。':' 法人資料暫不可用。')+'此處是日資料，不把現在的檢查時間當成交時間。';return}
   step(2,'active');await new Promise(r=>setTimeout(r,0));const computeAt=performance.now(),range=QuantChat.bounds(ctx.bars,p),b=base(ctx,p);let config,result,ranking=[];
   let facts,rankView=null;
   if(p.kind==='compare'){
    ranking=QuantChat.compare(E,ctx,b,range.a,range.b);rankView=document.createElement('section');rankView.className='quant-comparison';n.append(rankView);
    const focus=ranking.filter(x=>p.focus==='momentum'?x.type==='順勢動量':p.focus==='defensive'?['核心衛星配置','順勢動量','趨勢與風險調節'].includes(x.type):true),chosen=focus[0]||ranking[0],defensive=ranking.filter(x=>x.recipe.family!=='benchmark').sort((a,b)=>a.r.mdd-b.r.mdd)[0];
    answer.textContent=p.code+' 在 '+range.from+' 至 '+range.to+' 的'+(p.focus==='momentum'?'順勢動量類':p.focus==='defensive'?'防守配置候選':'全部候選')+'中，年化最高為「'+chosen.recipe.name+'」'+pctText(btAnnual(chosen.r))+'，同期定投 '+pctText(btAnnual(chosen.r.dca,chosen.r.monthly))+'。非基準候選中回落最小為「'+defensive.recipe.name+'」'+fmt(defensive.r.mdd*100,1)+'%。這是本段歷史內排序，並非未來預測或樣本外驗證；現金防守不等於放空或股債對沖。';
    rankView.innerHTML='<details class="quant-ranking-details" open><summary>同區間策略比較（可點選）</summary><p class="small">同本金、同期間、同費用；買賣次數含配息再投與再平衡。選一列看成交。'+(p.focus==='all'?'':'目前已標出提問類別，表格仍保留全部候選。')+'</p><div class="quant-table-scroll"><table class="quant-ranking"><thead><tr><th>排名／方法</th><th>類型／防守方式</th><th>年化</th><th>最大回落</th><th>Sharpe</th><th>買／賣</th></tr></thead><tbody>'+ranking.map((x,i)=>'<tr data-strategy-key="'+x.recipe.id+'"><td><button type="button" data-select-strategy="'+x.recipe.id+'">'+(i+1)+' · '+esc(x.recipe.name)+'</button></td><td>'+esc(x.type)+'<small>'+esc(x.defense)+'</small></td><td class="'+(btAnnual(x.r)>=0?'up':'down')+'">'+pctText(btAnnual(x.r))+'</td><td class="down">−'+fmt(x.r.mdd*100,1)+'%</td><td>'+(Number.isFinite(x.r.sharpe)?fmt(x.r.sharpe,2):'—')+'</td><td>'+x.buyCount+'／'+x.sellCount+'</td></tr>').join('')+'</tbody></table></div></details><label class="quant-strategy-select">檢視策略<select aria-label="對話圖表策略">'+ranking.map(x=>'<option value="'+x.recipe.id+'">'+esc(x.recipe.name)+'</option>').join('')+'</select></label>';
    const selectRecipe=id=>{const x=ranking.find(x=>x.recipe.id===id);if(!x)return;result=x.r;const active={...p,kind:'backtest',recipe:x.recipe.id,params:x.recipe.params};previous=active;facts=resultCard(n,result,ctx,active);rankView.querySelector('select').value=id;rankView.querySelectorAll('tr[data-strategy-key]').forEach(row=>{row.classList.toggle('is-selected',row.dataset.strategyKey===id);row.querySelector('button').setAttribute('aria-pressed',String(row.dataset.strategyKey===id))});n.querySelectorAll('.quant-ai-explanation').forEach(el=>el.hidden=el.dataset.recipe!==id);n.dataset.activeRecipe=id;};
    rankView.querySelectorAll('tr[data-strategy-key]').forEach(row=>row.onclick=()=>selectRecipe(row.dataset.strategyKey));rankView.querySelector('select').onchange=e=>selectRecipe(e.target.value);selectRecipe(chosen.recipe.id);
    facts.ranking=ranking.map(x=>({id:x.recipe.id,name:x.recipe.name,type:x.type,annual:btAnnual(x.r),mdd:x.r.mdd,sharpe:x.r.sharpe,buys:x.buyCount,sells:x.sellCount}));p=previous;
   }else{config=QuantChat.config(E,p,b);result=E.run(ctx,config,range.a,range.b);previous=p;answer.textContent=(p.defaults?.length?'先採用：'+p.defaults.join('；')+'。\n':'')+'所有績效由同一引擎計算；可調整問題後重跑。';facts=resultCard(n,result,ctx,p);if(p.recipe==='chatLadder')buttons(n,['改為：不建底倉、每跌 10% 分 5 次買進','改為：40%底倉、每跌 5% 分 6 批','加上：賺 20% 停利'])}
   step(2,'done',performance.now()-computeAt);if(mine!==generation)return;
   if($('quantUseGemini').checked){step(3,'active');const at=performance.now(),requestFacts=facts,out=await remote('explain',question,requestFacts,deadline);if(mine!==generation)return;const verification=QuantChat.verifyNarrative(out.text||'',requestFacts);aiText(n,verification.ok?out:{available:false,text:'解讀含無法核對的數字或保證敘述；請以計算卡為準。'},requestFacts.recipe,requestFacts);step(3,'done',performance.now()-at)}else{step(3,'done',0);n.querySelector('.quant-workflow').children[3].textContent='04 本機核對（未呼叫 Gemini）'};
   const timing=document.createElement('p');timing.className='small quant-total-timing';timing.textContent=(n.dataset.aiPending==='true'?'本機結果與首次等待 ':'本次總耗時 ')+fmt(performance.now()-start,0)+' ms；包含資料取得與圖表建立'+(n.dataset.aiPending==='true'?'，解讀仍在背景處理。':'，不保證固定速度。');n.append(timing);history.push({role:'assistant',text:'完成 '+p.code+' '+result.start+' 至 '+result.end+' 歷史試算。'});

  }catch(e){answer.textContent='暫未完成：'+e.message+'。你可以修改條件或稍後重試。'}finally{n.querySelectorAll('.quant-workflow .active').forEach(s=>s.classList.remove('active'));if(mine===generation){busy=false;$('quantSend').disabled=false}while(log.querySelectorAll('.quant-result').length>3){const first=log.querySelector('.quant-result');first.remove();charts.shift()?.()}history=history.slice(-8)}
 }
 function aiText(parent,out,recipe='',facts=null){const n=document.createElement('section');n.className='quant-ai-explanation';n.dataset.recipe=recipe;if(recipe&&parent.dataset.activeRecipe&&recipe!==parent.dataset.activeRecipe)n.hidden=true;parent.querySelector('.quant-answer').after(n);if(out.pending&&out.poll){parent.dataset.aiPending='true';n.innerHTML='<p class="kicker teal">背景解讀</p><p class="quant-answer"></p>';n.querySelector('.quant-answer').textContent=out.text;let attempts=0;const begun=Date.now();const schedule=()=>{const t=setTimeout(async()=>{pendingTimers.delete(t);if(!n.isConnected)return;try{const next=await out.poll();if(!n.isConnected)return;if(next.pending){if(Date.now()-begun<90000){schedule();return}n.querySelector('.quant-answer').textContent='解讀仍未完成，本機結果已保留；稍後可重送相同問題。';return}parent.dataset.aiPending='false';const total=parent.querySelector('.quant-total-timing');if(total)total.textContent='本機結果已先顯示；解讀取回共耗時 '+(Date.now()-Number(parent.dataset.turnStarted||Date.now()))+' ms。';n.remove();const check=QuantChat.verifyNarrative(next.text||'',facts);aiText(parent,check.ok?next:{available:false,text:'解讀含未核對數字，請以計算卡為準。'},recipe,facts)}catch{if(++attempts<3&&Date.now()-begun<90000)schedule();else n.querySelector('.quant-answer').textContent='暫未取回解讀，本機結果已保留。'}},5000);pendingTimers.add(t)};schedule();return}const title=document.createElement('p');title.className='kicker teal';title.textContent=out.available?'Gemini 解讀'+(out.searchUsed?' · 已附公開來源':''):'服務狀態';const body=document.createElement('p');body.className='quant-answer';body.textContent=out.text||out.error||'暫未取得解讀。';n.append(title,body);if(out.sources?.length){const list=document.createElement('div');list.className='quant-sources';out.sources.forEach(s=>{if(!/^https:\/\//.test(s.url))return;const a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=s.title;list.append(a)});n.append(list)}if(out.searchSuggestions){const frame=document.createElement('iframe');frame.className='quant-google-suggestions';frame.title='Google 搜尋建議';frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\'">'+out.searchSuggestions;n.append(frame)}if(out.elapsedMs!=null){const p=document.createElement('p');p.className='small';p.textContent=(out.cached?'快取回覆 ':'伺服器 ')+out.elapsedMs+' ms'+(out.usage?' · 用量 '+out.usage+' tokens':'');n.append(p)}}
 function feedback(prefill=''){log.querySelector('.quant-feedback')?.remove();const f=document.createElement('section');f.className='quant-feedback';f.innerHTML='<h3>回報問題或提出想法</h3><label>分類<select id="quantFeedbackCategory"><option value="bug">操作或資料錯誤</option><option value="idea">功能建議</option><option value="question">其他問題</option></select></label><label>發生什麼事？<textarea id="quantFeedbackText" maxlength="2000" placeholder="請描述操作步驟、預期與實際結果。請勿填金鑰或個資。"></textarea></label><p class="small">「送給站長」會寫入本站私人回饋試算表，包含文字、ETF、版本與去識別會員代碼，不附上完整對話。也可只下載，留在你的裝置。</p><button type="button" class="pill" id="quantFeedbackSend">送給站長</button> <button type="button" class="pill" id="quantFeedbackDownload">下載回饋報告</button><p class="small" id="quantFeedbackStatus" aria-live="polite"></p>';log.append(f);$('quantFeedbackText').value=prefill;f.scrollIntoView({block:'start'});const payload=()=>({message:$('quantFeedbackText').value.trim(),category:$('quantFeedbackCategory').value,code:selected,version:'ph11'});$('quantFeedbackDownload').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'}));a.download='chaowei-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};$('quantFeedbackSend').onclick=async()=>{const data=payload();if(data.message.length<5){$('quantFeedbackStatus').textContent='請至少輸入五個字。';return}const idToken=await window.chaoweiGetIdToken?.();if(!idToken){$('quantFeedbackStatus').textContent='請先在主網站登入；也可以先下載報告。';return}message('送出回饋：'+data.message,'user');const button=$('quantFeedbackSend');button.disabled=true;try{const r=await fetch(window.CHAOWEI_AI_ENDPOINT,{method:'POST',body:new URLSearchParams({action:'aiFeedback',payload:JSON.stringify({...data,idToken})}),credentials:'omit'}),d=await r.json();$('quantFeedbackStatus').textContent=d.ok?'已送出，回饋編號 '+d.id:d.error||'未送出，可先下載報告。';message(d.ok?'回饋已送達私人資料庫，編號 '+d.id+'。':d.error||'尚未確認送達，可先下載報告。')}catch{$('quantFeedbackStatus').textContent='連線暫不可用，尚未確認送達；可先下載報告。'}finally{button.disabled=false}}}
 let lastDark=document.body.classList.contains('dark');const refreshCharts=()=>{for(const refresh of refreshers)refresh()};new MutationObserver(()=>{const dark=document.body.classList.contains('dark');if(dark!==lastDark){lastDark=dark;refreshCharts()}}).observe(document.body,{attributes:true,attributeFilter:['class']});window.addEventListener('chaowei-typography-changed',refreshCharts);
 $('quantFeedbackOpen').onclick=()=>feedback();$('quantForm').onsubmit=e=>{e.preventDefault();const q=input.value.trim();if(q)submit(q)};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();const q=input.value.trim();if(q)submit(q)}};
})();

/* Presentation only: normal page scrolling, no alteration of chart/data math. */
(()=>{
 const menu=$('siteMenu'),inner=menu.querySelector('.site-menu-inner'),head=inner.querySelector('.site-menu-head'),account=inner.querySelector('[data-menu-account]');
 document.body.append(menu);inner.replaceChildren(head);const nav=document.createElement('nav');nav.className='ph13-menu-nav';nav.setAttribute('aria-label','網站功能');
 for(const [href,title,desc] of [['homePage','一眼總覽','從候選 ETF 開始。'],['explore','ETF 觀測','價格、水位與歷史回測。'],['marketPage','市場刻度','量能、原油、匯率與籌碼。'],['strategyBoardPage','策略白板','把條件連成自己的規則。'],['guidePage','方法說明','先看圖解，再設定。']]){const a=document.createElement('a');a.href='#'+href;const h=document.createElement('strong');h.textContent=title;const p=document.createElement('span');p.textContent=desc;a.append(h,p);nav.append(a)}
 const aside=document.createElement('aside');aside.className='ph13-menu-tools';const title=document.createElement('h3');title.textContent='接著，想做什麼？';aside.append(title);const status=document.createElement('p');status.className='small';aside.append(status);
 for(const [text,id] of [['搜尋 ETF','openSearchTop'],['打開策略對話','openQuantChat']]){const b=document.createElement('button');b.type='button';b.className='pill';b.textContent=text;b.onclick=()=>{$('closeSiteMenu').click();$(id).click()};aside.append(b)}if(account){account.classList.add('pill');aside.append(account)};
 const quick=document.createElement('div');quick.className='ph13-menu-etfs';const label=document.createElement('p');label.textContent='快速觀測';quick.append(label);for(const code of ['0050','0056','00878','00919','00981A','009816']){const b=document.createElement('button');b.type='button';b.className='pill mini';b.textContent=code;b.onclick=()=>{$('closeSiteMenu').click();pick(code)};quick.append(b)}aside.append(quick);inner.append(nav,aside);
 $('openSiteMenu').addEventListener('click',()=>{status.textContent=(isMember?'已登入，可保存研究。':'可直接看行情；登入可保存研究。')+' 最近確認收盤 '+(historyMeta?.snapshotLatest||bars.at(-1)?.date||'讀取中')+'。'});
 document.querySelectorAll('.purpose-index').forEach(e=>e.remove());
 const reduce=matchMedia('(prefers-reduced-motion:reduce)'),active=new Set(),seen=new WeakSet();let velocity=0,frame=0,serial=0;
 function reset(){cancelAnimationFrame(frame);frame=0;velocity=0;for(const e of active)e.style.removeProperty('transform')}
 const disabled=()=>reduce.matches||document.hidden||innerWidth<1000||document.body.classList.contains('motion-paused')||!$('aiChatDrawer').hidden||!menu.classList.contains('hidden');
 const io=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting)active.add(e.target);else{active.delete(e.target);e.target.style.removeProperty('transform')}}},{rootMargin:'30px'});
 function scan(){for(const e of document.querySelectorAll('.purpose-art,.rd-matrix-spark,.ph13-ambient'))if(!seen.has(e)){seen.add(e);e.dataset.motionSeed=String(++serial);io.observe(e)}}
 for(const factor of $('factorRail').children){const bg=document.createElement('span');bg.className='ph13-ambient';bg.setAttribute('aria-hidden','true');factor.prepend(bg)}scan();
 new MutationObserver(scan).observe($('matrixCards'),{subtree:true,childList:true});
 function step(){frame=0;if(disabled()){reset();return}velocity*=.7;const stop=Math.abs(velocity)<.05;for(const e of active){const seed=(Number(e.dataset.motionSeed)*1.61803398875)%1,d=seed-.5,v=stop?0:velocity;e.style.transform=v?'translate3d('+((Math.sin(seed*Math.PI)*v*.15).toFixed(2))+'px,'+(v*d*.6).toFixed(2)+'px,0) rotate('+Math.max(-2.2,Math.min(2.2,v*d*.12)).toFixed(2)+'deg)':''}if(!stop)frame=requestAnimationFrame(step)}
 let lastY=scrollY;window.addEventListener('scroll',()=>{const delta=scrollY-lastY;lastY=scrollY;if(disabled()||Math.abs(delta)>innerHeight*2)return;velocity=Math.max(-32,Math.min(32,velocity+delta*.12));if(!frame&&Math.abs(velocity)>.05){for(const e of active)e.dataset.motionRuns=String(Number(e.dataset.motionRuns||0)+1);frame=requestAnimationFrame(step)}},{passive:true});
 new MutationObserver(()=>{if(disabled())reset()}).observe(document.body,{attributes:true,attributeFilter:['class']});document.addEventListener('visibilitychange',reset);reduce.addEventListener('change',reset);window.addEventListener('resize',()=>{if(disabled())reset()});
})();

})();

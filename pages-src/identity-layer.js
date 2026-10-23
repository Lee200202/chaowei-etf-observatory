// Firebase configuration is a public web-app identifier, never a server secret.
function installChaoweiIdentity(host){
  const $=id=>document.getElementById(id);
  const status=t=>{$('accountStatus').textContent=t};
  if(host==='apps-script'){
    $('googleSignIn').classList.add('hidden');$('accountMainLink').classList.remove('hidden');
    status('請在主網站登入；Apps Script 鏡像提供行情與評分。');return;
  }
  const config={apiKey:'AIzaSyBSMEMIDfBUSVSPwQUdbs6mEV-SXkBHbbs',authDomain:'chaowei-etf-observatory.firebaseapp.com',projectId:'chaowei-etf-observatory',appId:'1:342380543762:web:f27d15c89c70fe94b57dcb'};
  const base='https://www.gstatic.com/firebasejs/13.0.0/';
  let auth,db,user=null,api,plans=[],saveTimer=0,applying=false,ready=false;
  const profileRef=()=>api.doc(db,'users',user.uid);
  const safeSettings=s=>({window:s.window,method:s.method,anchorMode:s.anchorMode,anchorCount:s.anchorCount,showLevels:s.showLevels!==false,font:s.font,dark:!!s.dark,weights:s.weights,volumeDirection:s.volumeDirection,watchlist:s.watchlist,overlays:s.overlays,osc:s.osc,oscs:s.oscs,ind:s.ind,chartType:s.chartType,colorScheme:s.colorScheme,tourDone:s.tourDone,uiMode:s.uiMode,marginWeight:s.marginWeight,marginDirection:s.marginDirection,chipRange:s.chipRange,fxDirection:s.fxDirection,paneHeights:s.paneHeights,volumeBasis:s.volumeBasis,bt:s.bt,favorites:s.favorites,preferredWindow:s.preferredWindow,wavePins:Array.isArray(s.wavePins)?s.wavePins.slice(-300):[],waveStudy:s.waveStudy&&typeof s.waveStudy==='object'?s.waveStudy:{}});
  const getLocal=()=>{try{return safeSettings(JSON.parse(localStorage.getItem('chaowei-settings')||'{}'))}catch{return {}}};
  const showPlans=()=>{const list=$('planList');list.replaceChildren(new Option('選擇方案',''));plans.forEach((p,i)=>list.add(new Option(p.name,String(i))))};
  const write=async settings=>{if(!user||!db)return;try{await api.setDoc(profileRef(),{settings:safeSettings(settings),plans,updatedAt:api.serverTimestamp()},{merge:true});status(`已登入 ${user.email} · 設定已同步`)}catch(e){status(`已登入 ${user.email} · 雲端同步失敗：${e.code||e.message}`)}};
  window.chaoweiProfileChanged=settings=>{if(!user||applying)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>write(settings),900)};
  $('savePlan').addEventListener('click',async()=>{if(!user)return;const name=$('planName').value.trim();if(!name){status('請先輸入方案名稱');return}const settings=getLocal();const existing=plans.findIndex(p=>p.name===name);const item={name,settings,createdAt:new Date().toISOString()};if(existing>=0)plans[existing]=item;else plans.push(item);plans=plans.slice(-12);showPlans();$('planList').value=String(plans.findIndex(p=>p.name===name));await write(settings)});
  $('applyPlan').addEventListener('click',()=>{if(!user)return;const p=plans[Number($('planList').value)];if(!p)return;window.chaoweiApplyProfile?.({settings:p.settings});status(`已套用「${p.name}」`)});
  async function signedIn(next){user=next;clearTimeout(saveTimer);window.chaoweiSetMember?.(!!user);$('googleSignIn').classList.toggle('hidden',!!user);$('googleSignOut').classList.toggle('hidden',!user);$('accountPlans').classList.toggle('hidden',!user);($('accountTop').querySelector('.nav-label')||$('accountTop')).textContent=user?'我的帳號':'登入';$('accountTop').setAttribute('aria-label',user?'我的帳號':'Google 登入');$('displaySyncNote').textContent=user?'外觀、權重與追蹤清單會同步到你的 Google 帳號。':'外觀與權重目前存在此瀏覽器；登入後可跨裝置同步。';
    if(!user){status(ready?'尚未登入；可繼續使用免費行情與本機設定。':'正在檢查登入服務…');plans=[];showPlans();return}
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

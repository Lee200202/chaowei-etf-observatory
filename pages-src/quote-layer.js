// Read-only quote bridge. The Fugle key stays in Apps Script Script Properties.
function installChaoweiQuote(appsScriptUrl){
  const memo=new Map(),pending=new Map();
  const cached=read=>code=>{const hit=memo.get(code);if(hit&&Date.now()-hit.at<240000)return Promise.resolve(hit.data);if(pending.has(code))return pending.get(code);const task=read(code).then(data=>{if(data?.available)memo.set(code,{at:Date.now(),data});return data}).finally(()=>pending.delete(code));pending.set(code,task);return task};
  if(window.google?.script?.run){
    window.CHAOWEI_QUOTE=code=>new Promise((resolve,reject)=>
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getQuote(code));
    window.CHAOWEI_QUOTE=cached(window.CHAOWEI_QUOTE);return;
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
  window.CHAOWEI_QUOTE=cached(window.CHAOWEI_QUOTE);
}

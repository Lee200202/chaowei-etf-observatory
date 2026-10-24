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

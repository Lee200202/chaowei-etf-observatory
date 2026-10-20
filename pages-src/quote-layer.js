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
    const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);delete window[callback];script.remove();error?reject(error):resolve(data)};
    window[callback]=data=>finish(null,data);
    script.onerror=()=>finish(Error('Apps Script 報價連線失敗'));
    const timer=setTimeout(()=>finish(Error('Apps Script 報價逾時')),12000);
    script.src=url.toString();document.head.append(script);
  });
}

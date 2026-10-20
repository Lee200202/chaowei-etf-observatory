// Live market factors (intraday TAIEX and turnover, EIA Brent, CBC USD/TWD) through the Apps Script deployment.
// Apps Script caches one bundle for all visitors; the page asks every five minutes.
function installChaoweiLive(appsScriptUrl){
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
    const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);delete window[callback];script.remove();error?reject(error):resolve(data)};
    window[callback]=data=>finish(null,data);
    script.onerror=()=>finish(Error('Apps Script 市場資料連線失敗'));
    const timer=setTimeout(()=>finish(Error('Apps Script 市場資料逾時')),20000);
    script.src=url.toString();document.head.append(script);
  });
}

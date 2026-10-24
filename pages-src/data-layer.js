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

// HiStock 全市場八大行庫總額：僅存入擁有者的私人潮位資料庫，不向網站訪客提供原始資料。
const BANK_HISTORY_URL='https://histock.tw/stock/broker8.aspx';

function bankHistoryRows_(){
  const response=UrlFetchApp.fetch(BANK_HISTORY_URL,{
    headers:{'User-Agent':'Mozilla/5.0 (compatible; ChaoweiResearch/1.0)'},
    muteHttpExceptions:true,followRedirects:true
  });
  if(response.getResponseCode()!==200)throw Error('HiStock HTTP '+response.getResponseCode());
  const match=response.getContentText('UTF-8').match(/loadChart\((\{[\s\S]*?\})\);/);
  if(!match)throw Error('HiStock 圖表資料不存在，可能已改版');
  const chart=JSON.parse(match[1]);
  const sums=JSON.parse(chart.SumMoney),prices=JSON.parse(chart.Price);
  if(!Array.isArray(sums)||!Array.isArray(prices)||sums.length<20)throw Error('HiStock 圖表資料不足');
  const priceByTime={};prices.forEach(x=>{priceByTime[String(x[0])]=Number(x[1])});
  const seen={},rows=[];
  sums.forEach(x=>{
    const time=Number(x[0]),amount=Number(x[1]),index=priceByTime[String(x[0])];
    if(!Number.isFinite(time)||time%86400000!==0||!Number.isFinite(amount)||!Number.isFinite(index))
      throw Error('HiStock 日期或數值格式錯誤');
    const date=new Date(time).toISOString().slice(0,10);
    if(seen[date])throw Error('HiStock 日期重複：'+date);
    seen[date]=true;rows.push([date,amount,index,'HiStock broker8',stamp_()]);
  });
  rows.sort((a,b)=>a[0].localeCompare(b[0]));
  return rows;
}

// 在 Apps Script 編輯器執行一次；時鐘觸發器會在台北時間 20:00 左右啟動，週末立即略過。
function setupBankHistory(){
  const ss=store_();if(!ss)throw Error('潮位資料庫尚未建立');
  storeTab_(ss,'bank');
  const existing=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='appendBankHistory');
  if(!existing.length)ScriptApp.newTrigger('appendBankHistory').timeBased().everyDays(1).atHour(20).nearMinute(0).create();
  storeReadme_(ss);
  storeLog_(ss,'setupBankHistory','八大行庫私人分頁已建立；平日 20:00 左右單次更新');
  return{sheet:ss.getUrl(),triggers:Math.max(existing.length,1)};
}

function appendBankHistory(){
  const day=taipeiNow_().getUTCDay(),today=taipeiDate_();
  if(day===0||day===6)return{ok:true,skipped:'非平日'};
  const ss=store_();if(!ss)throw Error('潮位資料庫尚未建立');
  const props=storeProps_();
  if(props.getProperty('BANK_LAST_ATTEMPT')===today)return{ok:true,skipped:'今天已嘗試，不重抓'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return{ok:false,skipped:'其他工作正在執行'};
  try{
    if(props.getProperty('BANK_LAST_ATTEMPT')===today)return{ok:true,skipped:'今天已嘗試，不重抓'};
    props.setProperty('BANK_LAST_ATTEMPT',today); // 先記錄嘗試，來源失敗也不自動重試。
    const incoming=bankHistoryRows_(),sh=storeTab_(ss,'bank'),count=sh.getLastRow()-1;
    const prior=count?sh.getRange(2,1,count,5).getValues():[];
    const byDate={};prior.forEach((row,i)=>{byDate[String(row[0])]=i+2});
    const added=[],updates=[];
    incoming.forEach(row=>{
      const at=byDate[row[0]];
      if(!at){added.push(row);return}
      const old=prior[at-2];
      if(Number(old[1])!==row[1]||Number(old[2])!==row[2])updates.push([at,row]);
    });
    updates.forEach(([at,row])=>sh.getRange(at,1,1,5).setValues([row]));
    if(added.length)storeAppend_(sh,'bank',added);
    const result={ok:true,sourceDays:incoming.length,added:added.length,corrected:updates.length,
      rows:count+added.length,first:incoming[0][0],latest:incoming[incoming.length-1][0]};
    storeLog_(ss,'appendBankHistory',JSON.stringify(result));
    return result;
  }catch(err){
    storeLog_(ss,'appendBankHistory','失敗且今天不重試：'+err.message);
    return{ok:false,error:String(err.message).slice(0,180),retry:false};
  }finally{lock.releaseLock()}
}

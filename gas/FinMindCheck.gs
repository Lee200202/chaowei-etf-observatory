// FinMind token 內部檢查：只讀取指令碼屬性 FINMIND_API_TOKEN 向 FinMind 查詢，不寫入任何資料分頁、不輸出 token。
// 目前網站與潮位資料庫沒有任何 FinMind 資料來源；這裡只確認 token 能否使用、帳號等級與額度。
const FINMIND_DATA_URL='https://api.finmindtrade.com/api/v4/data';

function finmindGet_(url,token){
  const response=UrlFetchApp.fetch(url,{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});
  let body;try{body=JSON.parse(response.getContentText('UTF-8'))}catch(err){body={}}
  return{http:response.getResponseCode(),status:body.status,msg:String(body.msg||'').slice(0,80),body};
}

// 在 Apps Script 編輯器執行；結果只含狀態、等級與額度。
function checkFinMindToken(){
  const token=String(storeProps_().getProperty('FINMIND_API_TOKEN')||'').trim();
  if(!token)return{ok:false,error:'沒有 FINMIND_API_TOKEN'};
  const since=Utilities.formatDate(new Date(Date.now()-14*86400000),'Asia/Taipei','yyyy-MM-dd');
  const user=finmindGet_('https://api.web.finmindtrade.com/v2/user_info',token);
  const free=finmindGet_(FINMIND_DATA_URL+'?dataset=TaiwanStockPrice&data_id=0050&start_date='+since,token);
  const sponsor=finmindGet_(FINMIND_DATA_URL+'?dataset=TaiwanStockGovernmentBankBuySell&start_date='+since,token);
  const rows=x=>Array.isArray(x.body.data)?x.body.data.length:0;
  const result={
    ok:user.status===200&&free.status===200,
    tokenLength:token.length,
    account:user.status===200?{level:user.body.level_title||user.body.level,limit:user.body.api_request_limit,used:user.body.user_count}:user.msg,
    freeDataset:{status:free.status,msg:free.msg,rows:rows(free)},
    sponsorDataset:{status:sponsor.status,msg:sponsor.msg,rows:rows(sponsor)}
  };
  const ss=store_();if(ss)storeLog_(ss,'checkFinMindToken',JSON.stringify(result));
  console.log(JSON.stringify(result));
  return result;
}

// TAIFEX daily sentiment for the market cards: the TXO put/call ratio and the retail (non-institutional) net position
// in mini TAIEX futures. The parsers below are plain JavaScript shared with scripts/update-taifex-sentiment.mjs.
// Source pages: https://www.taifex.com.tw/cht/3/pcRatio , futDataDown (MTX) and futContractsDate (MXF).
function taifexDate_(s){const m=String(s||'').trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/);return m?m[1]+'-'+m[2]+'-'+m[3]:null}
function taifexNum_(s){const t=String(s==null?'':s).replace(/[,\s]/g,'');if(!/^-?\d+(\.\d+)?$/.test(t))return null;return Number(t)}
function taifexTable_(csv){
  const rows=String(csv||'').replace(/^﻿/,'').split(/\r?\n/).filter(line=>line.trim()).map(line=>line.split(',').map(x=>x.trim()));
  const head=rows[0]||[],col=name=>head.findIndex(h=>h.indexOf(name)===0);
  return{head,rows:rows.slice(1),col};
}
// pcRatioDown: 日期,賣權成交量,買權成交量,買賣權成交量比率%,賣權未平倉量,買權未平倉量,買賣權未平倉量比率%
// Rows are [date, putVolume, callVolume, putOI, callOI]; both ratios are recomputed from the counts.
function parseTaifexPcr_(csv){
  const t=taifexTable_(csv),c=[t.col('日期'),t.col('賣權成交量'),t.col('買權成交量'),t.col('賣權未平倉量'),t.col('買權未平倉量')];
  if(c.some(i=>i<0))throw Error('期交所 PCR 格式異常');
  const out=[],seen={};
  for(const r of t.rows){
    const date=taifexDate_(r[c[0]]),v=c.slice(1).map(i=>taifexNum_(r[i]));
    if(!date||seen[date]||v.some(x=>x==null||x<0)||!(v[1]>0)||!(v[3]>0))continue;
    seen[date]=true;out.push([date].concat(v));
  }
  return out.sort((a,b)=>a[0]<b[0]?-1:1);
}
// futDataDown for MTX: the market's open interest is the sum of 未沖銷契約數 over single contract months (weekly
// contracts included) in the regular session. Spread rows ("202611/202612") and the after-hours rows carry no OI.
function parseTaifexMtxOi_(csv){
  const t=taifexTable_(csv),c={date:t.col('交易日期'),code:t.col('契約'),month:t.col('到期月份'),oi:t.col('未沖銷契約數'),session:t.col('交易時段')};
  if(Object.keys(c).some(k=>c[k]<0))throw Error('期交所小台行情格式異常');
  const out={};
  for(const r of t.rows){
    const date=taifexDate_(r[c.date]),oi=taifexNum_(r[c.oi]);
    if(!date||r[c.code]!=='MTX'||r[c.session]!=='一般'||String(r[c.month]).indexOf('/')>=0||oi==null||oi<0)continue;
    out[date]=(out[date]||0)+oi;
  }
  return out;
}
// futContractsDateDown for MXF: long and short open interest of dealers, investment trusts and foreign investors.
// A day counts only when all three identities are present.
function parseTaifexInstitutions_(csv){
  const t=taifexTable_(csv),c={date:t.col('日期'),name:t.col('商品名稱'),who:t.col('身份別'),long:t.col('多方未平倉口數'),short:t.col('空方未平倉口數')};
  if(Object.keys(c).some(k=>c[k]<0))throw Error('期交所三大法人格式異常');
  const out={},count={};
  for(const r of t.rows){
    const date=taifexDate_(r[c.date]),long=taifexNum_(r[c.long]),short=taifexNum_(r[c.short]);
    if(!date||String(r[c.name]).indexOf('小型臺指')<0||long==null||short==null)continue;
    out[date]=out[date]||[0,0];out[date][0]+=long;out[date][1]+=short;count[date]=(count[date]||0)+1;
  }
  Object.keys(out).forEach(d=>{if(count[d]<3)delete out[d]});
  return out;
}
// Rows are [date, mtxOI, institutionalLong, institutionalShort]. Retail longs = OI − institutional longs and retail
// shorts = OI − institutional shorts, so the retail long/short ratio is (institutionalShort − institutionalLong) / OI.
function taifexRetailRows_(oi,inst){
  return Object.keys(oi).filter(d=>inst[d]&&oi[d]>0).sort().map(d=>[d,oi[d],inst[d][0],inst[d][1]]);
}
function taifexRetailRatio_(row){return row&&row[1]>0?(row[3]-row[2])/row[1]*100:null}
function taifexPcrRatio_(row,kind){return kind==='volume'?(row[2]>0?row[1]/row[2]*100:null):(row[4]>0?row[3]/row[4]*100:null)}

// Live bundle for the page: the last few weeks, so a day TAIFEX has published (after about 15:00 Taipei) shows up
// before the evening CI snapshot. One copy serves every visitor for four minutes, so each five-minute page check sees a fresh read.
function taifexPost_(path,payload){
  const r=UrlFetchApp.fetch('https://www.taifex.com.tw/cht/3/'+path,{method:'post',payload:payload,muteHttpExceptions:true,headers:{'User-Agent':'Mozilla/5.0 (compatible; ChaoweiResearch/1.0)'}});
  if(r.getResponseCode()!==200)throw Error('HTTP '+r.getResponseCode());
  const text=r.getBlob().getDataAsString('Big5');
  if(/<html|<!DOCTYPE/i.test(text.slice(0,300)))throw Error('查詢不受理');
  return text;
}
// A query whose end date has no data yet (today before publication, a weekend) is refused; step the end back a day.
function taifexRecent_(path,payload,now){
  const ymd=d=>Utilities.formatDate(d,'Asia/Taipei','yyyy/MM/dd'),from=ymd(new Date(now.getTime()-20*86400000));
  let last;
  for(let k=0;k<5;k++){
    const body=Object.assign({},payload,{queryStartDate:from,queryEndDate:ymd(new Date(now.getTime()-k*86400000))});
    try{return taifexPost_(path,body)}catch(e){if(e.message!=='查詢不受理')throw e;last=e}
  }
  throw last;
}
function getTaifexSentiment(){
  const cache=CacheService.getScriptCache(),key='taifex-sentiment-v1',hit=cache.get(key);
  if(hit)return JSON.parse(hit);
  const now=new Date(),out={checkedAt:now.toISOString(),pcr:[],retail:[],errors:[]};
  try{out.pcr=parseTaifexPcr_(taifexRecent_('pcRatioDown',{},now))}catch(e){out.errors.push('期交所 PCR：'+e.message)}
  try{
    const oi=parseTaifexMtxOi_(taifexRecent_('futDataDown',{down_type:'1',commodity_id:'MTX',commodity_id2:''},now));
    const inst=parseTaifexInstitutions_(taifexRecent_('futContractsDateDown',{commodityId:'MXF'},now));
    out.retail=taifexRetailRows_(oi,inst);
  }catch(e){out.errors.push('期交所小台與法人：'+e.message)}
  if(out.pcr.length||out.retail.length)cache.put(key,JSON.stringify(out),240);
  return out;
}

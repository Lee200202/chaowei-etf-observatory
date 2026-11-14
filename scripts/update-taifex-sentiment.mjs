// TAIFEX options put/call ratio and the mini-TAIEX retail long/short ratio for the market cards.
// The parsers live in gas-src/TaifexSentiment.gs so the evening snapshot and the Apps Script live bundle read the
// CSVs identically. Normal runs re-read the last month; `--backfill` fills history (PCR since 2012; the institutional
// file is only served for the last three years, so the retail ratio starts there).
import{readFile,writeFile}from'node:fs/promises';import vm from'node:vm';
const root=new URL('../',import.meta.url);
const box={};vm.createContext(box);vm.runInContext(await readFile(new URL('gas-src/TaifexSentiment.gs',root),'utf8'),box);
const backfill=process.argv.includes('--backfill'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const big5=new TextDecoder('big5');
async function post(path,form){
  for(let attempt=1;;attempt++){
    let refused=false;
    try{
      const r=await fetch('https://www.taifex.com.tw/cht/3/'+path,{method:'POST',body:new URLSearchParams(form),headers:{'User-Agent':'Mozilla/5.0 (compatible; ChaoweiResearch/1.0)'},signal:AbortSignal.timeout(45000)});
      if(!r.ok)throw Error('HTTP '+r.status);
      const text=big5.decode(await r.arrayBuffer());
      // A rejected query (range too long, too old) comes back as an HTML alert page instead of a CSV.
      if(/<html|<!DOCTYPE/i.test(text.slice(0,300))){refused=true;throw Error('期交所回傳非 CSV 頁面（查詢區間或日期不受理）：'+path+' '+form.queryStartDate+'–'+form.queryEndDate)}
      return text;
    }catch(e){if(refused||attempt>=3)throw e;await sleep(3000*attempt)}
  }
}
const ymd=d=>d.toISOString().slice(0,10).replaceAll('-','/');
const addDays=(d,n)=>new Date(d.getTime()+n*86400000);
// Month-long windows ending today (TAIFEX accepts at most one calendar month per PCR and futures-data request, so 28 days).
function windows(from,to,days=27){const out=[];for(let s=from;s<=to;s=addDays(s,days+1))out.push([s,addDays(s,days)>to?to:addDays(s,days)]);return out}
async function load(file){try{return JSON.parse(await readFile(new URL(file,root),'utf8'))}catch{return{days:[]}}}
const today=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Taipei'}).replace(/,.*/,'')+' UTC');
// A query whose end date has no data yet (today before publication, a weekend) is refused; step the end back a day.
async function postUpTo(path,form,s,e){for(let k=0;;k++){try{return await post(path,{...form,queryStartDate:ymd(s),queryEndDate:ymd(e)})}catch(err){if(k>=5||addDays(e,-1)<s||today-e>6*86400000)throw err;e=addDays(e,-1)}}}
const merge=(old,rows)=>{const m=new Map(old.map(r=>[r[0],r]));for(const r of rows)m.set(r[0],r);return[...m.values()].sort((a,b)=>a[0]<b[0]?-1:1)};

// Put/call ratio.
const pcrFile='pages-data/options-pcr.json',oldPcr=await load(pcrFile);
let pcrRows=[];
for(const [s,e] of windows(backfill||!oldPcr.days.length?new Date('2012-01-02T00:00:00Z'):addDays(today,-35),today)){
  pcrRows.push(...box.parseTaifexPcr_(await postUpTo('pcRatioDown',{},s,e)));await sleep(700);
}
const pcr=merge(oldPcr.days,pcrRows);
if(pcr.length<20)throw Error('PCR 資料不足');
for(const r of pcr){const v=box.taifexPcrRatio_(r,'oi');if(!(v>5&&v<800))throw Error('PCR 數值異常：'+r.join(','))}
await writeFile(new URL(pcrFile,root),JSON.stringify({source:'臺灣期貨交易所 臺指選擇權 Put/Call 比',sourceUrl:'https://www.taifex.com.tw/cht/3/pcRatio',frequency:'daily',
  fields:['date','putVolume','callVolume','putOI','callOI'],notice:'未平倉 PCR＝賣權未平倉量 ÷ 買權未平倉量 ×100%；成交量 PCR 同理。',latest:pcr.at(-1)[0],days:pcr})+'\n');
console.log(`TAIFEX PCR: ${pcr.length} days, ${pcr[0][0]} through ${pcr.at(-1)[0]}, OI ratio ${box.taifexPcrRatio_(pcr.at(-1),'oi').toFixed(2)}%`);

// Retail long/short ratio in mini TAIEX futures (MTX).
const retailFile='pages-data/retail-ratio.json',oldRetail=await load(retailFile);
const retailFrom=backfill||!oldRetail.days.length?addDays(today,-3*365+2):addDays(today,-35);
const oi={},inst={};
for(const [s,e] of windows(retailFrom,today)){Object.assign(oi,box.parseTaifexMtxOi_(await postUpTo('futDataDown',{down_type:'1',commodity_id:'MTX',commodity_id2:''},s,e)));await sleep(700)}
for(const [s,e] of windows(retailFrom,today,360)){Object.assign(inst,box.parseTaifexInstitutions_(await postUpTo('futContractsDateDown',{commodityId:'MXF'},s,e)));await sleep(700)}
const retail=merge(oldRetail.days,box.taifexRetailRows_(oi,inst));
if(retail.length<20)throw Error('散戶多空比資料不足');
for(const r of retail){const v=box.taifexRetailRatio_(r);if(!(Math.abs(v)<100))throw Error('散戶多空比數值異常：'+r.join(','))}
await writeFile(new URL(retailFile,root),JSON.stringify({source:'臺灣期貨交易所 小型臺指期貨行情與三大法人未平倉',sourceUrl:'https://www.taifex.com.tw/cht/3/futContractsDate',frequency:'daily',
  fields:['date','mtxOI','institutionalLong','institutionalShort'],notice:'散戶多空比＝（三大法人空單未平倉 − 三大法人多單未平倉）÷ 小台全市場未平倉 ×100%；正值＝散戶淨多單。',latest:retail.at(-1)[0],days:retail})+'\n');
console.log(`TAIFEX retail ratio: ${retail.length} days, ${retail[0][0]} through ${retail.at(-1)[0]}, ${box.taifexRetailRatio_(retail.at(-1)).toFixed(2)}%`);
const age=(today-Date.parse(pcr.at(-1)[0]+'T00:00:00Z'))/86400000;if(age>7)throw Error('期交所 PCR 超過一週未更新：'+pcr.at(-1)[0]);
// The browser copies (same 2,700-day tail as build-pages) so a data-only workflow can publish without a full build.
for(const file of ['options-pcr.json','retail-ratio.json']){const d=JSON.parse(await readFile(new URL('pages-data/'+file,root),'utf8'));d.days=d.days.slice(-2700);await writeFile(new URL('docs/data/'+file,root),JSON.stringify(d)+'\n')}

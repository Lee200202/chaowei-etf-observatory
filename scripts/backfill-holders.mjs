import{readFile,writeFile}from'node:fs/promises';import{tdccDates,tdccHistoryRow}from'./tdcc-history.mjs';
const file=new URL('../pages-data/history/holders.json',import.meta.url),arg=process.argv.find(x=>x.startsWith('--codes=')),codes=(arg?arg.slice(8):'0050,0056,00878,006208,00919,009816,00981A,00631L').split(',');
const catalog=JSON.parse(await readFile(new URL('../worker/etf-catalog.json',import.meta.url),'utf8')),list=catalog.etfs||catalog;
let out=JSON.parse(await readFile(file,'utf8')),byKey=new Map(out.rows.map(r=>[r[0]+'|'+r[1],r]));
const html=await(await fetch('https://www.tdcc.com.tw/portal/zh/smWeb/qryStock')).text(),dates=tdccDates(html);if(dates.length<40)throw Error('TDCC 日期清單不足');
for(const code of codes){const listing=list.find(x=>x.code===code)?.listingDate||'1900-01-01';let n=0,failed=0;
  for(const date of dates){const iso=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6);if(iso<listing||byKey.has(iso+'|'+code))continue;
    try{const row=await tdccHistoryRow(code,date);byKey.set(iso+'|'+code,row);n++}catch(e){console.log(`${code} ${date}: ${e.message}`);failed++;if(failed>=3)break}
    await new Promise(r=>setTimeout(r,400));
  }
  out.rows=[...byKey.values()].sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));out.source='TDCC 1-5 開放資料＋官網歷史查詢';out.historySource='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';out.rowsByCode=Object.fromEntries(codes.map(c=>[c,out.rows.filter(r=>r[1]===c).length]));
  await writeFile(file,JSON.stringify(out)+'\n');console.log(`${code}: added ${n}, total ${out.rows.filter(r=>r[1]===code).length} weekly records`);
}

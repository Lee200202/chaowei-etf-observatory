// The user's HiStock chart parser, persisted as one market-wide series (never ETF-level).
import{readFile,writeFile}from'node:fs/promises';
const file=new URL('../pages-data/history/histock-bank.json',import.meta.url),arg=process.argv.find(x=>x.startsWith('--csv='));
let rows;
if(arg){const t=(await readFile(arg.slice(6),'utf8')).replace(/^\uFEFF/,'');rows=t.trim().split(/\r?\n/).slice(1).map(x=>{const[d,a,i]=x.split(',');return[d,Number(a),Number(i)]})}
else{try{const r=await fetch('https://histock.tw/stock/broker8.aspx',{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);const h=await r.text(),m=h.match(/loadChart\((\{[\s\S]*?\})\);/);if(!m)throw Error('HiStock 圖表格式改變');const c=JSON.parse(m[1]),p=new Map(JSON.parse(c.Price));rows=JSON.parse(c.SumMoney).map(([t,v])=>[new Date(t).toISOString().slice(0,10),v,p.get(t)])}catch(e){console.log('HiStock 單次更新失敗，保留舊資料，不重試：'+e.message);process.exit(0)}}
if(rows.length<20||rows.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||!r.slice(1).every(Number.isFinite)))throw Error('HiStock 日期或數值異常');
let old={rows:[]};try{old=JSON.parse(await readFile(file,'utf8'))}catch{}
const m=new Map(old.rows.map(x=>[x[0],x]));rows.forEach(r=>m.set(r[0],r));const all=[...m.values()].sort((a,b)=>a[0].localeCompare(b[0]));
await writeFile(file,JSON.stringify({source:'HiStock 八大行庫全市場買賣總金額',sourceUrl:'https://histock.tw/stock/broker8.aspx',unit:'億元',frequency:'daily',fields:['date','netAmount','taiex'],first:all[0][0],latest:all.at(-1)[0],rows:all})+'\n');console.log(`HiStock: ${all.length} days, ${all[0][0]} through ${all.at(-1)[0]}`);

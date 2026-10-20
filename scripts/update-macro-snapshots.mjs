import {mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const fetchText=async url=>{const res=await fetch(url);if(!res.ok)throw Error(`${url} HTTP ${res.status}`);return res.text()};
const month={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const html=await fetchText('https://www.eia.gov/dnav/pet/hist/rbrteD.htm'),brent=[];
const re=/<td class=.B6.>\s*(?:&nbsp;)*\s*(\d{4})\s+([A-Za-z]{3})-\s*(\d{1,2})\s+to\s+[A-Za-z]{3}-\s*\d{1,2}<\/td>([\s\S]*?)<\/tr>/g;
for(const m of html.matchAll(re)){
  const values=[...m[4].matchAll(/<td class=.B3.>(.*?)<\/td>/g)].map(x=>x[1]);
  for(let i=0;i<Math.min(5,values.length);i++){const value=Number(values[i]);if(values[i]&&Number.isFinite(value)){const date=new Date(Date.UTC(Number(m[1]),month[m[2]],Number(m[3])+i)).toISOString().slice(0,10);brent.push({date,value})}}
}
if(brent.length<600)throw Error('EIA snapshot has too few days');
const raw=JSON.parse(await fetchText('https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day')),fx=[];
for(const row of raw){const date=String(row['日期']||''),value=Number(row.NTD_USD);if(/^\d{8}$/.test(date)&&Number.isFinite(value))fx.push({date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}`,value})}
if(fx.length<200)throw Error('CBC snapshot has too few days');
await mkdir(new URL('pages-data/',root),{recursive:true});
const b=brent.slice(-650),f=fx.slice(-650);
await writeFile(new URL('pages-data/brent.json',root),JSON.stringify({days:b,latest:b.at(-1).date,source:'EIA Brent daily snapshot',snapshot:true,unit:'USD/barrel'})+'\n');
await writeFile(new URL('pages-data/fx.json',root),JSON.stringify({days:f,latest:f.at(-1).date,source:'CBC FTDOpenData_Day',unit:'TWD/USD'})+'\n');
console.log(`EIA: ${b.length} through ${b.at(-1).date}; CBC: ${f.length} through ${f.at(-1).date}`);

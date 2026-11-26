// Back up the existing public cloud series; do not crawl HiStock again or retry its daily job.
import {readFile,writeFile} from 'node:fs/promises';
import {GAS_PUBLIC,publicJson,lastDate,businessAge} from './market-health-core.mjs';
const fresh=await publicJson(GAS_PUBLIC+'?api=bank');
if(fresh.error || !fresh.rows?.length)throw Error(fresh.error || '官股雲端無資料');
if(businessAge(lastDate(fresh))>5)throw Error('官股雲端超過五個平日未更新：'+lastDate(fresh));
const path='pages-data/history/histock-bank.json';
const old=JSON.parse(await readFile(path,'utf8'));
const merged=new Map(old.rows.map(row=>[row[0],row]));
for(const row of fresh.rows){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row[0]) || row.length<3 || !row.slice(1,3).every(Number.isFinite))throw Error('官股資料格式異常');
  merged.set(row[0],row);
}
const rows=[...merged.values()].sort((a,b)=>a[0].localeCompare(b[0]));
const result={...old,first:rows[0][0],latest:rows.at(-1)[0],rows};
for(const file of [path,'docs/data/history/histock-bank.json'])await writeFile(file,JSON.stringify(result)+'\n');
console.log('官股公開備份：'+rows.length+' 筆，截至 '+result.latest);

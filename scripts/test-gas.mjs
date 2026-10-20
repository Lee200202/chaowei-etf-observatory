import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../gas/Code.gs',import.meta.url),'utf8');
const cache=new Map();
const sample={stat:'OK',data:[['115/10/19','1,000','100,000','15.80','16.20','15.70','16.07']]};
const box={
  Date,Number,String,Array,Map,JSON,Math,Error,RegExp,isFinite,encodeURIComponent,
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
  UrlFetchApp:{fetchAll:requests=>requests.map(()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(sample)}))},
  HtmlService:{createHtmlOutputFromFile:name=>({name,setTitle(title){this.title=title;return this}})}
};
vm.createContext(box);vm.runInContext(source,box);
assert.equal(box.api('/api/etfs',{}).etfs.find(x=>x.code==='009816').name,'凱基台灣TOP50');
const bars=box.api('/api/bars',{code:'009816',count:'1'});
assert.equal(bars.bars.length,1);
assert.equal(bars.bars[0].close,16.07);
assert.equal(bars.bars[0].date,'2026-10-19');
assert.equal(box.api('/api/bars',{code:'009816',count:'120'}).error,'歷史資料查詢範圍錯誤');
assert.equal(box.doGet().title,'潮位 ETF 觀測所');
console.log('Apps Script catalogue, bar parsing, validation, and page entry passed');

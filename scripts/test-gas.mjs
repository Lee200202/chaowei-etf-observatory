import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../gas/Code.gs',import.meta.url),'utf8');
const html=await readFile(new URL('../gas/Index.html',import.meta.url),'utf8');
const cache=new Map(),fetched=[],props=new Map([['FUGLE_API_KEY','test-only-secret']]);
const box={
  JSON,String,Number,Date,
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
  UrlFetchApp:{fetch:(url,options)=>{fetched.push({url,options});return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.includes('api.fugle.tw')?
    {symbol:'009816',date:'2026-10-20',closePrice:16.2,closeTime:1792459800000000,previousClose:16.07,openPrice:16,highPrice:16.3,lowPrice:15.9,total:{tradeVolume:1234}}:
    url.endsWith('etf-catalog.json')?{etfs:[{code:'009816'}]}:
    {code:'009816',rows:[['2026-10-19',16,16.2,15.9,16.07,1000]]})}}},
  HtmlService:{createHtmlOutputFromFile:name=>({name,setTitle(t){this.title=t;return this},addMetaTag(){return this}})},
  ContentService:{MimeType:{JAVASCRIPT:'js',JSON:'json'},createTextOutput:text=>({text,setMimeType(type){this.type=type;return this}})}
};
vm.createContext(box);vm.runInContext(source,box);
assert.equal(box.readSnapshot('data/history/009816.json').rows[0][4],16.07);
assert.match(fetched[0].url,/^https:\/\/lee200202\.github\.io\/chaowei-etf-observatory\/data\/history\/009816\.json$/);
box.readSnapshot('data/history/009816.json');assert.equal(fetched.length,1,'second read must come from CacheService');
assert.equal(box.readSnapshot('../secret').error,'不支援的資料路徑');
assert.equal(box.readSnapshot('https://evil.example/x.json').error,'不支援的資料路徑');
assert.match(box.doGet().title,/潮位 ETF 觀測所/);
assert.ok(html.includes("installChaoweiApi('https://lee200202.github.io/chaowei-etf-observatory/'"));
assert.ok(html.includes('lightweight-charts@4.1.3'));
assert.equal(box.getQuote('009816').available,false,'public quote must start disabled');
props.set('FUGLE_PUBLIC_DISPLAY_ENABLED','true');
const quote=box.getQuote('009816');
assert.equal(quote.price,16.2);assert.equal(quote.volumeShares,1234000);
assert.equal(fetched.at(-1).options.headers['X-API-KEY'],'test-only-secret');
assert.equal(JSON.stringify(quote).includes('test-only-secret'),false,'key must never reach visitor');
assert.equal(box.getQuote('2330').available,false,'only catalogue ETFs may use the key');
assert.equal(box.doGet({parameter:{api:'quote',code:'009816',callback:'__cwq_abcdefgh'}}).type,'js');
assert.equal(box.doGet({parameter:{api:'quote',code:'009816',callback:'alert'}}).type,'json');
console.log('Apps Script snapshot proxy, quote gate, ETF allow-list, key isolation and page entry passed');

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../gas/FinMindCheck.gs',import.meta.url),'utf8');
const TOKEN='secret-token-value-123';
let token=TOKEN,calls=[],logs=[];
const reply=(code,body)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)});
const box={console:{log:t=>logs.push(t)},JSON,Date,Number,String,Array,Math,
  Utilities:{formatDate:()=> '2026-10-09'},
  storeProps_:()=>({getProperty:k=>k==='FINMIND_API_TOKEN'?token:null}),
  store_:()=>({}),storeLog_:(ss,job,text)=>logs.push(text),
  UrlFetchApp:{fetch:(url,opt)=>{
    calls.push({url,auth:opt.headers.Authorization});
    if(url.includes('user_info'))return reply(200,{status:200,level_title:'Free',api_request_limit:600,user_count:3,email:'x@y'});
    if(url.includes('GovernmentBank'))return reply(400,{status:400,msg:'Your level is free. Please update your user level.'});
    return reply(200,{status:200,msg:'success',data:[{},{}]});
  }}};
vm.createContext(box);vm.runInContext(source,box);

const ok=box.checkFinMindToken();
assert.equal(ok.ok,true);
assert.deepEqual({...ok.account},{level:'Free',limit:600,used:3});
assert.equal(ok.freeDataset.rows,2);
assert.equal(ok.sponsorDataset.status,400);
assert.equal(calls.length,3);
assert.ok(calls.every(c=>c.auth==='Bearer '+TOKEN&&!c.url.includes(TOKEN)),'token only in header');
assert.ok(!JSON.stringify(ok).includes(TOKEN)&&!logs.join('').includes(TOKEN),'token never returned or logged');
assert.ok(!logs.join('').includes('x@y'),'email not logged');

box.UrlFetchApp.fetch=()=>reply(400,{status:400,msg:'Token is illegal.'});
const bad=box.checkFinMindToken();
assert.equal(bad.ok,false);assert.equal(bad.account,'Token is illegal.');

token='';
assert.equal(box.checkFinMindToken().error,'沒有 FINMIND_API_TOKEN');
console.log('FinMind token check: header-only token, no token/email in output, illegal and missing token handled');

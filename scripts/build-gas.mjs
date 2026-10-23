import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const PAGES_BASE='https://lee200202.github.io/chaowei-etf-observatory/';
const [page,css,client,enhancements,dataLayer,quoteLayer,identityLayer,liveLayer,backend]=await Promise.all([
  read('worker/page.html'),Promise.all([read('worker/style.css'),read('worker/story.css'),read('worker/research.css')]).then(parts=>parts.join('\n')),read('worker/client.js'),read('worker/chart-enhancements.js').then(async s=>s+'\n'+await read('worker/wave-research-core.js')+'\n'+await read('worker/research-extras.js')+'\n'+await read('worker/research-wave-ui.js')+'\n'+await read('worker/tdcc-holders.js')+'\n'+await read('worker/strategy-engine.js')+'\n'+await read('worker/backtest.js')+'\n'+await read('worker/tour.js')+'\n'+await read('worker/custom.js')+'\n'+await read('worker/analytics.js')+'\n'+await read('worker/novice.js')+'\n'+await read('worker/market-extras.js')+'\n'+await read('worker/chip-weight.js')+'\n'+await read('worker/experience.js')),
  read('pages-src/data-layer.js'),read('pages-src/quote-layer.js'),read('pages-src/identity-layer.js'),read('pages-src/live-layer.js'),read('gas-src/Code.template.gs')
]);
// The page reads the Pages snapshots directly (CORS is open); google.script.run is only the fallback.
const fallback=`path=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(d=>d&&d.error?reject(Error(d.error)):resolve(d)).withFailureHandler(reject).readSnapshot(path))`;
const shim=`${dataLayer}\n${quoteLayer}\n${identityLayer}\n${liveLayer}\nwindow.CHAOWEI_STATIC=true;window.CHAOWEI_HOST='apps-script';installChaoweiApi('${PAGES_BASE}',${fallback});installChaoweiQuote('');installChaoweiIdentity('apps-script');installChaoweiLive('');\n`;
const html=page.replace('__CSS__',()=>css).replace('__JS__',()=>shim+client.replace('__ENHANCEMENTS__',()=>enhancements));
await mkdir(new URL('gas/',root),{recursive:true});
await writeFile(new URL('gas/Index.html',root),html);
await writeFile(new URL('gas/Code.gs',root),backend.replace('__PAGES_BASE__',PAGES_BASE));
// Cloud spreadsheet store (潮位資料庫): needs Sheets and trigger scopes, granted once by the owner in the editor.
await writeFile(new URL('gas/Store.gs',root),await read('gas-src/Store.gs'));
await writeFile(new URL('gas/appsscript.json',root),JSON.stringify({timeZone:'Asia/Taipei',exceptionLogging:'STACKDRIVER',runtimeVersion:'V8',webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'},oauthScopes:['https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/script.scriptapp']},null,2)+'\n');
console.log('Built Google Apps Script web app');

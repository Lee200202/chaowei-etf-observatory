import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const PAGES_BASE='https://lee200202.github.io/chaowei-etf-observatory/';
const [page,css,client,enhancements,dataLayer,quoteLayer,identityLayer,liveLayer,backend]=await Promise.all([
  read('worker/page.html'),Promise.all([read('worker/style.css'),read('worker/story.css'),read('worker/research.css')]).then(parts=>parts.join('\n')),read('worker/client.js'),read('worker/chart-enhancements.js').then(async s=>s+'\n'+await read('worker/wave-research-core.js')+'\n'+await read('worker/research-extras.js')+'\n'+await read('worker/research-wave-ui.js')+'\n'+await read('worker/tdcc-holders.js')+'\n'+await read('worker/momentum-panel.js')+'\n'+await read('worker/strategy-engine.js')+'\n'+await read('worker/backtest.js')+'\n'+await read('worker/tour.js')+'\n'+await read('worker/custom.js')+'\n'+await read('worker/analytics.js')+'\n'+await read('worker/novice.js')+'\n'+await read('worker/market-score-core.js')+'\n'+await read('worker/market-factor-config.js')+'\n'+await read('worker/market-extras.js')+'\n'+await read('worker/market-bank.js')+'\n'+await read('worker/chip-weight.js')+'\n'+await read('worker/indicator-direction-core.js')+'\n'+await read('worker/indicator-directions.js')+'\n'+await read('worker/market-layout.js')+'\n'+await read('worker/wave-backtest-bridge.js')+'\n'+await read('worker/chip-resonance.js')+'\n'+await read('worker/measurement-core.js')+'\n'+await read('worker/chart-measurement.js')+'\n'+await read('worker/experience.js')),
  read('pages-src/data-layer.js'),read('pages-src/quote-layer.js'),read('pages-src/identity-layer.js'),read('pages-src/live-layer.js'),read('gas-src/Code.template.gs')
]);
// The page reads the Pages snapshots directly (CORS is open); google.script.run is only the fallback.
const fallback=`path=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(d=>d&&d.error?reject(Error(d.error)):resolve(d)).withFailureHandler(reject).readSnapshot(path))`;
const cloudSync=await read('pages-src/cloud-sync.js');
const shim=`${cloudSync}\n${dataLayer}\n${quoteLayer}\n${identityLayer}\n${liveLayer}\nwindow.CHAOWEI_STATIC=true;window.CHAOWEI_HOST='apps-script';installChaoweiApi('${PAGES_BASE}',${fallback});installChaoweiQuote('');installChaoweiIdentity('apps-script');installChaoweiLive('');\n`;
// HtmlService's inline-JS sanitizer can truncate URL strings after modern template literals.
// Serve the same committed runtime over HTTPS; the content hash prevents stale cross-deployment caches.
const runtime=shim+client.replace('__ENHANCEMENTS__',()=>enhancements),hash=createHash('sha256').update(runtime).digest('hex').slice(0,16);
await mkdir(new URL('docs/',root),{recursive:true});
await writeFile(new URL('docs/gas-runtime.js',root),runtime);
// Immutable filenames keep an older /exec deployment paired with its own runtime.
const filename='gas-runtime-'+hash+'.js';
await writeFile(new URL('docs/'+filename,root),runtime);
let previous=[];try{previous=JSON.parse(await read('docs/gas-runtimes.json'))}catch{}
const keep=[hash,...previous.filter(x=>x!==hash&&/^[a-f0-9]{16}$/.test(x))].slice(0,5);
for(const old of previous)if(/^[a-f0-9]{16}$/.test(old)&&!keep.includes(old))await rm(new URL('docs/gas-runtime-'+old+'.js',root),{force:true});
await writeFile(new URL('docs/gas-runtimes.json',root),JSON.stringify(keep)+'\n');
const html=page.replace('__CSS__',()=>css).replace('<script>__JS__</script>',()=>'<script src="'+PAGES_BASE+filename+'"></script>');
if(html.includes('__JS__'))throw Error('Apps Script runtime placeholder not replaced');
await mkdir(new URL('gas/',root),{recursive:true});
await writeFile(new URL('gas/Index.html',root),html);
await writeFile(new URL('gas/Code.gs',root),backend.replace('__PAGES_BASE__',PAGES_BASE));
// Cloud spreadsheet store (潮位資料庫): needs Sheets and trigger scopes, granted once by the owner in the editor.
await writeFile(new URL('gas/Store.gs',root),await read('gas-src/Store.gs'));
await writeFile(new URL('gas/BankHistory.gs',root),await read('gas-src/BankHistory.gs'));
await writeFile(new URL('gas/FinMindCheck.gs',root),await read('gas-src/FinMindCheck.gs'));
await writeFile(new URL('gas/MarketSources.gs',root),await read('gas-src/MarketSources.gs'));
await writeFile(new URL('gas/appsscript.json',root),JSON.stringify({timeZone:'Asia/Taipei',exceptionLogging:'STACKDRIVER',runtimeVersion:'V8',webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'},oauthScopes:['https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/script.scriptapp']},null,2)+'\n');
console.log('Built Google Apps Script web app');

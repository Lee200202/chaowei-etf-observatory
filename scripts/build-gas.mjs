import {scaleTypography} from './typography-css.mjs';
import {mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const PAGES_BASE='https://lee200202.github.io/chaowei-etf-observatory/';
const [page,css,client,enhancements,dataLayer,quoteLayer,identityLayer,liveLayer,backend]=await Promise.all([
  read('worker/page.html'),Promise.all([read('worker/style.css'),read('worker/story.css'),read('worker/research.css'),read('worker/minimal.css'),read('worker/typography.css'),read('worker/visual-metrics.css'),read('worker/research-studio.css'),read('worker/strategy-board.css'),read('worker/ux-refinements.css'),read('worker/redesign.css'),read('worker/subtraction.css'),read('worker/ph10.css'),read('worker/quant-chat.css')]).then(parts=>scaleTypography(parts.join('\n'))),read('worker/client.js'),read('worker/chart-enhancements.js').then(async s=>s+'\n'+await read('worker/wave-research-core.js')+'\n'+await read('worker/research-extras.js')+'\n'+await read('worker/research-wave-ui.js')+'\n'+await read('worker/tdcc-holders.js')+'\n'+await read('worker/momentum-panel.js')+'\n'+await read('worker/strategy-engine.js')+'\n'+await read('worker/optimizer-worker.js')+'\n'+await read('worker/backtest.js')+'\n'+await read('worker/tour.js')+'\n'+await read('worker/custom.js')+'\n'+await read('worker/analytics.js')+'\n'+await read('worker/novice.js')+'\n'+await read('worker/market-score-core.js')+'\n'+await read('worker/market-factor-config.js')+'\n'+await read('worker/market-extras.js')+'\n'+await read('worker/market-bank.js')+'\n'+await read('worker/chip-weight.js')+'\n'+await read('worker/indicator-direction-core.js')+'\n'+await read('worker/indicator-directions.js')+'\n'+await read('worker/market-layout.js')+'\n'+await read('worker/wave-backtest-bridge.js')+'\n'+await read('worker/chip-resonance.js')+'\n'+await read('worker/measurement-core.js')+'\n'+await read('worker/chart-measurement.js')+'\n'+await read('worker/viewport-core.js')+'\n'+await read('worker/viewport-controller.js')+'\n'+await read('worker/cache-refresh.js')+'\n'+await read('worker/study-layout.js')+'\n'+await read('worker/visual-metrics-core.js')+'\n'+await read('worker/subperiod-charts.js')+'\n'+await read('worker/visual-metrics.js')+'\n'+await read('worker/training-core.js')+'\n'+await read('worker/training-ui.js')+'\n'+await read('worker/daily-score.js')+'\n'+await read('worker/experience.js')+'\n'+await read('worker/page-navigation.js')+'\n'+await read('worker/strategy-board-core.js')+'\n'+await read('worker/board-stage.js')+'\n'+await read('worker/strategy-board-ui.js')+'\n'+await read('worker/strength-research.js')+'\n'+await read('worker/method-illustrations.js')+'\n'+await read('worker/funding-ui.js')+'\n'+await read('worker/ux-refinements.js')+'\n'+await read('worker/applied-plan.js')+'\n'+await read('worker/redesign.js')+'\n'+await read('worker/subtraction.js')+'\n'+await read('worker/ph10.js')+'\n'+await read('worker/quant-chat-core.js')+'\n'+await read('worker/quant-chat-ui.js')),
  read('pages-src/data-layer.js'),read('pages-src/quote-layer.js'),read('pages-src/identity-layer.js'),read('pages-src/live-layer.js'),read('gas-src/Code.template.gs')
]);
// The page reads the Pages snapshots directly (CORS is open); google.script.run is only the fallback.
const fallback=`path=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(d=>d&&d.error?reject(Error(d.error)):resolve(d)).withFailureHandler(reject).readSnapshot(path))`;
const cloudSync=await read('pages-src/cloud-sync.js');
const snapshotCache=await read('pages-src/snapshot-cache.js');
const shim=`${snapshotCache}\n${cloudSync}\n${dataLayer}\n${quoteLayer}\n${identityLayer}\n${liveLayer}\nwindow.CHAOWEI_AI_ENDPOINT='https://script.google.com/macros/s/AKfycbwea2kGu7UX0RPfUYW2IaMmtar5_LitJth3mQ_c5uGOtgeihU_nmkM3uNw1CnddLdd6Kw/exec';window.CHAOWEI_STATIC=true;installChaoweiSnapshotCache();window.CHAOWEI_HOST='apps-script';installChaoweiApi('${PAGES_BASE}',${fallback});installChaoweiQuote('');installChaoweiIdentity('apps-script');installChaoweiLive('');\n`;
// HtmlService's inline-JS sanitizer can truncate URL strings after modern template literals.
// Serve the same committed runtime over HTTPS; the content hash prevents stale cross-deployment caches.
const runtime=shim+client.replace('__ENHANCEMENTS__',()=>enhancements),hash=createHash('sha256').update(runtime).digest('hex').slice(0,16);
await mkdir(new URL('docs/',root),{recursive:true});
await writeFile(new URL('docs/gas-runtime.js',root),runtime);
// Immutable filenames keep an older /exec deployment paired with its own runtime.
const filename='gas-runtime-'+hash+'.js';
await writeFile(new URL('docs/'+filename,root),runtime);
let previous=[];try{previous=JSON.parse(await read('docs/gas-runtimes.json'))}catch{}
previous=(await Promise.all(previous.map(async h=>{if(!/^[a-f0-9]{16}$/.test(h))return null;try{await access(new URL('docs/gas-runtime-'+h+'.js',root));return h}catch{return null}}))).filter(Boolean);
// Keep the newest 8 runtimes: a published web-app version still loads its older file until it is
// redeployed, but unbounded retention made every local rebuild add another file to docs/.
// The runtime named by the committed gas/Index.html is what the live deployment loads, so it is always kept,
// even when CI builds (different line endings, different hash) push it out of the newest eight.
let deployed=null;try{deployed=(await read('gas/Index.html')).match(/gas-runtime-([a-f0-9]{16})\.js/)?.[1]||null}catch{}
// A committed runtime may still be referenced by an older published GAS version. Never prune it.
let published=[];try{published=execFileSync('git',['ls-files','docs/gas-runtime-*.js'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).split(/\r?\n/).map(x=>x.match(/gas-runtime-([a-f0-9]{16})\.js$/)?.[1]).filter(Boolean)}catch{}
const keep=[...new Set([hash,...previous.filter(x=>x!==hash&&/^[a-f0-9]{16}$/.test(x)).slice(0,7),...published,deployed].filter(Boolean))];
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
await writeFile(new URL('gas/QuantAi.gs',root),await read('gas-src/QuantAi.gs'));
await writeFile(new URL('gas/appsscript.json',root),JSON.stringify({timeZone:'Asia/Taipei',exceptionLogging:'STACKDRIVER',runtimeVersion:'V8',webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'},oauthScopes:['https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/script.scriptapp']},null,2)+'\n');
console.log('Built Google Apps Script web app');

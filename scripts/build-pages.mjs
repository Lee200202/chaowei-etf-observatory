import {scaleTypography} from './typography-css.mjs';
import {mkdir,readFile,writeFile,copyFile,readdir,rm} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [page,css,client,enhancements,dataLayer,quoteLayer,identityLayer,liveLayer]=await Promise.all([read('worker/page.html'),Promise.all([read('worker/style.css'),read('worker/story.css'),read('worker/research.css'),read('worker/minimal.css'),read('worker/typography.css'),read('worker/visual-metrics.css'),read('worker/research-studio.css')]).then(parts=>scaleTypography(parts.join('\n'))),read('worker/client.js'),read('worker/chart-enhancements.js').then(async s=>s+'\n'+await read('worker/wave-research-core.js')+'\n'+await read('worker/research-extras.js')+'\n'+await read('worker/research-wave-ui.js')+'\n'+await read('worker/tdcc-holders.js')+'\n'+await read('worker/momentum-panel.js')+'\n'+await read('worker/strategy-engine.js')+'\n'+await read('worker/optimizer-worker.js')+'\n'+await read('worker/backtest.js')+'\n'+await read('worker/tour.js')+'\n'+await read('worker/custom.js')+'\n'+await read('worker/analytics.js')+'\n'+await read('worker/novice.js')+'\n'+await read('worker/market-score-core.js')+'\n'+await read('worker/market-factor-config.js')+'\n'+await read('worker/market-extras.js')+'\n'+await read('worker/market-bank.js')+'\n'+await read('worker/chip-weight.js')+'\n'+await read('worker/indicator-direction-core.js')+'\n'+await read('worker/indicator-directions.js')+'\n'+await read('worker/market-layout.js')+'\n'+await read('worker/wave-backtest-bridge.js')+'\n'+await read('worker/chip-resonance.js')+'\n'+await read('worker/measurement-core.js')+'\n'+await read('worker/chart-measurement.js')+'\n'+await read('worker/viewport-core.js')+'\n'+await read('worker/viewport-controller.js')+'\n'+await read('worker/cache-refresh.js')+'\n'+await read('worker/study-layout.js')+'\n'+await read('worker/visual-metrics-core.js')+'\n'+await read('worker/subperiod-charts.js')+'\n'+await read('worker/visual-metrics.js')+'\n'+await read('worker/training-core.js')+'\n'+await read('worker/training-ui.js')+'\n'+await read('worker/daily-score.js')+'\n'+await read('worker/experience.js')+'\n'+await read('worker/page-navigation.js')),read('pages-src/data-layer.js'),read('pages-src/quote-layer.js'),read('pages-src/identity-layer.js'),read('pages-src/live-layer.js')]);
const GAS_URL='https://script.google.com/macros/s/AKfycbwea2kGu7UX0RPfUYW2IaMmtar5_LitJth3mQ_c5uGOtgeihU_nmkM3uNw1CnddLdd6Kw/exec';
const cloudSync=await read('pages-src/cloud-sync.js');
const snapshotCache=await read('pages-src/snapshot-cache.js');
const shim=`${snapshotCache}\n${cloudSync}\n${dataLayer}\n${quoteLayer}\n${identityLayer}\n${liveLayer}\nwindow.CHAOWEI_STATIC=true;installChaoweiSnapshotCache();installChaoweiApi('./');installChaoweiQuote('${GAS_URL}');installChaoweiIdentity('pages');installChaoweiLive('${GAS_URL}');\n`;
const html=page.replace('__CSS__',()=>css).replace('__JS__',()=>shim+client.replace('__ENHANCEMENTS__',()=>enhancements));
await mkdir(new URL('docs/data/history/',root),{recursive:true});
await writeFile(new URL('docs/index.html',root),html);
await writeFile(new URL('docs/.nojekyll',root),'');
await copyFile(new URL('worker/etf-catalog.json',root),new URL('docs/etf-catalog.json',root));
// pages-data keeps the full append-only history; the browser copy carries the last 2,700 days (over ten years).
for(const file of ['brent.json','oil-spot.json','fx.json']){const d=JSON.parse(await read(`pages-data/${file}`));d.days=d.days.slice(-2700);await writeFile(new URL(`docs/data/${file}`,root),JSON.stringify(d)+'\n')}
await mkdir(new URL('docs/data/chips/',root),{recursive:true});
const chipSrc=new URL('pages-data/chips/',root),chipDst=new URL('docs/data/chips/',root);
const chipFiles=new Set((await readdir(chipSrc).catch(()=>[])).filter(file=>/^[0-9A-Z]{4,6}\.json$/.test(file)));
for(const file of await readdir(chipDst))if(!chipFiles.has(file))await rm(new URL(file,chipDst));
for(const file of chipFiles)await copyFile(new URL(file,chipSrc),new URL(file,chipDst));
// Today's radar summary is derived from the history files, so it is rebuilt on every deploy.
const {buildRadar}=await import('./build-radar.mjs');await buildRadar();
// Long history: mirror pages-data/history into docs/data/history (stale files removed).
const src=new URL('pages-data/history/',root),dst=new URL('docs/data/history/',root);
const wanted=new Set((await readdir(src).catch(()=>[])).filter(f=>f.endsWith('.json')));
for(const f of await readdir(dst))if(!wanted.has(f))await rm(new URL(f,dst));
for(const f of wanted)await copyFile(new URL(f,src),new URL(f,dst));
console.log(`Built GitHub Pages website with ${wanted.size} history files and ${chipFiles.size} ETF chip files`);

await mkdir(new URL('docs/assets/',root),{recursive:true});for(const file of await readdir(new URL('worker/assets/',root)))if(!file.includes('-v1.'))await copyFile(new URL('worker/assets/'+file,root),new URL('docs/assets/'+file,root));
for(const file of await readdir(new URL('docs/assets/',root)))if(file.endsWith('-v1.webp'))await rm(new URL('docs/assets/'+file,root));

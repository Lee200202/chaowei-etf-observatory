import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const [page,css,client,enhancements,backend,catalog,brent]=await Promise.all([
  read('worker/page.html'),read('worker/style.css'),read('worker/client.js'),read('worker/chart-enhancements.js'),
  read('gas-src/Code.template.gs'),read('worker/etf-catalog.json'),read('worker/brent-snapshot.json')
]);
const shim=`const nativeFetch=window.fetch.bind(window);window.fetch=(input,options)=>{const url=new URL(input,location.href);if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(data=>resolve({ok:!data.error,status:data.error?503:200,json:async()=>data})).withFailureHandler(reject).api(url.pathname,Object.fromEntries(url.searchParams)));};`;
const html=page.replace('__CSS__',css).replace('__JS__',shim+client.replace('__ENHANCEMENTS__',enhancements));
const code=backend.replace('__CATALOG__',JSON.stringify(JSON.parse(catalog))).replace('__BRENT__',JSON.stringify(JSON.parse(brent)));
await mkdir(new URL('gas/',root),{recursive:true});
await writeFile(new URL('gas/Index.html',root),html);
await writeFile(new URL('gas/Code.gs',root),code);
await writeFile(new URL('gas/appsscript.json',root),JSON.stringify({timeZone:'Asia/Taipei',exceptionLogging:'STACKDRIVER',runtimeVersion:'V8',webapp:{access:'ANYONE_ANONYMOUS',executeAs:'USER_DEPLOYING'},oauthScopes:['https://www.googleapis.com/auth/script.external_request']},null,2)+'\n');
console.log('Built Google Apps Script web app');

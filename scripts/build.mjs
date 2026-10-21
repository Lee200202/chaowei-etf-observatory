import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [template,css,client,enhancements,worker,manifest,brent,catalog]=await Promise.all([
  read('worker/page.html'),Promise.all([read('worker/style.css'),read('worker/story.css')]).then(parts=>parts.join('\n')),read('worker/client.js'),Promise.all([read('worker/chart-enhancements.js'),read('worker/experience.js')]).then(parts=>parts.join('\n')),read('worker/index.js'),read('.openai/hosting.json'),read('worker/brent-snapshot.json'),read('worker/etf-catalog.json')
]);
if(!template.includes('__CSS__')||!template.includes('__JS__')||!client.includes('__ENHANCEMENTS__')||!worker.includes('__PAGE__')||!worker.includes('__BRENT__')||!worker.includes('__CATALOG__'))throw Error('Missing build placeholder');
const page=template.replace('__CSS__',css).replace('__JS__',client.replace('__ENHANCEMENTS__',enhancements));
const output=worker.replace('__PAGE__',JSON.stringify(page)).replace('__BRENT__',JSON.stringify(JSON.parse(brent))).replace('__CATALOG__',JSON.stringify(JSON.parse(catalog)));
await mkdir(new URL('dist/server/',root),{recursive:true});
await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),output);
await writeFile(new URL('dist/.openai/hosting.json',root),manifest);
console.log('Built Worker with inlined HTML, CSS, and JS');

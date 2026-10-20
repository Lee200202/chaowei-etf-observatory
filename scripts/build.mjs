import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [template,css,client,worker,manifest]=await Promise.all([
  read('worker/page.html'),read('worker/style.css'),read('worker/client.js'),read('worker/index.js'),read('.openai/hosting.json')
]);
if(!template.includes('__CSS__')||!template.includes('__JS__')||!worker.includes('__PAGE__'))throw Error('Missing build placeholder');
const page=template.replace('__CSS__',css).replace('__JS__',client);
const output=worker.replace('__PAGE__',JSON.stringify(page));
await mkdir(new URL('dist/server/',root),{recursive:true});
await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),output);
await writeFile(new URL('dist/.openai/hosting.json',root),manifest);
console.log('Built Worker with inlined HTML, CSS, and JS');

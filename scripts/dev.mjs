import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
let stamp=0,worker;
async function current(){
  const files=['worker/index.js','worker/page.html','worker/style.css','worker/story.css','worker/client.js','worker/experience.js','worker/brent-snapshot.json'];
  const all=await Promise.all(files.map(async p=>(await import('node:fs/promises')).stat(resolve(root,p))));
  const latest=Math.max(...all.map(s=>s.mtimeMs));
  if(!worker||latest>stamp){execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root});worker=(await import(pathToFileURL(resolve(root,'dist/server/index.js')).href+'?t='+Date.now())).default;stamp=latest}
  return worker;
}
const server=createServer(async(req,res)=>{
  try{const w=await current(),url='http://127.0.0.1:4173'+req.url,response=await w.fetch(new Request(url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}
  catch(e){res.writeHead(500);res.end(e.stack||String(e))}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173/'));

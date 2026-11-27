import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
for(const name of await readdir('scripts')){
  if(!name.endsWith('.mjs'))continue;
  const r=spawnSync(process.execPath,['--check','scripts/'+name],{encoding:'utf8'});
  if(r.status!==0)throw Error(name+'\n'+r.stderr);
}
for(const name of await readdir('gas-src')){
  if(name.endsWith('.gs'))new vm.Script(await readFile('gas-src/'+name,'utf8'),{filename:name});
}
await import('./test-action-health.mjs');
await import('./test-market-session-health.mjs');
console.log('Pipeline JavaScript / Apps Script syntax passed');

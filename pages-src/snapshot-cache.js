// Public market snapshots only. Identity, tokens and intraday quotes never enter this database.
function installChaoweiSnapshotCache(){
  const memory=new Map(),pending=new Map(),checked=new Map();let database,lastPrune=0;
  const stats={hits:0,network:0,lastSource:'',lastMs:0,background:'',storage:'opening'};
  function open(){if(!database)database=new Promise(resolve=>{try{const r=indexedDB.open('chaowei-public-snapshots',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'path'});r.onsuccess=()=>{stats.storage='ready';resolve(r.result)};r.onerror=r.onblocked=()=>{stats.storage='unavailable';resolve(null)}}catch{stats.storage='unavailable';resolve(null)}});return database}
  async function read(path){const begun=performance.now();return Promise.race([(async()=>{const db=await open();if(!db)return null;return new Promise(resolve=>{try{const r=db.transaction('snapshots').objectStore('snapshots').get(path);r.onsuccess=()=>{emit('chaowei-cache-storage',{path,read:r.result?'hit':'miss',ms:performance.now()-begun});resolve(r.result||null)};r.onerror=()=>{emit('chaowei-cache-storage',{path,read:'error'});resolve(null)}}catch{resolve(null)}})})(),new Promise(resolve=>setTimeout(()=>resolve(null),300))]).then(record=>{stats.lastMs=performance.now()-begun;return record})}
  async function store(record){const db=await open();if(!db)return;try{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(record);tx.onerror=()=>{stats.background='本機快取未寫入，行情仍可使用'};
    // Prune once in the background, rather than copying every stored snapshot on every write.
    if(Date.now()-lastPrune>300000){lastPrune=Date.now();setTimeout(()=>{try{const s=db.transaction('snapshots','readwrite').objectStore('snapshots'),r=s.getAll();r.onsuccess=()=>{const all=r.result.sort((a,b)=>b.at-a.at);let bytes=0;for(let i=0;i<all.length;i++){bytes+=all[i].bytes||0;if(i>=60||bytes>20*1024*1024)s.delete(all[i].path)}}}catch{}},1000)}
  }catch{}}
  const emit=(type,detail)=>window.dispatchEvent(new CustomEvent(type,{detail}));
  function revalidate(path,fetcher){
    if(pending.has(path))return pending.get(path);if(Date.now()-(checked.get(path)||0)<300000&&memory.has(path))return Promise.resolve(memory.get(path));
    const task=(async()=>{try{const data=await fetcher();if(!data||data.error)throw Error(data?.error||'空白資料');const signature=JSON.stringify(data),old=memory.get(path),changed=old&&old.signature!==signature,record={path,data,signature,bytes:signature.length*2,at:Date.now()};memory.set(path,record);checked.set(path,Date.now());stats.network++;stats.background='已核對';store(record);emit('chaowei-cache-status',{path,source:'network',checked:true});if(changed)emit('chaowei-snapshot-updated',{path});return record}catch(e){stats.background='背景核對未完成，沿用標示日期的快取';emit('chaowei-cache-status',{path,source:'stale',error:true});throw e}finally{pending.delete(path)}})();pending.set(path,task);return task;
  }
  async function load(path,fetcher){
    const begun=performance.now();let record=memory.get(path),source='memory',failed=false;
    if(record)revalidate(path,fetcher).catch(()=>{});
    else{
      // Start both immediately: slow or blocked IndexedDB must not delay a faster network response.
      const disk=read(path).then(record=>{if(!record)throw Error('cache miss');if(!memory.has(path))memory.set(path,record);return{record,source:'indexeddb'}});
      const network=revalidate(path,fetcher).then(record=>({record,source:'network'})).catch(e=>{failed=true;throw e});
      try{({record,source}=await Promise.any([disk,network]))}catch(e){throw e.errors?.at(-1)||e}
    }
    stats.lastSource=source;stats.lastMs=performance.now()-begun;if(source!=='network')stats.hits++;emit('chaowei-cache-status',{path,source:failed?'stale':source,readSource:source,ms:stats.lastMs,storage:stats.storage});
    return source==='network'?record.data:{...record.data,_snapshotCache:{source,at:record.at}};
  }
  window.CHAOWEI_SNAPSHOT_CACHE={load,stats};
}

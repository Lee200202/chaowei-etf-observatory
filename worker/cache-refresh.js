(()=>{
  const note=document.createElement('p');note.className='small cache-note';note.id='cacheState';$('historyNote').after(note);
  window.addEventListener('chaowei-cache-storage',e=>{if(e.detail.path===`data/history/${selected}.json`){note.dataset.databaseRead=e.detail.read;if(e.detail.ms!=null)note.dataset.databaseMs=e.detail.ms.toFixed(2)}});
  window.addEventListener('chaowei-cache-status',e=>{const d=e.detail;if(d.path!==`data/history/${selected}.json`)return;note.textContent=d.source==='stale'?'背景核對未完成，沿用上方標示日期的歷史資料。':d.source==='network'?'歷史快照已核對；盤中報價另行更新。':'先顯示本機歷史快取，背景核對最新快照。';note.dataset.source=d.source;if(d.ms!=null){note.dataset.readMs=d.ms.toFixed(2);note.dataset.readSource=d.readSource||d.source}if(d.storage)note.dataset.storage=d.storage});
  const timers=new Map();
  function refresh(path){clearTimeout(timers.get(path));timers.set(path,setTimeout(()=>{if(path===`data/history/${selected}.json`)loadBars(true);else if(path==='data/history/market.json')loadMarket();else if(path==='data/oil-spot.json')loadBrent();else if(path==='data/fx.json')loadFx();else if(path==='data/history/margin.json')loadMktMargin();else if(path==='data/history/histock-bank.json')loadBanks();else if(path==='etf-catalog.json')fetch('/api/etfs').then(r=>r.json()).then(d=>{if(d.etfs?.length){catalog=d.etfs;renderList()}}).catch(()=>{})},0))}
  window.addEventListener('chaowei-snapshot-updated',e=>refresh(e.detail.path));window.addEventListener('chaowei-history-live',e=>{if(e.detail.code===selected)refresh(`data/history/${selected}.json`)});
})();

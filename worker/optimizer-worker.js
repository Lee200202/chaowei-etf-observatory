function optimizerBatch(engine,ctx,candidates,start,end,onProgress){
  const rows=[],begun=performance.now();let dcaRef=null;
  for(let i=0;i<candidates.length;i++){const c=candidates[i],r=engine.run(ctx,c.cfg,start,end);dcaRef=dcaRef||{monthly:r.monthly,xirr:r.dca.xirr,mdd:r.dca.mdd,cagr:r.dca.cagr};rows.push({p:c.p,w:c.w,usesWater:c.usesWater,r:{monthly:r.monthly,xirr:r.xirr,cagr:r.cagr,annual:r.monthly?r.xirr:r.cagr,mdd:r.mdd,calmar:r.calmar,dca:{xirr:r.dca.xirr,cagr:r.dca.cagr}}});if(i%3===0||i===candidates.length-1)onProgress?.(i+1,candidates.length)}
  return{rows,dcaRef,computeMs:performance.now()-begun};
}
function createOptimizerRunner(){
  let worker=null,rejectCurrent=null,generation=0;const memo=new Map();
  function aborted(){const e=Error('cancelled');e.name='AbortError';return e}
  function cancel(){generation++;worker?.terminate();worker=null;if(rejectCurrent){rejectCurrent(aborted());rejectCurrent=null}}
  async function run(key,ctx,candidates,start,end,progress){
    const begun=performance.now();cancel();const mine=generation;if(memo.has(key))return{...memo.get(key),executor:'memory',elapsedMs:performance.now()-begun};
    let result;
    try{
      const src='const E=('+createChaoweiEngine.toString()+')();const batch='+optimizerBatch.toString()+';onmessage=e=>{try{const d=e.data;const result=batch(E,d.ctx,d.candidates,d.start,d.end,(done,total)=>postMessage({progress:{done,total}}));postMessage({result})}catch(e){postMessage({error:e.message})}}';
      const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));try{worker=new Worker(url)}finally{URL.revokeObjectURL(url)}
      result=await new Promise((resolve,reject)=>{rejectCurrent=reject;worker.onmessage=e=>{if(e.data.progress)progress?.(e.data.progress.done,e.data.progress.total);if(e.data.error)reject(Error(e.data.error));if(e.data.result)resolve({...e.data.result,executor:'worker'})};worker.onerror=e=>reject(Error(e.message||'worker unavailable'));worker.postMessage({ctx,candidates,start,end})});
    }catch(e){if(e.name==='AbortError'||mine!==generation)throw aborted();worker?.terminate();worker=null;const rows=[];let dcaRef=null;const t=performance.now();for(let i=0;i<candidates.length;i++){if(mine!==generation)throw aborted();const one=optimizerBatch(E,ctx,[candidates[i]],start,end);rows.push(...one.rows);dcaRef=dcaRef||one.dcaRef;progress?.(i+1,candidates.length);await new Promise(resolve=>setTimeout(resolve,0))}if(mine!==generation)throw aborted();result={rows,dcaRef,executor:'chunked',computeMs:performance.now()-t}}
    finally{if(mine===generation){rejectCurrent=null;worker?.terminate();worker=null}}
    result.elapsedMs=performance.now()-begun;memo.set(key,result);if(memo.size>4)memo.delete(memo.keys().next().value);return result;
  }
  return{run,cancel};
}
const OptimizerRunner=createOptimizerRunner();

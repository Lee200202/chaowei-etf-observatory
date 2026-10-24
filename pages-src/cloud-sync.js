// Firestore rejects undefined fields. Clean only the user's plain settings before adding serverTimestamp().
function sanitizeCloudPayload(value){
  const path=new WeakSet();
  function clean(x,depth=0){
    if(x===undefined||typeof x==='function'||typeof x==='symbol'||depth>30)return undefined;
    if(x===null||typeof x==='string'||typeof x==='boolean')return x;
    if(typeof x==='number')return Number.isFinite(x)?x:null;
    if(x instanceof Date)return Number.isFinite(x.getTime())?x.toISOString():null;
    if(typeof x!=='object'||path.has(x))return undefined;
    path.add(x);let out;
    if(Array.isArray(x))out=x.map(v=>clean(v,depth+1)??null);
    else{out={};for(const[k,v]of Object.entries(x)){if(!k.trim()||['__proto__','prototype','constructor'].includes(k))continue;const y=clean(v,depth+1);if(y!==undefined)out[k]=y}}
    path.delete(x);return out;
  }
  return clean(value)??null;
}

/* TAIFEX sentiment maths for the PCR and retail long/short cards: rows, ranges, position zones and readings. */
const SentimentCore=(()=>{
  const RANGES=[['2w','兩週',{rows:10}],['1m','1 個月',{months:1}],['3m','3 個月',{months:3}],['6m','6 個月',{months:6}],['1y','1 年',{months:12}],['3y','3 年',{months:36}]];
  // Files store counts; ratios are recomputed here so the card, gauge and charts agree to the last digit.
  function pcrRows(file){
    return(file?.days||[]).filter(r=>Array.isArray(r)&&r[2]>0&&r[4]>0).map(([date,putVol,callVol,putOi,callOi])=>({date,putVol,callVol,putOi,callOi,oiRatio:putOi/callOi*100,volRatio:putVol/callVol*100,value:putOi/callOi*100}));
  }
  function retailRows(file){
    return(file?.days||[]).filter(r=>Array.isArray(r)&&r[1]>0).map(([date,oi,long,short])=>({date,oi,long,short,net:long-short,ratio:(short-long)/oi*100,value:(short-long)/oi*100}));
  }
  // Newer rows (a live bundle) replace older ones by date.
  function merge(rows,more){const m=new Map(rows.map(r=>[r.date,r]));for(const r of more||[])m.set(r.date,r);return[...m.values()].sort((a,b)=>a.date<b.date?-1:1)}
  function range(rows,id){
    const spec=(RANGES.find(r=>r[0]===id)||RANGES[2])[2];if(!rows.length)return[];
    if(spec.rows)return rows.slice(-spec.rows);
    const d=new Date(rows.at(-1).date+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-spec.months);const from=d.toISOString().slice(0,10);
    return rows.filter(r=>r.date>from);
  }
  // Where the latest value sits between the range's low and high, split into thirds.
  function zone(values){
    const a=values.filter(Number.isFinite);if(!a.length)return null;
    const last=a.at(-1),low=Math.min(...a),high=Math.max(...a),pos=high>low?(last-low)/(high-low):.5;
    return{last,low,high,pos,mean:a.reduce((s,x)=>s+x,0)/a.length,segment:pos<1/3?'low':pos>2/3?'high':'mid',label:pos<1/3?'偏低段':pos>2/3?'偏高段':'中段'};
  }
  const pct=v=>(Math.round(v*100)/100).toFixed(2)+'%',lots=v=>Math.round(v).toLocaleString('zh-TW')+' 口',signed=(v,f)=>(v>0?'+':v<0?'−':'')+f(Math.abs(v));
  // threshold: 'user' compares with the reader's threshold, 'zero' with zero, 'mean' with the range average.
  const METRICS={
    pcr:[
      {id:'oiRatio',label:'未平倉 PCR',long:'賣權買權未平倉比率',unit:'%',format:pct,threshold:'user',reading:{
        low:'未平倉 PCR 位於所選區間偏低段，表示賣權未平倉相對偏少，避險部位偏低，情緒面偏向空方。台指選擇權的賣權多由賣方（常見為法人）建立，賣權少代表下方支撐相對薄弱。',
        mid:'未平倉 PCR 位於所選區間中段，賣權與買權未平倉大致均衡，情緒面中性，宜搭配指數走勢與其他刻度一起看。',
        high:'未平倉 PCR 位於所選區間偏高段，表示賣權未平倉相對偏多，賣方在下方累積較多支撐，情緒面偏向多方；若指數同時急跌，也可能是避險需求升高，宜搭配指數走勢判讀。'}},
      {id:'volRatio',label:'成交量 PCR',long:'賣權買權成交量比率',unit:'%',format:pct,threshold:'user',reading:{
        low:'成交量 PCR 位於偏低段，當天買權成交明顯多於賣權，短線追價氣氛較濃。成交量只反映當天進出，起伏較大，宜看連續幾天。',
        mid:'成交量 PCR 位於中段，買賣權成交大致均衡，短線情緒中性。',
        high:'成交量 PCR 位於偏高段，當天賣權成交相對活躍，短線避險或看空交易增加。成交量只反映當天進出，起伏較大，宜看連續幾天。'}},
      {id:'putOi',label:'賣權未平倉',long:'賣權未平倉口數',unit:'口',format:lots,threshold:'mean',reading:{
        low:'賣權未平倉口數位於偏低段，下方的賣方部位相對較少，指數下跌時的支撐偏弱。',
        mid:'賣權未平倉口數位於中段，下方支撐與平常相當。',
        high:'賣權未平倉口數位於偏高段，賣方在下方累積較多部位，常被視為支撐增強。'}},
      {id:'callOi',label:'買權未平倉',long:'買權未平倉口數',unit:'口',format:lots,threshold:'mean',reading:{
        low:'買權未平倉口數位於偏低段，上方的買權賣方部位相對較少，上檔壓力較輕。',
        mid:'買權未平倉口數位於中段，上檔壓力與平常相當。',
        high:'買權未平倉口數位於偏高段，上方壓力相對較重，指數上攻時可能遇到賣壓。'}}
    ],
    retail:[
      {id:'ratio',label:'散戶多空比',long:'小台散戶多空比',unit:'%',format:v=>signed(v,pct),threshold:'user',reading:{
        low:'散戶多空比位於所選區間偏低段，小台散戶偏空、三大法人相對偏多，市場常把它當作反向的偏多訊號。',
        mid:'散戶多空比位於所選區間中段，散戶多空部位沒有明顯偏向，情緒面中性。',
        high:'散戶多空比位於所選區間偏高段，小台散戶淨多單偏多、三大法人相對偏空，市場常把它當作反向的偏空訊號：散戶追多時，行情較容易震盪或回檔。'}},
      {id:'net',label:'法人淨部位',long:'三大法人小台淨部位',unit:'口',format:v=>signed(v,lots),threshold:'zero',reading:{
        low:'三大法人小台淨部位位於偏低段（偏空），散戶相對偏多。',
        mid:'三大法人小台淨部位位於中段，法人沒有明顯偏向。',
        high:'三大法人小台淨部位位於偏高段（偏多），散戶相對偏空。'}},
      {id:'oi',label:'小台未平倉',long:'小台全市場未平倉口數',unit:'口',format:lots,threshold:'mean',reading:{
        low:'小台全市場未平倉位於偏低段，參與者觀望，部位較輕。',
        mid:'小台全市場未平倉位於中段，參與程度與平常相當。',
        high:'小台全市場未平倉位於偏高段，參與與槓桿部位偏多，後續波動可能放大。'}}
    ]
  };
  function metric(key,id){const list=METRICS[key]||[];return list.find(m=>m.id===id)||list[0]}
  function reading(key,id,z){if(!z)return'資料不足，暫不判讀。';return metric(key,id).reading[z.segment]}
  // The bar colour: red at or above the line, green below (Taiwan colours). 'mean' uses the range average.
  function line(m,values,userThreshold){return m.threshold==='zero'?0:m.threshold==='mean'?values.reduce((s,x)=>s+x,0)/Math.max(1,values.length):userThreshold}
  function side(value,threshold){return value>=threshold?'rise':'fall'}
  return{RANGES,METRICS,pcrRows,retailRows,merge,range,zone,metric,reading,line,side};
})();

/* ---------- Strategy backtest panel (uses ChaoweiEngine from strategy-engine.js) ---------- */
const E=ChaoweiEngine;
const BT_DEFAULT={v:3,family:'dca',preset:'smartDca',strategy:'smart_dca_water',params:{...E.PARAMS.smart_dca_water},
  ref:{window:'240',anchorMode:'wick',anchorCount:5,method:'equal'},capital:1200000,dcaPeriods:12,period:'5',
  fee:0.1425,discount:100,tax:0.1,parking:1.5,drip:true,wholeShares:false,markers:true};
// v2 stored the classic builder's fields at the top level; keep the user's swing settings.
function btMigrate(b){
  if(b&&b.v===3)return{...BT_DEFAULT,...b,ref:{...BT_DEFAULT.ref,...b.ref},params:{...E.PARAMS[b.strategy]||{},...b.params}};
  const out={...BT_DEFAULT,ref:{...BT_DEFAULT.ref,window:settings.window||'240',anchorMode:settings.anchorMode||'wick',anchorCount:settings.anchorCount||5,method:settings.method||'equal'}};
  if(b&&typeof b==='object'&&(b.v===2||b.mode)){
    const keys=['entry','drop','levels','buyGrade','step','adds','exit','rise','sellGrade','fibExt','stop','maxDays'],params={...E.PARAMS.classic};
    for(const k of keys)if(b[k]!=null)params[k]=b[k];if(b.mode==='fib'){params.entry='fib';params.exit='fibext';params.fibExt=b.fibSell||1}
    Object.assign(out,{family:'swing',preset:'custom',strategy:'classic',params,period:b.period||'5',fee:b.fee??out.fee,discount:b.discount??out.discount,tax:b.tax??out.tax,wholeShares:!!b.wholeShares,markers:b.markers!==false});
    if(b.window)out.ref={window:String(b.window),anchorMode:b.anchorMode||'wick',anchorCount:b.anchorCount||5,method:b.method||'equal'};
  }
  return out;
}
settings.bt=btMigrate(settings.bt);
var btResult=null,btBarsRef=null,btCtx=null,btDivs=null,btTimer=0,btCharts=null,btTradeFilter='all',btSeq=0;
const clampNum=(v,lo,hi,d)=>{const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d};

/* Parameter fields per strategy: [key,label,type,extra,visible(params)]. */
const GRADE_OPTS=[['5','5 分（區間最低處）'],['4','4 分以上'],['3','3 分以上']];
const BT_SCHEMA={
  classic:[['entry','買進條件','select',[['drop','自區間高點下跌'],['fib','回檔到黃金分割位階'],['grade','水位分數達到']]],
    ['drop','下跌幅度','num',{min:1,max:90,step:1,unit:'%'},p=>p.entry==='drop'],['levels','買進位階','levels',null,p=>p.entry==='fib'],
    ['buyGrade','水位分數','select',GRADE_OPTS,p=>p.entry==='grade'],['step','每再跌','num',{min:1,max:50,step:1,unit:'%'},p=>p.entry!=='fib'],
    ['adds','加碼最多','num',{min:0,max:10,step:1,unit:'次'},p=>p.entry!=='fib'],
    ['exit','賣出條件','select',[['gain','自平均成本上漲'],['high','突破進場前高點'],['grade','水位分數回到'],['fibext','黃金分割擴展位'],['trailing','移動停利（不設高點）'],['pyramid','分批停利＋留底倉']]],
    ['rise','幅度','num',{min:0,max:300,step:1,unit:'%'},p=>['gain','high','pyramid'].includes(p.exit)],['sellGrade','水位分數','select',[['1','1 分（區間最高處）'],['2','2 分以下']],p=>p.exit==='grade'],
    ['fibExt','位置','select',[['1','區間高點（100%）'],['1.272','127.2%'],['1.618','161.8%']],p=>p.exit==='fibext'],
    ['trail','自高點回落','num',{min:2,max:40,step:1,unit:'%'},p=>p.exit==='trailing'],['atrMult','吊燈 ATR 倍數','num',{min:0,max:6,step:0.5,unit:'倍'},p=>p.exit==='trailing'],
    ['stop','停損','num',{min:0,max:90,step:1,unit:'%'}],['maxDays','最長持有','num',{min:0,max:2400,step:10,unit:'日'}]],
  dca:[],
  smart_dca_water:[['mult','各水位扣款倍數（1→5 分）','array5',{step:0.1}],['trim','高檔減碼','check'],['trimBias','MA60 乖離超過','num',{min:5,max:60,step:1,unit:'%'},p=>p.trim],['trimPct','減碼比例','num',{min:5,max:50,step:5,unit:'%'},p=>p.trim]],
  value_averaging:[['growth','目標市值月成長','num',{min:0,max:3,step:0.1,unit:'%'}],['cap','單月最多投入','num',{min:1,max:10,step:0.5,unit:'倍'}],['allowSell','超出目標時賣出','check']],
  bias_tiered_dca:[['tiers','扣款倍數：乖離 >15%、−5~15%、−10~−5%、−15~−10%、<−15%','array5',{step:0.1}]],
  tech_bb_rsi_dca:[['baseRatio','每月底倉比例','num',{min:0,max:1,step:0.1,unit:'倍'}],['dipMult','超賣加碼','num',{min:0.5,max:5,step:0.5,unit:'倍'}],['pbLow','%B 低於','num',{min:-0.5,max:0.5,step:0.05}],['rsiLow','RSI 低於','num',{min:10,max:50,step:1}],['pbHigh','%B 高於','num',{min:0.8,max:1.5,step:0.05}],['rsiHigh','RSI 高於','num',{min:60,max:95,step:1}],['trimPct','過熱減碼','num',{min:0,max:50,step:5,unit:'%'}]],
  core_satellite:[['core','核心比例','num',{min:10,max:90,step:5,unit:'%'}],['satGrade','衛星進場水位','select',GRADE_OPTS],['step','衛星再跌加碼','num',{min:1,max:30,step:1,unit:'%'}],['trail','衛星自高點回落出場','num',{min:2,max:40,step:1,unit:'%'}]],
  rebalance_50_50:[['weight','目標持股比例','num',{min:10,max:90,step:5,unit:'%'}],['band','偏離多少再平衡','num',{min:2,max:30,step:1,unit:'%'}]],
  dual_momentum:[['minScore','另需水位分數至少','num',{min:0,max:4,step:0.5,unit:'分'}]],
  macro_regime:[['pullback','多頭：回落多少買','num',{min:2,max:20,step:1,unit:'%'}],['trail','多頭：自高點回落賣','num',{min:3,max:30,step:1,unit:'%'}],['stop','空頭：停損','num',{min:5,max:40,step:1,unit:'%'}],['macroFilter','原油與匯率濾網','check'],['macroMin','濾網最低分','num',{min:0,max:4,step:0.5,unit:'分'},p=>p.macroFilter]],
  vol_targeting:[['target','目標年化波動','num',{min:5,max:60,step:1,unit:'%'}],['minW','最低持股','num',{min:0,max:80,step:5,unit:'%'}],['band','偏離多少調整','num',{min:2,max:30,step:1,unit:'%'}]],
  bb_squeeze:[['squeeze','帶寬低於近 120 日','num',{min:5,max:40,step:1,unit:'% 分位'}],['volume','突破時需放量','check']]
};
const BT_EXPLAIN={
  classic:'在區間低處分批買進，依設定賣出；沒有部位時現金停泊',dca:'每月固定金額買進，作為比較基準',
  smart_dca_water:'每月扣款，依水位分數放大或縮小金額；扣不完的錢留作下次加碼',value_averaging:'讓持股市值照目標曲線成長，跌深多買、漲多少買或賣出',
  bias_tiered_dca:'依股價與 MA60 的乖離決定每月扣款倍數',tech_bb_rsi_dca:'每月小額底倉，超賣（%B、RSI 偏低）時加碼，過熱時小幅減碼',
  core_satellite:'核心每月潮位定投不賣出，衛星資金在低水位進場、移動停利出場',rebalance_50_50:'維持固定持股比例，偏離時高賣低買',
  dual_momentum:'近 60／120 日報酬為正且站上 MA120 時滿倉，轉弱時改持現金',macro_regime:'依 MA200 判斷多空：多頭淺回檔買、空頭只在水位 5 分買',
  vol_targeting:'波動低時提高持股、波動放大時降低持股',bb_squeeze:'布林帶寬壓縮後突破上軌才買進，跌破 MA20 賣出'
};

/* ---------- context: daily bars + split-adjusted dividends + macro score ---------- */
async function btEnsureDividends(){if(btDivs)return btDivs;try{const r=await fetch('/api/dividends'),d=await r.json();btDivs=r.ok?d.events||{}:{}}catch{btDivs={}}return btDivs}
function btMacro(){
  // Average of the oil score (cheaper = higher) and the USD/TWD score (user's direction), on each bar's date.
  if(!brent.length||!fx.length)return null;
  const series=(list,flip)=>{const out=new Map();for(let k=0;k<list.length;k++){const s=Math.max(0,k-240),w=list.slice(s,k);if(w.length<40)continue;const lo=Math.min(...w.map(x=>x.value)),hi=Math.max(...w.map(x=>x.value));if(hi>lo){const r=(list[k].value-lo)/(hi-lo);out.set(list[k].date,5*(1-(flip?1-r:r)))}}return out};
  const oil=series(brent,false),cur=series(fx,settings.fxDirection==='high'),dates=bars.map(b=>b.date),pick=(m,keys)=>{let v=null,j=0;return d=>{while(j<keys.length&&keys[j]<=d){v=m.get(keys[j]);j++}return v}};
  const po=pick(oil,[...oil.keys()].sort()),pf=pick(cur,[...cur.keys()].sort());
  return dates.map(d=>{const a=po(d),b=pf(d);return a==null||b==null?NaN:(a+b)/2});
}
function btContext(){
  if(btCtx&&btCtx.bars===bars)return btCtx;
  const adj=historyMeta?.adjustments||[],div=(btDivs?.[selected]||[]).map(([date,v])=>{let f=1;for(const a of adj)if(date<a.date)f*=a.factor;return[date,v/f]});
  btCtx=E.prepare(bars,div,btMacro());btCtx.bars=bars;return btCtx;
}
function btStart(period){if(period==='all')return 0;const d=new Date(bars.at(-1).date+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-Number(period));const i=bars.findIndex(b=>b.date>=d.toISOString().slice(0,10));return i<0?0:i}
const btCfg=(over={})=>{const b=settings.bt;return{ref:{...b.ref},capital:b.capital,dcaPeriods:b.dcaPeriods,fee:b.fee,discount:b.discount,tax:b.tax,parking:b.parking,drip:b.drip,wholeShares:b.wholeShares,strategy:b.strategy,params:{...b.params},...over}};

/* ---------- form ---------- */
function btFieldHtml([key,label,type,extra,visible],p){
  const hide=visible&&!visible(p)?' hidden':'';
  if(type==='select')return `<label class="bt-f${hide}">${label}<select data-k="${key}">${extra.map(([v,t])=>`<option value="${v}"${String(p[key])===v?' selected':''}>${t}</option>`).join('')}</select></label>`;
  if(type==='check')return `<label class="bt-check${hide}"><input type="checkbox" data-k="${key}"${p[key]?' checked':''}>${label}</label>`;
  if(type==='levels')return `<fieldset class="bt-levels${hide}"><legend>${label}</legend>${[0.236,0.382,0.5,0.618,0.786].map(v=>`<label><input type="checkbox" data-level="${v}"${p.levels.includes(v)?' checked':''}>${(v*100).toFixed(1).replace('.0','')}%</label>`).join('')}</fieldset>`;
  if(type==='array5')return `<fieldset class="bt-array${hide}"><legend>${label}</legend>${p[key].map((v,i)=>`<input type="number" data-arr="${key}" data-i="${i}" value="${v}" step="${extra.step}" min="0" max="10" aria-label="${label} 第 ${i+1} 項">`).join('')}</fieldset>`;
  return `<label class="bt-f${hide}">${label}<span class="bt-num"><input type="number" data-k="${key}" value="${p[key]}" min="${extra.min}" max="${extra.max}" step="${extra.step}" inputmode="decimal">${extra.unit?`<em>${extra.unit}</em>`:''}</span></label>`;
}
function btRenderParams(){
  const b=settings.bt,schema=BT_SCHEMA[b.strategy]||[];
  $('btParams').innerHTML=(schema.length?schema.map(f=>btFieldHtml(f,b.params)).join(''):'')+`<p class="bt-hint">${BT_EXPLAIN[b.strategy]||''}</p>`;
}
function btFillForm(){
  const b=settings.bt;
  if(!$('btWindow').options.length){$('btWindow').innerHTML=$('window').innerHTML;$('btAnchorMode').innerHTML=$('anchorMode').innerHTML;$('btMethod').innerHTML=$('method').innerHTML}
  $('btFamilies').innerHTML=E.FAMILIES.map(([id,name])=>`<button type="button" role="tab" data-family="${id}" aria-selected="${b.family===id}" class="${b.family===id?'active':''}">${name}</button>`).join('');
  $('btPresets').innerHTML=E.PRESETS.filter(p=>p.family===b.family).map(p=>`<button class="pill mini${b.preset===p.id?' on':''}" type="button" data-preset="${p.id}">${p.name}</button>`).join('');
  const set=(id,v)=>{$(id).value=String(v)};
  set('btCapital',b.capital);set('btDcaPeriods',b.dcaPeriods);set('btPeriod',b.period);
  set('btWindow',b.ref.window);set('btAnchorMode',b.ref.anchorMode);set('btAnchorCount',b.ref.anchorCount);set('btMethod',b.ref.method);
  set('btFee',b.fee);set('btDiscount',b.discount);set('btTax',b.tax);set('btParking',b.parking);$('btDrip').checked=!!b.drip;$('btWhole').checked=!!b.wholeShares;
  const card=$('backtestCard');card.querySelectorAll('.bt-if-average').forEach(e=>e.classList.toggle('hidden',b.ref.anchorMode!=='average'));
  card.querySelectorAll('.bt-if-classic').forEach(e=>e.classList.toggle('hidden',b.strategy!=='classic'));
  btRenderSplit();
  $('btFriction').textContent='買賣一次成本 '+fmt(b.fee*b.discount/100*2+b.tax,4)+'%';
  $('btMarkers').setAttribute('aria-pressed',String(!!b.markers));
  btRenderParams();
}
function btRenderSplit(){
  const b=settings.bt,p=b.params,C=b.capital,N=b.dcaPeriods,base=C/N,m=v=>fmt(Math.round(v),0)+' 元';
  let mine;
  if(b.strategy==='classic'){const k=p.entry==='fib'?p.levels.length:1+p.adds;mine='本策略分 '+k+' 批：每批 C ÷ '+k+' = '+m(C/k)}
  else if(b.strategy==='dca')mine='本策略就是定期定額';
  else if(['smart_dca_water','bias_tiered_dca','value_averaging'].includes(b.strategy))mine='本策略每月基準 C ÷ '+N+' = '+m(base)+'，再乘上當月倍數，直到資金用完';
  else if(b.strategy==='tech_bb_rsi_dca')mine='本策略每月底倉 '+m(base*p.baseRatio)+'，超賣時加碼 '+m(base*p.dipMult);
  else if(b.strategy==='core_satellite')mine='核心每月 '+m(base*p.core/100)+' × 倍數；衛星資金 '+m(C*(100-p.core)/100)+' 分 2 批';
  else if(['rebalance_50_50','vol_targeting'].includes(b.strategy))mine='本策略依目標持股比例調整，不分期';
  else mine='本策略符合條件時投入全部可用資金';
  $('btSplit').innerHTML='定期定額：每月 C ÷ '+N+' = <b>'+m(base)+'</b><br>'+mine+'<br>買進持有：第一天投入 C = '+m(C);
}
function btReadForm(){
  const b=settings.bt,num=(id,lo,hi,d)=>clampNum($(id).value,lo,hi,d);
  b.capital=Math.round(num('btCapital',10000,1e9,1200000));b.dcaPeriods=[6,12,24,36,60].includes(Number($('btDcaPeriods').value))?Number($('btDcaPeriods').value):12;
  b.period=['1','3','5','10','all'].includes($('btPeriod').value)?$('btPeriod').value:'5';
  b.ref={window:$('btWindow').value,anchorMode:$('btAnchorMode').value,anchorCount:Math.round(num('btAnchorCount',1,20,5)),method:$('btMethod').value==='fib'?'fib':'equal'};
  b.fee=num('btFee',0,1,0.1425);b.discount=num('btDiscount',10,100,100);b.tax=num('btTax',0,1,0.1);b.parking=num('btParking',0,10,1.5);b.drip=$('btDrip').checked;b.wholeShares=$('btWhole').checked;
  $('btParams').querySelectorAll('[data-k]').forEach(el=>{const k=el.dataset.k,v=el.type==='checkbox'?el.checked:el.tagName==='SELECT'?el.value:Number(el.value);
    b.params[k]=el.tagName==='SELECT'&&/^-?\d+(\.\d+)?$/.test(v)?Number(v):(typeof v==='number'&&!Number.isFinite(v)?b.params[k]:v)});
  const levels=[...$('btParams').querySelectorAll('[data-level]:checked')].map(x=>Number(x.dataset.level)).sort((x,y)=>x-y);if($('btParams').querySelector('[data-level]'))b.params.levels=levels.length?levels:[0.382];
  $('btParams').querySelectorAll('[data-arr]').forEach(el=>{const v=Number(el.value);if(Number.isFinite(v))b.params[el.dataset.arr][Number(el.dataset.i)]=Math.max(0,Math.min(10,v))});
  b.preset=E.PRESETS.some(p=>p.id===b.preset&&p.strategy===b.strategy&&JSON.stringify({...E.PARAMS[p.strategy],...p.params})===JSON.stringify(b.params))?b.preset:'custom';
  save();
}
function btSchedule(){clearTimeout(btTimer);btTimer=setTimeout(renderBacktest,160)}
$('btFamilies').addEventListener('click',e=>{const t=e.target.closest('[data-family]');if(!t)return;const p=E.PRESETS.find(x=>x.family===t.dataset.family);btApplyPreset(p.id)});
$('btPresets').addEventListener('click',e=>{const t=e.target.closest('[data-preset]');if(t)btApplyPreset(t.dataset.preset)});
function btApplyPreset(id,over){const p=E.PRESETS.find(x=>x.id===id);if(!p)return;Object.assign(settings.bt,{family:p.family,preset:p.id,strategy:p.strategy,params:JSON.parse(JSON.stringify({...E.PARAMS[p.strategy],...p.params}))},over||{});save();btFillForm();renderBacktest()}
$('backtestCard').addEventListener('change',e=>{if(e.target.closest('.bt-steps,.bt-advanced')){btReadForm();btFillForm();btSchedule()}});
$('btSyncView').addEventListener('click',()=>{settings.bt.ref={window:settings.window,anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,method:settings.method};save();btFillForm();renderBacktest()});
$('btMarkers').addEventListener('click',()=>{settings.bt.markers=!settings.bt.markers;save();btFillForm();applyMarkers()});
$('btTradeFilter').addEventListener('click',e=>{const t=e.target.closest('[data-f]');if(!t)return;btTradeFilter=t.dataset.f;$('btTradeFilter').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===t));btRenderTrades()});

/* ---------- text ---------- */
const pctText=v=>v==null||!Number.isFinite(v)?'—':(v>0?'+':'')+fmt(v*100,1)+'%';
const money=v=>fmt(Math.round(v),0)+' 元';
function btSentence(cfg){
  const b=settings.bt,p=cfg.params,cash='資金 '+fmt(b.capital/10000,0)+' 萬元';
  const win=cfg.ref.window==='all'?'全部歷史':'近 '+cfg.ref.window+' 日';
  const name=E.PRESETS.find(x=>x.id===b.preset)?.name||'自訂組合';
  let s=`「${name}」：${cash}，${BT_EXPLAIN[cfg.strategy]}`;
  if(cfg.strategy==='classic'){
    const e={drop:'較區間高點跌 '+p.drop+'% 買'+(p.adds?'、每再跌 '+p.step+'% 加碼（最多 '+p.adds+' 次）':''),fib:'回檔到 '+p.levels.map(x=>(x*100).toFixed(1)+'%').join('、')+' 分批買',grade:'水位 '+p.buyGrade+' 分買'}[p.entry];
    const x={gain:'高於成本 '+p.rise+'% 全賣',high:p.rise?'突破前高 '+p.rise+'% 全賣':'回到前高全賣',grade:'水位回到 '+p.sellGrade+' 分全賣',fibext:'到 '+(p.fibExt*100).toFixed(1)+'% 擴展位全賣',trailing:'回到前高後改用移動停利（回落 '+p.trail+'%'+(p.atrMult?'或吊燈 '+p.atrMult+'×ATR':'')+'）',pyramid:'+'+p.rise+'% 或回到前高先賣 30%、138.2% 再賣 30%，底倉跌破 MA120 才出'}[p.exit];
    s=`「${name}」：${cash}，${e}；${x}${p.stop?'，停損 '+p.stop+'%':''}`;
  }
  if(['classic','smart_dca_water','core_satellite','macro_regime'].includes(cfg.strategy)||cfg.params.minScore)s+=`（水位以${win}區間計算）`;
  return s+'。';
}

/* ---------- results ---------- */
function btAnimate(el,to,format){
  // Short count-up so changed numbers are noticed; skipped when the user prefers reduced motion.
  const from=Number(el.dataset.v),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;el.dataset.v=to;
  if(!Number.isFinite(from)||reduce||!Number.isFinite(to)){el.textContent=format(to);return}
  const t0=performance.now(),tick=t=>{const k=Math.min(1,(t-t0)/350),e=1-Math.pow(1-k,3);el.textContent=format(from+(to-from)*e);if(k<1)requestAnimationFrame(tick)};requestAnimationFrame(tick);
}
function btCharts_(){
  if(btCharts||!window.LightweightCharts)return btCharts;
  const L=window.LightweightCharts,opt={...chartOptions(),handleScroll:false,handleScale:false};
  const top=L.createChart($('btEquity'),{...opt,timeScale:{...opt.timeScale,visible:false}}),under=L.createChart($('btUnder'),opt);
  const money=v=>fmt(v/10000,v>=1e6?0:1)+' 萬',pc=v=>fmt(v,0)+'%';
  btCharts={top,under,
    s:top.addLineSeries({color:'#0e7490',lineWidth:2.5,priceLineVisible:false,priceFormat:{type:'custom',formatter:money}}),
    d:top.addLineSeries({color:'#e6a23c',lineWidth:1.6,priceLineVisible:false,priceFormat:{type:'custom',formatter:money}}),
    h:top.addLineSeries({color:'#9aa5ab',lineWidth:1.4,priceLineVisible:false,priceFormat:{type:'custom',formatter:money}}),
    c:top.addLineSeries({color:'#7c8a90',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:money}}),
    e:under.addAreaSeries({priceScaleId:'left',lineColor:'rgba(25,167,170,.0)',topColor:'rgba(25,167,170,.18)',bottomColor:'rgba(25,167,170,.04)',priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:pc}}),
    sd:under.addLineSeries({color:'#0e7490',lineWidth:1.8,priceLineVisible:false,priceFormat:{type:'custom',formatter:pc}}),
    dd:under.addLineSeries({color:'#e6a23c',lineWidth:1.2,priceLineVisible:false,priceFormat:{type:'custom',formatter:pc}})};
  under.priceScale('left').applyOptions({visible:false,scaleMargins:{top:0,bottom:0}});
  // The two panes share one time axis.
  let syncing=false;for(const [a,b] of [[top,under],[under,top]])a.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(!r||syncing)return;syncing=true;b.timeScale().setVisibleLogicalRange(r);syncing=false});
  return btCharts;
}
function btDrawCharts(r){
  const c=btCharts_();if(!c)return;
  c.s.setData(r.series.map(x=>({time:x.time,value:x.value})));c.d.setData(r.dca.series.map(x=>({time:x.time,value:x.value})));
  c.h.setData(r.bh.series.map(x=>({time:x.time,value:x.value})));c.c.setData(r.series.map(x=>({time:x.time,value:x.contributed})));
  c.sd.setData(r.series.map(x=>({time:x.time,value:x.dd*100})));c.dd.setData(r.dca.series.map(x=>({time:x.time,value:x.dd*100})));
  c.e.setData(r.series.map(x=>({time:x.time,value:x.exposure*100})));
  c.top.timeScale().fitContent();c.under.timeScale().fitContent();
}
function btNow(r){
  const ctx=btCtx,i=ctx.n-1,c=ctx.close[i],p=r.cfg.params,st=r.state,w=E.water(ctx,r.cfg.ref),g=w.grade[i],core=w.core[i],rows=[];
  const at=v=>'<b>'+fmt(v,2)+'</b>（較今日 '+pctText(v/c-1)+'）',hold=r.shares>0?'持有 '+fmt(r.shares,0)+' 股、現金 '+money(r.cash):'空手、現金 '+money(r.cash);
  rows.push(['目前',hold+'；今日水位 '+(Number.isFinite(core)?fmt(core,1)+' 分':'—')]);
  const s=r.cfg.strategy;
  if(s==='classic'){
    // Tomorrow's range includes today; use the engine's own reference for the next bar when it exists.
    const ref=E.reference(ctx,r.cfg.ref.window,r.cfg.ref.anchorMode,r.cfg.ref.anchorCount),hi=Math.max(ref.hi[i],r.cfg.ref.anchorMode==='close'?c:ctx.high[i]),lo=Math.min(ref.lo[i],r.cfg.ref.anchorMode==='close'?c:ctx.low[i]);
    if(!st.buys){if(p.entry==='drop')rows.push(['下一個買點','收盤跌到 '+at(hi*(1-p.drop/100))]);if(p.entry==='fib')rows.push(['下一個買點','收盤跌到 '+at(hi-p.levels[0]*(hi-lo))]);if(p.entry==='grade')rows.push(['下一個買點','水位達 '+p.buyGrade+' 分（目前 '+(g||'—')+' 分）'])}
    else{const avg=r.cost/r.shares;rows.push(['平均成本',fmt(avg,2)+'，未實現 '+pctText(c/avg-1)]);
      if(p.exit==='gain')rows.push(['賣出點','收盤漲到 '+at(avg*(1+p.rise/100))]);if(p.exit==='trailing')rows.push(['移動停利',st.armed?'收盤跌到 '+at(st.peak*(1-p.trail/100)):'需先回到進場前高點 '+fmt(st.hi,2)+' 才啟動']);
      if(p.stop)rows.push(['停損點','收盤跌到 '+at(avg*(1-p.stop/100))])}
  }else if(s==='smart_dca_water'||s==='core_satellite'){const m=p.mult[Math.max(1,Math.min(5,g||3))-1];rows.push(['本月扣款','水位 '+(g||'—')+' 分 → '+m+' 倍']);}
  else if(s==='bias_tiered_dca'&&ctx.ma60[i]>0){const b=(c/ctx.ma60[i]-1)*100;rows.push(['MA60 乖離',fmt(b,1)+'%'])}
  else if(s==='tech_bb_rsi_dca'){const pb=(c-ctx.bbLo[i])/(ctx.bbUp[i]-ctx.bbLo[i]);rows.push(['%B／RSI',fmt(pb,2)+'／'+fmt(ctx.rsi[i],0)+'（加碼門檻 %B<'+p.pbLow+' 且 RSI<'+p.rsiLow+'）'])}
  else if(s==='dual_momentum'&&i>=120){const mom=0.5*(c/ctx.close[i-60]-1)+0.5*(c/ctx.close[i-120]-1);rows.push(['動能',pctText(mom)+(c>ctx.ma120[i]?'，在 MA120 之上':'，在 MA120 之下')+(st.on?'（滿倉中）':'（持現金）')])}
  else if(s==='macro_regime'&&ctx.ma200[i]>0){rows.push(['市場體制',c>ctx.ma200[i]&&ctx.ma200[i]>ctx.ma200[i-20]?'多頭（MA200 之上且上彎）':'空頭或盤整']);if(ctx.macro)rows.push(['原油＋匯率分數',Number.isFinite(ctx.macro[i])?fmt(ctx.macro[i],1)+' 分':'—'])}
  else if(s==='vol_targeting'){rows.push(['近 20 日年化波動',fmt(ctx.sigma[i]*100,0)+'% → 目標持股 '+fmt(Math.max(p.minW,Math.min(100,p.target/ctx.sigma[i])),0)+'%'])}
  else if(s==='bb_squeeze'){rows.push(['布林帶寬','近 120 日第 '+fmt(ctx.bwRank[i]*100,0)+' 百分位'+(r.shares?'；持有中，跌破 MA20 '+fmt(ctx.ma20[i],2)+' 賣出':'')])}
  else if(s==='rebalance_50_50'){const v=r.shares*c,eq=v+r.cash;rows.push(['持股比例',fmt(v/eq*100,0)+'%（目標 '+p.weight+'%，±'+p.band+'% 時再平衡）'])}
  return rows;
}
function btRenderTrades(){
  const r=btResult;if(!r)return;
  const list=r.trades.filter(t=>btTradeFilter==='all'||(btTradeFilter==='dca'?['dca','drip'].includes(t.kind):t.type===btTradeFilter&&!['dca','drip'].includes(t.kind)));
  const maxRet=Math.max(0.01,...list.filter(t=>t.ret!=null).map(t=>Math.abs(t.ret))),cls=v=>v>0?'up':v<0?'down':'';
  const rows=list.slice(-400).reverse();
  $('btTradesTitle').textContent='交易明細（'+r.trades.length+' 筆）';
  $('btTrades').innerHTML=rows.length?`<table><thead><tr><th>日期</th><th>動作</th><th>價格</th><th>股數</th><th>金額</th><th>報酬</th><th>原因</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${t.date}</td><td class="${t.type}">${t.type==='buy'?(t.kind==='dca'?'定投':t.kind==='drip'?'配息再投入':'買進'):'賣出'}</td><td>${fmt(t.price,2)}</td><td>${fmt(t.shares,0)}</td><td>${fmt(t.amount,0)}</td><td class="${cls(t.ret)}">${t.ret!=null?`<span class="bt-bar" style="--w:${Math.round(Math.abs(t.ret)/maxRet*100)}%"></span>${pctText(t.ret)}`:''}</td><td>${t.reason}</td></tr>`).join('')}</tbody></table>${list.length>400?'<p class="small">只顯示最近 400 筆；完整明細請下載 CSV。</p>':''}`:'<p class="small">沒有符合的交易。</p>';
}
function renderBacktest(){
  btBarsRef=bars;
  if(!bars.length||bars.length<60){$('btKpis').innerHTML='<p class="small">需要至少 60 個交易日才能回測。</p>';btResult=null;applyMarkers();return}
  if(!btDivs){btEnsureDividends().then(()=>{btCtx=null;renderBacktest()});}
  const seq=++btSeq,ctx=btContext(),cfg=btCfg(),start=btStart(settings.bt.period),r=E.run(ctx,cfg,start);btResult=r;
  $('btSummary').textContent=btSentence(cfg);
  // Verdict: name the metric; never call it a win when the return is behind.
  const dx=r.xirr-r.dca.xirr,dm=r.dca.mdd-r.mdd,calS=r.calmar,calD=r.dca.mdd>0?r.dca.cagr/r.dca.mdd:null;
  $('btVerdict').innerHTML=r.cfg.strategy==='dca'?'<span class="bt-tag">這就是定期定額本身，可作為其他策略的比較基準。</span>':
    (dx>0?`<span class="bt-tag win">🏆 年化報酬勝過定期定額 ${fmt(dx*100,1)} 個百分點</span>`:`<span class="bt-tag lose">年化報酬落後定期定額 ${fmt(-dx*100,1)} 個百分點</span>`)+
    (dm>0.005?`<span class="bt-tag win">最大回落少 ${fmt(dm*100,1)} 個百分點</span>`:'')+(calS!=null&&calD!=null&&calS>calD?`<span class="bt-tag win">風險調整後（Calmar）較佳：${fmt(calS,2)} vs ${fmt(calD,2)}</span>`:'');
  const k=[['策略年化報酬',r.xirr,v=>pctText(v),'總報酬 '+pctText(r.ret)],['定期定額年化',r.dca.xirr,v=>pctText(v),'C ÷ '+settings.bt.dcaPeriods+' 每月一期'],['買進持有年化',r.bh.xirr,v=>pctText(v),'第一天全部投入'],['最大回落',r.mdd,v=>'−'+fmt(v*100,1)+'%','定期定額 −'+fmt(r.dca.mdd*100,1)+'%']];
  const small=[['期間',r.start+' 至 '+r.end],['資金基數',money(r.contributed)],['期末資產',money(r.equity)],['Calmar',r.calmar!=null?fmt(r.calmar,2):'—'],['Sharpe',r.sharpe!=null?fmt(r.sharpe,2):'—'],['平均持股比例',fmt(r.utilization*100,0)+'%'],['股利入帳',money(r.dividends)],['停泊利息',money(r.interest)],['手續費與稅',money(r.fees)],['交易',r.buys+' 買／'+r.sells+' 賣'+(r.sells?'（勝率 '+fmt(r.wins/r.sells*100,0)+'%）':'')]];
  if(!$('btKpis').querySelector('.bt-big'))$('btKpis').innerHTML=`<div class="bt-big">${k.map((_,j)=>`<div><small></small><b data-k="${j}"></b><span></span></div>`).join('')}</div><div class="bt-small"></div>`;
  $('btKpis').querySelectorAll('.bt-big>div').forEach((el,j)=>{const [label,v,f,sub]=k[j];el.querySelector('small').textContent=label;el.querySelector('span').textContent=sub;const b=el.querySelector('b');b.className=j<3?(v>0?'up':v<0?'down':''):'';btAnimate(b,v,f)});
  $('btKpis').querySelector('.bt-small').innerHTML=small.map(([a,b])=>`<span><small>${a}</small>${b}</span>`).join('');
  btDrawCharts(r);
  $('btNow').innerHTML='<h4>今日狀態</h4><dl>'+btNow(r).map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join('')+'</dl>';
  btRenderTrades();
  if(cfg.strategy==='classic')btRenderGrid(ctx,cfg,start);
  if($('btRollingBox').open)btRenderRolling();else $('btRolling').innerHTML='';
  applyMarkers();
}
function btRenderGrid(ctx,cfg,start){
  const p=cfg.params;let rows,cols,rowLabel,colLabel,make,cur;
  if(p.entry==='drop'){rows=[8,10,15,20,25];rowLabel='下跌';make=a=>({drop:a});cur=p.drop}else if(p.entry==='fib'){rows=[0.236,0.382,0.5,0.618];rowLabel='第一個位階';make=a=>({levels:[a,...p.levels.filter(x=>x>a)]});cur=p.levels[0]}else{rows=[5,4,3];rowLabel='買進分數';make=a=>({buyGrade:a});cur=p.buyGrade}
  if(['gain','high','pyramid'].includes(p.exit)){cols=[0,10,20,30,50].filter(x=>p.exit!=='gain'||x>0).map(x=>({rise:x}));colLabel='幅度'}else if(p.exit==='trailing'){cols=[6,8,10,15,20].map(x=>({trail:x}));colLabel='回落'}else if(p.exit==='grade'){cols=[{sellGrade:1},{sellGrade:2}];colLabel='賣出分數'}else{cols=[{fibExt:1},{fibExt:1.272},{fibExt:1.618}];colLabel='擴展位'}
  const curCol=JSON.stringify(Object.fromEntries(Object.keys(cols[0]).map(x=>[x,p[x]])));
  const rt=a=>p.entry==='drop'?a+'%':p.entry==='fib'?(a*100).toFixed(1)+'%':a+' 分',ct=b=>{const [kk,v]=Object.entries(b)[0];return kk==='fibExt'?(v*100).toFixed(1)+'%':kk==='sellGrade'?v+' 分':v+'%'};
  let html=`<table><thead><tr><th>${rowLabel} ＼ ${colLabel}</th>${cols.map(b=>`<th>${ct(b)}</th>`).join('')}</tr></thead><tbody>`;
  for(const a of rows){html+=`<tr><th>${rt(a)}</th>`;for(const b of cols){const x=E.run(ctx,{...cfg,params:{...p,...make(a),...b}},start),isCur=a===cur&&JSON.stringify(b)===curCol,t=Math.max(-1,Math.min(1,x.xirr||0));
    html+=`<td class="${x.xirr>0?'up':x.xirr<0?'down':''}${isCur?' current':''}" style="--heat:${Math.abs(t)}" title="總報酬 ${pctText(x.ret)}">${x.buys?pctText(x.xirr):'未觸發'}</td>`}html+='</tr>'}
  $('btGrid').innerHTML=html+'</tbody></table><p class="small">表中為年化報酬；框起來的是目前設定。</p>';
}
function btRenderRolling(){
  const ctx=btContext(),cfg=btCfg(),out=[];
  for(const years of [1,3]){
    const len=Math.round(years*245);let win=0,winCal=0,total=0;
    for(let i=0;i+len<ctx.n;i++){if(!ctx.monthStart[i])continue;const r=E.run(ctx,cfg,i,i+len);total++;if(r.xirr>r.dca.xirr)win++;const cd=r.dca.mdd>0?r.dca.cagr/r.dca.mdd:0;if((r.calmar||0)>cd)winCal++}
    out.push(total?`<div class="bt-roll"><b>持有 ${years} 年</b><span>共 ${total} 個起點</span><span>年化報酬勝過定期定額：<b>${fmt(win/total*100,0)}%</b></span><span>Calmar 勝過：<b>${fmt(winCal/total*100,0)}%</b></span></div>`:`<p class="small">資料不足 ${years} 年。</p>`);
  }
  $('btRolling').innerHTML=out.join('')+'<p class="small">每個月的第一個交易日都當成一次起點，用同樣的資金基數各跑一次。</p>';
}
$('btRollingBox').addEventListener('toggle',()=>{if($('btRollingBox').open&&btResult)btRenderRolling()});
$('btCsv').addEventListener('click',()=>{
  if(!btResult)return;
  const rows=[['日期','類型','價格','股數','金額','損益','報酬率','原因']].concat(btResult.trades.map(t=>[t.date,t.type==='buy'?(t.kind==='dca'?'定投':t.kind==='drip'?'配息再投入':'買進'):'賣出',t.price,Math.round(t.shares*1000)/1000,Math.round(t.amount),t.pnl!=null?Math.round(t.pnl):'',t.ret!=null?(t.ret*100).toFixed(2)+'%':'',t.reason]));
  const csv='﻿'+rows.map(r=>r.map(x=>/[",\n]/.test(String(x))?'"'+String(x).replace(/"/g,'""')+'"':x).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=selected+'-回測交易明細.csv';document.body.append(a);a.click();a.remove();
});

/* ---------- optimizer: every preset, three water-level windows, ranked three ways ---------- */
$('btOptimize').addEventListener('click',()=>{
  if(!bars.length)return;const ctx=btContext(),start=btStart(settings.bt.period),base=btCfg(),rows=[];
  $('btOptSheet').classList.remove('hidden');document.body.classList.add('searching');$('btOptBody').innerHTML='<p class="small">計算中…</p>';
  setTimeout(()=>{
    let dcaRef=null;
    for(const p of E.PRESETS){
      const usesWater=['classic','smart_dca_water','core_satellite','macro_regime'].includes(p.strategy);
      for(const w of usesWater?['60','120','240']:[base.ref.window]){
        const cfg={...base,strategy:p.strategy,params:JSON.parse(JSON.stringify({...E.PARAMS[p.strategy],...p.params})),ref:{...base.ref,window:w}},r=E.run(ctx,cfg,start);
        dcaRef=dcaRef||r.dca;rows.push({p,w,usesWater,r});
      }
    }
    const calD=dcaRef.mdd>0?dcaRef.cagr/dcaRef.mdd:0,board=(title,key,dir,fmtv)=>{const seen=new Set(),list=[...rows].filter(x=>x.p.strategy!=='dca').sort((a,b)=>dir*((b.r[key]??-9)-(a.r[key]??-9))).filter(x=>!seen.has(x.p.id)&&seen.add(x.p.id)).slice(0,3);
      return `<section class="bt-board"><h4>${title}</h4>${list.map((x,j)=>`<button class="bt-rank" type="button" data-preset="${x.p.id}" data-window="${x.w}"><b>${j+1}</b><span>${x.p.name}${x.usesWater?'（'+x.w+' 日）':''}</span><em>${fmtv(x.r)}</em></button>`).join('')}</section>`};
    $('btOptNote').textContent=`${selected}，${btStart(settings.bt.period)===0?'全部資料':'近 '+settings.bt.period+' 年'}，資金 ${fmt(settings.bt.capital/10000,0)} 萬元、定期定額分 ${settings.bt.dcaPeriods} 期；共試算 ${rows.length} 組。定期定額：年化 ${pctText(dcaRef.xirr)}、最大回落 −${fmt(dcaRef.mdd*100,1)}%、Calmar ${fmt(calD,2)}。`;
    $('btOptBody').innerHTML='<div class="bt-boards">'+board('年化報酬最高','xirr',1,r=>pctText(r.xirr)+(r.xirr>r.dca.xirr?' 🏆':''))+board('風險調整後（Calmar）最高','calmar',1,r=>fmt(r.calmar,2)+(r.calmar>calD?' 🏆':''))+board('最大回落最小','mdd',-1,r=>'−'+fmt(r.mdd*100,1)+'%，年化 '+pctText(r.xirr))+'</div><p class="small">🏆 表示該指標勝過定期定額。歷史最佳參數未必在未來有效，請搭配「滾動期間勝率」一起判斷。點任一列即可套用。</p>';
  },30);
});
$('btOptBody').addEventListener('click',e=>{const t=e.target.closest('.bt-rank');if(!t)return;btCloseSheet();const ref={...settings.bt.ref,window:t.dataset.window};btApplyPreset(t.dataset.preset,{ref});$('backtestCard').scrollIntoView({behavior:'smooth',block:'start'})});
function btCloseSheet(){$('btOptSheet').classList.add('hidden');document.body.classList.remove('searching')}
$('btOptClose').addEventListener('click',btCloseSheet);$('btOptSheet').addEventListener('click',e=>{if(e.target===$('btOptSheet'))btCloseSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('btOptSheet').classList.contains('hidden'))btCloseSheet()});

/* ---------- markers on the K-line chart ---------- */
function applyMarkers(){
  if(!lwc)return;
  if(!isMember||!btResult||!settings.bt.markers||!lwc.data.length){lwc.s.candle.setMarkers([]);return}
  const dates=lwc.data.map(b=>b.date),markers=[];
  // Routine monthly buys and dividend reinvestment would bury the chart; show decisions only.
  for(const t of btResult.trades){
    if(['dca','drip','bench'].includes(t.kind))continue;
    let lo=0,hi=dates.length-1,at=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(dates[mid]<=t.date){at=mid;lo=mid+1}else hi=mid-1}
    if(at<0)continue;
    markers.push(t.type==='buy'?{time:dates[at],position:'belowBar',color:'#0e7490',shape:'arrowUp',text:'買'}:{time:dates[at],position:'aboveBar',color:'#c2410c',shape:'arrowDown',text:t.kind==='trim'?'減':'賣'});
  }
  markers.sort((a,b)=>a.time.localeCompare(b.time));
  lwc.s.candle.setMarkers(markers);
}
const btDrawChart=drawChart;
drawChart=function(keepView){btDrawChart(keepView);if(bars.length&&btBarsRef!==bars){btCtx=null;renderBacktest()}else applyMarkers()};
const btPrefs=prefs;
prefs=function(){btPrefs();if(btCharts){const o={...chartOptions(),handleScroll:false,handleScale:false};btCharts.top.applyOptions({...o,timeScale:{...o.timeScale,visible:false}});btCharts.under.applyOptions(o)}};
// Brent / FX arrive after the first render; the macro filter needs them.
const btLoadLiveHook=applyLive;applyLive=function(){btLoadLiveHook();if(btCtx&&!btCtx.macro&&brent.length&&fx.length){btCtx=null;btSchedule()}};
btEnsureDividends();btFillForm();

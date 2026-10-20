/* ---------- Backtest: reference range → entry → exit, with costs, risk limits and benchmarks ----------
   Every signal on day i uses only bars before i for the reference range (no look-ahead) and fills at day i's close.
   Days without a full observation window do not trade. Prices are split-adjusted; dividends are not included. */
const BT_DEFAULT={v:2,window:'240',anchorMode:'wick',anchorCount:5,method:'equal',entry:'drop',drop:20,levels:[0.382,0.5,0.618],buyGrade:5,
  step:10,adds:3,exit:'gain',rise:20,sellGrade:1,fibExt:1,stop:0,maxDays:0,amount:100000,period:'5',fee:0.1425,discount:100,tax:0.1,wholeShares:false,markers:true};
const BT_PRESETS=[
  ['跌 20% 買、賺 20% 賣',{entry:'drop',drop:20,step:10,adds:3,exit:'gain',rise:20,stop:0,maxDays:0}],
  ['每跌 10% 分批承接',{entry:'drop',drop:10,step:10,adds:4,exit:'gain',rise:15,stop:0,maxDays:0}],
  ['回到前高就賣',{entry:'drop',drop:15,step:10,adds:2,exit:'high',rise:0,stop:0,maxDays:0}],
  ['黃金分割分批',{entry:'fib',levels:[0.382,0.5,0.618],exit:'fibext',fibExt:1,stop:0,maxDays:0}],
  ['水位 5 分買、1 分賣',{entry:'grade',buyGrade:5,step:10,adds:2,exit:'grade',sellGrade:1,stop:0,maxDays:0}]
];
// Earlier versions stored {mode:'pct'|'fib',...}; translate them once.
function btMigrate(b){
  if(!b||typeof b!=='object')return{...BT_DEFAULT,window:settings.window,anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,method:settings.method};
  if(b.v===2)return Object.assign({},BT_DEFAULT,b);
  const out={...BT_DEFAULT,amount:b.amount||BT_DEFAULT.amount,period:b.period||'5',markers:b.markers!==false};
  if(b.mode==='fib')Object.assign(out,{entry:'fib',exit:'fibext',levels:Array.isArray(b.levels)&&b.levels.length?b.levels:out.levels,fibExt:b.fibSell||1,window:String(b.fibWindow||240)});
  else Object.assign(out,{drop:b.drop||20,step:b.step||10,adds:b.adds??3,exit:b.sellMode==='high'?'high':'gain',rise:b.rise??20});
  return out;
}
settings.bt=btMigrate(settings.bt);
var btResult=null,btBarsRef=null,btChart=null,btTimer=0;
const clampNum=(v,lo,hi,d)=>{const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d};
const pctText=v=>(v>0?'+':'')+fmt(v*100,1)+'%';
const money=v=>fmt(Math.round(v),0)+' 元';

/* Reference high/low for each day from the bars before it, following the chosen window and method. */
function btReference(cfg){
  const n=bars.length,W=cfg.window==='all'?Infinity:Number(cfg.window),hi=new Float64Array(n).fill(NaN),lo=new Float64Array(n).fill(NaN);
  const byClose=cfg.anchorMode==='close',H=bars.map(b=>byClose?b.close:b.high),L=bars.map(b=>byClose?b.close:b.low),need=W===Infinity?20:W;
  if(cfg.anchorMode!=='average'){
    const qh=[],ql=[];let a=0,b=0;
    for(let i=1;i<n;i++){
      const j=i-1;
      while(qh.length>a&&H[qh[qh.length-1]]<=H[j])qh.pop();qh.push(j);
      while(ql.length>b&&L[ql[ql.length-1]]>=L[j])ql.pop();ql.push(j);
      while(qh[a]<i-W)a++;while(ql[b]<i-W)b++;
      if(i>=need){hi[i]=H[qh[a]];lo[i]=L[ql[b]]}
    }
  }else{
    const k=Math.max(1,Math.min(20,Math.round(cfg.anchorCount)||5));
    for(let i=need;i<n;i++){
      const s=Math.max(0,i-W),hs=Float64Array.from(H.slice(s,i)).sort(),ls=Float64Array.from(L.slice(s,i)).sort(),kk=Math.min(k,hs.length);
      let x=0,y=0;for(let j=0;j<kk;j++){x+=hs[hs.length-1-j];y+=ls[j]}hi[i]=x/kk;lo[i]=y/kk;
    }
  }
  return{hi,lo,need};
}
function btStartIndex(period){
  if(period==='all'||!bars.length)return 0;
  const d=new Date(bars.at(-1).date+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-Number(period));
  const i=bars.findIndex(b=>b.date>=d.toISOString().slice(0,10));return i<0?0:i;
}
const btGrade=(c,h,l,method)=>h>l?scoreFor((c-l)/(h-l),method).grade:null;
const btMaxBuys=cfg=>cfg.entry==='fib'?cfg.levels.length:1+cfg.adds;

function btRun(cfg,ref,start){
  const fee=cfg.fee/100*cfg.discount/100,tax=cfg.tax/100,maxBuys=btMaxBuys(cfg),C=cfg.amount*maxBuys,n=bars.length;
  let cash=C,shares=0,cost=0,buys=0,anchorHi=0,anchorLo=0,lastBuy=0,entryIdx=-1,feesPaid=0,daysIn=0,peak=C,mdd=0,firstTradable=-1;
  const trades=[],equity=[],hold=[],dca=[];
  const c0=bars[start].close,holdUnits=C/(c0*(1+fee)),months=new Set(bars.slice(start).map(b=>b.date.slice(0,7))),perMonth=C/months.size;
  let dcaCash=C,dcaUnits=0,month='';
  const buy=(i,reason)=>{
    const c=bars[i].close,budget=Math.min(cfg.amount,cash);let sh=budget/(c*(1+fee));if(cfg.wholeShares)sh=Math.floor(sh);
    if(!(sh>0)||budget<1)return false;
    const gross=sh*c,f=gross*fee;cash-=gross+f;shares+=sh;cost+=gross+f;feesPaid+=f;buys++;lastBuy=c;if(entryIdx<0)entryIdx=i;
    trades.push({date:bars[i].date,type:'buy',price:c,shares:sh,amount:gross+f,fee:f,reason});return true;
  };
  const sell=(i,reason)=>{
    const c=bars[i].close,gross=shares*c,f=gross*(fee+tax),net=gross-f,pnl=net-cost;cash+=net;feesPaid+=f;
    trades.push({date:bars[i].date,type:'sell',price:c,shares,amount:net,fee:f,pnl,ret:pnl/cost,days:i-entryIdx,reason});
    shares=0;cost=0;buys=0;entryIdx=-1;
  };
  for(let i=start;i<n;i++){
    const b=bars[i],c=b.close,h=ref.hi[i],l=ref.lo[i],valid=h>l;
    if(b.date.slice(0,7)!==month){month=b.date.slice(0,7);const spend=Math.min(perMonth,dcaCash);dcaUnits+=spend/(c*(1+fee));dcaCash-=spend}
    if(valid&&firstTradable<0)firstTradable=i;
    let bought=false;
    if(!buys){
      if(valid){
        let why=null;
        if(cfg.entry==='drop'&&c<=h*(1-cfg.drop/100))why='首次買進：較區間高點 '+fmt(h,2)+' 下跌 '+fmt((1-c/h)*100,1)+'%';
        else if(cfg.entry==='fib'&&c<=h-cfg.levels[0]*(h-l))why='首次買進：回檔到 '+fmt(cfg.levels[0]*100,1)+'% 位階';
        else if(cfg.entry==='grade'){const g=btGrade(c,h,l,cfg.method);if(g!=null&&g>=cfg.buyGrade)why='首次買進：水位 '+g+' 分'}
        if(why){anchorHi=h;anchorLo=l;bought=buy(i,why)}
      }
    }else{
      // Adds follow the range frozen at the first buy, so the ladder does not drift with the window.
      if(cfg.entry==='drop'){while(buys<maxBuys&&c<=anchorHi*(1-(cfg.drop+buys*cfg.step)/100)){if(!buy(i,'加碼：較區間高點下跌 '+fmt(cfg.drop+buys*cfg.step,0)+'%'))break;bought=true}}
      else if(cfg.entry==='fib'){while(buys<maxBuys&&c<=anchorHi-cfg.levels[buys]*(anchorHi-anchorLo)){if(!buy(i,'加碼：回檔到 '+fmt(cfg.levels[buys]*100,1)+'% 位階'))break;bought=true}}
      else if(buys<maxBuys&&c<=lastBuy*(1-cfg.step/100)){const g=valid?btGrade(c,h,l,cfg.method):null;if(g!=null&&g>=cfg.buyGrade)bought=buy(i,'加碼：較上次買價再跌 '+cfg.step+'%')}
      if(!bought){
        const avg=cost/shares;let why=null;
        if(cfg.stop>0&&c<=avg*(1-cfg.stop/100))why='停損：低於平均成本 '+cfg.stop+'%';
        else if(cfg.maxDays>0&&i-entryIdx>=cfg.maxDays)why='持有滿 '+cfg.maxDays+' 個交易日';
        else if(cfg.exit==='gain'&&c>=avg*(1+cfg.rise/100))why='獲利：高於平均成本 '+cfg.rise+'%';
        else if(cfg.exit==='high'&&c>=anchorHi*(1+cfg.rise/100))why=cfg.rise?'突破進場前高點 '+cfg.rise+'%':'回到進場前高點';
        else if(cfg.exit==='grade'&&valid){const g=btGrade(c,h,l,cfg.method);if(g!=null&&g<=cfg.sellGrade)why='水位回到 '+g+' 分'}
        else if(cfg.exit==='fibext'&&c>=anchorLo+cfg.fibExt*(anchorHi-anchorLo))why=cfg.fibExt===1?'回到區間高點':'到達 '+fmt(cfg.fibExt*100,1)+'% 擴展位';
        if(why)sell(i,why);
      }
    }
    if(shares>0)daysIn++;
    const eq=cash+shares*c;peak=Math.max(peak,eq);mdd=Math.max(mdd,(peak-eq)/peak);
    equity.push({time:b.date,value:(eq/C-1)*100});hold.push({time:b.date,value:(holdUnits*c/C-1)*100});dca.push({time:b.date,value:((dcaCash+dcaUnits*c)/C-1)*100});
  }
  const last=bars[n-1],eqEnd=cash+shares*last.close,years=Math.max(1/365,(Date.parse(last.date)-Date.parse(bars[start].date))/31557600000);
  const sells=trades.filter(t=>t.type==='sell'),ret=eqEnd/C-1;
  return{cfg,C,maxBuys,trades,equity,hold,dca,ret,cagr:ret>-1?Math.pow(1+ret,1/years)-1:-1,mdd,feesPaid,start:bars[start].date,end:last.date,
    sells:sells.length,buys:trades.length-sells.length,wins:sells.filter(t=>t.pnl>0).length,avgDays:sells.length?sells.reduce((a,t)=>a+t.days,0)/sells.length:null,
    exposure:daysIn/(n-start),holdRet:holdUnits*last.close/C-1,dcaRet:(dcaCash+dcaUnits*last.close)/C-1,firstTradable:firstTradable>=0?bars[firstTradable].date:null,
    state:{shares,cost,buys,anchorHi,anchorLo,lastBuy,cash}};
}

/* Text: the strategy in one sentence, and what it would do next from today's close. */
const BT_ANCHOR={wick:'最高／最低價',close:'收盤價極值',average:n=>'最高、最低各 '+n+' 筆平均'};
function btSentence(cfg){
  const win=cfg.window==='all'?'全部歷史':'近 '+cfg.window+' 個交易日',anchor=cfg.anchorMode==='average'?BT_ANCHOR.average(cfg.anchorCount):BT_ANCHOR[cfg.anchorMode];
  const amt=fmt(cfg.amount/10000,cfg.amount%10000?1:0)+' 萬元';
  let s='以'+win+'的'+anchor+'為區間，';
  if(cfg.entry==='drop')s+='價格較區間高點下跌 '+cfg.drop+'% 時買進 '+amt+(cfg.adds?'，之後每再跌 '+cfg.step+'% 加碼一次（最多 '+cfg.adds+' 次）':'');
  if(cfg.entry==='fib')s+='回檔到 '+cfg.levels.map(x=>fmt(x*100,1)+'%').join('、')+' 位階時各買進 '+amt;
  if(cfg.entry==='grade')s+='水位分數達 '+cfg.buyGrade+' 分時買進 '+amt+(cfg.adds?'，再跌 '+cfg.step+'% 且仍在該分數時加碼（最多 '+cfg.adds+' 次）':'');
  s+='；';
  if(cfg.exit==='gain')s+='高於平均成本 '+cfg.rise+'% 時全部賣出';
  if(cfg.exit==='high')s+=cfg.rise?'突破進場前高點 '+cfg.rise+'% 時全部賣出':'回到進場前高點時全部賣出';
  if(cfg.exit==='grade')s+='水位回到 '+cfg.sellGrade+' 分時全部賣出';
  if(cfg.exit==='fibext')s+=cfg.fibExt===1?'回到區間高點時全部賣出':'到達 '+fmt(cfg.fibExt*100,1)+'% 擴展位時全部賣出';
  if(cfg.stop)s+='，跌破成本 '+cfg.stop+'% 停損';
  if(cfg.maxDays)s+='，最多持有 '+cfg.maxDays+' 個交易日';
  return s+'。';
}
// Water-level score thresholds as a position in the range (0 = low, 1 = high).
function btGradeEdge(g,method,dir){
  let edge=null;
  for(let r=-0.5;r<=1.5;r+=0.0005){const grade=scoreFor(r,method).grade;if(dir==='buy'&&grade>=g)edge=r;if(dir==='sell'&&grade<=g){edge=r;break}}
  return edge;
}
function btNow(r){
  const cfg=r.cfg,n=bars.length,c=bars[n-1].close,st=r.state;
  // Tomorrow's reference range includes today's bar.
  const W=cfg.window==='all'?n:Number(cfg.window),slice=bars.slice(Math.max(0,n-W)),byClose=cfg.anchorMode==='close';
  let hi,lo;
  if(cfg.anchorMode==='average'){const k=Math.min(cfg.anchorCount,slice.length),hs=slice.map(b=>b.high).sort((a,b)=>b-a),ls=slice.map(b=>b.low).sort((a,b)=>a-b);hi=hs.slice(0,k).reduce((a,b)=>a+b,0)/k;lo=ls.slice(0,k).reduce((a,b)=>a+b,0)/k}
  else{hi=Math.max(...slice.map(b=>byClose?b.close:b.high));lo=Math.min(...slice.map(b=>byClose?b.close:b.low))}
  const at=p=>'<b>'+fmt(p,2)+'</b>（'+(p>=c?'較今日 +':'較今日 ')+fmt((p/c-1)*100,1)+'%）';
  const rows=[];
  if(!st.shares){
    let p=null;
    if(cfg.entry==='drop')p=hi*(1-cfg.drop/100);
    if(cfg.entry==='fib')p=hi-cfg.levels[0]*(hi-lo);
    if(cfg.entry==='grade'){const e=btGradeEdge(cfg.buyGrade,cfg.method,'buy');if(e!=null)p=lo+e*(hi-lo)}
    rows.push(['目前','空手（依這套規則，最近一次已全部賣出或尚未進場）']);
    if(p!=null)rows.push(['下一個買點',c<=p?'今日收盤 '+fmt(c,2)+' 已在買進範圍':'收盤跌到 '+at(p)]);
  }else{
    const avg=st.cost/st.shares;
    rows.push(['目前','持有 '+fmt(st.shares,0)+' 股、平均成本 '+fmt(avg,2)+'，未實現 '+pctText(c/avg-1)]);
    let add=null;
    if(st.buys<r.maxBuys){if(cfg.entry==='drop')add=st.anchorHi*(1-(cfg.drop+st.buys*cfg.step)/100);if(cfg.entry==='fib')add=st.anchorHi-cfg.levels[st.buys]*(st.anchorHi-st.anchorLo);if(cfg.entry==='grade')add=st.lastBuy*(1-cfg.step/100)}
    if(add!=null)rows.push(['下一次加碼','收盤跌到 '+at(add)]);
    let out=null;
    if(cfg.exit==='gain')out=avg*(1+cfg.rise/100);
    if(cfg.exit==='high')out=st.anchorHi*(1+cfg.rise/100);
    if(cfg.exit==='fibext')out=st.anchorLo+cfg.fibExt*(st.anchorHi-st.anchorLo);
    if(cfg.exit==='grade'){const e=btGradeEdge(cfg.sellGrade,cfg.method,'sell');if(e!=null)out=lo+e*(hi-lo)}
    if(out!=null)rows.push(['賣出點','收盤漲到 '+at(out)]);
    if(cfg.stop)rows.push(['停損點','收盤跌到 '+at(avg*(1-cfg.stop/100))]);
  }
  return rows;
}

/* ---------- Form ---------- */
function btFillForm(){
  const c=settings.bt;
  if(!$('btWindow').options.length){$('btWindow').innerHTML=$('window').innerHTML;$('btAnchorMode').innerHTML=$('anchorMode').innerHTML;$('btMethod').innerHTML=$('method').innerHTML}
  const set=(id,v)=>{$(id).value=String(v)};
  set('btWindow',c.window);set('btAnchorMode',c.anchorMode);set('btAnchorCount',c.anchorCount);set('btMethod',c.method);
  set('btEntry',c.entry);set('btDrop',c.drop);set('btBuyGrade',c.buyGrade);set('btStep',c.step);set('btAdds',c.adds);
  set('btExit',c.exit);set('btRise',c.rise);set('btSellGrade',c.sellGrade);set('btFibExt',c.fibExt);set('btStop',c.stop);set('btMaxDays',c.maxDays);
  set('btAmount',c.amount);set('btPeriod',c.period);set('btFee',c.fee);set('btDiscount',c.discount);set('btTax',c.tax);$('btWhole').checked=!!c.wholeShares;
  document.querySelectorAll('.bt-levels input').forEach(x=>{x.checked=c.levels.includes(Number(x.value))});
  const card=$('backtestCard'),show=(sel,on)=>card.querySelectorAll(sel).forEach(e=>e.classList.toggle('hidden',!on));
  show('.bt-if-average',c.anchorMode==='average');show('.bt-if-grade',c.entry==='grade'||c.exit==='grade');
  show('.bt-if-entry-drop',c.entry==='drop');show('.bt-if-entry-fib',c.entry==='fib');show('.bt-if-entry-grade',c.entry==='grade');show('.bt-if-ladder',c.entry!=='fib');
  show('.bt-if-exit-rise',c.exit==='gain'||c.exit==='high');show('.bt-if-exit-grade',c.exit==='grade');show('.bt-if-exit-fibext',c.exit==='fibext');
  $('btMarkers').setAttribute('aria-pressed',String(!!c.markers));
  $('btPresets').querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on',Object.entries(BT_PRESETS[i][1]).every(([k,v])=>JSON.stringify(c[k])===JSON.stringify(v))));
}
function btConfigFromForm(){
  const v=id=>$(id).value,levels=[...document.querySelectorAll('.bt-levels input:checked')].map(x=>Number(x.value)).sort((a,b)=>a-b);
  settings.bt={...settings.bt,window:v('btWindow'),anchorMode:v('btAnchorMode'),anchorCount:Math.round(clampNum(v('btAnchorCount'),1,20,5)),method:v('btMethod')==='fib'?'fib':'equal',
    entry:['drop','fib','grade'].includes(v('btEntry'))?v('btEntry'):'drop',drop:clampNum(v('btDrop'),1,90,20),levels:levels.length?levels:[0.382],buyGrade:Number(v('btBuyGrade'))||5,
    step:clampNum(v('btStep'),1,50,10),adds:Math.round(clampNum(v('btAdds'),0,10,3)),exit:['gain','high','grade','fibext'].includes(v('btExit'))?v('btExit'):'gain',
    rise:clampNum(v('btRise'),0,300,20),sellGrade:Number(v('btSellGrade'))||1,fibExt:[1,1.272,1.618].includes(Number(v('btFibExt')))?Number(v('btFibExt')):1,
    stop:clampNum(v('btStop'),0,90,0),maxDays:Math.round(clampNum(v('btMaxDays'),0,2400,0)),amount:Math.round(clampNum(v('btAmount'),1000,1e8,100000)),
    period:['1','3','5','10','all'].includes(v('btPeriod'))?v('btPeriod'):'5',fee:clampNum(v('btFee'),0,1,0.1425),discount:clampNum(v('btDiscount'),10,100,100),
    tax:clampNum(v('btTax'),0,1,0.1),wholeShares:$('btWhole').checked};
  save();
}
$('btPresets').innerHTML=BT_PRESETS.map(([name])=>`<button class="pill mini" type="button">${name}</button>`).join('');
$('btPresets').querySelectorAll('button').forEach((b,i)=>b.addEventListener('click',()=>{settings.bt={...settings.bt,...BT_PRESETS[i][1]};save();btFillForm();renderBacktest()}));
$('backtestCard').querySelectorAll('.bt-steps input,.bt-steps select').forEach(el=>el.addEventListener('change',()=>{btConfigFromForm();btFillForm();clearTimeout(btTimer);btTimer=setTimeout(renderBacktest,60)}));
$('btSyncView').addEventListener('click',()=>{settings.bt={...settings.bt,window:settings.window,anchorMode:settings.anchorMode,anchorCount:settings.anchorCount,method:settings.method};save();btFillForm();renderBacktest()});
$('btMarkers').addEventListener('click',()=>{settings.bt.markers=!settings.bt.markers;save();btFillForm();applyMarkers()});
$('btCsv').addEventListener('click',()=>{
  if(!btResult)return;
  const rows=[['日期','動作','價格','股數','金額（含費用）','手續費與稅','損益','報酬率','持有天數','原因']].concat(btResult.trades.map(t=>[t.date,t.type==='buy'?'買進':'賣出',t.price,Math.round(t.shares*1000)/1000,Math.round(t.amount),Math.round(t.fee),t.pnl!=null?Math.round(t.pnl):'',t.ret!=null?(t.ret*100).toFixed(2)+'%':'',t.days??'',t.reason]));
  const csv='﻿'+rows.map(r=>r.map(x=>/[",\n]/.test(String(x))?'"'+String(x).replace(/"/g,'""')+'"':x).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=selected+'-回測交易明細.csv';document.body.append(a);a.click();a.remove();
});

/* ---------- Results ---------- */
function btEquityChart(r){
  if(!window.LightweightCharts)return;
  if(!btChart){
    btChart=window.LightweightCharts.createChart($('btEquity'),{...chartOptions(),rightPriceScale:{borderColor:themeColors().border},handleScroll:false,handleScale:false});
    btChart.lines={s:btChart.addLineSeries({color:'#0e7490',lineWidth:2.5,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>fmt(v,1)+'%'}}),
      h:btChart.addLineSeries({color:'#9aa5ab',lineWidth:1.5,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>fmt(v,1)+'%'}}),
      d:btChart.addLineSeries({color:'#e6a23c',lineWidth:1.5,lineStyle:2,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>fmt(v,1)+'%'}})};
  }
  btChart.lines.s.setData(r.equity);btChart.lines.h.setData(r.hold);btChart.lines.d.setData(r.dca);btChart.timeScale().fitContent();
}
function renderBacktest(){
  btBarsRef=bars;
  if(!bars.length||bars.length<40){$('btKpis').innerHTML='<p class="small">需要至少 40 個交易日才能回測。</p>';btResult=null;applyMarkers();return}
  const cfg=settings.bt,ref=btReference(cfg),start=btStartIndex(cfg.period),r=btRun(cfg,ref,start);btResult=r;
  $('btSummary').textContent=btSentence(cfg);
  $('btNow').innerHTML='<h4>今日狀態</h4><dl>'+btNow(r).map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')+'</dl>';
  const cls=v=>v>0?'up':v<0?'down':'';
  const note=r.firstTradable&&r.firstTradable>r.start?`<p class="small">前段用來建立 ${cfg.window} 日區間，${r.firstTradable} 起才開始交易。</p>`:'';
  const big=[['策略報酬',`<span class="${cls(r.ret)}">${pctText(r.ret)}</span>`,'年化 '+pctText(r.cagr)],['同期間買進持有',`<span class="${cls(r.holdRet)}">${pctText(r.holdRet)}</span>`,'期初一次投入'],['定期定額',`<span class="${cls(r.dcaRet)}">${pctText(r.dcaRet)}</span>`,'每月平均投入'],['最大回落','−'+fmt(r.mdd*100,1)+'%','策略資產自高點']];
  const small=[['期間',r.start+' 至 '+r.end],['最高投入資金',money(r.C)],['交易',r.buys+' 買／'+r.sells+' 賣'],['勝率',r.sells?fmt(r.wins/r.sells*100,0)+'%':'—'],['平均持有',r.avgDays!=null?fmt(r.avgDays,0)+' 個交易日':'—'],['在市場時間',fmt(r.exposure*100,0)+'%'],['手續費與稅',money(r.feesPaid)]];
  $('btKpis').innerHTML=(r.buys?'':'<p class="small bt-empty">回測期間沒有觸發買進，可放寬條件或拉長期間。</p>')+note+
    `<div class="bt-big">${big.map(([k,v,s])=>`<div><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('')}</div><div class="bt-small">${small.map(([k,v])=>`<span><small>${k}</small>${v}</span>`).join('')}</div>`;
  btEquityChart(r);
  // Sensitivity: the same window and costs, different entry and exit parameters.
  let rows,cols,rowLabel,colLabel,make,cur;
  if(cfg.entry==='drop'){rows=[10,15,20,25,30];rowLabel='下跌';make=(a,b)=>({drop:a,...b});cur=[cfg.drop]}
  else if(cfg.entry==='fib'){rows=[0.236,0.382,0.5,0.618];rowLabel='第一個位階';make=(a,b)=>({levels:[a,...cfg.levels.filter(x=>x>a)],...b});cur=[cfg.levels[0]]}
  else{rows=[5,4,3];rowLabel='買進分數';make=(a,b)=>({buyGrade:a,...b});cur=[cfg.buyGrade]}
  if(cfg.exit==='gain'||cfg.exit==='high'){cols=[0,10,20,30,50].filter(x=>cfg.exit==='high'||x>0).map(x=>({rise:x}));colLabel=cfg.exit==='gain'?'獲利':'突破前高';cur.push(cfg.rise)}
  else if(cfg.exit==='grade'){cols=[{sellGrade:1},{sellGrade:2}];colLabel='賣出分數';cur.push(cfg.sellGrade)}
  else{cols=[{fibExt:1},{fibExt:1.272},{fibExt:1.618}];colLabel='擴展位';cur.push(cfg.fibExt)}
  const rowText=a=>cfg.entry==='drop'?a+'%':cfg.entry==='fib'?fmt(a*100,1)+'%':a+' 分',colText=b=>{const v=Object.values(b)[0];return cfg.exit==='grade'?v+' 分':cfg.exit==='fibext'?fmt(v*100,1)+'%':v+'%'};
  let g=`<table><thead><tr><th>${rowLabel} ＼ ${colLabel}</th>${cols.map(b=>`<th>${colText(b)}</th>`).join('')}</tr></thead><tbody>`;
  for(const a of rows){g+=`<tr><th>${rowText(a)}</th>`;for(const b of cols){const x=btRun({...cfg,...make(a,b)},ref,start),isCur=a===cur[0]&&Object.values(b)[0]===cur[1];
    const t=Math.max(-1,Math.min(1,x.ret));g+=`<td class="${cls(x.ret)}${isCur?' current':''}" style="--heat:${Math.abs(t)}" title="${x.buys} 買／${x.sells} 賣">${x.buys?pctText(x.ret):'未觸發'}</td>`}g+='</tr>'}
  $('btGrid').innerHTML=g+'</tbody></table><p class="small">框起來的是目前設定；其他條件不變。</p>';
  $('btTradesTitle').textContent='交易明細（'+r.trades.length+' 筆）';
  $('btTrades').innerHTML=r.trades.length?`<table><thead><tr><th>日期</th><th>動作</th><th>價格</th><th>股數</th><th>金額</th><th>損益</th><th>原因</th></tr></thead><tbody>${r.trades.map(t=>`<tr><td>${t.date}</td><td class="${t.type}">${t.type==='buy'?'買進':'賣出'}</td><td>${fmt(t.price,2)}</td><td>${fmt(t.shares,0)}</td><td>${fmt(t.amount,0)}</td><td class="${t.pnl!=null?cls(t.pnl):''}">${t.type==='sell'?(t.pnl>0?'+':'')+fmt(t.pnl,0)+'（'+pctText(t.ret)+'）':''}</td><td>${t.reason}</td></tr>`).join('')}</tbody></table>`:'<p class="small">沒有交易。</p>';
  applyMarkers();
}
function applyMarkers(){
  if(!lwc)return;
  if(!isMember||!btResult||!settings.bt.markers||!lwc.data.length){lwc.s.candle.setMarkers([]);return}
  const dates=lwc.data.map(b=>b.date),markers=[];
  for(const t of btResult.trades){
    let lo=0,hi=dates.length-1,at=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(dates[mid]<=t.date){at=mid;lo=mid+1}else hi=mid-1}
    if(at<0)continue;
    markers.push(t.type==='buy'?{time:dates[at],position:'belowBar',color:'#0e7490',shape:'arrowUp',text:'買'}:{time:dates[at],position:'aboveBar',color:'#c2410c',shape:'arrowDown',text:'賣'});
  }
  markers.sort((a,b)=>a.time.localeCompare(b.time));
  lwc.s.candle.setMarkers(markers);
}
const btDrawChart=drawChart;
drawChart=function(keepView){btDrawChart(keepView);if(bars.length&&btBarsRef!==bars)renderBacktest();else applyMarkers()};
const btPrefs=prefs;
prefs=function(){btPrefs();if(btChart)btChart.applyOptions({...chartOptions(),handleScroll:false,handleScale:false})};
btFillForm();

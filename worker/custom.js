/* ---------- User-defined inputs across the page ---------- */
// "自訂…" in a select opens a small number box; the typed value becomes a normal option.
function bindCustomSelect(select,{min,max,step=1,unit,label}){
  const box=document.createElement('span');box.className='custom-entry hidden';
  box.innerHTML=`<input type="number" min="${min}" max="${max}" step="${step}" inputmode="numeric" aria-label="${label}"><em>${unit}</em><button class="pill mini" type="button">套用</button><button class="pill mini" type="button">取消</button>`;
  select.closest('label').after(box);
  const [input,,ok,cancel]=box.children;let previous=select.value;
  select.addEventListener('focus',()=>{if(select.value!=='custom')previous=select.value});
  // Capture on the target runs before the page's own change handlers, so "custom" never reaches them.
  select.addEventListener('change',e=>{if(select.value!=='custom'){previous=select.value;return}e.stopImmediatePropagation();select.value=previous;input.value=Number(previous)||'';box.classList.remove('hidden');input.focus()},true);
  const apply=()=>{const v=Math.round(Number(input.value));if(!Number.isFinite(v)||v<min||v>max){input.setCustomValidity(`請輸入 ${min}–${max}`);input.reportValidity();return}
    input.setCustomValidity('');customOption(select,v,`${v} ${unit}（自訂）`);select.value=String(v);previous=select.value;box.classList.add('hidden');select.dispatchEvent(new Event('change',{bubbles:true}))};
  ok.addEventListener('click',apply);input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply()}if(e.key==='Escape')box.classList.add('hidden')});
  cancel.addEventListener('click',()=>box.classList.add('hidden'));
}
bindCustomSelect($('window'),{min:20,max:2400,unit:'交易日',label:'自訂觀察窗交易日數'});
bindCustomSelect($('btWindow'),{min:20,max:2400,unit:'交易日',label:'自訂回測觀察窗交易日數'});
bindCustomSelect($('btDcaPeriods'),{min:1,max:240,unit:'期',label:'自訂定期定額期數'});
if(!/^(60|120|200|240|400|600|1200|2400|all)$/.test(String(settings.window))&&Number(settings.window)>0){customOption($('window'),settings.window,settings.window+' 交易日（自訂）');$('window').value=String(settings.window)}

/* Chart range: custom dates. */
$('rangeSeg').addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;const on=b.dataset.range==='custom';$('rangeCustom').classList.toggle('hidden',!on);
  if(on&&bars.length){const last=bars.at(-1).date,d=new Date(last+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-3);$('rangeFrom').value=settings.chartFrom||d.toISOString().slice(0,10);$('rangeTo').value=settings.chartTo||last;$('rangeFrom').min=$('rangeTo').min=bars[0].date;$('rangeFrom').max=$('rangeTo').max=last}});
$('rangeApply').addEventListener('click',()=>{let a=$('rangeFrom').value,z=$('rangeTo').value;if(!a||!z)return;if(a>z)[a,z]=[z,a];settings.chartFrom=a;settings.chartTo=z;save();setRange('custom')});

/* Indicator parameters and K-line style. */
settings.chartType=['candle','ohlc','line'].includes(settings.chartType)?settings.chartType:'candle';
settings.colorScheme=settings.colorScheme==='intl'?'intl':'tw';
const IND_FIELDS=[['indMa1',s=>s.ma[0]],['indMa2',s=>s.ma[1]],['indMa3',s=>s.ma[2]],['indBbN',s=>s.bb[0]],['indBbK',s=>s.bb[1]],['indMacdF',s=>s.macd[0]],['indMacdS',s=>s.macd[1]],['indMacdG',s=>s.macd[2]],['indRsi',s=>s.rsi],['indKd',s=>s.kd]];
function fillIndicators(){
  for(const [id,get] of IND_FIELDS)$(id).value=get(settings.ind);$('chartType').value=settings.chartType;$('colorScheme').value=settings.colorScheme;
  // Overlay buttons and the help text name the periods the user chose.
  document.querySelectorAll('[data-overlay]').forEach(b=>{const j=['ma5','ma20','ma60'].indexOf(b.dataset.overlay);if(j>=0)b.lastChild.textContent=indName.ma(j)});
  document.body.classList.toggle('intl-colors',settings.colorScheme==='intl');
}
function readIndicators(){
  const v=id=>$(id).value;
  settings.ind=normInd({ma:[v('indMa1'),v('indMa2'),v('indMa3')],bb:[v('indBbN'),v('indBbK')],macd:[v('indMacdF'),v('indMacdS'),v('indMacdG')],rsi:v('indRsi'),kd:v('indKd')});
  settings.chartType=$('chartType').value;settings.colorScheme=$('colorScheme').value==='intl'?'intl':'tw';save();fillIndicators();drawChart(true);
}
$('indSettings').addEventListener('change',readIndicators);
$('indReset').addEventListener('click',()=>{settings.ind=normInd(null);settings.chartType='candle';settings.colorScheme='tw';save();fillIndicators();drawChart(true)});
function applyChartStyle(){
  if(!lwc)return;const s=lwc.s,up=settings.colorScheme==='intl'?FALL:RISE,down=settings.colorScheme==='intl'?RISE:FALL,clear='rgba(0,0,0,0)',t=settings.chartType;
  if(!s.ohlc){s.ohlc=lwc.main.addBarSeries({priceLineVisible:false,lastValueVisible:false,thinBars:false});s.closeLine=lwc.main.addLineSeries({color:'#19a7aa',lineWidth:2,priceLineVisible:false,lastValueVisible:false})}
  // The candle series stays (markers and price lines live on it) but turns transparent for the other styles.
  s.candle.applyOptions(t==='candle'?{upColor:up,downColor:down,borderUpColor:up,borderDownColor:down,wickUpColor:up,wickDownColor:down}:{upColor:clear,downColor:clear,borderUpColor:clear,borderDownColor:clear,wickUpColor:clear,wickDownColor:clear});
  s.ohlc.applyOptions({upColor:up,downColor:down,visible:t==='ohlc'});s.closeLine.applyOptions({visible:t==='line'});
  s.ohlc.setData(t==='ohlc'?lwc.data.map(b=>({time:b.date,open:b.open,high:b.high,low:b.low,close:b.close})):[]);
  s.closeLine.setData(t==='line'?lwc.data.map(b=>({time:b.date,value:b.close})):[]);
}
const styleDrawChart=drawChart;
drawChart=function(keepView){styleDrawChart(keepView);applyChartStyle()};
fillIndicators();

/* Weight plan: type an exact percentage next to each slider. */
function syncWeightNumbers(){document.querySelectorAll('.w-num').forEach(n=>{if(document.activeElement!==n)n.value=$(n.dataset.for).value})}
document.querySelectorAll('.w-num').forEach(n=>n.addEventListener('input',()=>{const v=Math.max(0,Math.min(100,Math.round(Number(n.value)||0)));const s=$(n.dataset.for);s.value=v;s.dispatchEvent(new Event('input',{bubbles:true}))}));
const numUpdateWeights=updateWeights;
updateWeights=function(){numUpdateWeights();syncWeightNumbers()};
['wEtf','wIndex','wVolume','wBrent','wFx'].forEach(k=>$(k).addEventListener('input',syncWeightNumbers));
syncWeightNumbers();

/* Tide radar: adjustable water-score threshold. */
RADAR_TESTS.low=x=>x.score>=clampNum($('radarMin').value,0,5,4.5);
$('radarMin').addEventListener('change',()=>{if(radarFilter==='low')renderList()});

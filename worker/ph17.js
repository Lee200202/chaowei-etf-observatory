/* The shared display window is available in all three research views. */
(() => {
  const settingsRow=$('marketWindow').closest('.controls');
  const marketControls=document.createElement('div');
  marketControls.className='lookback-market-controls';
  $('marketContextPanel').querySelector('h3').after(marketControls);
  marketControls.append(...Array.from(settingsRow.children).slice(0,2));

  const picks=[30,60,120,240,600];
  function picker(host){
    const row=document.createElement('div');
    row.className='lookback-picker';
    row.innerHTML='<label>趨勢參考筆數<select>'+picks.map(n=>'<option value="'+n+'">'+n+' 筆</option>').join('')+'<option value="custom">自訂筆數</option></select></label><label class="lookback-custom" hidden>自訂 <output></output><input type="range" min="20" max="2400" step="1"></label>';
    host.append(row);
    const select=row.querySelector('select'),slider=row.querySelector('input'),custom=slider.closest('label'),readout=row.querySelector('output');
    let editing=false;
    function sync(){
      const n=marketN();
      select.value=editing||!picks.includes(n)?'custom':String(n);
      custom.hidden=select.value!=='custom';
      slider.value=n;
      readout.value=n+' 筆';
    }
    select.onchange=()=>{editing=select.value==='custom';if(!editing)setMarketLookback(select.value);sync();if(editing)slider.focus()};
    slider.oninput=()=>setMarketLookback(slider.value);
    if(shareView)select.disabled=slider.disabled=true;
    document.addEventListener('market-lookback',sync);
    sync();
  }
  const matrixControls=document.createElement('div');
  matrixControls.className='matrix-lookback';
  $('matrixCards').before(matrixControls);
  picker(matrixControls);

  const trend=document.createElement('section');
  trend.className='etf-lookback';
  trend.setAttribute('aria-label','ETF 收盤趨勢與價格位置');
  trend.innerHTML='<h4>收盤趨勢</h4><div class="etf-lookback-tools"></div><div class="etf-lookback-plot"></div>';
  $('chartCard').before(trend);
  picker(trend.querySelector('.etf-lookback-tools'));
  const graph=trend.querySelector('.etf-lookback-plot');
  const closePlot=document.createElement('div'),gauge=document.createElement('div');
  graph.append(closePlot,gauge);
  let lastBars,lastN;
  function draw(){
    const n=marketN();
    if(bars!==lastBars||n!==lastN){
      lastBars=bars;lastN=n;
      closePlot.innerHTML=renderLookbackTrend(bars.filter(bar=>!bar.intraday).map(bar=>[bar.date,bar.close]),n,value=>fmt(value,2)+' 元');
    }
    gauge.innerHTML=lookbackGauge(position?.r);
  }
  const render=renderPosition;
  renderPosition=function(...args){const result=render(...args);draw();return result};
  document.addEventListener('market-lookback',()=>{
    draw();
    if(document.body.dataset.page!=='explore'||!bars.length)return;
    settings.chartFrom=bars[Math.max(0,bars.length-marketN())].date;
    settings.chartTo=bars.at(-1).date;
    setRange('custom');
    save();
  });
  draw();
})();

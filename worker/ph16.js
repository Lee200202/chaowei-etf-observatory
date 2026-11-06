/* Market cards share a single native dialog and keep the existing trend renderer. */
(() => {
  const rail = $('factorRail');
  const modal = document.createElement('dialog');
  modal.id = 'marketFullscreenModal';
  modal.className = 'market-fullscreen';
  modal.setAttribute('aria-labelledby', 'marketDialogTitle');
  modal.innerHTML = '<div class="market-dialog-head"><h2 id="marketDialogTitle">市場歷史趨勢</h2><button type="button" class="pill">關閉</button></div><div class="market-dialog-settings"></div><p class="small market-dialog-source"></p>';
  document.body.append(modal);
  modal.append(trendPanel, bankPanel);
  $('bankTrendDetails').remove();
  $('market').classList.add('market-compact');
  $('marketOverview').querySelector('small').textContent = '可計分因子';
  $('brentScore').closest('.factor').querySelector('.factor-note').textContent = 'Yahoo BZ=F 近月連續期貨 · 分數與歷史圖採日收盤';
  $('oilFutureMeta').hidden = true;
  $('fxScore').closest('.factor').querySelector('h4').textContent = '美元／新台幣';
  $('factorNote').textContent = '行情每 5 分鐘檢查 · 日資料依來源發布';

  const vixTile = document.createElement('div');
  vixTile.className = 'factor vix-factor';
  vixTile.innerHTML = '<h4>恐慌指數 VIX</h4><strong id="vixScore">—</strong><p class="direction-action" id="action-vix"></p><p class="vix-frequency">Cboe 美東交易日收盤</p><span class="factor-more">查看歷史趨勢</span>';
  rail.append(vixTile);
  makeDirection('vix',vixTile,$('vixScore'));
  const vixDate = vixTile.querySelector('.vix-frequency');
  async function loadVix() {
    try {
      const response = await fetch('/api/vix');
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.days) || !data.days.length) throw Error('無 VIX 日資料');
      vixDays = mergeDays(vixDays, data.days.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.value > 0));
      const last = vixDays.at(-1);
      if (!last) return;
      refreshDirectionViews();
      updateWeights();
      document.dispatchEvent(new Event('vix-updated'));
      if (factorTrendKey === 'vix') renderFactorTrend();
    } catch {
      document.dispatchEvent(new Event('vix-updated'));
      if (!vixDays.length) vixDate.textContent = 'Cboe 日資料暫不可用';
    }
  }
  FACTOR_TRENDS.vix = {title:'恐慌指數 VIX', unit:'點', color:'#8563af', data:()=>vixDays.map(row=>[row.date,row.value]), fmt:value=>fmt(value,2)+' 點'};
  FACTOR_TRENDS.bank = {title:'八大官股 · 區間累計淨額', unit:'億元', color:'#16867d', data:()=>bankDays.map(row=>[row.date,row.value]), fmt:value=>fmt(value,2)+' 億元'};
  bankTile.dataset.trend = 'bank';
  vixTile.dataset.trend = 'vix';
  for (const tile of [bankTile, vixTile]) {
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-expanded', 'false');
    tile.setAttribute('aria-label', tile.querySelector('h4').textContent + '：查看趨勢圖');
  }
  for (const tile of rail.querySelectorAll('[data-trend]')) tile.setAttribute('aria-haspopup','dialog');
  rail.setAttribute('aria-label','七項市場刻度');
  let opener = null;
  let direction = null;
  const source = modal.querySelector('.market-dialog-source');
  const references = {
    index:['臺灣證券交易所','https://mis.twse.com.tw/stock/','歷史趨勢採每日收盤。'],
    volume:['臺灣證券交易所','https://mis.twse.com.tw/stock/','歷史趨勢採完整交易日的成交股數。'],
    brent:['Yahoo Finance BZ=F','https://finance.yahoo.com/quote/BZ=F/','趨勢及分數採近月期貨日收盤，換月可能造成價差。'],
    fx:['中央銀行收盤匯率','https://www.cbc.gov.tw/tw/lp-645-1.html','趨勢及分數採銀行間收盤，卡片另可顯示 Yahoo 延遲報價。'],
    margin:['臺灣證券交易所信用交易統計','https://www.twse.com.tw/zh/trading/margin/mi-margn.html','以每日融資餘額增減比較。'],
    bank:['玩股網官股參考','https://www.wantgoo.com/stock/public-bank/buy-sell','圖表採 HiStock 八大行庫全市場每日淨額。'],
    vix:['Cboe VIX 歷史資料','https://www.cboe.com/tradable-products/vix/vix-historical-data','以美東交易日收盤計分。14 以下波動偏低，25 起恐慌偏高，30 起屬高恐慌區；分數依設定方向換算。']
  };
  modal.querySelector('button').onclick = () => modal.close();
  modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
  function restoreDirection() {
    if (direction && opener) opener.querySelector('strong[id$="Score"]').before(direction);
    direction = null;
    opener?.setAttribute('aria-expanded', 'false');
  }
  modal.addEventListener('close', () => {
    restoreDirection();
    factorTrendKey = null;
    trendPanel.classList.add('hidden');
    opener?.focus({preventScroll:true});
    opener = null;
  });
  openFactorTrend = function(key) {
    if (modal.open && factorTrendKey === key) { modal.close(); return; }
    if (!FACTOR_TRENDS[key]) return;
    restoreDirection();
    opener = rail.querySelector('[data-trend="'+key+'"]');
    opener.setAttribute('aria-expanded','true');
    direction = opener.querySelector('.factor-direction');
    if (direction) modal.querySelector('.market-dialog-settings').append(direction);
    factorTrendKey = key;
    $('marketDialogTitle').textContent = FACTOR_TRENDS[key].title;
    const [label, href, description] = references[key];
    const link = document.createElement('a');
    link.textContent = label;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    source.replaceChildren(document.createTextNode(description+' '),link);
    if(key==='vix')for(const [name,url] of [['OANDA 指數說明','https://www.oanda.com/bvi-ft/lab-education/dictionary/vix/'],['CMoney 波動解讀','https://www.cmoney.tw/notes/note-detail.aspx?nid=60671']]){
      const extra=link.cloneNode();extra.textContent=name;extra.href=url;source.append(' · ',extra);
    }
    trendPanel.classList.remove('hidden');
    bankPanel.hidden = key !== 'bank';
    if (!modal.open) modal.showModal();
    renderFactorTrend();
    if (key === 'bank') renderBankTrend();
  };
  const previousBank = computeBank;
  computeBank = function() {
    previousBank();
    if (factorTrendKey === 'bank') renderFactorTrend();
  };
  loadVix();
  setInterval(() => { if (!document.hidden && document.body.dataset.page === 'market') loadVix(); }, 30*60000);
})();

/* Use the current catalogue and daily radar for typeahead, and the shared picker to switch ETF. */
(() => {
  const box = document.createElement('div');
  box.className = 'etf-typeahead';
  box.innerHTML = '<label for="etfLiveSearchInput">快速切換 ETF</label><input id="etfLiveSearchInput" type="search" placeholder="輸入代號或名稱，例如 0050、高股息" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="etfAutocompleteDropdown" autocomplete="off"><div id="etfAutocompleteDropdown" role="listbox" aria-label="ETF 搜尋結果" hidden></div><p class="small" role="status"></p>';
  const ticker=$('compactTicker');
  ticker.before(box);
  const chips=document.createElement('div');
  chips.className='etf-quick-switch';
  chips.setAttribute('role','group');
  chips.setAttribute('aria-label','熱門 ETF 快速切換');
  for(const code of ['0050','0056','00878','00919','00980A','00981A','00982A']){
    const button=document.createElement('button');
    button.type='button';
    button.className='pill mini'+(code.endsWith('A')?' is-active-type':'');
    button.textContent=code;
    button.dataset.quickCode=code;
    button.addEventListener('click',()=>choose(code));
    chips.append(button);
  }
  box.append(chips);
  function reflectQuick(){
    for(const button of chips.children)button.setAttribute('aria-pressed',String(button.dataset.quickCode===selected));
  }
  reflectQuick();
  const previousPosition=renderPosition;
  renderPosition=function(){previousPosition();reflectQuick()};
  const input = $('etfLiveSearchInput'), list = $('etfAutocompleteDropdown'), status = box.querySelector('[role=status]');
  let choices = [], highlighted = -1, generation = 0;
  function close() {
    generation++;
    list.hidden = true;
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
    status.textContent = '';
  }
  function choose(code) {
    close();
    input.value = '';
    pick(code,false);
  }
  function paint(snapshot) {
    list.replaceChildren();
    choices.forEach((etf,index) => {
      const quote = snapshot?.map.get(etf.code);
      const option = document.createElement('div');
      option.id = 'etf-autocomplete-' + index;
      option.setAttribute('role','option');
      option.setAttribute('aria-selected', String(highlighted === index));
      option.dataset.code = etf.code;
      const title = document.createElement('strong');
      title.textContent = etf.code + ' · ' + etf.name;
      const badge = document.createElement('span');
      badge.className = 'etf-type-badge' + (etf.type === 'active' ? ' is-active-type' : '');
      badge.textContent = etf.type === 'active' ? '主動型' : '被動型';
      const info = document.createElement('small');
      if (Number.isFinite(quote?.close)) {
        info.textContent = (quote.date || snapshot.latest || '日資料') + ' 收盤 ' + fmt(quote.close,2) +
          (Number.isFinite(quote.chg) ? ' · ' + pctText(quote.chg/100) : '');
        info.className = quote.chg > 0 ? 'up' : quote.chg < 0 ? 'down' : '';
      } else info.textContent = '收盤資料待載入';
      const grade = document.createElement('small');
      grade.textContent = Number.isFinite(quote?.score) ? '水位 ' + fmt(quote.score,1) + '／5' : '水位 —';
      option.append(title,badge,info,grade);
      list.append(option);
    });
    list.hidden = choices.length === 0;
    input.setAttribute('aria-expanded',String(!list.hidden));
    status.textContent = choices.length ? '顯示 ' + choices.length + ' 檔 · 價格與水位採日資料' : (catalog.length ? '找不到符合的 ETF' : 'ETF 名錄載入中');
  }
  function search() {
    const token = ++generation, query = input.value.trim().toLowerCase();
    choices = catalog.filter(etf => (etf.code+' '+etf.name+' '+(etf.note||'')+' '+(etf.type==='active'?'主動型':'被動型')).toLowerCase().includes(query))
      .sort((a,b)=>(b.code.toLowerCase()===query)-(a.code.toLowerCase()===query)||(b.code.toLowerCase().startsWith(query))-(a.code.toLowerCase().startsWith(query)))
      .slice(0,8);
    highlighted = -1;
    input.removeAttribute('aria-activedescendant');
    paint(null);
    loadRadar().then(snapshot=>{if(generation===token && document.activeElement===input) paint(snapshot)});
  }
  input.addEventListener('focus',search);
  input.addEventListener('input',search);
  input.addEventListener('keydown',event => {
    if (event.key==='Escape') { close(); return; }
    if (event.isComposing || !choices.length) return;
    if (event.key==='Enter' && !list.hidden) {
      event.preventDefault();
      choose(choices[Math.max(0,highlighted)].code);
    } else if (event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();
      if (list.hidden) search();
      if (!choices.length) return;
      highlighted = highlighted<0 && event.key==='ArrowUp' ? choices.length-1 :
        (highlighted+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
      const options = Array.from(list.children);
      options.forEach((option,index)=>option.setAttribute('aria-selected',String(index===highlighted)));
      input.setAttribute('aria-activedescendant', options[highlighted].id);
      options[highlighted].scrollIntoView({block:'nearest'});
    }
  });
  list.addEventListener('pointerdown',event=>event.preventDefault());
  list.addEventListener('click',event=>{const option=event.target.closest('[data-code]');if(option)choose(option.dataset.code)});
  input.addEventListener('blur',close);
  const previousRenderList = renderList;
  renderList = function(...args) {
    const result = previousRenderList(...args);
    if(document.activeElement===input) search();
    return result;
  };
})();

/* Route explicit changes through the current window, chart, and backtest controls. */
(() => {
  const details = document.createElement('details');
  details.className = 'custom-observation metric-detail';
  details.innerHTML = '<summary>自訂觀察區間</summary><div class="custom-observation-fields"><label>交易日數<input id="customObservationDays" type="number" min="20" max="2400" step="1"></label><label>快速調整<input id="customObservationSlider" type="range" min="20" max="2400" step="1"></label><label>起日<input id="customObservationFrom" type="date"></label><label>迄日<input id="customObservationTo" type="date"></label></div><p class="small">日數會同步至回測的觀察窗。填入起訖日會同步選定圖表和回測期間，最新水位仍以最新交易日為基準。</p><p class="small" role="status"></p>';
  $('scenarios').after(details);
  const days=$('customObservationDays'), slider=$('customObservationSlider'), from=$('customObservationFrom'), to=$('customObservationTo'), status=details.querySelector('[role=status]');
  const windowSelect=$('window');
  let timer;
  function reflect() {
    const count=Number(windowSelect.value);
    if(Number.isInteger(count)&&count>=20&&count<=2400) days.value=slider.value=count;
  }
  function apply(count,start,end,updatePeriod) {
    customOption(windowSelect,count,count+' 交易日（自訂）');
    windowSelect.value=String(count);
    settings.bt.sync=true;
    if(updatePeriod) Object.assign(settings.bt,{period:'custom',from:start,to:end});
    windowSelect.dispatchEvent(new Event('change',{bubbles:true}));
    btFillForm();
    btSchedule();
    settings.chartFrom=start;
    settings.chartTo=end;
    setRange('custom');
    save();
    status.textContent=count+' 個交易日 · '+start+' 至 '+end;
  }
  function onDays() {
    const count=days.valueAsNumber;
    if(!Number.isInteger(count)||count<20||count>2400||!bars.length) return;
    const start=bars[Math.max(0,bars.length-count)].date, end=bars.at(-1).date;
    from.value=to.value='';
    apply(count,start,end,false);
    status.textContent='觀察窗 '+count+' 日 · 圖表顯示 '+Math.min(count,bars.length)+' 日';
  }
  function onDates() {
    clearTimeout(timer);
    if(!from.value||!to.value) return;
    const rows=bars.filter(row=>row.date>=from.value&&row.date<=to.value);
    if(rows.length<20||rows.length>2400) {
      status.textContent='請選取含 20–2400 筆日 K 的起訖期間。';
      return;
    }
    apply(rows.length,rows[0].date,rows.at(-1).date,true);
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(onDays,120)};
  days.addEventListener('input',schedule);
  slider.addEventListener('input',()=>{days.value=slider.value;schedule()});
  from.addEventListener('change',onDates);
  to.addEventListener('change',onDates);
  windowSelect.addEventListener('change',reflect);
  details.addEventListener('toggle',reflect);
  if(shareView) details.querySelectorAll('input').forEach(input=>input.disabled=true);
  reflect();
})();

function customMovingAverage() {
  const saved=settings.customMa||{}, period=Number(saved.period);
  return {enabled:saved.enabled===true, period:Number.isInteger(period)&&period>=1&&period<=2400?period:120,
    algorithm:saved.algorithm==='ema'?'ema':'sma',color:/^#[0-9a-f]{6}$/i.test(saved.color)?saved.color:'#e879f9',style:saved.style==='solid'?'solid':'dashed'};
}
function customMovingAverageValues(rows, config) {
  const close=rows.map(row=>row.close);
  if(config.algorithm==='sma') return sma(close,config.period);
  return ema(close,config.period).map((value,index)=>index>=config.period-1?value:null);
}
const tidePricePalette=['#10b981','#06b6d4','#64748b','#f59e0b','#f43f5e'];
function setTideTone(card, location) {
  const available=Number.isFinite(location);
  card.classList.toggle('tide-tone',available);
  if(available) card.style.setProperty('--tide-accent',tidePricePalette[Math.max(0,Math.min(4,Math.floor(location*5)))]);
}
(() => {
  const field=document.createElement('fieldset');
  field.className='custom-ma-settings';
  field.innerHTML='<legend>第 4 條自訂均線</legend><label><input id="customMaEnabled" type="checkbox"> 顯示自訂均線</label><label>期數（依日／週／月 K）<input id="customMaPeriod" type="number" min="1" max="2400" step="1"></label><label>算法<select id="customMaAlgorithm"><option value="sma">SMA 簡單均線</option><option value="ema">EMA 指數均線</option></select></label><label>顏色<input id="customMaColor" type="color"></label><label>線型<select id="customMaStyle"><option value="dashed">虛線</option><option value="solid">實線</option></select></label><output id="customMaBias" aria-live="polite"></output>';
  $('indSettings').querySelector('.ind-grid').append(field);
  function fill() {
    const config=customMovingAverage();
    $('customMaEnabled').checked=config.enabled;
    $('customMaPeriod').value=config.period;
    $('customMaAlgorithm').value=config.algorithm;
    $('customMaColor').value=config.color;
    $('customMaStyle').value=config.style;
  }
  field.addEventListener('change',event=>{
    event.stopPropagation();
    const period=$('customMaPeriod').valueAsNumber;
    if(!Number.isInteger(period)||period<1||period>2400) { fill();return; }
    settings.customMa={enabled:$('customMaEnabled').checked,period,algorithm:$('customMaAlgorithm').value,color:$('customMaColor').value,style:$('customMaStyle').value};
    save();
    drawChart(true);
  });
  $('indReset').addEventListener('click',()=>{delete settings.customMa;fill();save();drawChart(true)},true);
  const previousDraw=drawChart;
  drawChart=function(...args) {
    const result=previousDraw(...args), config=customMovingAverage();
    if(!lwc?.data.length) return result;
    if(!config.enabled) {
      lwc.s.customMa?.applyOptions({visible:false});
      $('customMaBias').textContent='';
      return result;
    }
    const values=customMovingAverageValues(lwc.data,config), last=values.at(-1);
    if(!lwc.s.customMa) lwc.s.customMa=lwc.main.addLineSeries({lineWidth:2,priceLineVisible:false,lastValueVisible:false});
    lwc.s.customMa.setData(seriesData(lwc.data,values));
    lwc.s.customMa.applyOptions({visible:true,color:config.color,lineStyle:config.style==='solid'?0:2});
    $('customMaBias').textContent=last>0?config.algorithm.toUpperCase()+config.period+' · 乖離 '+pctText(lwc.data.at(-1).close/last-1):'可用 K 棒不足 '+config.period+' 根';
    return result;
  };
  const previousProfile=window.chaoweiApplyProfile;
  window.chaoweiApplyProfile=profile=>{previousProfile(profile);fill();drawChart(true)};
  fill();
})();

(() => {
  const glossary=[
    ['均線','均線平滑價格，方便看近期平均價格走向。','https://www.tradingview.com/support/solutions/43000502589-moving-averages/'],
    ['乖離率 BIAS','現價比均線高或低多少百分比。','https://www.cmoney.tw/notes/note-detail.aspx?nid=20148'],
    ['布林通道 %B','0 代表下軌，1 代表上軌，突破區間時可以小於 0 或大於 1。','https://www.tradingview.com/support/solutions/43000501971-bollinger-bands-b-b/'],
    ['KD 鈍化','K、D 長時間停在高檔或低檔，常見於趨勢延續。','https://www.tradingview.com/support/solutions/43000502332-stochastic-stoch/'],
    ['RSI 與 MACD','RSI 比較漲跌力道，MACD 用快慢均線的差追蹤動能變化。','https://www.pocket.tw/school/articles/4289/'],
    ['最大回撤 MDD','衡量資產從先前高峰到後續低點的最大跌幅。','https://www.tradingview.com/support/solutions/43000681683-performance-summary-tab/'],
    ['夏普比率 Sharpe','以報酬波動為分母，比較每單位風險的超額報酬。','https://web.stanford.edu/~wfsharpe/art/sr/sr.htm']
  ];
  const guide=$('technicalGuide'), terms=document.createElement('div');
  terms.className='tech-glossary';
  for(const [term,explanation,href] of glossary){
    const item=document.createElement('article');
    item.innerHTML='<h4></h4><p></p><a class="pill mini" target="_blank" rel="noopener noreferrer">原理教學</a>';
    item.querySelector('h4').textContent=term;
    item.querySelector('p').textContent=explanation;
    item.querySelector('a').href=href;
    item.querySelector('a').setAttribute('aria-label',term+'原理教學');
    terms.append(item);
  }
  const formulas=document.createElement('details');
  formulas.className='metric-detail';
  formulas.innerHTML='<summary>指標公式與口徑</summary>';
  formulas.append(...guide.querySelectorAll(':scope > dl,:scope > p'));
  function diagram(){
    const figure=document.createElement('figure');
    figure.className='tide-demo';
    figure.innerHTML='<svg viewBox="0 0 600 120" role="img" aria-label="由低至高的五段價格水位，洋紅虛線代表自訂均線，三個圓點示意分批進場">'+
      tidePricePalette.map((color,index)=>'<rect x="'+(index*120)+'" y="8" width="118" height="16" rx="7" fill="'+color+'"/>').join('')+
      '<path d="M20 90 Q150 93 245 70 T580 55" fill="none" stroke="#e879f9" stroke-width="4" stroke-dasharray="10 8"/><path d="M20 83 L120 96 L204 76 L290 94 L385 58 L460 77 L580 38" fill="none" stroke="currentColor" stroke-width="3"/><g fill="#10b981"><circle cx="120" cy="96" r="6"/><circle cx="290" cy="94" r="6"/><circle cx="460" cy="77" r="6"/></g></svg><figcaption>從左到右依序是極低、偏低、中性、偏高、極高價位。先選 ETF 和觀察期間，再加一條自訂均線，最後用分批點位理解策略。圖中圓點為示意。</figcaption>';
    return figure;
  }
  guide.append(diagram(),terms,formulas);
  const chartGuide=$('chartCard').querySelector('.guide-link');
  if(chartGuide){
    const brief=document.createElement('details');
    brief.className='metric-detail';
    brief.innerHTML='<summary>一眼看懂水位、均線與分批</summary>';
    brief.append(diagram());
    chartGuide.before(brief);
  }
  const waterCard=$('grade').closest('.water-card');
  const previousRender=renderPosition;
  renderPosition=function(...args){
    const result=previousRender(...args);
    if(waterCard) setTideTone(waterCard,position?.r);
    return result;
  };
})();

/* Layout preference, kept on this device only: 「電腦版」 makes a phone render the full desktop layout (as a
   1280px-wide page it can zoom), and on a computer a button opens the site in a phone-sized window, where the
   real mobile layout applies (it follows the window width, so a narrow column inside this page would not). */
(()=>{
 const meta=document.querySelector('meta[name=viewport]'),narrow=matchMedia('(max-width: 760px)');
 settings.layoutMode=settings.layoutMode==='desktop'?'desktop':'auto';
 const apply=()=>{meta.setAttribute('content',settings.layoutMode==='desktop'?'width=1280':'width=device-width,initial-scale=1');$('layoutMode').value=settings.layoutMode};
 $('layoutMode').addEventListener('change',e=>{settings.layoutMode=e.target.value==='desktop'?'desktop':'auto';save();apply()});
 const phoneButton=()=>{$('openPhoneView').hidden=narrow.matches||settings.layoutMode==='desktop'&&screen.width<760};
 $('openPhoneView').addEventListener('click',()=>window.open(location.href,'chaoweiPhoneView','width=400,height=860'));
 narrow.addEventListener('change',phoneButton);apply();phoneButton();
})();
/* Shared disclosure and FAQ markup. No financial settings are changed here. */
(()=>{
 const marketHeading=$('market').querySelector('h3');if(marketHeading){marketHeading.textContent='觀測因子';marketHeading.previousElementSibling?.remove()}
 const group=document.querySelector('.method-steps');for(const summary of group.querySelectorAll(':scope > details > summary')){const m=summary.textContent.trim().match(/^(\d{2})\s*(.+)$/);if(!m)continue;const num=document.createElement('span'),title=document.createElement('strong'),state=document.createElement('span');num.className='faq-number';num.textContent=m[1];title.className='faq-question';title.textContent=m[2];state.className='faq-state';state.textContent=summary.parentElement.open?'收起':'展開';state.setAttribute('aria-hidden','true');summary.replaceChildren(num,title,state);summary.parentElement.addEventListener('toggle',()=>state.textContent=summary.parentElement.open?'收起':'展開')}
 for(const a of document.querySelectorAll('#pageNav a')){const text=a.textContent.trim(),short=({'首頁':'首頁','ETF 觀測':'ETF','市場刻度':'市場','策略白板':'白板','方法說明':'說明'})[text];if(short){a.setAttribute('aria-label',text);const full=document.createElement('span'),small=document.createElement('span');full.className='nav-full';full.textContent=text;small.className='nav-short';small.textContent=short;small.setAttribute('aria-hidden','true');a.replaceChildren(full,small)}}
 const form=document.querySelector('.view-card'),advanced=document.createElement('details');advanced.className='metric-detail observation-settings';advanced.id='observationSettings';advanced.innerHTML='<summary>觀察設定與收藏</summary>';const fields=form.querySelector('.controls'),fav=$('favBar');fields.before(advanced);advanced.append(fields,fav);if(settings.studyMode==='full')advanced.open=true;
 // Range remains available on the chart; repeated mode choices are represented by the single study bar.
 $('btMode').hidden=true;$('btMode').setAttribute('aria-hidden','true');
 const originalPosition=computePosition;function observationTitle(){const w=$('window').value,m=$('method').value;advanced.querySelector('summary').textContent='觀察設定 · '+(w==='all'?'全部':w+' 日')+'／'+(m==='fib'?'黃金分割':'等距')}computePosition=function(...args){const r=originalPosition(...args);observationTitle();return r};observationTitle();
 const range=$('rangeSeg'),more=document.createElement('select');more.id='chartRangeMore';more.setAttribute('aria-label','其他顯示期間');more.add(new Option('其他期間',''));const extraButtons=new Map();for(const b of range.querySelectorAll('[data-range]'))if(!['1m','3m','1','all'].includes(b.dataset.range)){extraButtons.set(b.dataset.range,b);more.add(new Option(b.textContent.trim(),b.dataset.range));b.hidden=true}range.append(more);more.onchange=()=>{extraButtons.get(more.value)?.click()};const oldRange=setRange;setRange=function(v,...args){const r=oldRange(v,...args);more.value=extraButtons.has(v)?v:'';return r};
 const indicators=document.createElement('details');indicators.id='chartIndicatorSettings';indicators.className='metric-detail';indicators.innerHTML='<summary>技術指標與圖表設定</summary>';const indicatorTools=$('chartCard').querySelector('.indicator-tools');indicatorTools.before(indicators);indicators.append(indicatorTools,$('chartCard').querySelector('.level-tools'),$('indSettings'));
 const step=$('btParams').closest('.bt-step'),title=step.querySelector('h4');if(title)title.innerHTML='<b>2</b> 觸發條件';
 const label=$('btDcaPeriods').closest('label');label.classList.remove('expert-only');$('btCapitalMode').closest('label').classList.remove('expert-only');
 for(const details of group.children)if(details.tagName==='DETAILS')details.addEventListener('toggle',()=>{if(details.open)for(const other of group.children)if(other!==details&&other.tagName==='DETAILS')other.open=false});
 // The chart pans and zooms by wheel, drag and pinch; the four step buttons move into the chart settings so the
 // toolbar keeps only the ranges plus 貼合畫面／回到最新區間. They stay available for keyboard users there.
 const zoom=$('chartCard').querySelector('.zoom-controls'),settingsPanel=$('chartIndicatorSettings');
 if(zoom&&settingsPanel){const box=document.createElement('div');box.className='zoom-moved';box.innerHTML='<span class="small">移動與縮放（也可用滑鼠滾輪、拖曳或雙指）</span>';box.append(zoom);settingsPanel.querySelector(':scope > summary').after(box)}
})();

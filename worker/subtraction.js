/* ph9: one place for each decision. Existing controls and charts are moved, never cloned. */
(()=>{
 document.body.classList.add('subtraction-site');
 const node=(tag,cls,html='')=>{const n=document.createElement(tag);n.className=cls;n.innerHTML=html;return n},drawer=(title,id)=>{const d=node('details','metric-detail');d.id=id;d.append(node('summary','',title));return d};
 // Three home sections. Stop the removed preview's animation without replacing real market data.
 $('homePage').querySelector('.feature-gallery')?.remove();$('homePage').querySelector('.member-story')?.remove();
 const hero=$('homePage').querySelector('.hero-actions');hero.querySelector('a').textContent='開始觀測 ETF';hero.querySelector('a.secondary').textContent='進入策略白板';
 const nav=$('siteHeader').querySelector('nav'),menu=$('openSiteMenu'),lesson=$('homeTour'),motion=$('homeMotion');
 lesson.className='pill ph9-nav-tool';lesson.title='10 步使用教學';lesson.setAttribute('aria-label',lesson.title);lesson.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2M12 17v1"/></svg>';nav.insertBefore(lesson,menu);
 // Preserve the original motion handler; put the play/pause state in accessible text, not a long header label.
 const motionIcon=node('button','pill ph9-nav-tool');motionIcon.type='button';motionIcon.id='headerMotion';motionIcon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 5v14M16 5v14"/></svg>';motionIcon.onclick=()=>motion.click();nav.insertBefore(motionIcon,menu);motion.hidden=true;
 function motionLabel(){const off=document.body.classList.contains('motion-paused');motionIcon.setAttribute('aria-label',off?'播放頁面動畫':'暫停頁面動畫');motionIcon.title=off?'播放頁面動畫':'暫停頁面動畫';motionIcon.setAttribute('aria-pressed',String(off));motionIcon.querySelector('path').setAttribute('d',off?'M8 5l11 7-11 7z':'M8 5v14M16 5v14')};new MutationObserver(motionLabel).observe(document.body,{attributes:true,attributeFilter:['class']});motionLabel();
 // Compact ticker: title/quote, a search action, and the user's existing candidate buttons.
 const ticker=node('section','compact-ticker');ticker.id='compactTicker';ticker.setAttribute('aria-label','目前 ETF 與候選');const toolbar=document.querySelector('.toolbar');$('researchDesk').before(ticker);ticker.append(toolbar);
 const search=node('button','pill mini ticker-search','搜尋 ETF');search.type='button';search.onclick=openSearch;toolbar.append(search);ticker.append($('quickInline'));
 $('openSearch').hidden=true;const sectionHeading=$('explore').querySelector(':scope > .section-heading');if(sectionHeading)sectionHeading.hidden=true;
 document.querySelector('.study-mode-bar').hidden=true;document.querySelector('.first-visit').hidden=true;
 if($('observationSettings'))$('observationSettings').open=false;
 // Only today's diagnosis remains at the right. Risk and holdout have one home below the backtest.
 const side=document.querySelector('.research-side');side.querySelector('.research-side-tabs').hidden=true;$('researchPane0').hidden=false;
 const training=$('trainingLab'),trainingWrapper=training.closest('.member-only');$('backtestCard').append(trainingWrapper);training.open=false;
 $('researchPane1').hidden=true;$('researchPane2').hidden=true;$('researchRisk').hidden=true;
 document.querySelectorAll('.study-drawer').forEach(d=>d.open=false);
 const riskDetail=drawer('回撤事件與計算假設','backtestRiskDetails');$('backtestCard').append(riskDetail);riskDetail.append($('researchRiskContent'));$('researchRiskContent').removeAttribute('data-member-gated');
 // Three tabs, one plot stage. Both original charts retain their data and shared time/crosshair hooks.
 const wrap=$('btEquity').closest('.bt-equity-wrap'),topLegend=wrap.querySelector('.bt-equity-legend'),underLegend=wrap.querySelector('.bt-equity-legend.sub');
 const actionDrawer=drawer('依規則查看下一步','nextActionDetails');wrap.after(actionDrawer);actionDrawer.append($('btNow'));
 $('btVerdict').hidden=true;
 const chartTabs=node('div','backtest-chart-tabs');chartTabs.setAttribute('role','tablist');chartTabs.setAttribute('aria-label','回測圖表');wrap.before(chartTabs);
 const scoreDrawer=drawer('每日水位與交易對照','scoreHistoryDetails');wrap.after(scoreDrawer);scoreDrawer.append($('showDailyScore').closest('label'),$('dailyScorePanel'));
 let chartMode=0,cashSeries=null,chartOwner=null;
 const titles=['累積資產','持股與現金','回撤與交易'];titles.forEach((title,i)=>{const b=node('button','',title);b.id='btPlotTab'+i;b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-controls',i===0?'btEquity':'btUnder');b.onclick=()=>selectPlot(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;selectPlot(next);$('btPlotTab'+next).focus()}};chartTabs.append(b)});
 function selectPlot(i){const c=btCharts,range=c&&(chartMode===0?c.top:c.under).timeScale().getVisibleLogicalRange();chartMode=i;chartTabs.querySelectorAll('button').forEach((b,j)=>{b.setAttribute('aria-selected',String(j===i));b.tabIndex=i===j?0:-1});$('btEquity').hidden=i!==0;topLegend.hidden=i!==0;$('btUnder').hidden=i===0;underLegend.hidden=i===0;
  underLegend.innerHTML=i===1?'<span class="e">持股比例（左軸）</span><span class="cash">現金池（右軸，元）</span>':'<span class="s">策略回落</span><span class="d">定投回落</span><span>紅點買進 · 綠點賣出</span>';
  if(c){if(chartOwner!==c){chartOwner=c;cashSeries=c.under.addLineSeries({priceScaleId:'right',color:'#b78636',priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'custom',formatter:v=>money(v)}})}
   const axisFormat={type:'custom',formatter:i===1?v=>money(v):v=>fmt(v,1)+'%'};
   c.sd.applyOptions({visible:i===2,priceFormat:axisFormat});c.dd.applyOptions({visible:i===2,priceFormat:axisFormat});c.e.applyOptions({visible:i===1,lineColor:'#248b97',lineWidth:2,priceFormat:{type:'custom',formatter:v=>fmt(v,0)+'%'},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});cashSeries.applyOptions({visible:i===1});c.under.priceScale('left').applyOptions({visible:i===1,autoScale:true});c.under.priceScale('right').applyOptions({visible:true,autoScale:true});
   if(btResult){cashSeries.setData(btResult.series.map(x=>({time:x.time,value:Math.max(0,x.value*(1-x.exposure))})));c.sd.setMarkers(i===2?btResult.trades.map(t=>({time:t.date,position:t.type==='buy'?'belowBar':'aboveBar',color:t.type==='buy'?'#e44960':'#139974',shape:'circle',text:''})).sort((a,b)=>a.time.localeCompare(b.time)):[])}
   requestAnimationFrame(()=>{const active=i===0?c.top:c.under,host=i===0?$('btEquity'):$('btUnder');if(host.clientWidth>0){active.resize(host.clientWidth,310);active.applyOptions({timeScale:{visible:true}});if(range){c.top.timeScale().setVisibleLogicalRange(range);c.under.timeScale().setVisibleLogicalRange(range)}else active.timeScale().fitContent()}})
  }wrap.dataset.plot=String(i);
 }
 scoreDrawer.addEventListener('toggle',()=>window.dispatchEvent(new Event('chaowei-page-changed')));
 function scorecard(r){const annual=btAnnual(r),dca=btAnnual(r.dca,r.monthly),rounds=r.rounds,events=r.drawdowns||[],longest=events.reduce((a,b)=>!a||b.tradingDays>a.tradingDays?b:a,null),rate=rounds?.total?rounds.wins/rounds.total:null;
  const k=[['總資金'+(r.monthly?'年化 · XIRR':'年化 · CAGR'),pctText(annual),'定投 '+pctText(dca)+' · 持有 '+pctText(r.bh.cagr),annual],['最大回落','−'+fmt(r.mdd*100,1)+'%',longest?'最長水下 '+longest.tradingDays+' 交易日'+(longest.ongoing?'（尚未恢復）':''):'沒有回撤事件',-r.mdd],['風險調整',r.sharpe==null?'—':fmt(r.sharpe,2),'Sharpe · Calmar '+(r.calmar==null?'—':fmt(r.calmar,2)),r.sharpe],['平均持股',fmt(r.utilization*100,0)+'%',rate==null?'完整回合尚無已結束樣本':'完整回合勝率 '+fmt(rate*100,0)+'% · '+rounds.total+' 回合',r.utilization]];
  $('btKpis').innerHTML='<p class="bt-kpi-note">'+(r.monthly?'每月實際入金，以 XIRR 比較策略與定投；買進持有為期初全額資金，另外列示。':'同一筆期初本金、相同停泊利率與成交成本。CAGR 包含閒置現金與第一筆費用。')+'</p><div class="bt-big">'+k.map(([label,value,detail,v])=>'<div><small>'+label+'</small><b class="'+(v>0?'up':v<0?'down':'')+'">'+value+'</b><span>'+detail+'</span></div>').join('')+'</div><div class="bt-small hidden"></div>';
  const alpha=annual-dca,against=annual-r.bh.cagr;const note=node('p','scorecard-baseline small','年化差：對定投 '+(Math.abs(alpha)<5e-5?'0.00':(alpha>0?'+':'−')+fmt(Math.abs(alpha)*100,2))+' 個百分點'+(!r.monthly?'；對買進持有 '+(against>0?'+':'')+fmt(against*100,2)+' 個百分點':'。薪資模式不把兩種資金到位方式判為勝負。'));$('btKpis').append(note);
  if(r.utilization<.3)$('btKpis').append(node('p','exposure-warning','平均持股不足 30%，可能長時間等待訊號。可檢查進場條件、觀察窗與底倉設定；增加每批金額不會讓訊號提早出現。'));
  const facts=$('financialDetails')?.querySelector('.financial-facts');if(facts){facts.querySelectorAll('[data-ph9-xirr]').forEach(n=>n.remove());const dt=node('dt','','現金流 XIRR'),dd=node('dd','',pctText(r.xirr)+'（依實際入金）');dt.dataset.ph9Xirr='';dd.dataset.ph9Xirr='';facts.append(dt,dd)}
  // Keep recovery events and methodology, remove repeated headline metrics.
  const risk=$('researchRiskContent');risk.querySelector('.rd-risk-values')?.remove();risk.querySelector('.rd-exposure')?.remove();risk.querySelector('.rd-risk-mini')?.remove();risk.querySelector('a[href="#fundingComparison"]')?.remove();risk.querySelectorAll(':scope > h3,:scope > h4,:scope > .kicker,:scope > p').forEach(el=>{if(el.textContent==='主要回撤')return;el.remove()});
 }
 const old=renderBacktest;renderBacktest=function(...args){const out=old(...args);if(btResult){scorecard(btResult);selectPlot(chartMode)}return out};
 // Daily overview, not a second bank factor. The timestamp stays with source status.
 const refresh=$('refreshClock').closest('.factor');refresh.classList.add('market-refresh-status');$('factorNote').after(refresh);
 const bankDetails=drawer('官股每日買賣超長條圖','bankTrendDetails');$('bankScore').closest('.factor').append(bankDetails);bankDetails.append($('bankMarketTrend'));bankDetails.addEventListener('toggle',()=>{if(bankDetails.open)renderBankTrend()});
 $('factorRail').classList.add('is-grid');$('factorRail').setAttribute('aria-label','六大市場刻度');document.querySelector('.market-view-tools').hidden=true;document.querySelector('.factor-rail-nav').hidden=true;
 // Restore the chosen graph after font/theme and route changes, keeping the date span.
 window.addEventListener('chaowei-page-changed',()=>selectPlot(chartMode));window.addEventListener('chaowei-typography-changed',()=>selectPlot(chartMode));
 const memberBefore=window.chaoweiSetMember;window.chaoweiSetMember=value=>{memberBefore(value);if(btResult)scorecard(btResult)};
 window.chaoweiSetMember(isMember);selectPlot(0);if(btResult)scorecard(btResult);
})();

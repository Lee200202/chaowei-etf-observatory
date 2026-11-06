/* Presentation only: normal page scrolling, no alteration of chart/data math. */
(()=>{
 const menu=$('siteMenu'),inner=menu.querySelector('.site-menu-inner'),head=inner.querySelector('.site-menu-head'),account=inner.querySelector('[data-menu-account]');
 document.body.append(menu);inner.replaceChildren(head);const nav=document.createElement('nav');nav.className='ph13-menu-nav';nav.setAttribute('aria-label','網站功能');
 for(const [href,title,desc] of [['homePage','一眼總覽','從候選 ETF 開始。'],['explore','ETF 觀測','價格、水位與歷史回測。'],['marketPage','市場刻度','量能、原油、匯率與籌碼。'],['strategyBoardPage','策略白板','把條件連成自己的規則。'],['guidePage','方法說明','先看圖解，再設定。']]){const a=document.createElement('a');a.href='#'+href;const h=document.createElement('strong');h.textContent=title;const p=document.createElement('span');p.textContent=desc;a.append(h,p);nav.append(a)}
 const aside=document.createElement('aside');aside.className='ph13-menu-tools';const title=document.createElement('h3');title.textContent='接著，想做什麼？';aside.append(title);const status=document.createElement('p');status.className='small';aside.append(status);
 for(const [text,id] of [['搜尋 ETF','openSearchTop'],['打開策略對話','openQuantChat']]){const b=document.createElement('button');b.type='button';b.className='pill';b.textContent=text;b.onclick=()=>{$('closeSiteMenu').click();$(id).click()};aside.append(b)}if(account){account.classList.add('pill');aside.append(account)};
 const quick=document.createElement('div');quick.className='ph13-menu-etfs';const label=document.createElement('p');label.textContent='快速觀測';quick.append(label);for(const code of ['0050','0056','00878','00919','00981A','009816']){const b=document.createElement('button');b.type='button';b.className='pill mini';b.textContent=code;b.onclick=()=>{$('closeSiteMenu').click();pick(code)};quick.append(b)}aside.append(quick);inner.append(nav,aside);
 $('openSiteMenu').addEventListener('click',()=>{status.textContent=(isMember?'已登入，可保存研究。':'可直接看行情；登入可保存研究。')+' 最近確認收盤 '+(historyMeta?.snapshotLatest||bars.at(-1)?.date||'讀取中')+'。'});
 document.querySelectorAll('.purpose-index').forEach(e=>e.remove());
})();

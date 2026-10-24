const IndicatorDirection=(()=>{
  const clamp=x=>Math.max(0,Math.min(5,x));
  const meta={
    etf:{name:'ETF 價格',modes:[['low_buy','價格越低 → 分高'],['high_buy','價格越高 → 分高']],default:'low_buy'},
    index:{name:'大盤價格',modes:[['low_buy','指數越低 → 分高'],['high_buy','指數越高 → 分高']],default:'low_buy'},
    volume:{name:'大盤量能',modes:[['low_buy','量縮 → 分高'],['high_buy','量增 → 分高'],['smart_pv','價量配合（實驗規則）']],default:'low_buy'},
    oil:{name:'布蘭特現貨',modes:[['low_buy','油價越低 → 分高'],['high_buy','油價越高 → 分高']],default:'low_buy'},
    fx:{name:'美元／新台幣',modes:[['twd_strong_buy','匯率低／台幣升 → 分高'],['twd_weak_buy','匯率高／台幣貶 → 分高']],default:'twd_strong_buy'},
    margin:{name:'大盤融資增減',modes:[['decrease_buy','融資減少 → 分高'],['increase_buy','融資增加 → 分高']],default:'decrease_buy'},
    bank:{name:'全市場官股',modes:[['buy_follow','官股買超 → 分高'],['sell_follow','官股賣超 → 分高']],default:'buy_follow'}
  };
  const presets={
    value:{etf:'low_buy',index:'low_buy',volume:'low_buy',oil:'low_buy',fx:'twd_weak_buy',margin:'decrease_buy',bank:'buy_follow'},
    trend:{etf:'high_buy',index:'high_buy',volume:'high_buy',oil:'low_buy',fx:'twd_strong_buy',margin:'increase_buy',bank:'sell_follow'},
    hedge:{etf:'low_buy',index:'high_buy',volume:'smart_pv',oil:'low_buy',fx:'twd_strong_buy',margin:'decrease_buy',bank:'buy_follow'}
  };
  function normalize(m={}){return Object.fromEntries(Object.entries(meta).map(([k,v])=>[k,v.modes.some(x=>x[0]===m?.[k])?m[k]:v.default]))}
  function score(key,base,mode,{rank,pricePosition}={}){
    if(key==='volume'){
      if(!Number.isFinite(rank))return null;
      if(mode==='smart_pv')return Number.isFinite(pricePosition)?clamp(2.5+10*(.5-pricePosition)*(rank-.3)):null;
      return clamp(5*(mode==='low_buy'?1-rank:rank));
    }
    if(!Number.isFinite(base))return null;
    const flip=mode==='high_buy'||mode==='increase_buy'||mode==='sell_follow'||key==='fx'&&mode==='twd_weak_buy';
    return clamp(flip?5-base:base);
  }
  function action(score){return !Number.isFinite(score)?{kind:'missing',text:'資料不足，暫不判讀'}:score>=4?{kind:'increase',text:'依設定：偏向增加配置'}:score<=2?{kind:'decrease',text:'依設定：偏向降低配置'}:{kind:'neutral',text:'依設定：維持觀察'}}
  return{meta,presets,normalize,score,action};
})();

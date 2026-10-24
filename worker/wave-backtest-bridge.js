// Use confirmed training segments only when a test start date is specified.
var waveBridgeData=null;
const WaveBacktestBridge=(()=>{
  function summarize(segments,cutoff){
    const sample=segments.filter(s=>!cutoff||s.availableDate<cutoff),up=sample.filter(s=>s.change>0),down=sample.filter(s=>s.change<0),mean=a=>a.length?a.reduce((n,s)=>n+Math.abs(s.change),0)/a.length:null;
    return{up:mean(up),down:mean(down),upCount:up.length,downCount:down.length,count:sample.length};
  }
  return{summarize};
})();
const bridge=document.createElement('div');bridge.className='wave-bridge';bridge.innerHTML='<p class="small" id="waveBridgeNote">完成波段計算後，可帶入回測。</p><button type="button" class="pill" id="waveToBacktest" disabled>套用平均波段至回測</button>';$('waveSummary').after(bridge);
function refreshWaveBridge(){
  const d=waveBridgeData,s=d&&d.code===selected?WaveBacktestBridge.summarize(d.segments,d.params.cutoff):null;
  const enoughTest=!d?.params.cutoff||bars.filter(b=>b.date>=d.params.cutoff).length>=41;
  $('waveToBacktest').disabled=!isMember||!s?.up||!s?.down||shareView||!enoughTest;
  $('waveBridgeNote').textContent=s?.up&&s?.down?`${d.params.cutoff?'僅用測試起日前確認的訓練段':'全段描述統計（樣本內）'}：上漲 ${s.upCount} 段均幅 ${fmt(s.up,1)}%，拉回 ${s.downCount} 段均幅 ${fmt(s.down,1)}%。帶入後仍以日 K 回測，不代表轉折可預知。`:'需要已確認的上漲及拉回段，才能帶入參數。';
  if(!enoughTest)$('waveBridgeNote').textContent+=' 測試期需至少 41 個交易日；請將起日往前調整。';
}
const bridgeRender=window.chaoweiWave.render;window.chaoweiWave.render=function(){waveBridgeData=null;bridgeRender();refreshWaveBridge()};
$('waveToBacktest').addEventListener('click',()=>{
  if(!isMember||!waveBridgeData||waveBridgeData.code!==selected)return;
  const d=waveBridgeData,s=WaveBacktestBridge.summarize(d.segments,d.params.cutoff);if(!s.up||!s.down)return;
  const round=x=>Math.round(x*10)/10;
  Object.assign(settings.bt,{family:'swing',preset:'custom',strategy:'classic',params:{...E.PARAMS.classic,entry:'drop',drop:Math.max(1,Math.min(90,round(s.down))),exit:'gain',rise:Math.min(300,round(s.up))},waveOrigin:{code:selected,interval:d.interval,cutoff:d.params.cutoff||'',upCount:s.upCount,downCount:s.downCount}});
  if(d.params.cutoff)Object.assign(settings.bt,{period:'custom',from:d.params.cutoff,to:bars.at(-1).date});
  save();btFillForm();btSchedule();renderWaveOrigin();$('backtestCard').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
});
const origin=document.createElement('p');origin.id='btWaveOrigin';origin.className='small wave-origin';$('btParams').after(origin);
function renderWaveOrigin(){const o=settings.bt.waveOrigin;origin.textContent=o&&settings.bt.strategy==='classic'?`參數來源：${o.code} ${o.interval} K 的 ${o.upCount} 段上漲／${o.downCount} 段拉回。${o.cutoff?'只用 '+o.cutoff+' 前確認資料；下方起日已設為測試期。':'全段樣本內統計，未構成樣本外驗證。'}帶入後可自行調整；方向選單不會改寫回測內原有的水位交易條件。`:''}
const bridgeFill=btFillForm;btFillForm=function(){bridgeFill();renderWaveOrigin()};refreshWaveBridge();renderWaveOrigin();
const bridgePreset=btApplyPreset;btApplyPreset=function(...args){delete settings.bt.waveOrigin;bridgePreset(...args)};

// The price's raw position remains unchanged. Direction only changes the observation/weight score.
var polarityReady=false;
const DM=IndicatorDirection;
function migrateDirections(){
  const old=settings.factorModes;
  settings.factorModes=DM.normalize(old);
  if(!old){if(settings.fxDirection==='high')settings.factorModes.fx='twd_weak_buy';if(settings.volumeDirection==='high')settings.factorModes.volume='high_buy'}
}
migrateDirections();
const DKEYS=['etf','index','volume','oil','fx','margin','bank'];
function directionScore(key){
  if(key==='volume'){
    if(!marketPosition||marketPosition.volumeGrade==null)return null;
    const last=marketPosition.last,n=settings.window==='all'?market.length:Number(settings.window),prior=market.filter(x=>x.date<last.date).slice(-n),range=scalarRange(prior.map(x=>x.index));
    const p=range?(last.index-range.low)/(range.high-range.low):null;
    return DM.score(key,null,settings.factorModes.volume,{rank:marketPosition.volumeScore/5,pricePosition:p});
  }
  const base={etf:position?.core,index:marketPosition?.index?.core,oil:brentPosition?.core,fx:fxPosition?(settings.fxDirection==='high'?5-fxPosition.core:fxPosition.core):null,margin:mktMarginPosition?.core,bank:bankPosition?.core}[key];
  return DM.score(key,base,settings.factorModes[key]);
}
const directionSelects=[];
function makeDirection(key,parent,before=null){
  const select=document.createElement('select');select.className='factor-direction';select.setAttribute('aria-label',DM.meta[key].name+'計分方向');select.dataset.direction=key;
  for(const[value,label]of DM.meta[key].modes)select.add(new Option(label,value));
  select.value=settings.factorModes[key];select.disabled=shareView;select.addEventListener('click',e=>e.stopPropagation());select.addEventListener('keydown',e=>e.stopPropagation());
  select.addEventListener('change',e=>{e.stopPropagation();settings.factorModes[key]=select.value;applyDirections()});
  before?parent.insertBefore(select,before):parent.append(select);directionSelects.push(select);return select;
}
const scoreIds={index:'indexScore',volume:'volumeScore',oil:'brentScore',fx:'fxScore',margin:'mktMarginScore',bank:'bankScore'};
makeDirection('etf',$('grade').parentElement,$('grade'));
for(const[key,id]of Object.entries(scoreIds)){const score=$(id),parent=score.closest('.factor');makeDirection(key,parent,score);const tag=document.createElement('p');tag.className='direction-action';tag.id='action-'+key;score.after(tag)}
const etfAction=document.createElement('p');etfAction.className='direction-action';etfAction.id='action-etf';$('waterText').after(etfAction);
for(const[key,id]of Object.entries({etf:'wEtf',index:'wIndex',volume:'wVolume',oil:'wBrent',fx:'wFx',margin:'wMktMargin',bank:'wBank'})){const row=$(id).closest('.weight'),wrap=document.createElement('div');wrap.className='weight-direction';makeDirection(key,wrap);row.append(wrap)}
// Keep old controls for existing saved plans and backtest code, but expose only the explicit wording above.
$('fxDirection').classList.add('hidden');$('volumeDirection').closest('label').classList.add('hidden');
const logic=document.createElement('div');logic.className='direction-presets';logic.innerHTML='<p class="small">分數高＝依你的規則偏向增加配置；分數低＝偏向降低。這是位置／規則讀數，不是勝率或固定持股比例。</p><div class="segment" role="group" aria-label="指標方向預設包"><button type="button" data-direction-preset="value">🛡 價值低接</button><button type="button" data-direction-preset="trend">↗ 順勢觀察</button><button type="button" data-direction-preset="hedge">▥ 債券／避險參考</button></div>';
$('market').querySelector('.card-heading').after(logic);
logic.addEventListener('click',e=>{const b=e.target.closest('[data-direction-preset]');if(!b||shareView)return;settings.factorModes={...DM.presets[b.dataset.directionPreset]};applyDirections()});
if(shareView)logic.querySelectorAll('button').forEach(b=>b.disabled=true);
function refreshDirectionViews(){
  if(!polarityReady)return;
  const ids={...scoreIds,etf:'grade'};
  for(const[key,id]of Object.entries(ids)){
    const s=directionScore(key),node=$(id);if(key==='etf'){node.innerHTML=Number.isFinite(s)?fmt(s,1)+'<small>/5</small>':'—<small>/5</small>';$('barGrade').textContent=Number.isFinite(s)?fmt(s,1)+' / 5':'—'}else node.textContent=Number.isFinite(s)?fmt(s,1)+' / 5':'—';
    const a=DM.action(s),tag=$('action-'+key);tag.className='direction-action '+a.kind;tag.textContent=a.text;
  }
  for(const select of directionSelects)select.value=settings.factorModes[select.dataset.direction];
  if(fxPosition)$('fxMeta').textContent=fmt(fxPosition.last.value,3)+' 新台幣／美元 · '+fxPosition.last.date+' · '+(settings.factorModes.fx==='twd_strong_buy'?'數字低＝台幣較強，分高':'數字高＝台幣較弱，分高');
  bankTile.querySelector('small').textContent=(settings.factorModes.bank==='buy_follow'?'買超加分':'賣超加分')+' · 平日約 20:00 單次擷取';
  const a=DM.action(Number.parseFloat($('combined').textContent));$('combinedAction').textContent=a.text;$('combinedAction').className='direction-action '+a.kind;
}
const combinedAction=document.createElement('p');combinedAction.id='combinedAction';$('combined').after(combinedAction);
const directionHelp=document.createElement('details');directionHelp.innerHTML='<summary>05 方向、分數與配置傾向</summary><p>顯示分數為 0–5 分，4 分以上標示偏向增加配置、2 分以下偏向降低，其餘維持觀察；依各項方向設定判讀，不代表勝率或固定持股比例。價格圖與原始相對位置不會因方向反轉而改變。</p><p>匯率是 USD/TWD：數字變小表示台幣較強，變大表示台幣較弱。正反方向得分互補，合計 5 分；不能由匯率或官股單項推定外資流向。價量配合是實驗規則，使用大盤價格位置與成交股數百分位，尚未驗證預測能力。</p><p>油價使用美元現貨日資料，盤中期貨另列。融資用當日增減、官股用全市場淨額，以零為基準；常態模式採 Z 分數映射，並非報酬機率。方向可保存在權重方案；歷史策略的交易條件仍依回測區設定。</p>';
document.querySelector('.method-steps').append(directionHelp);
function applyDirections(){
  settings.fxDirection=settings.factorModes.fx==='twd_strong_buy'?'low':'high';$('fxDirection').value=settings.fxDirection;
  settings.volumeDirection=settings.factorModes.volume==='low_buy'?'low':'high';$('volumeDirection').value=settings.volumeDirection;
  computeFx();updateWeights();refreshDirectionViews();save();
  btCtx=null;btSchedule();
}
const directionUpdate=updateWeights;updateWeights=function(){directionUpdate();refreshDirectionViews()};
const directionRender=renderPosition;renderPosition=function(){directionRender();refreshDirectionViews()};
const directionProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{directionProfile(p);migrateDirections();applyDirections()};
polarityReady=true;applyDirections();

/* Optional margin factors next to the five base weights: this ETF's margin balance and the market-wide balance.
   Absent data never becomes a zero score; a factor with weight but no data pauses the combined score. */
const EXTRA_FACTORS=[
  {id:'wMargin',setting:'marginWeight',label:'本檔融資餘額',name:'本檔融資',score:()=>marginScore()},
  {id:'wMktMargin',setting:'mktMarginWeight',label:'大盤融資餘額',name:'大盤融資',score:()=>mktMarginPosition?.core??null}
];
for(const f of EXTRA_FACTORS){
  const row=document.createElement('div');row.className='weight';
  row.innerHTML=`<label for="${f.id}">${f.label}</label><input id="${f.id}" type="range" min="0" max="100" step="1" value="0"><input class="w-num" type="number" min="0" max="100" step="1" data-for="${f.id}" aria-label="${f.label}權重數值"><output id="o${f.id.slice(1)}">0%</output>`;
  $('weights').querySelector('.weights').append(row);f.row=row;
  settings[f.setting]=Math.max(0,Math.min(100,Number(settings[f.setting])||0));
  $(f.id).value=settings[f.setting];$(f.id).disabled=shareView;row.querySelector('.w-num').value=$(f.id).value;
  $(f.id).addEventListener('input',()=>{row.querySelector('.w-num').value=$(f.id).value;updateWeights()});
  row.querySelector('.w-num').addEventListener('input',e=>{$(f.id).value=Math.max(0,Math.min(100,Number(e.target.value)||0));updateWeights()});
}
const marginControls=document.createElement('div');marginControls.className='controls';
marginControls.innerHTML='<label>本檔融資解讀<select id="marginDirection"><option value="low">融資越低分越高</option><option value="high">融資越高分越高</option></select></label><span class="small">本檔：今日融資餘額在近 60 個交易日的位置，資料不足 20 天停算。大盤：與上方「大盤融資餘額」卡同一分數，方向在該卡設定。</span>';
$('weights').querySelector('.weights').after(marginControls);
const bankHint=document.createElement('p');bankHint.className='small';bankHint.textContent='八大官股：尚無授權逐檔資料，暫不開放加權。';marginControls.after(bankHint);
settings.marginDirection=settings.marginDirection==='high'?'high':'low';
$('marginDirection').value=settings.marginDirection;$('marginDirection').disabled=shareView;
function marginScore(){
  if(chipCode!==selected)return null;
  const through=$('chipDate').value||chipRows.at(-1)?.[0];
  const values=chipRows.filter(r=>r[0]<=through).slice(-60).map(r=>r[7]).filter(Number.isFinite);
  if(values.length<20)return null;
  const low=Math.min(...values),high=Math.max(...values);if(high===low)return null;
  const r=(values.at(-1)-low)/(high-low);
  return 5*(settings.marginDirection==='low'?1-r:r);
}
const fiveFactorWeights=updateWeights;
updateWeights=function(){
  fiveFactorWeights();
  const five=(settings.weights||[]).map(x=>Number(x)||0),extra=EXTRA_FACTORS.map(f=>Number($(f.id).value)||0),weights=[...five,...extra],sum=weights.reduce((a,b)=>a+b,0);
  EXTRA_FACTORS.forEach((f,i)=>settings[f.setting]=extra[i]);settings.marginDirection=$('marginDirection').value;
  const outs=['oEtf','oIndex','oVolume','oBrent','oFx',...EXTRA_FACTORS.map(f=>'o'+f.id.slice(1))];
  outs.forEach((id,i)=>$(id).textContent=sum?Math.round(weights[i]/sum*100)+'%':'0%');
  const names=['本檔 ETF','大盤價格','大盤量能','原油（00642U）','美元／新台幣',...EXTRA_FACTORS.map(f=>f.name)];
  $('weightBar').innerHTML=weights.map((w,i)=>w>0&&sum>0?`<span class="w${i}" style="width:${(w/sum*100).toFixed(2)}%" title="${names[i]} ${Math.round(w/sum*100)}%">${w/sum>=0.12?names[i]+' '+Math.round(w/sum*100)+'%':''}</span>`:'').join('');
  $('weightStatus').textContent=sum===100?'權重合計 100%':sum>0?`權重合計 ${sum}%，依比例換算成 100%`:'請至少設定一項權重';
  const base=[position?.core,marketPosition?.index?.core,marketPosition?.volumeGrade==null||settings.volumeDirection==='off'?null:settings.volumeDirection==='low'?5-marketPosition.volumeScore:marketPosition.volumeScore,brentPosition?.core,fxPosition?.core];
  const scores=[...base,...EXTRA_FACTORS.map(f=>f.score())];
  const missing=weights.findIndex((w,i)=>w>0&&!Number.isFinite(scores[i]));
  if(sum<=0||missing>=0||!position){$('combined').textContent='—';$('combinedExtra').textContent=sum<=0?'請至少設定一項權重':missing>=5?`${names[missing]}可用資料不足，暫停綜合分`:'選取的因子資料不足';$('weightPreview').textContent='';save();return}
  const value=weights.reduce((n,w,i)=>n+w*scores[i],0)/sum;
  $('combined').textContent=fmt(value,1)+' / 5';
  $('combinedExtra').textContent=EXTRA_FACTORS.filter((f,i)=>extra[i]>0).map(f=>`${f.name} ${fmt(f.score(),1)} 分`).join(' · ')||'延伸綜合分請參照各項位置';
  const d=value-position.core;
  $('weightPreview').innerHTML=`只看 ${selected}：<b>${fmt(position.core,1)}</b> 分 → 依你的權重：<b>${fmt(value,1)}</b> 分`+(Math.abs(d)>=0.05?`（${d>0?'偏向加碼':'偏向減碼'} ${fmt(Math.abs(d),1)} 分）`:'');
  save();
};
$('marginDirection').addEventListener('change',updateWeights);
// Settings from the signed-in account arrive later; move the extra controls with them.
const marginApplyProfile=window.chaoweiApplyProfile;
window.chaoweiApplyProfile=profile=>{marginApplyProfile(profile);
  for(const f of EXTRA_FACTORS){$(f.id).value=Math.max(0,Math.min(100,Number(settings[f.setting])||0));f.row.querySelector('.w-num').value=$(f.id).value}
  $('marginDirection').value=settings.marginDirection==='high'?'high':'low';
  if($('mktMarginDirection')){$('mktMarginDirection').value=settings.mktMarginDirection==='high'?'high':'low';computeMktMargin()}
  updateWeights()};
updateWeights();

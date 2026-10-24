// An optional current-observation factor. Historical backtest entry rules remain independent.
const ChipResonance=(()=>{
  function evaluate(chips,holders,{days=3,holder='1000',mode='both',through='9999-12-31'}={}){
    const daily=chips.filter(r=>r[0]<=through).slice(-days),weekly=holders.filter(r=>r[0]<=through).slice(-2),net=daily.map(r=>r[4]),col=holder==='400'?2:3;
    const inst=daily.length===days&&net.every(Number.isFinite)?net.every(x=>x>0):null;
    const change=weekly.length===2&&weekly.every(r=>Number.isFinite(r[col]))?weekly[1][col]-weekly[0][col]:null,held=change==null?null:change>0;
    const enabled=mode==='institution'?[inst]:mode==='holder'?[held]:[inst,held],score=enabled.some(x=>x===null)?null:5*enabled.filter(Boolean).length/enabled.length;
    return{score,inst,held,change,dailyDate:daily.at(-1)?.[0],holderDate:weekly.at(-1)?.[0]};
  }
  return{evaluate};
})();
function normalizeResonance(){const p=settings.chipResonance||{};settings.chipResonance={days:[2,3,5,10].includes(Number(p.days))?Number(p.days):3,holder:p.holder==='400'?'400':'1000',mode:['both','institution','holder'].includes(p.mode)?p.mode:'both'}}
normalizeResonance();
const resonance=document.createElement('div');resonance.className='resonance-panel';resonance.innerHTML='<h4>籌碼共振 <span class="member-badge">會員</span></h4><div class="controls"><label>觀察規則<select id="resonanceMode"><option value="both">法人＋大戶</option><option value="institution">只看法人連買</option><option value="holder">只看大戶週增</option></select></label><label>法人連買<select id="resonanceDays"><option value="2">2 日</option><option value="3">3 日</option><option value="5">5 日</option><option value="10">10 日</option></select></label><label>大戶門檻<select id="resonanceHolder"><option value="1000">1,000 張以上</option><option value="400">400 張以上</option></select></label></div><p id="resonanceReading" aria-live="polite" class="small"></p><p class="small">法人以三大法人合計買賣超判斷；大戶比較最近兩筆集保比例。每項成立得 5 分、不成立 0 分，兩項取平均。這是自訂規則，非勝率；只納入當前綜合分，未接入歷史回測。</p>';
$('chipContents').after(resonance);
function resonanceScore(){if(!isMember||chipCode!==selected)return null;return ChipResonance.evaluate(chipRows,holderRowsByCode.get(selected)||[],{...settings.chipResonance,through:$('chipDate').value||chipRows.at(-1)?.[0]}).score}
const resonanceFactor={id:'wResonance',setting:'chipResonanceWeight',label:'ETF 籌碼共振（會員）',name:'籌碼共振',score:resonanceScore};EXTRA_FACTORS.push(resonanceFactor);
const resonanceRow=document.createElement('div');resonanceRow.className='weight';resonanceRow.innerHTML='<label for="wResonance">ETF 籌碼共振（會員）</label><input id="wResonance" type="range" min="0" max="100" step="1" value="0"><input class="w-num" type="number" min="0" max="100" step="1" data-for="wResonance" aria-label="籌碼共振權重數值"><output id="oResonance">0%</output>';$('weights').querySelector('.weights').append(resonanceRow);resonanceFactor.row=resonanceRow;
function resonanceView(){const p=settings.chipResonance;for(const [id,key]of [['resonanceMode','mode'],['resonanceDays','days'],['resonanceHolder','holder']]){$(id).value=p[key];$(id).disabled=!isMember||shareView}$('wResonance').disabled=!isMember||shareView;resonanceRow.querySelector('.w-num').disabled=!isMember||shareView;if(!isMember){$('resonanceReading').textContent='Google 登入後可查看並納入權重。';return}const r=ChipResonance.evaluate(chipRows,holderRowsByCode.get(selected)||[],{...p,through:$('chipDate').value||chipRows.at(-1)?.[0]});$('resonanceReading').textContent=`${Number.isFinite(r.score)?fmt(r.score,1)+' / 5':'資料不足，暫不計分'} · 法人 ${r.dailyDate||'—'}：${r.inst===null?'不足 '+p.days+' 筆':r.inst?'連買成立':'連買未成立'} · 集保 ${r.holderDate||'—'}：${r.change==null?'需兩週資料':(r.change>=0?'+':'')+fmt(r.change,2)+' 個百分點'}`}
for(const [id,key]of [['resonanceMode','mode'],['resonanceDays','days'],['resonanceHolder','holder']])$(id).addEventListener('change',()=>{settings.chipResonance[key]=key==='days'?Number($(id).value):$(id).value;updateWeights()});
function resonanceWeight(){settings.chipResonanceWeight=Math.max(0,Math.min(100,Number(settings.chipResonanceWeight)||0));$('wResonance').value=settings.chipResonanceWeight;resonanceRow.querySelector('.w-num').value=settings.chipResonanceWeight}
$('wResonance').addEventListener('input',()=>{resonanceRow.querySelector('.w-num').value=$('wResonance').value;updateWeights()});resonanceRow.querySelector('.w-num').addEventListener('input',e=>{$('wResonance').value=Math.max(0,Math.min(100,Number(e.target.value)||0));updateWeights()});
const resonanceUpdate=updateWeights;updateWeights=function(){resonanceUpdate();resonanceView()};
const resonanceChip=renderChip;renderChip=function(){resonanceChip();updateWeights()};
const resonanceHolders=renderHolders;renderHolders=function(...args){resonanceHolders(...args);updateWeights()};
const resonanceMember=window.chaoweiResearchMemberChanged;window.chaoweiResearchMemberChanged=signed=>{resonanceMember?.(signed);updateWeights()};
const resonanceProfile=window.chaoweiApplyProfile;window.chaoweiApplyProfile=p=>{resonanceProfile(p);normalizeResonance();resonanceWeight();updateWeights()};resonanceWeight();updateWeights();

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../worker/chart-readouts.js',import.meta.url),'utf8');
const pure=source.slice(0,source.indexOf('/* Readouts'));
const R=new Function(pure+';return MarketReadout')();
for(const [domain,positive,negative] of [
  ['flow','買超','賣超'],['cumulative','區間累計買超','區間累計賣超'],
  ['margin','融資增加','融資減少'],['pnl','獲利','虧損'],['comparison','領先定投','落後定投']
]){
  const up=R.state(31.05,domain,'億元'),down=R.state(-84.59,domain,'億元');
  assert.ok(up.label.startsWith(positive+' +'));
  assert.ok(!up.label.includes(negative));
  assert.equal(up.color,'#f43f5e');
  assert.ok(down.label.startsWith(negative+' -'));
  assert.ok(!down.label.includes(positive));
  assert.equal(down.color,'#10b981');
}
assert.equal(R.state(null).label,'未取得資料');
assert.equal(R.state(NaN).label,'未取得資料');
assert.equal(R.state(undefined).label,'未取得資料');
assert.equal(R.state(-0.0001).label,'買賣持平 0.00 億元');
assert.equal(R.state(-12.345,'flow','張',1).label,'賣超 -12.3 張');
assert.equal(R.cleanText('\u{1F44B} 0050 \u2728 +12.5%'), ' 0050  +12.5%');
console.log('PASS readouts: exclusive buy/sell, margin and P&L states, correct units, missing values, no negative zero, AI decoration removed without changing financial numbers.');

// Layout rules from the skill spec (design-motion B8): uneven card rhythm, readouts that never cover a line chart,
// and a day-change pill. Static checks on the stylesheet and readout code so a later edit cannot quietly undo them.
import fs from 'node:fs';import assert from 'node:assert/strict';
const css=fs.readFileSync('worker/ph18.css','utf8').replace(/\r\n/g,'\n'),js=fs.readFileSync('worker/chart-readouts.js','utf8'),cards=fs.readFileSync('worker/redesign.js','utf8');
const block=q=>{const i=css.indexOf(q);assert.ok(i>=0,'missing '+q);let depth=0,j=css.indexOf('{',i);for(let k=j;k<css.length;k++){if(css[k]==='{')depth++;if(css[k]==='}'&&--depth===0)return css.slice(j,k+1)}return''};
for(const [query,cols] of [['@media(min-width:1000px)',12],['@media(min-width:720px) and (max-width:999px)',10]]){
  const b=block(query);assert.ok(b.includes('repeat('+cols+','),query+' uses '+cols+' columns');
  const spans=[...b.matchAll(/--tide-span:(\d+)/g)].map(m=>Number(m[1]));assert.ok(new Set(spans).size>=3,query+' must keep at least three different card widths, got '+spans);
  assert.ok(new Set([...b.matchAll(/--tide-height:(\d+)px/g)].map(m=>m[1])).size>=3,query+' must keep varied card heights');
  assert.match(b,/--tide-offset:-?\d+px/,query+' keeps vertical offsets');
}
assert.match(css,/\.mini-live-readout\{position:static!important/,'mini readout is a strip above the plot, not an overlay');
assert.match(js,/if\(!point\|\|mini\)\{float\.hidden=true;return\}/,'mini plots do not float a second readout over the line');
assert.match(js,/if\(mini\)show\(dates\.length-1,'sync'\)/,'mini readout returns to the latest point when the pointer leaves');
assert.match(js,/clear\(\)\{float\.hidden=true;header\.hidden=true\}/,'large-chart readouts hide when the crosshair leaves');
assert.match(cards,/class="day-change '\+\(diff>0\?'up':diff<0\?'down':'flat'\)/,'market cards show a red/green day-change pill');
assert.match(css,/\.day-change\.up\{color:var\(--tw-rise/,'rise is red');assert.match(css,/\.day-change\.down\{color:var\(--tw-fall/,'fall is green');
console.log('PASS layout rules: 12- and 10-column uneven card rhythm with varied widths, heights and offsets; chart readouts never cover the plot; red/green day-change pill.');

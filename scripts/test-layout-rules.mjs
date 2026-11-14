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
// Nine market cards (ph19.css): pack the spans into grid rows. Every row closes with at least two cards, and
// neighbouring cards never share a width, so the rail never reads as a regular left-right grid.
{
  const css19=fs.readFileSync('worker/ph19.css','utf8').replace(/\r\n/g,'\n'),blocks19=q=>{const i=css19.lastIndexOf(q);assert.ok(i>=0,'ph19 missing '+q);let d=0,j=css19.indexOf('{',i);for(let k=j;k<css19.length;k++){if(css19[k]==='{')d++;if(css19[k]==='}'&&--d===0)return css19.slice(j,k+1)}return''};
  // Base spans as the browser resolves them: every ph18 block for this width, in file order (later blocks win).
  const allBlocks=(text,q)=>{const out=[];let i=-1;while((i=text.indexOf(q,i+1))>=0){let d=0,j=text.indexOf('{',i);for(let k=j;k<text.length;k++){if(text[k]==='{')d++;if(text[k]==='}'&&--d===0){out.push(text.slice(j,k+1));break}}}return out};
  for(const [query,cols] of [['@media(min-width:1000px)',12],['@media(min-width:720px) and (max-width:999px)',10]]){
    const cycle=[];for(const b of allBlocks(css,query))for(const m of b.matchAll(/\(#matrixCards,#factorRail\)>:nth-child\(7n\+(\d)\)\{--tide-span:(\d+)/g))cycle[m[1]-1]=Number(m[2]);
    assert.equal(cycle.filter(Number.isFinite).length,7,query+' base cycle of seven spans');
    const spans=Array.from({length:9},(_,i)=>cycle[i%7]);for(const m of allBlocks(css19,query).join("").matchAll(/#factorRail>\.factor:nth-child\((\d)\)\{--tide-span:(\d+)/g))spans[m[1]-1]=Number(m[2]);
    const rows=[[]];let used=0;for(const s of spans){if(used+s>cols){rows.push([]);used=0}rows.at(-1).push(s);used+=s}
    // No two rows may be the same sequence either (8/4 then 5/7 then 7/5 is fine; 5/7 twice is not).
    const seqs=rows.map(r=>r.join('/'));assert.equal(new Set(seqs).size,seqs.length,query+' two rows repeat the same widths: '+seqs.join(' | '));
    for(const row of rows){assert.ok(row.length>=2,query+' a card fills a row alone: '+JSON.stringify(rows));assert.equal(row.reduce((a,b)=>a+b,0),cols,query+' row does not close: '+JSON.stringify(rows));
      row.forEach((s,i)=>assert.ok(!i||s!==row[i-1],query+' neighbours share a width: '+JSON.stringify(rows)))}
  }
  assert.match(css19,/\.market-overview-stats\{grid-column:2;grid-row:1;justify-self:end/,'scorable-factor count sits top right');
  assert.match(css19,/\.market-overview \.rd-factor-bars\{grid-column:1\/-1;grid-row:2;justify-self:center/,'water levels centred below');
  assert.match(css19,/\.rd-factor-bars\{grid-template-columns:repeat\(9,/,'nine water-level bars on one row');
  const cmp=fs.readFileSync('worker/market-compare.js','utf8');assert.ok(!/compare-grip|拖到下方比較/.test(cmp+css19),'no drag button or label on the cards: the whole card is dragged');
  assert.match(cmp,/touchstart[\s\S]*setTimeout\([\s\S]*,450\)/,'phones start a card drag with a long press');assert.match(cmp,/data-slot-pick/,'empty boxes offer a list as the non-drag path');
  assert.match(css19,/#factorRail #pcrMeta,#factorRail #retailMeta\{display:none\}/,'PCR and retail cards carry no detail line');assert.ok(!/sentiment-note/.test(fs.readFileSync('worker/market-sentiment.js','utf8')),'no formula on the cards');
  const has=(text,needle,msg)=>assert.ok(text.includes(needle),msg);
  has(css19,'a.pill,a.pill:hover,a.pill:focus-visible{text-decoration:none}','button-styled links carry no underline');
  assert.match(css19,/\.purpose-link\{display:inline-flex[^}]*text-decoration:none/,'home door links are buttons');
  has(css19,'summary{cursor:pointer}','disclosures show the hand cursor');
  has(cmp,'setBoth(clampVp(pan.v.from+shift,pan.v.to+shift))','panning A or B moves both');
  has(cmp,'setBoth(clampVp(at-ratio*next,at-ratio*next+next))','zooming A or B zooms both');
  has(cmp,"if(b.dataset.rcZoom==='reset'){setBoth(windowVp())",'reset resets both');
  // Phones: water levels split five above four, centred; button groups become even grids.
  assert.match(css19,/@media\(max-width:600px\)\{\n body\.editorial-site #top \.market-overview \.rd-factor-bars\{display:flex;flex-wrap:wrap;justify-content:center[^}]*\}\n body\.editorial-site #top \.market-overview \.rd-factor-bar\{flex:0 0 20%/,'phone water levels: two centred rows of five and four');
  has(css19,':is(.market-fullscreen,.range-compare) .segment:has(>:nth-child(4):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}','phone: four buttons as 2×2');
  // Settings inputs keep their size; the custom-MA checkbox shares a line with its text.
  has(css19,'.ind-grid fieldset{align-content:flex-start;align-items:flex-start}','settings inputs are not stretched to the box height');
  has(css19,'.ind-grid fieldset.custom-ma-settings{grid-column:1/-1','custom MA spans the full row');
  has(css19,'.custom-ma-settings label:has(>input[type=checkbox]){display:flex!important;flex-direction:row;align-items:center','checkbox beside its text');
  // Locked members-only cards grow to fit the lock box.
  const ph19js=fs.readFileSync('worker/ph19.js','utf8');assert.match(ph19js,/card\.style\.minHeight=need\+'px'/,'members-only cards fit their lock box');
  // Home doors stay uneven on tablets.
  assert.match(css19,/@media\(min-width:600px\) and \(max-width:999px\)\{\n body\.subtraction-site #top \.purpose-deck>\.purpose-door:nth-child\(1\)\{grid-column:span 7;min-height:420px/,'home doors 7/5 then 5/7 on tablets');
  // Every live source is listed in the footer table.
  assert.match(fs.readFileSync('worker/page.html','utf8'),/<th scope="row">選擇權 PCR、散戶多空比<\/th>/,'TAIFEX listed among the data sources');
  has(css19,'body.editorial-site #top .etf-quick-switch button[aria-pressed="true"]{background:var(--rd-ink,#203a34);border-color:var(--rd-ink,#203a34);color:var(--paper)}','the selected quick-switch chip stays readable');
  console.log('PASS nine-card rhythm: rows close with two or more cards and neighbours differ at 12 and 10 columns; overview count top right, levels centred.');
}

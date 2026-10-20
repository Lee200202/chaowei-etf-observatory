// Daily "tide radar": one row per ETF with today's water level and a few technical flags,
// so the search sheet can filter all ETFs without loading 242 history files in the browser.
// Water level uses the site defaults: prior 240 trading days, highest high / lowest low, five equal bands.
import {readdir,readFile,writeFile} from 'node:fs/promises';

const dir=new URL('../pages-data/history/',import.meta.url);
const sma=(a,n,i)=>{if(i<n-1)return null;let s=0;for(let j=i-n+1;j<=i;j++)s+=a[j];return s/n};
function rsi14(close){let g=0,l=0;for(let i=1;i<close.length;i++){const ch=close[i]-close[i-1],up=Math.max(ch,0),dn=Math.max(-ch,0);if(i<=14){g+=up/14;l+=dn/14}else{g=(g*13+up)/14;l=(l*13+dn)/14}}return close.length>15?(l===0?100:100-100/(1+g/l)):null}
export async function buildRadar(){
  const files=(await readdir(dir)).filter(f=>/^[0-9A-Z]{4,6}\.json$/.test(f)),rows=[];
  for(const f of files){
    const d=JSON.parse(await readFile(new URL(f,dir),'utf8')),r=d.rows;if(!r||r.length<30)continue;
    const n=r.length,close=r.map(x=>x[4]),last=r[n-1],prev=r[n-2],W=Math.min(240,n-1),prior=r.slice(n-1-W,n-1);
    const hi=Math.max(...prior.map(x=>x[2])),lo=Math.min(...prior.map(x=>x[3])),pos=hi>lo?(last[4]-lo)/(hi-lo):null;
    const ma20=sma(close,20,n-1),ma60=sma(close,60,n-1);
    let sd=null;if(ma20!=null){let s=0;for(let j=n-20;j<n;j++)s+=(close[j]-ma20)**2;sd=Math.sqrt(s/20)}
    const upper=ma20!=null?ma20+2*sd:null,lower=ma20!=null?ma20-2*sd:null,pctB=upper>lower?(last[4]-lower)/(upper-lower):null;
    // Squeeze: today's band width in the lowest 15% of the last 120 days, and the close above the upper band.
    let squeeze=false;
    if(n>=140&&upper>lower){
      const widths=[];for(let i=n-120;i<n;i++){const m=sma(close,20,i);let s=0;for(let j=i-19;j<=i;j++)s+=(close[j]-m)**2;widths.push(4*Math.sqrt(s/20)/m)}
      const today=widths.at(-1),rank=widths.filter(w=>w<=today).length/widths.length;squeeze=rank<=0.15&&last[4]>upper;
    }
    rows.push({code:d.code,date:last[0],close:last[4],chg:prev?(last[4]/prev[4]-1)*100:null,
      pos:pos==null?null:Math.round(pos*1000)/1000,score:pos==null?null:Math.round(Math.max(0,Math.min(5,5*(1-pos)))*10)/10,
      bias60:ma60?Math.round((last[4]/ma60-1)*1000)/10:null,pctB:pctB==null?null:Math.round(pctB*100)/100,rsi:Math.round((rsi14(close.slice(-300))??NaN)*10)/10||null,squeeze,days:n});
  }
  rows.sort((a,b)=>(b.score??-1)-(a.score??-1));
  const latest=rows.reduce((m,x)=>x.date>m?x.date:m,'');
  await writeFile(new URL('radar.json',dir),JSON.stringify({basis:'近 240 交易日最高／最低價、等距五段；乖離為 MA60；布林 20,2；RSI 14',latest,rows})+'\n');
  return rows.length;
}
if(import.meta.url===`file:///${process.argv[1].replace(/\\/g,'/')}`)console.log('Radar rows:',await buildRadar());

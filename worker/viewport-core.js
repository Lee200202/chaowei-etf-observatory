const ViewportMath=(()=>{
  function clamp(range,n){if(!range||!n||![range.from,range.to].every(Number.isFinite))return null;const span=Math.max(2,Math.min(n+5,range.to-range.from));if(range.to-range.from>n+5)return{from:-.5,to:n+2.5};if(range.to<1)return{from:-.5,to:Math.min(n+2.5,span-.5)};if(range.from>n-2)return{from:Math.max(-.5,n+2.5-span),to:n+2.5};return{from:range.from,to:range.to}}
  function anchor(daily,display,index){if(!daily.length||!display.length)return-1;const next=display[Math.min(display.length-1,index)+1]?.date;let lo=0,hi=daily.length;while(lo<hi){const m=(lo+hi)>>1;if(!next||daily[m].date<next)lo=m+1;else hi=m}return lo-1}
  return{clamp,anchor};
})();

const ViewportMath=(()=>{
  function clamp(range,n){if(!range||!n||![range.from,range.to].every(Number.isFinite))return null;const span=Math.max(Math.min(2,n),Math.min(n,Math.max(0,range.to-range.from))),from=Math.max(-.5,Math.min(n-.5-span,range.from));return{from,to:from+span}}
  function anchor(daily,display,index){if(!daily.length||!display.length)return-1;const next=display[Math.min(display.length-1,index)+1]?.date;let lo=0,hi=daily.length;while(lo<hi){const m=(lo+hi)>>1;if(!next||daily[m].date<next)lo=m+1;else hi=m}return lo-1}
  return{clamp,anchor};
})();

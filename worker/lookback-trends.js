/* Each plot uses complete daily observations. Downsample its drawing, never its statistics. */
let lookbackPlotId=0;
function renderLookbackTrend(rows,count,format,context=''){
  const data=rows.filter(row=>Number.isFinite(row[1])).slice(-count);
  if(data.length<2)return '<p class="small lookback-empty">走勢資料不足</p>';
  const values=data.map(row=>row[1]),last=values.at(-1),first=values[0];
  const low=Math.min(...values),high=Math.max(...values),mean=values.reduce((a,b)=>a+b,0)/values.length;
  const lo=values.indexOf(low),hi=values.indexOf(high),span=high-low;
  const stride=Math.max(1,Math.ceil(values.length/320));
  const x=i=>6+288*i/(values.length-1),y=v=>span?8+72*(high-v)/span:44;
  const points=values.flatMap((v,i)=>i%stride===0||i===lo||i===hi||i===values.length-1?[x(i).toFixed(2)+','+y(v).toFixed(2)]:[]).join(' ');
  const color=last>first?'#f43f5e':last<first?'#10b981':'#8293ad',id='lookbackFill'+(++lookbackPlotId);
  ChartReadouts.registerMini(id,{rows:data,format});
  const range=data[0][0]+' 至 '+data.at(-1)[0];
  const point=(i,color,label)=>'<circle cx="'+x(i)+'" cy="'+y(values[i])+'" r="4" fill="'+color+'"><title>'+label+' '+data[i][0]+' '+format(values[i])+'</title></circle>';
  return '<svg data-tide-plot class="lookback-plot" data-readout-key="'+id+'" viewBox="0 0 300 90" preserveAspectRatio="none" role="img" data-points="'+data.length+'" aria-label="近 '+data.length+' 筆走勢，'+range+'，最高 '+format(high)+'，最低 '+format(low)+'，均值 '+format(mean)+'">'+
    '<defs><linearGradient id="'+id+'" x2="0" y2="1"><stop stop-color="'+color+'" stop-opacity=".32"/><stop offset="100%" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+
    '<line x1="6" x2="294" y1="'+y(mean)+'" y2="'+y(mean)+'" stroke="var(--muted)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"><title>區間均值 '+format(mean)+'</title></line>'+
    '<g data-tide-base="85"><polygon points="6,85 '+points+' 294,85" fill="url(#'+id+')"/>'+
    '<polyline points="'+points+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'+
    point(lo,'#10b981','最低')+(lo!==hi?point(hi,'#f43f5e','最高'):'')+
    tideTail(x(values.length-1),y(last),color)+'</g></svg>'+
    '<small class="lookback-caption">'+(context?context+' · ':'')+'近 '+data.length+' 筆'+(data.length<count?'（可用資料）':'')+' · 虛線為均值</small>';
}
function lookbackGauge(rank,vix=false){
  if(!Number.isFinite(rank))return '<div class="lookback-gauge"><span>歷史位置待確認</span></div>';
  const ratio=Math.max(0,Math.min(1,rank));
  const zones=vix?['高恐慌','恐慌偏高','波動中段','波動偏低','低波動警戒']:['歷史低檔','歷史偏低','歷史中段','歷史偏高','歷史高檔'];
  const index=Math.min(4,Math.max(0,vix?Math.ceil(ratio*5-1e-10)-1:Math.floor(ratio*5)));
  const text=zones[index];
  return '<div class="lookback-gauge"><span>'+text+'</span><div class="lookback-rail" role="img" aria-label="五段色溫，'+text+(vix?'':'，歷史位置 '+Math.round(ratio*100)+'%')+'"><i></i><i></i><i></i><i></i><i></i><b style="left:'+ratio*100+'%"></b></div></div>';
}

function tideTail(x,y,color){
  return '<circle class="tide-tail-halo" cx="'+x+'" cy="'+y+'" r="5" fill="'+color+'"/>'+
    '<circle cx="'+x+'" cy="'+y+'" r="2.8" fill="'+color+'"/>';
}

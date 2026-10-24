// Scale each explicit CSS font once. Legacy large-mode exceptions would otherwise double-scale captions.
export function scaleTypography(css){
  css=css.replace(/body\.(?:xlarge|large)[^{]*\{font-size:\s*\d+px\}/g,'');
  return css.replace(/font-size\s*:\s*([^;}\n]+)/g,(whole,raw)=>{
    const important=/!important\s*$/.test(raw)?'!important':'',value=raw.replace(/!important\s*$/,'').trim();
    if(/^(inherit|initial|unset|revert|0)$/.test(value)||value.includes('--text-scale'))return whole;
    const bounded=value.replace(/([\d.]+)px/g,(_,n)=>`${Math.max(13,Math.min(64,Number(n)))}px`);
    return `font-size:calc((${bounded}) * var(--text-scale,1))${important}`;
  });
}

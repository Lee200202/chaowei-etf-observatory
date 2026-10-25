"""Render this skill's maintained references into one offline, searchable HTML file."""
from pathlib import Path
import argparse, base64, html, re

ROOT = Path(__file__).resolve().parents[1]
FILES = ['architecture','design-motion','market-data','scoring','strategies','wave-measurement','training-validation','membership-performance','qa-release','diagnostic-playbook']

def inline(text):
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    # Only allow ordinary http(s) reference links; no executable Markdown links.
    return re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', text)

def render(md):
    result, para, code = [], [], None
    def flush():
        if para:
            text=' '.join(para); test=re.match(r'([TU]\d{2})\s',text)
            attr=(' id="'+test[1]+'"') if test else ''
            result.append('<p'+attr+'>'+inline(text)+'</p>'); para.clear()
    for line in md.splitlines():
        if line.startswith('```'):
            flush()
            if code is None: code=[]
            else: result.append('<pre><code>'+html.escape('\n'.join(code))+'</code></pre>'); code=None
        elif code is not None: code.append(line)
        elif line.startswith('# '): flush()
        elif line.startswith('## '):
            flush(); title=line[3:]; key=title.split()[0]
            result.append('<h3 id="'+html.escape(key)+'">'+inline(title)+'</h3>')
        elif not line.strip(): flush()
        else: para.append(line)
    flush()
    return '\n'.join(result)

CSS = '''
:root{--paper:#f4f7f5;--ink:#153b40;--muted:#587276;--line:#d9e4df;--accent:#126b69}*{box-sizing:border-box}html{scroll-behavior:auto;scroll-padding-top:90px}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,"Microsoft JhengHei",sans-serif;font-size:16px;line-height:1.85}button,input{font:inherit}a{color:var(--accent);text-underline-offset:4px}button{cursor:pointer;min-height:44px;border-radius:22px;padding:8px 18px;border:1px solid var(--line);color:var(--ink);background:#fff}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #e5ac4d;outline-offset:3px}.wrap{max-width:1320px;margin:auto;padding:36px 24px}header{padding:40px;border-radius:32px;background:#153b40;color:#f4fbf8}header p{max-width:800px;color:#c5dfd7}h1{font-size:clamp(28px,4vw,44px);line-height:1.3;margin:12px 0}h2{font-size:25px;line-height:1.5;margin:0 0 20px}h3{font-size:20px;line-height:1.5;margin:32px 0 12px;scroll-margin-top:0}p{margin:14px 0}.overline{font-size:13px;letter-spacing:.15em}.intro-actions{display:flex;gap:10px;flex-wrap:wrap}.intro-actions code{background:#284c50;color:#d0f3e9}.tools{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;background:#f4f7f5f5;padding:16px 0;backdrop-filter:blur(10px)}.tools input{flex:1;min-width:0;width:100%;min-height:48px;border:1px solid var(--line);border-radius:24px;padding:10px 18px;background:white;color:var(--ink)}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:28px}aside{position:sticky;top:84px;align-self:start;max-height:calc(100vh - 100px);overflow:auto}aside a{display:block;padding:9px 12px;text-decoration:none;border-radius:14px;font-size:14px}aside a:hover{background:#e3eeea}section{background:white;border:1px solid var(--line);border-radius:28px;padding:32px;margin:0 0 22px;min-width:0}section[hidden]{display:none}.category{display:flex;gap:12px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:18px}.category h2{margin:0}.copy{font-size:13px;flex:none}code{font-family:ui-monospace,monospace;font-size:.88em;background:#edf4f0;padding:2px 6px;border-radius:5px;overflow-wrap:anywhere}pre{overflow:auto;white-space:pre-wrap;background:#edf4f0;padding:20px;border-radius:16px;font-size:14px;line-height:1.7}pre code{padding:0;background:none}.note{border-left:4px solid #e5ac4d;background:#fff7e5;padding:16px 20px;border-radius:0 16px 16px 0}.count{font-size:13px;color:var(--muted);white-space:nowrap}.no-result{padding:32px;background:white;border-radius:24px}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.gallery figure{margin:0}.gallery img{width:100%;max-height:560px;object-fit:contain;object-position:top;background:#edf4f0;border:1px solid var(--line);border-radius:16px}.gallery figcaption{font-size:13px;color:var(--muted);margin-top:8px}footer{font-size:13px;color:var(--muted);padding:18px 0 30px}.status{font-size:14px;min-height:26px}body.large{font-size:18px}body.large h3{font-size:22px}@media(max-width:850px){.layout{grid-template-columns:1fr}aside{position:static;display:flex;flex-wrap:wrap;gap:4px;max-height:none}aside a{border:1px solid var(--line);font-size:13px;padding:7px 10px}section{padding:24px}.wrap{padding:18px 14px}header{padding:28px}.tools{flex-wrap:wrap}.tools input{flex-basis:100%;padding-right:94px}.tools .count{position:absolute;right:16px;top:31px}html{scroll-padding-top:148px}.category,section,h3{scroll-margin-top:0}.category{align-items:start}h2{font-size:22px}.gallery{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{body{background:white;font-size:11pt}.wrap{padding:0;max-width:none}header{color:#153b40;background:white;padding:12px;border-bottom:2px solid #153b40}header p{color:#153b40}.tools,aside,.copy,.intro-actions,.status{display:none!important}.layout{display:block}section,section[hidden]{display:block!important;border:0;border-top:1px solid #ccc;padding:20px 0;break-inside:auto}.category{display:block}h3{break-after:avoid}a{color:inherit}pre{break-inside:avoid}.gallery{display:block}.gallery img{max-height:450px}header h1{font-size:26pt}}
'''
JS = '''
const sections=[...document.querySelectorAll('section[data-topic]')],search=document.querySelector('#search'),count=document.querySelector('#count'),empty=document.querySelector('#empty'),status=document.querySelector('#status');
search.addEventListener('input',()=>{const words=search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);let n=0;for(const s of sections){s.hidden=!words.every(w=>s.textContent.toLowerCase().includes(w));if(!s.hidden)n++}count.textContent=n+' / '+sections.length+' 類';empty.hidden=n>0});
document.querySelector('#clear').onclick=()=>{search.value='';search.dispatchEvent(new Event('input'));search.focus()};
document.querySelector('#size').onclick=e=>{const on=document.body.classList.toggle('large');e.target.setAttribute('aria-pressed',String(on))};
document.querySelector('#print').onclick=()=>window.print();
for(const a of document.querySelectorAll('aside a'))a.onclick=()=>{search.value='';search.dispatchEvent(new Event('input'))};
for(const b of document.querySelectorAll('[data-copy]'))b.onclick=async()=>{const text='使用 $chaowei-etf-site，依'+b.dataset.copy+'規格處理本次問題，先核對現況，再以測試或實際截圖驗收。';try{await navigator.clipboard.writeText(text);b.textContent='已複製呼叫';status.textContent='已複製：'+text}catch{status.textContent='請選取複製：'+text}};
'''

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);ap.add_argument('--evidence',type=Path);args=ap.parse_args()
    sections=[];links=[]
    for i,name in enumerate(FILES):
        text=(ROOT/'references'/f'{name}.md').read_text(encoding='utf-8');title=text.splitlines()[0][2:];key=chr(65+i)
        links.append(f'<a href="#{key}">{html.escape(title)}</a>')
        sections.append(f'<section id="{key}" data-topic="{key}"><div class="category"><h2>{html.escape(title)}</h2><button class="copy" data-copy="{key}" aria-label="複製{html.escape(title)}呼叫語句">複製呼叫</button></div>{render(text)}</section>')
    gallery=''
    if args.evidence:
        images=[]
        for filename,label in [('faq-before.png','早期正式站FAQ故障截圖'),('faq-mobile-after.png','同日390px本機FAQ修正驗收；不是第68版正式截圖'),('chart-phone-after.png','同日390px本機圖表拖曳與副圖驗收'),('formal-faq-v68.png','第68版正式站FAQ實際畫面')]:
            p=args.evidence/filename
            if p.is_file():images.append(f'<figure><img loading="lazy" src="data:image/png;base64,{base64.b64encode(p.read_bytes()).decode()}" alt="{html.escape(label)}"><figcaption>{html.escape(label)}</figcaption></figure>')
        if images:gallery='<section id="evidence"><h2>截圖證據與範圍</h2><p>以下為實際操作時保存的畫面，依標註區分本機與正式版。截圖只能證明該時刻與尺寸，不能代替全部測試。</p><div class="gallery">'+''.join(images)+'</div></section>'
    doc='''<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>潮位網站技能與驗收手冊</title><style>'''+CSS+'''</style></head><body><div class="wrap"><header><div class="overline">CHAOWEI / MAINTAINABLE SPECIFICATION</div><h1>把網站的想法，整理成可呼叫的規格。</h1><p>10 類技能參考、段落式規格、公式與具體驗收步驟。來源與技能共用同一份 Markdown，適合後續診斷、交接與修改。</p><div class="intro-actions"><code>$chaowei-etf-site</code><span>整理日期 2026-10-25 · 版本現況詳 I1</span></div></header><div class="tools"><input id="search" type="search" aria-label="搜尋技能規格" placeholder="搜尋：平均持股、原油、FAQ、訓練、T01…"><button id="clear">清除</button><button id="size" aria-pressed="false">放大文字</button><button id="print">列印手冊</button><span id="count" class="count">10 / 10 類</span></div><p id="status" class="status" aria-live="polite">可按每類「複製呼叫」，或指定 E3、U02 等段落。</p><div class="layout"><aside aria-label="分類索引">'''+''.join(links)+'''<a href="#evidence">截圖證據</a></aside><main><p class="note">這是維護規格，不是所有功能均已驗收的宣告。已知例子與版本都有日期；自動基準帶、完整上櫃等仍依 J7 區分。技能不額外授權真實下單、資料採購或發布。</p><p id="empty" class="no-result" hidden>沒有符合的類別，請縮短關鍵字。</p>'''+''.join(sections)+gallery+'''</main></div><footer>本檔可離線閱讀、搜尋與列印；不含API token或登入憑證。更新技能參考後重新執行 render_handbook.py，避免維護兩份不同規格。</footer></div><script>'''+JS+'''</script></body></html>'''
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(doc,encoding='utf-8');print(f'Rendered {len(FILES)} categories: {args.output} ({len(doc.encode("utf-8")):,} bytes)')

if __name__=='__main__': main()

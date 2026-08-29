from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.31','// @version      0.2.32',1)
s=s.replace("const VERSION = '0.2.31';","const VERSION = '0.2.32';",1)

block=r'''

      /* v0.2.31 cross-device text and spacing safety */
      #tta-root{-webkit-text-size-adjust:100%;text-size-adjust:100%}
      #tta-root .tta-content,#tta-root .tta-dashboard,#tta-root .tta-feature-portal,#tta-root .tta-fin-section,#tta-root .tta-glass-section,#tta-root .tta-bento,#tta-root .tta-toolcard{min-width:0}
      #tta-root .tta-sectionintro,#tta-root .tta-sectionhead,#tta-root .tta-portal-head{min-width:0;align-items:flex-start}
      #tta-root .tta-sectionintro>div,#tta-root .tta-sectionhead>div,#tta-root .tta-portal-head>div{min-width:0;display:grid;grid-template-columns:minmax(0,1fr);align-content:start;row-gap:4px}
      #tta-root .tta-sectionintro small,#tta-root .tta-sectionhead small,#tta-root .tta-portal-head small{position:static;display:block;margin:0;padding:0;line-height:1.35;min-height:1.35em;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-sectionintro h3,#tta-root .tta-sectionhead h3,#tta-root .tta-portal-head h3{position:static;display:block;margin:0;padding:0;line-height:1.2;min-height:1.2em;white-space:normal;overflow-wrap:anywhere;word-break:normal}
      #tta-root .tta-sectionintro{margin-top:16px;margin-bottom:10px;gap:10px}
      #tta-root .tta-sectionintro>span,#tta-root .tta-sectionhint,#tta-root .tta-morehint{line-height:1.4;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-portal-head{gap:9px;margin-bottom:12px}
      #tta-root .tta-portal-head>span{line-height:1.4;white-space:normal;flex:0 1 auto}
      #tta-root .tta-feature-portal .tta-toolcard{height:auto;align-content:center}
      #tta-root .tta-toolcopy{min-width:0;overflow:visible}
      #tta-root .tta-toolcopy strong,#tta-root .tta-toolcopy small,#tta-root .tta-toolcopy em{white-space:normal;overflow-wrap:anywhere;word-break:normal;line-height:1.35}
      #tta-root .tta-toolcopy strong{line-height:1.25}
      #tta-root .tta-toolcopy em{line-height:1.3}
      #tta-root .tta-bento small,#tta-root .tta-bento b,#tta-root .tta-bento p,#tta-root .tta-cashcard small,#tta-root .tta-cashcard b{line-height:1.35}
      #tta-root .tta-fin-row span,#tta-root .tta-fin-row b{line-height:1.4}
      #tta-root .tta-flowtitle{line-height:1.35;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-flowmeta{line-height:1.4;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-nw-change-copy strong,#tta-root .tta-nw-change-copy small{white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-btn,#tta-root .tta-chip,#tta-root .tta-iconbtn,#tta-root .tta-back{flex-shrink:0}
      @media(max-width:520px){
        #tta-root .tta-portal-head{flex-direction:column;align-items:stretch;gap:9px}
        #tta-root .tta-portal-head>span{width:100%;margin-top:1px}
        #tta-root .tta-sectionintro{align-items:flex-start}
        #tta-root .tta-sectionintro h3,#tta-root .tta-portal-head h3{font-size:clamp(14px,5vw,18px)}
        #tta-root .tta-sectionintro small,#tta-root .tta-portal-head small{font-size:8px}
        #tta-root .tta-feature-portal .tta-toolcard{min-height:0;padding-top:12px;padding-bottom:12px}
        #tta-root .tta-toolcopy em{margin-top:6px}
      }
      @media(max-width:430px){
        #tta-root .tta-sectionintro{display:grid;grid-template-columns:minmax(0,1fr);align-items:start}
        #tta-root .tta-sectionintro>span,#tta-root .tta-sectionintro>.tta-btn,#tta-root .tta-sectionintro>.tta-sectionhint{justify-self:start;max-width:100%}
        #tta-root .tta-sectionintro>.tta-btn{width:auto;min-width:0;white-space:normal}
        #tta-root .tta-sectionhead{flex-wrap:wrap}
        #tta-root .tta-sectionhead>div{flex:1 1 180px}
        #tta-root .tta-sectionhead>.tta-btn{max-width:100%;white-space:normal}
      }
      @media(max-width:360px){
        #tta-root .tta-sectionintro h3,#tta-root .tta-portal-head h3{font-size:14px}
        #tta-root .tta-sectionintro{margin-top:14px;margin-bottom:9px}
        #tta-root .tta-feature-portal{padding-left:9px;padding-right:9px}
      }
'''

count=s.count(block)
if count < 1:
    raise SystemExit(f'Expected responsive block, found {count}')
s=s.replace(block,'')

anchor="""    `;
    document.head.appendChild(s);
"""
if anchor not in s:
    raise SystemExit('CSS closing anchor not found')
clean=block.replace('v0.2.31 cross-device text and spacing safety','v0.2.32 cross-device text and spacing safety',1)
s=s.replace(anchor,clean+'\n'+anchor,1)

if s.count('cross-device text and spacing safety') != 1:
    raise SystemExit('Responsive block dedupe failed')
if any(ord(ch)>=128 for ch in s):
    raise SystemExit('Non-ASCII characters introduced')

p.write_text(s,encoding='ascii')

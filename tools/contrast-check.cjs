const assert=require('node:assert/strict');

const hostilePageStyles=`
  body { color:#000 !important; }
  div,span,p,b,strong,small,label,h2,h3,summary,code,pre,button,input,select,option,td,th {
    color:#000 !important; -webkit-text-fill-color:#000 !important;
    font-family:"Times New Roman" !important;
  }
  td,th { background:#fff !important; }
  input::placeholder { color:#000 !important; opacity:.4 !important; }
  svg text { fill:#000 !important; }
`;

async function assertReadable(page,context){
  const failures=await page.locator('#tta-root').evaluate(root=>{
    const rgba=value=>{
      const parts=value.match(/[\d.]+/g)?.map(Number);
      if(!parts||parts.length<3)throw new Error(`Unsupported computed color: ${value}`);
      return [...parts.slice(0,3),parts[3]??1];
    };
    const blend=(top,bottom)=>top.slice(0,3).map((v,i)=>v*top[3]+bottom[i]*(1-top[3]));
    const luminance=rgb=>rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const backgrounds=el=>{
      const ancestors=[];for(let p=el;p;p=p.parentElement)ancestors.unshift(p);
      let colors=[[255,255,255]];
      for(const p of ancestors){
        const css=getComputedStyle(p),fill=rgba(css.backgroundColor);
        colors=colors.map(color=>blend(fill,color));
        // Evaluate every gradient stop over each ancestor stop, not just the solid fallback.
        const stops=css.backgroundImage.match(/rgba?\([^)]*\)/g);
        if(stops)colors=colors.flatMap(color=>stops.map(stop=>blend(rgba(stop),color)));
      }
      return colors;
    };
    const failures=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const check=(el,text,foreground)=>{
      const css=getComputedStyle(el),fg=rgba(foreground);
      const minimum=Math.min(...backgrounds(el).map(bg=>ratio(blend(fg,bg),bg)));
      if(minimum<4.5)failures.push({text:text.trim().slice(0,80),element:el.tagName,class:el.className?.baseVal??el.className,color:foreground,ratio:minimum});
      if(css.fontFamily.includes('Times New Roman'))failures.push({text:'Host font leaked: '+text.trim().slice(0,60)});
    };
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      const el=node.parentElement;if(!node.textContent.trim()||!el?.getClientRects().length||el.closest('[hidden],button:disabled'))continue;
      const css=getComputedStyle(el);if(css.visibility==='hidden'||css.display==='none')continue;
      const fill=el instanceof SVGElement?css.fill:css.webkitTextFillColor;
      check(el,node.textContent,fill==='currentcolor'?css.color:fill);
    }
    for(const el of root.querySelectorAll('input[placeholder]')){
      if(!el.getClientRects().length)continue;
      const css=getComputedStyle(el,'::placeholder');check(el,el.placeholder,css.color);
      if(Number(css.opacity)<1)failures.push({text:'Faded placeholder: '+el.placeholder});
    }
    for(const el of root.querySelectorAll('select option'))check(el,el.textContent,getComputedStyle(el).color);
    return failures.slice(0,20);
  });
  assert.deepEqual(failures,[],`${context}: text must retain at least 4.5:1 contrast under conflicting host styles`);
}

module.exports={hostilePageStyles,assertReadable};

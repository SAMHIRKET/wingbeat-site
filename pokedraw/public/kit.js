import {FONT_METRICS} from './font-metrics.js';
import {canvasBudget,animationActive} from './render-budget.js';
// WINGBEAT web kit: the wingbe.at look, lifted from the landing page so Pokedraw
// shares one set of parts. Everything here is drawing only; it never talks to the
// room service.
//
// Parts (all found by class, so app.js only writes markup):
//   .wb-win   aero box: halftone title bar, Luna caption buttons, aqua dot body,
//             orbs/bubbles/swoosh drifters, boiling ink border with magenta+cyan
//             misprints, plum halftone shadow, chaotic pop when it first opens.
//             data-key: a window seen before opens settled (no second pop).
//             data-field="calm": thin body dots, no drifters (for busy windows).
//   .wb-l     scratch-font lettering (ink/fill/halftone, ink on 4s, rest on 2s).
//             data-size, data-color (token or hex), data-align, data-title (dot title).
//   .wb-pill  glossy pill button (pink, cyan on hover/focus). data-tone=blue|lime.
//   #wb-world fixed aero sky with drifting dot objects.
//   WB.face(canvas, draw) registers a canvas redrawn on the boil clock.

export const C = {ink:'#1833a0',plum:'#7222a4',cyan:'#00d4e8',magenta:'#ff27ba',blue:'#1263ff',yellow:'#ffe72b',ice:'#fffaf0',paper:'#fffcf0',lime:'#c6ff3a',sky:'#3ff2ff'};
const TITLE_COLORS = ['#004cff','#00b96a','#ff21b5','#e8341c'];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let clock = 0, last = performance.now(), lastInput=last, focused=true, fillSeed = 0, inkSeed = 0, atlases = null;
const wins = new Set(), letters = new Set(), pills = new Set(), faces = new Set(), seen = new Set();
const cache = new Map();let cacheBytes=0;
function releaseCanvas(c){c.width=0;c.height=0;}
function trimFontCache(){while(cacheBytes>12*1024*1024||cache.size>240){const [key,r]=cache.entries().next().value;cache.delete(key);cacheBytes-=r.bytes;releaseCanvas(r.c);r.tints?.forEach(releaseCanvas);}}
function wake(){lastInput=performance.now();document.documentElement.classList.remove('wb-idle');}
const ro = new ResizeObserver(entries=>{for(const e of entries){const el=e.target;if(!el._wb)continue;if(letters.has(el)){sizeLetter(el);drawLetter(el);}else if(wins.has(el))drawWin(el);else if(pills.has(el))drawPill(el);}});

export const reduced = () => motion.matches;
export const boil = () => ({fill:fillSeed, ink:inkSeed, clock});

/* ---------- small helpers ---------- */
export function dot(path,x,y,r){if(r<=.03)return;path.moveTo(x+r,y);path.arc(x,y,r,0,Math.PI*2);}
export function paint(ctx,path,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fill(path);ctx.globalAlpha=1;}
export function hash(x,y){const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);}
const mod=(n,m)=>((n%m)+m)%m;
function fit(canvas,w,h){const {scale:d,width:W,height:H}=canvasBudget(w,h,devicePixelRatio||1);if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}const ctx=canvas.getContext('2d');ctx.setTransform(d,0,0,d,0,0);return ctx;}
function image(src){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src;});}
const colorOf=v=>!v?C.ink:(C[v]||v);
function inView(el,pad=40){const r=el.getBoundingClientRect();return r.width>0&&r.bottom>-pad&&r.top<innerHeight+pad;}

/* ---------- scratch font ---------- */
async function loadFonts(){
  const glyphs=Array.from(FONT_METRICS.glyphs);
  const out={big:{ink:[],fill:[]},small:{ink:[],fill:[]}};
  await Promise.all(['big','small'].flatMap(size=>['ink','fill'].flatMap(kind=>[1,2,3].map(async seed=>{
    const key=`scratch_${size}_${kind}_${seed}`,metrics=FONT_METRICS.atlases[key],im=await image(`fonts/${key}.png`);
    if(im.width!==metrics.width||im.height!==metrics.height)throw Error('Font atlas dimensions changed.');
    const cells=new Map(metrics.cells.map(([x,w],i)=>[glyphs[i],{x,w}]));
    out[size][kind][seed-1]={im,cells,h:im.height};
  }))));
  return out;
}
// Accents (Pokémon) are drawn as a small stroke from the apostrophe glyph.
const MARKS={'́':1,'̀':-1,'̈':2};
function word(text,big,kind,seed){
  const key=[text,big,kind,seed].join('|');if(cache.has(key)){const r=cache.get(key);cache.delete(key);cache.set(key,r);return r;}
  const a=atlases[big?'big':'small'][kind][seed],line=big?64:32,chars=Array.from(text.normalize('NFD'));
  const pad=chars.some(ch=>MARKS[ch])?Math.round(a.h*.2):0,H=a.h+pad;
  const width=chars.reduce((w,ch)=>MARKS[ch]?w:w+(a.cells.get(ch)?.w||(ch===' '?line*.32:line*.5)),0);
  const c=document.createElement('canvas');c.width=Math.max(1,width);c.height=H;const p=c.getContext('2d',{willReadFrequently:true});let x=0,prev=null;
  for(const ch of chars){
    const g=a.cells.get(ch);
    if(MARKS[ch]){const q=a.cells.get("'");if(q&&prev){const w=q.w*.8,h=a.h*.42;p.save();p.translate(prev.x+prev.w/2+(MARKS[ch]===-1?-w*.2:0),pad*.2);if(MARKS[ch]===2){p.drawImage(a.im,q.x,0,q.w,a.h,-w*.9,0,w*.6,h);p.drawImage(a.im,q.x,0,q.w,a.h,w*.3,0,w*.6,h);}else{p.rotate(MARKS[ch]*.5);p.drawImage(a.im,q.x,0,q.w,a.h,-w/2,0,w,h);}p.restore();}continue;}
    if(g){p.drawImage(a.im,g.x,0,g.w,a.h,x,pad,g.w,a.h);prev={x,w:g.w};x+=g.w;}
    else{const w=ch===' '?line*.32:line*.5;if(ch!==' '){p.font=`bold ${line*.6}px Verdana,sans-serif`;p.fillStyle='#fff';p.textAlign='center';p.fillText(ch,x+w/2,pad+line*.74);}prev={x,w};x+=w;}
  }
  const rgba=p.getImageData(0,0,c.width,c.height).data,data=new Uint8Array(c.width*c.height);for(let i=0;i<data.length;i++)data[i]=rgba[i*4+3];
  const r={c,w:c.width,h:c.height,pad,data,bytes:c.width*c.height*5};cache.set(key,r);cacheBytes+=r.bytes;
  return r;
}
function sample(a,x,y){x=Math.floor(x);y=Math.floor(y);return x<0||y<0||x>=a.w||y>=a.h?0:a.data[y*a.w+x]/255;}
function tint(ctx,a,x,y,w,h,color,alpha=1){if(!a.tints)a.tints=new Map();let c=a.tints.get(color);if(!c){c=document.createElement('canvas');c.width=a.w;c.height=a.h;const p=c.getContext('2d');p.drawImage(a.c,0,0);p.globalCompositeOperation='source-in';p.fillStyle=color;p.fillRect(0,0,c.width,c.height);a.tints.set(color,c);const bytes=a.w*a.h*4;a.bytes+=bytes;cacheBytes+=bytes;}ctx.globalAlpha=alpha;ctx.drawImage(c,x,y,w,h);ctx.globalAlpha=1;}
function dotWord(ctx,a,x,y,w,h,color,grid=2,alpha=1){const p=new Path2D();for(let yy=Math.floor(y/grid)*grid;yy<y+h;yy+=grid)for(let xx=Math.floor(x/grid)*grid;xx<x+w;xx+=grid){const v=sample(a,(xx-x)*a.w/w,(yy-y)*a.h/h);if(v>.03)dot(p,xx,yy,grid*.46*Math.sqrt(v));}paint(ctx,p,color,alpha);}

// Draw text in the scratch font into a box. Returns the inked extent.
// o: {size, color, align:'center'|'left'|'right', title:boolean, seeds:{fill,ink}}
export function text(ctx,str,bx,by,bw,bh,o={}){
  str=String(str??'');if(!str)return null;
  const size=o.size||24,color=colorOf(o.color),big=o.big??size>28,fs=o.seeds?.fill??fillSeed,is=o.seeds?.ink??inkSeed;
  if(!atlases){ctx.font=`bold ${Math.min(size,bh*.7)}px Verdana,sans-serif`;ctx.textBaseline='middle';ctx.textAlign=o.align||'center';ctx.fillStyle=color;ctx.fillText(str,o.align==='left'?bx:o.align==='right'?bx+bw:bx+bw/2,by+bh/2,bw);return {x:bx,y:by,w:bw,h:bh};}
  const a=word(str,big,'ink',is),b=word(str,big,'fill',fs),d=word(str,big,'fill',(fs+1)%3);
  const line=big?64:32,scale=Math.min(size/line,(bw-4)/a.w,(bh-2)/a.h),w=a.w*scale,h=a.h*scale;
  const x=o.align==='left'?bx+2:o.align==='right'?bx+bw-w-2:bx+(bw-w)/2,y=by+(bh-h)/2;
  if(o.title){
    const grid=o.grid||(w<300?3:5),off=grid*.9;
    dotWord(ctx,d,x+off+4,y+7,w,h,'#000',grid,.6);
    dotWord(ctx,b,x-off,y-1,w,h,C.cyan,grid);
    dotWord(ctx,d,x+off,y+2,w,h,C.magenta,grid);
    dotWord(ctx,a,x,y,w,h,o.face||C.ice,grid);
  }else{
    const off=big?2:1.1,cell=o.cell||(color===C.ice?C.plum:color);
    tint(ctx,d,x+off,y+off*.7,w,h,cell,.48);
    if(size>=18)dotWord(ctx,b,x+off*.45,y+off*.3,w,h,cell,size>34?6:4,.35);
    tint(ctx,a,x,y,w,h,color);
  }
  return {x,y,w,h};
}
export function measure(str,size){if(!atlases)return String(str).length*size*.6;const big=size>28,a=word(String(str),big,'ink',0);return a.w*Math.min(size/(big?64:32),1e9);}

/* ---------- lettering elements ---------- */
function setupLetter(el){
  if(el._wb)return;const t=el.textContent.trim();
  el._wb={text:t};el.textContent='';
  const sr=document.createElement('span');sr.className='sr';sr.textContent=t;el.append(sr);
  const cv=document.createElement('canvas');cv.setAttribute('aria-hidden','true');el.append(cv);el._wb.canvas=cv;el._wb.sr=sr;
  letters.add(el);sizeLetter(el);ro.observe(el);
}
function sizeLetter(el){
  const s=+el.dataset.size||22;
  if(el.dataset.fit==='auto'&&atlases){el.style.width=Math.ceil(measure(el._wb.text,s)+10)+'px';}
  if(!el.style.height&&!el.dataset.keepHeight)el.style.height=Math.round(s*(s>28?1.25:1.35)*(/[̀-ͯ]/.test(el._wb.text.normalize('NFD'))?1.2:1))+'px';
}
export function setText(el,t){
  if(!el)return;t=String(t);if(!el._wb){el.textContent=t;return;}
  if(el._wb.text===t)return;el._wb.text=t;el._wb.sr.textContent=t;sizeLetter(el);drawLetter(el);
}
function drawLetter(el){
  const L=el._wb,w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;
  const ctx=fit(L.canvas,w,h);ctx.clearRect(0,0,w,h);
  const hot=el.closest('.wb-pill')?.matches(':hover,:focus-visible');
  let color=el.dataset.color;if(hot&&el.dataset.hot)color=el.dataset.hot;
  text(ctx,L.text,0,0,w,h,{size:+el.dataset.size||22,color,align:el.dataset.align||'center',title:'title' in el.dataset});
}

/* ---------- aero window ---------- */
function setupWin(el){
  if(el._wb)return;
  const key=el.dataset.key,already=key&&seen.has(key);if(key){seen.add(key);if(seen.size>256)seen.delete(seen.values().next().value);}
  const cv=document.createElement('canvas');cv.className='wb-chrome';cv.setAttribute('aria-hidden','true');el.prepend(cv);
  const seed=Math.random();
  el._wb={canvas:cv,start:already||motion.matches?-10:clock+(+el.dataset.delay||0),w:0,h:0,
    color:el.dataset.tone?colorOf(el.dataset.tone):TITLE_COLORS[Math.floor(seed*TITLE_COLORS.length)],seed:seed*97,
    orbs:Array.from({length:3},(_,i)=>({x:Math.random(),y:Math.random(),r:25+Math.random()*27,vx:(Math.random()-.5)*10,vy:(Math.random()-.5)*8,color:['#23e5c6','#a4ee24','#1fa5ff'][i]})),
    swoosh:{x:Math.random(),y:Math.random(),vx:4+Math.random()*3,vy:(Math.random()-.5)*4},
    bubbles:Array.from({length:3},()=>({x:Math.random(),y:Math.random(),r:10+Math.random()*12}))};
  if(el._wb.start<clock)el.classList.add('open','ready');
  wins.add(el);ro.observe(el);
}
export function reopen(el){if(el?._wb&&!motion.matches){el._wb.start=clock;el.classList.remove('open','ready');}}
function drawWin(el){
  const s=el._wb,W=el.offsetWidth,H=el.offsetHeight;if(!W||!H)return;s.w=W;s.h=H;
  const ctx=fit(s.canvas,W+28,H+28);ctx.translate(14,14);ctx.clearRect(-14,-14,W+28,H+28);
  const age=motion.matches?10:clock-s.start;if(age<0)return;
  el.classList.add('open');const settled=age>=.5;if(settled)el.classList.add('ready');
  const calm=el.dataset.field==='calm',BAR=el.querySelector(':scope>.wb-bar')?38:0;
  const fr=Math.min(5,Math.floor(age*12)),pop=[[.08,.12],[.4,1.3],[1.12,.84],[.94,1.08],[1.02,.98],[1,1]][fr];
  // The opaque panel hides its interior shadow once open. Retain just the edge dots.
  const shadowKey=`${W}:${H}:${settled}`;
  if(s.shadowKey!==shadowKey){const sh=new Path2D();
    const right=9+6*Math.ceil((W-2.25-9)/6),bottom=9+6*Math.ceil((H-2.25-9)/6);
    for(let y=9;y<H+12;y+=6)for(let x=settled&&y<bottom?Math.max(9,right):9;x<W+12;x+=6)dot(sh,x,y,2.25);
    s.shadow=sh;s.shadowKey=shadowKey;
  }
  paint(ctx,s.shadow,C.plum,.8);
  ctx.save();ctx.translate(W/2,H/2);ctx.scale(pop[0],pop[1]);ctx.translate(-W/2,-H/2);
  ctx.fillStyle=C.paper;ctx.fillRect(0,0,W,H);
  if(BAR){ctx.fillStyle=s.color;ctx.fillRect(0,0,W,BAR);
    const caps=el.querySelectorAll(':scope>.wb-bar .wb-caps>*').length;
    for(let i=0;i<caps;i++){const x=W-7-caps*22-(caps-1)*4+i*26,red=i===caps-1;
      const g=ctx.createLinearGradient(0,8,0,31);g.addColorStop(0,red?'#ffb297':'#93ecff');g.addColorStop(.43,red?'#ff6243':'#25a9ff');g.addColorStop(1,red?'#e52d24':'#0054f5');
      ctx.fillStyle=g;ctx.fillRect(x,8,22,23);ctx.lineWidth=1.3;ctx.strokeStyle='#f9f4e4';ctx.strokeRect(x+.5,8.5,21,22);}
  }
  ctx.restore();
  const paths=new Map(),P=calm?9:6,time=motion.matches?0:clock;
  const add=(col,x,y,r)=>{if(r<.08)return;let p=paths.get(col);if(!p){p=new Path2D();paths.set(col,p);}dot(p,x,y,Math.min(P*.46,r));};
  const orbs=calm?[]:s.orbs.map(o=>({...o,cx:mod(o.x*W+time*o.vx+o.r,W+o.r*2)-o.r,cy:BAR+mod(o.y*(H-BAR)+time*o.vy+o.r,H-BAR+o.r*2)-o.r}));
  const sx=mod(s.swoosh.x*W+time*s.swoosh.vx+100,W+200)-100,sy=BAR+mod(s.swoosh.y*(H-BAR)+time*s.swoosh.vy+60,H+80)-60;
  for(let y=3;y<H;y+=P)for(let x=3;x<W;x+=P){
    const px=(x-W/2)/pop[0]+W/2,py=(y-H/2)/pop[1]+H/2;if(px<0||px>W||py<0||py>H)continue;
    const noise=hash(x,y+fillSeed*3);
    if(py<BAR){add('#28a4ff',x,y,2.5-1.35*py/BAR+noise*.18);if(py<18)add('#fffdf4',x,y,1.7*(1-py/22));
      if(Math.hypot(px-17,py-19)<8)add(C.yellow,x,y,2.65);if(Math.hypot(px-17,py-19)<3)add(C.ink,x,y,2.7);continue;}
    const v=(py-BAR)/(H-BAR);let r=calm?.2+1.1*Math.pow(1-v,2.2)+noise*.1:.25+1.75*Math.pow(1-v,1.6)+noise*.14,col='#21cce5';
    for(const o of orbs){const dx=(px-o.cx)/o.r,dy=(py-o.cy)/o.r,q=dx*dx+dy*dy;if(q<1){const z=Math.sqrt(1-q),lit=Math.max(0,-dx*.45-dy*.55+z*.65);r=Math.max(r,.65+lit*1.85);col=o.color;if((dx+.32)**2+(dy+.4)**2<.055){r=2.5;col=C.ice;}}}
    if(!calm){const u=(px-sx)/85,d=(py-sy)/36+.45*Math.sin(u*2);if(Math.abs(u)<1&&Math.abs(d)<.14*(1-u*u)){r=2.1*(1-Math.abs(u))+.4;col='#05c9f7';}
      for(const b of s.bubbles){const bx=b.x*W,by=46+b.y*(H-56);if(Math.abs(Math.hypot(px-bx,py-by)-b.r)<2){col='#ffffff';r=2.3;}}}
    add(col,x,y,r);
  }
  paths.forEach((p,col)=>paint(ctx,p,col,.85));
  ctx.save();ctx.translate(W/2,H/2);ctx.scale(pop[0],pop[1]);ctx.translate(-W/2,-H/2);
  inkBox(ctx,0,0,W,H,s.seed,settled);
  if(BAR){const j=(i)=>(hash(i+s.seed,fillSeed)-.5)*(settled?1.6:2.2);ctx.beginPath();ctx.moveTo(-1,BAR+j(1));ctx.lineTo(W+1,BAR+j(2));ctx.strokeStyle=C.ink;ctx.lineWidth=1.7;ctx.stroke();}
  ctx.restore();
}
// Boiling ink rectangle with magenta + cyan misprints. Corners swap on the 2s clock.
export function inkBox(ctx,x0,y0,W,H,seed=0,settled=true,lw=3,fs=fillSeed){
  const j=(i,s)=>(hash(i+seed+s,fs)-.5)*(settled?5.2:7);
  const pts=[[0,0],[W*.34,0],[W*.71,0],[W,0],[W,H*.43],[W,H],[W*.61,H],[W*.27,H],[0,H],[0,H*.47]];
  const one=(dx,dy,color,w,s)=>{ctx.beginPath();pts.forEach(([x,y],i)=>{const xx=x0+x+dx+j(i*2+1,s),yy=y0+y+dy+j(i*2+2,s);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=w;ctx.lineJoin='miter';ctx.stroke();};
  one(-4,2,C.magenta,lw*.7,37);one(4,-2,C.cyan,lw*.7,79);one(0,0,C.ink,lw,0);
}

/* ---------- glossy pill buttons ---------- */
const TONES={pink:[['#ffa7eb','#ff42d2','#ec00a7','#ff26b9']],blue:[['#a8d4ff','#2a8cff','#0050f0','#1c78ff']],lime:[['#f2ffb0','#b8f53a','#7fd600','#a8ee20']]};
const HOT=['#a5ffff','#00e8ff','#00bcf4','#00d6ef'];
function setupPill(el){
  if(el._wb)return;const cv=document.createElement('canvas');cv.className='wb-pillface';cv.setAttribute('aria-hidden','true');el.prepend(cv);
  el._wb={canvas:cv};pills.add(el);ro.observe(el);
  const redraw=()=>drawPill(el);['pointerenter','pointerleave','focus','blur'].forEach(t=>el.addEventListener(t,()=>{redraw();el.querySelectorAll('.wb-l').forEach(l=>l._wb&&drawLetter(l));}));
}
function pillDistance(x,y,rect,frame,dx=0,dy=0){const cx=rect.left+rect.width/2+dx,cy=rect.top+rect.height/2+dy,px=x-cx,py=y-cy,radius=rect.height/2-4,half=rect.width/2-rect.height/2,qx=Math.max(Math.abs(px)-half,0),d=Math.hypot(qx,py)-radius,a=Math.atan2(py,px);return d+Math.sin(a*7+frame*2.1)*.7+Math.sin(a*13-frame*1.7)*.35;}
function drawPill(el){
  const s=el._wb,W=el.offsetWidth,H=el.offsetHeight;if(!W||!H)return;
  const M=12,ctx=fit(s.canvas,W+M*2,H+M*2);ctx.translate(M,M);ctx.clearRect(-M,-M,W+M*2,H+M*2);
  const off=el.disabled,hot=!off&&el.matches(':hover,:focus-visible'),pressed=el.getAttribute('aria-pressed')==='true';
  const r=H/2-4,x=3,y=3,w=W-6,h=H-6,rect={left:x,top:y,width:w,height:h};
  const shadow=new Path2D(),sheen=new Path2D();
  for(let yy=-3;yy<h+12;yy+=6)for(let xx=-3;xx<w+12;xx+=6){
    if(!pressed&&pillDistance(xx,yy,rect,fillSeed,5,7)<0)dot(shadow,xx,yy,2.2);
    if(pillDistance(xx,yy,rect,fillSeed)<-5&&yy<y+h*.43)dot(sheen,xx,yy,2.1*(1-(yy-y)/(h*.5)));
  }
  paint(ctx,shadow,C.plum,off?.35:.8);
  const tone=(hot||pressed)?HOT:off?['#f4efe0','#e6e0cf','#dcd5c2','#e9e3d2']:(TONES[el.dataset.tone]||TONES.pink)[0];
  const g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,tone[0]);g.addColorStop(.38,tone[1]);g.addColorStop(.43,tone[2]);g.addColorStop(1,tone[3]);
  ctx.save();if(pressed)ctx.translate(3,4);
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=g;ctx.fill();paint(ctx,sheen,'#ffffff',off?.5:.88);
  const ink=(dx,dy,seed)=>{ctx.beginPath();let i=0;const pt=(xx,yy)=>{const jx=(hash(i+seed,fillSeed)-.5)*2.4,jy=(hash(i+seed+41,fillSeed)-.5)*2.4;i?ctx.lineTo(xx+dx+jx,yy+dy+jy):ctx.moveTo(xx+dx+jx,yy+dy+jy);i++;};
    for(let k=0;k<=12;k++){const a=-Math.PI/2+k*Math.PI/12;pt(x+w-r+Math.cos(a)*r,y+h/2+Math.sin(a)*r);}
    for(let k=0;k<=12;k++){const a=Math.PI/2+k*Math.PI/12;pt(x+r+Math.cos(a)*r,y+h/2+Math.sin(a)*r);}ctx.closePath();};
  if(!off){ink(-2,1,31);ctx.strokeStyle=C.magenta;ctx.lineWidth=1.5;ctx.stroke();ink(2,-1,67);ctx.strokeStyle=C.cyan;ctx.stroke();}
  ink(0,0,0);ctx.strokeStyle=off?'#9a94b8':C.ink;ctx.lineWidth=2.8;ctx.stroke();
  ctx.restore();
}

/* ---------- aero world (page background) ---------- */
let world,worldCtx,worldT=-1e9;const worldObjs=Array.from({length:11},(_,i)=>({x:hash(i,2),y:hash(i,3),r:52+hash(i,4)*91,angle:hash(i,5)*Math.PI*2,vx:(hash(i,6)-.5)*9,vy:(hash(i,7)-.5)*7,kind:i%6,col:Math.floor(hash(i,8)*4)}));
function drawWorld(force){
  if(!world||document.hidden)return;const now=performance.now();if(!force&&now-worldT<150)return;worldT=now;
  const W=innerWidth,H=innerHeight,ctx=fit(world,W,H),grid=8,t=motion.matches?0:clock,pal=['#ff19b7','#69eb08','#075fff','#00dabd'];
  ctx.clearRect(0,0,W,H);const paths=new Map();
  const add=(c,x,y,r)=>{if(r<.08)return;let p=paths.get(c);if(!p){p=new Path2D();paths.set(c,p);}dot(p,x,y,Math.min(grid*.46,r));};
  for(const o of worldObjs){
    const cx=mod(o.x*W+t*o.vx+140,W+280)-140,cy=mod(o.y*H+t*o.vy+140,H+280)-140,R=o.r,E=R*1.8,ca=Math.cos(o.angle),sa=Math.sin(o.angle);
    for(let y=Math.max(2.5,Math.floor((cy-E)/grid)*grid+2.5);y<Math.min(H,cy+E);y+=grid)for(let x=Math.max(2.5,Math.floor((cx-E)/grid)*grid+2.5);x<Math.min(W,cx+E);x+=grid){
      const dx=(x-cx)/R,dy=(y-cy)/R,u=dx*ca+dy*sa,v=-dx*sa+dy*ca;let nx=0,ny=0,nz=0,inside=false,k=1;
      if(o.kind===0){const q=u*u+v*v;if(q<1){inside=true;nx=u;ny=v;nz=Math.sqrt(1-q);}}
      if(o.kind===1||o.kind===5){const rad=Math.hypot(u,v),tube=o.kind===1?.055:.21,q=(rad-.73)/tube;if(Math.abs(q)<1){inside=true;nx=q*u/Math.max(rad,.01);ny=q*v/Math.max(rad,.01);nz=Math.sqrt(1-q*q);k=o.kind===1?.88:1;}}
      if(o.kind===2||o.kind===3){const lim=o.kind===2?1.45:1.2,cu=.26*Math.sin(u*2.4),th=(o.kind===2?.14:.27)*Math.max(0,1-(u/lim)**2),q=(v-cu)/Math.max(th,.001);if(Math.abs(u)<lim&&Math.abs(q)<1){inside=true;ny=q;nz=Math.sqrt(1-q*q);nx=-.35*Math.cos(u*2.4)*q;}}
      if(o.kind===4){const a=Math.max(Math.abs(u)-.65,0),b=v/.47,q=a*a+b*b;if(q<1){inside=true;nx=Math.sign(u)*a;ny=b;nz=Math.sqrt(1-q);}}
      if(!inside)continue;
      const lit=Math.max(0,-nx*.43-ny*.55+nz*.68),shine=Math.pow(Math.max(0,-nx*.36-ny*.43+nz*.82),24);
      add(shine>.45?'#fafff1':pal[o.col],x,y,grid*.46*Math.sqrt((.22+.64*lit+.23*shine)*k));
    }
  }
  paths.forEach((p,c)=>paint(ctx,p,c,1));
}

/* ---------- registry + clock ---------- */
export function face(canvas,draw){const f={canvas,draw,dirty:true};canvas._wbFace=f;faces.add(f);return f;}
export function dirty(canvas){if(canvas?._wbFace){canvas._wbFace.dirty=true;wake();}}
function scan(root=document){
  root.querySelectorAll?.('.wb-win').forEach(setupWin);
  root.querySelectorAll?.('.wb-l').forEach(setupLetter);
  root.querySelectorAll?.('.wb-pill').forEach(setupPill);
}
function prune(){for(const set of [wins,letters,pills])for(const el of set)if(!el.isConnected){set.delete(el);ro.unobserve(el);releaseCanvas(el._wb.canvas);}for(const f of faces)if(!f.canvas.isConnected){faces.delete(f);releaseCanvas(f.canvas);}}
export function redraw(all=false){
  prune();
  wins.forEach(el=>{if(all||inView(el))drawWin(el);});
  pills.forEach(el=>{if(all||inView(el))drawPill(el);});
  letters.forEach(el=>{if(all||inView(el))drawLetter(el);});
  faces.forEach(f=>{if((f.dirty||all||f.live?.())&&inView(f.canvas)){f.dirty=false;f.draw(f.canvas);}});
  drawWorld(all);trimFontCache();
}
function tick(){
  const now=performance.now(),active=animationActive(now,lastInput,{hidden:document.hidden,focused,reduced:motion.matches});
  const dt=Math.min((now-last)/1000,.25);last=now;prune();trimFontCache();
  document.documentElement.classList.toggle('wb-idle',!active);
  if(!active){if(!document.hidden)faces.forEach(f=>{if(f.dirty&&inView(f.canvas)){f.dirty=false;f.draw(f.canvas);}});return;}
  clock+=dt;
  fillSeed=motion.matches?0:Math.floor(clock*6)%3;inkSeed=motion.matches?0:Math.floor(clock*3)%3;
  prune();
  wins.forEach(el=>{if(inView(el)){const age=clock-el._wb.start;if(!motion.matches||age<1)drawWin(el);}});
  if(!motion.matches){pills.forEach(el=>inView(el)&&drawPill(el));letters.forEach(el=>inView(el)&&drawLetter(el));}
  faces.forEach(f=>{if((f.dirty||(!motion.matches&&f.live?.()))&&inView(f.canvas)){f.dirty=false;f.draw(f.canvas);}});
  drawWorld();trimFontCache();
}
export async function boot(){
  world=document.getElementById('wb-world');
  scan();
  new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1){wake();if(n.matches?.('.wb-win'))setupWin(n);if(n.matches?.('.wb-l'))setupLetter(n);if(n.matches?.('.wb-pill'))setupPill(n);scan(n);}}).observe(document.body,{childList:true,subtree:true});
  addEventListener('resize',()=>{wake();redraw(true);},{passive:true});
  addEventListener('scroll',()=>{wake();redraw();},{passive:true});
  try{atlases=await loadFonts();letters.forEach(sizeLetter);}catch{/* real text stays readable without the atlases */}
  redraw(true);
  setInterval(tick,1000/6);
  for(const event of ['pointermove','pointerdown','keydown'])addEventListener(event,wake,{passive:true});
  addEventListener('blur',()=>{focused=false;});
  addEventListener('focus',()=>{focused=true;wake();redraw(true);});
  motion.addEventListener('change',()=>{wake();redraw(true);});
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(!document.hidden){wake();redraw(true);}});
}

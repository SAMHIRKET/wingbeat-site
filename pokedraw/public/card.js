// Pokedraw card: one renderer for the screen and the downloaded PNG, so they match.
// Card space is 300 x 420; callers scale. Look: cream paper, halftone title band in
// a rolled colour, the player's drawing in a boiled frame, black marker strip foot,
// plum dot shadow, misprinted boiling ink border. Winners get a dot holo band.
import {C,dot,paint,hash,text,inkBox,boil} from './kit.js';

export const CARD_W = 300, CARD_H = 420, MARGIN = 16;
const BANDS = ['#004cff','#00b96a','#ff21b5','#e8341c','#7222a4','#0095c8'];
export const bandFor = name => BANDS[[...String(name)].reduce((n,ch)=>n+ch.charCodeAt(0),0)%BANDS.length];

// o: {title, num, art (canvas 800x600 or null), artist, caption, foot, footRight, winner, seed}
// f: {fill, ink, t} boil frame; omit for the live clock.
export function drawCard(ctx,o,f){
  const b=f||boil(),fs=b.fill,seeds={fill:b.fill,ink:b.ink},t=b.clock||0,seed=o.seed||0;
  const W=CARD_W,H=CARD_H,band=bandFor(o.title);
  // shadow
  const sh=new Path2D();for(let y=10;y<H+12;y+=6)for(let x=10;x<W+11;x+=6)dot(sh,x,y,2.25);paint(ctx,sh,C.plum,.8);
  ctx.fillStyle=C.paper;ctx.fillRect(0,0,W,H);
  if(o.back){drawBack(ctx,o,b,seed,band);return;}
  // body dot screen, thin, fading down from under the art
  const body=new Path2D();for(let y=276;y<H-46;y+=7)for(let x=4;x<W;x+=7){const v=(y-276)/(H-322);dot(body,x,y,.3+1.2*Math.pow(1-v,1.8)+hash(x,y+fs*3)*.12);}
  paint(ctx,body,'#21cce5',.55);
  // title band
  ctx.fillStyle=band;ctx.fillRect(0,0,W,56);
  const bd=new Path2D(),gl=new Path2D(),holo=new Map();
  for(let y=3;y<56;y+=6)for(let x=3;x<W;x+=6){
    const n=hash(x,y+fs*3);
    if(o.winner){const hue=Math.floor(mod((x*.9+y*.6+t*40)/60,6));let p=holo.get(hue);if(!p){p=new Path2D();holo.set(hue,p);}dot(p,x,y,2.6-1.3*y/56+n*.2);}
    else dot(bd,x,y,2.5-1.35*y/56+n*.18);
    if(y<22)dot(gl,x,y,1.7*(1-y/26));
  }
  if(o.winner){const hc=['#ff27ba','#ffe72b','#c6ff3a','#00d4e8','#1263ff','#b04cff'];holo.forEach((p,h)=>paint(ctx,p,hc[h],.95));}
  else paint(ctx,bd,'#28a4ff',.85);
  paint(ctx,gl,'#fffdf4',.9);
  text(ctx,o.title,10,5,o.num?226:280,46,{size:50,color:C.ice,align:'left',seeds});
  if(o.num)text(ctx,o.num,236,12,54,32,{size:26,color:C.ice,align:'right',seeds});
  ctx.beginPath();ctx.moveTo(0,56+(hash(seed,fs)-.5)*1.5);ctx.lineTo(W,56+(hash(seed+1,fs)-.5)*1.5);ctx.strokeStyle=C.ink;ctx.lineWidth=1.7;ctx.stroke();
  // art window 4:3
  const ax=18,ay=70,aw=264,ah=198;
  const ash=new Path2D();for(let y=ay+6;y<ay+ah+8;y+=5)for(let x=ax+6;x<ax+aw+8;x+=5)dot(ash,x,y,1.7);paint(ctx,ash,C.plum,.55);
  ctx.fillStyle='#fff';ctx.fillRect(ax,ay,aw,ah);
  if(o.art)ctx.drawImage(o.art,ax,ay,aw,ah);
  else{const q=new Path2D();for(let y=ay+6;y<ay+ah;y+=8)for(let x=ax+6;x<ax+aw;x+=8)dot(q,x,y,1.2);paint(ctx,q,'#9fe8ff',.8);}
  inkBox(ctx,ax,ay,aw,ah,seed+11,true,2.2,fs);
  // artist + caption
  text(ctx,o.artist||'',14,276,272,46,{size:44,color:C.ink,align:'left',seeds});
  if(o.caption)text(ctx,o.caption,14,322,272,32,{size:30,color:C.plum,align:'left',seeds});
  // marker strip foot
  const y0=H-44,y1=H-14,x0=10,x1=W-10,J=(i,a)=>(hash(i+seed,fs+7)-.5)*a,pts=[];
  for(let i=0;i<=9;i++){const k=i/9;pts.push([x0+(x1-x0)*k+J(i,3),y0+2*k+J(i+20,5)]);}
  for(let i=0;i<=3;i++)pts.push([x1+J(i+40,9),y0+2+(y1-y0)*i/3+J(i+45,2)]);
  for(let i=9;i>=0;i--){const k=i/9;pts.push([x0+(x1-x0)*k+J(i+60,3),y1+2*k+J(i+80,5)]);}
  for(let i=3;i>=0;i--)pts.push([x0+J(i+100,9),y0+(y1-y0)*i/3+J(i+105,2)]);
  const strip=()=>{ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();};
  ctx.save();ctx.translate(-3,1);strip();ctx.fillStyle=C.magenta;ctx.globalAlpha=.85;ctx.fill();ctx.restore();
  ctx.save();ctx.translate(3,-1);strip();ctx.fillStyle=C.cyan;ctx.globalAlpha=.85;ctx.fill();ctx.restore();
  ctx.globalAlpha=1;strip();ctx.fillStyle='#050505';ctx.fill();
  if(o.foot)text(ctx,o.foot,x0+8,y0+2,170,y1-y0,{size:26,color:C.lime,align:'left',seeds});
  if(o.footRight)text(ctx,o.footRight,x1-110,y0+2,102,y1-y0,{size:26,color:C.sky,align:'right',seeds});
  // winner star in yellow dots, over the corner
  if(o.winner){const cx=W-34,cy=92,st=new Path2D(),ink=new Path2D();
    for(let y=cy-30;y<cy+30;y+=4)for(let x=cx-30;x<cx+30;x+=4){const a=Math.atan2(y-cy,x-cx)+t*.6,r=Math.hypot(x-cx,y-cy),edge=20+9*Math.cos(5*a);if(r<edge)dot(st,x,y,1.9);else if(r<edge+3)dot(ink,x,y,1.7);}
    paint(ctx,ink,C.ink);paint(ctx,st,C.yellow);}
  inkBox(ctx,0,0,W,H,seed,true,3,fs);
}
// Face-down card: halftone field in the band colour, a glossy dot orb, the name across it.
function drawBack(ctx,o,b,seed,band){
  const W=CARD_W,H=CARD_H,fs=b.fill,t=b.clock||0,field=new Path2D(),orb=new Map();
  const add=(c,x,y,r)=>{let p=orb.get(c);if(!p){p=new Path2D();orb.set(c,p);}dot(p,x,y,r);};
  const cx=W/2,cy=H/2,R=92;
  for(let y=4;y<H;y+=7)for(let x=4;x<W;x+=7){
    const dx=(x-cx)/R,dy=(y-cy)/R,q=dx*dx+dy*dy;
    if(q<1){const z=Math.sqrt(1-q),a=t*.5,lit=Math.max(0,-dx*Math.cos(a)*.5-dy*.5+z*.65);add(lit>.95?C.ice:'#ff32c0',x,y,.9+2.4*lit);continue;}
    const d=Math.hypot(x-cx,y-cy)/Math.hypot(cx,cy);dot(field,x,y,.5+2.4*d+hash(x,y+fs*3)*.25);
  }
  paint(ctx,field,band,.9);orb.forEach((p,c)=>paint(ctx,p,c,1));
  ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();ctx.translate(cx,cy);ctx.rotate(-.18);
  ctx.fillStyle='#050505';ctx.fillRect(-W*.62,-24,W*1.24,48);
  text(ctx,o.backTitle||'POKEDRAW',-W*.45,-22,W*.9,44,{size:40,color:C.lime,seeds:{fill:b.fill,ink:b.ink}});
  ctx.restore();
  inkBox(ctx,0,0,W,H,seed,true,3,fs);
}
function mod(n,m){return((n%m)+m)%m;}

// Paint a card into a canvas element at its CSS size (with margin for shadow/jitter).
export function paintCard(canvas,o,f){
  const w=canvas.clientWidth||CARD_W,h=w*(CARD_H+MARGIN*2)/(CARD_W+MARGIN*2),d=Math.min(devicePixelRatio||1,2);
  const W=Math.ceil(w*d),H=Math.ceil(h*d);if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  const ctx=canvas.getContext('2d'),s=W/(CARD_W+MARGIN*2);
  ctx.setTransform(s,0,0,s,MARGIN*s,MARGIN*s);ctx.clearRect(-MARGIN,-MARGIN,CARD_W+MARGIN*2,CARD_H+MARGIN*2);
  drawCard(ctx,o,f);
}
// Export: fixed boil frame so the file is the settled card.
export function exportCard(o,scale=2){
  const c=document.createElement('canvas');c.width=(CARD_W+MARGIN*2)*scale;c.height=(CARD_H+MARGIN*2)*scale;
  const ctx=c.getContext('2d');ctx.setTransform(scale,0,0,scale,MARGIN*scale,MARGIN*scale);
  drawCard(ctx,o,{fill:0,ink:0,clock:0});return c;
}

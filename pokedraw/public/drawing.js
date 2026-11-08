// Hard-edged pixel drawing (Aseprite-style behaviour, our own code).
// The drawing is an 800x600 pixel grid kept in memory. Every tool writes whole
// pixels: no antialiasing, and the bucket fill matches colours exactly, so there
// is no halo. The canvas is never read back (getImageData), which avoids the
// browser pixel noise that broke the font on SAM's phone.
// The saved format is unchanged: {ops:[{tool,color,size,alpha,points:[[x,y,p]]}],revision}.
export const W = 800, H = 600;
const WHITE = 0xffffffff;

function rgba(hex){const n=parseInt(String(hex).slice(1,7),16)||0;return [(n>>16)&255,(n>>8)&255,n&255];}
const pack=(r,g,b)=>(255<<24|b<<16|g<<8|r)>>>0;
function blend(dst,[r,g,b],a){if(a>=1)return pack(r,g,b);const dr=dst&255,dg=(dst>>8)&255,db=(dst>>16)&255;return pack(Math.round(r*a+dr*(1-a)),Math.round(g*a+dg*(1-a)),Math.round(b*a+db*(1-a)));}
export function hexAt(px,x,y){x=Math.max(0,Math.min(W-1,Math.floor(x)));y=Math.max(0,Math.min(H-1,Math.floor(y)));const v=px[y*W+x];return '#'+[v&255,(v>>8)&255,(v>>16)&255].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function blank(){const px=new Uint32Array(W*H);px.fill(WHITE);return px;}

// Round brush footprints by integer diameter (1 = single pixel).
const stamps=new Map();
function stamp(d){d=Math.max(1,Math.min(64,Math.round(d)));let s=stamps.get(d);if(s)return s;s=[];const c=(d-1)/2,r2=(d/2)*(d/2)+(d>2?.25:0);
  for(let j=0;j<d;j++)for(let i=0;i<d;i++)if((i-c)**2+(j-c)**2<=r2)s.push([i-Math.floor(c),j-Math.floor(c)]);stamps.set(d,s);return s;}
// Pixels of a straight line (Bresenham).
function line(x0,y0,x1,y1,out){let dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,e=dx+dy;for(;;){out.push(x0,y0);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx;}if(e2<=dx){e+=dx;y0+=sy;}}return out;}
// Outline pixels of an ellipse in a bounding box (midpoint algorithm).
function ellipse(x0,y0,x1,y1,out){
  if(x0>x1)[x0,x1]=[x1,x0];if(y0>y1)[y0,y1]=[y1,y0];
  let a=x1-x0,b=y1-y0,b1=b&1,dx=4*(1-a)*b*b,dy=4*(b1+1)*a*a,err=dx+dy+b1*a*a,e2;
  if(a===0||b===0)return line(x0,y0,x1,y1,out);
  y0+=(b+1)>>1;y1=y0-b1;a*=8*a;b1=8*b*b;
  do{out.push(x1,y0,x0,y0,x0,y1,x1,y1);e2=2*err;if(e2<=dy){y0++;y1--;err+=dy+=a;}if(e2>=dx||2*err>dy){x0++;x1--;err+=dx+=b1;}}while(x0<=x1);
  while(y0-y1<=b){out.push(x0-1,y0,x1+1,y0++,x0-1,y1,x1+1,y1--);}
  return out;
}
// Remove L-shaped corners from a 1px freehand path so diagonals stay one pixel thin.
function pixelPerfect(pts){const out=[];for(const p of pts){const n=out.length;if(n&&out[n-1][0]===p[0]&&out[n-1][1]===p[1])continue;
  if(n>=2){const a=out[n-2],b=out[n-1];if((a[0]===b[0]||a[1]===b[1])&&(p[0]===b[0]||p[1]===b[1])&&a[0]!==p[0]&&a[1]!==p[1])out.pop();}out.push(p);}return out;}

// Which pixels an op covers, before colour. Returns a flat [x,y,x,y...] list of centre pixels plus brush size per pixel.
function trace(op){
  const P=op.points.map(([x,y,p])=>[Math.floor(x),Math.floor(y),p??1]),size=Math.max(1,Math.round(op.size||1)),centres=[];
  const [x0,y0]=P[0],[x1,y1]=P.at(-1);
  if(op.tool==='line'){line(x0,y0,x1,y1,centres);return {centres,size:()=>size};}
  if(op.tool==='rect'){line(x0,y0,x1,y0,centres);line(x1,y0,x1,y1,centres);line(x1,y1,x0,y1,centres);line(x0,y1,x0,y0,centres);return {centres,size:()=>size};}
  if(op.tool==='ellipse'){ellipse(x0,y0,x1,y1,centres);return {centres,size:()=>size};}
  // freehand pen / eraser: pressure varies size per point
  const per=[];let path=[];
  for(let i=0;i<P.length;i++){const s=Math.max(1,Math.round(size*Math.max(.25,P[i][2])));
    if(i===0){path.push([P[0][0],P[0][1],s]);continue;}const seg=line(P[i-1][0],P[i-1][1],P[i][0],P[i][1],[]);for(let k=2;k<seg.length;k+=2)path.push([seg[k],seg[k+1],s]);}
  if(size===1)path=pixelPerfect(path);
  for(const [x,y,s] of path){centres.push(x,y);per.push(s);}
  return {centres,size:i=>per[i]};
}

// Paint one op into a pixel grid. mask is reused to blend each pixel once per op.
const MASK=new Uint8Array(W*H);
export function drawOp(px,op){
  if(!op?.points?.length)return;
  const color=op.tool==='eraser'?[255,255,255]:rgba(op.color),alpha=op.tool==='eraser'?1:Math.max(0,Math.min(1,op.alpha??1));
  if(op.tool==='fill'){fill(px,op.points[0][0],op.points[0][1],color,alpha);return;}
  const {centres,size}=trace(op),touched=[];
  for(let i=0;i<centres.length;i+=2){const s=stamp(size(i/2)),cx=centres[i],cy=centres[i+1];
    for(const [ox,oy] of s){const x=cx+ox,y=cy+oy;if(x<0||y<0||x>=W||y>=H)continue;const k=y*W+x;if(MASK[k])continue;MASK[k]=1;touched.push(k);px[k]=blend(px[k],color,alpha);}}
  for(const k of touched)MASK[k]=0;
}
// Exact-colour flood fill, 4-way. Edges stay hard; nothing is left between line and fill.
export function fill(px,x,y,color,alpha=1){
  x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=W||y>=H)return;
  const target=px[y*W+x],next=blend(target,color,alpha);if(next===target)return;
  const stack=[x,y];
  while(stack.length){let cy=stack.pop(),cx=stack.pop(),k=cy*W+cx;if(px[k]!==target)continue;
    let l=cx;while(l>0&&px[k-(cx-l)-1]===target)l--;let r=cx;while(r<W-1&&px[k+(r-cx)+1]===target)r++;
    let up=false,down=false;
    for(let i=l;i<=r;i++){const j=cy*W+i;px[j]=next;
      if(cy>0){const u=px[j-W]===target;if(u&&!up)stack.push(i,cy-1);up=u;}
      if(cy<H-1){const d=px[j+W]===target;if(d&&!down)stack.push(i,cy+1);down=d;}}
  }
}
// Live freehand preview: stamp only the new segment, each pixel blended once per stroke.
export function strokeSegment(px,mask,a,b,size,hex,alpha,eraser){
  const color=eraser?[255,255,255]:rgba(hex),al=eraser?1:alpha,s0=Math.max(1,Math.round(size*Math.max(.25,b[2]??1))),st=stamp(s0);
  const seg=a?line(Math.floor(a[0]),Math.floor(a[1]),Math.floor(b[0]),Math.floor(b[1]),[]):[Math.floor(b[0]),Math.floor(b[1])];
  for(let i=a?2:0;i<seg.length;i+=2)for(const [ox,oy] of st){const x=seg[i]+ox,y=seg[i+1]+oy;if(x<0||y<0||x>=W||y>=H)continue;const k=y*W+x;if(mask[k])continue;mask[k]=1;px[k]=blend(px[k],color,al);}
}
export function renderPixels(ops=[],px=blank()){for(const op of ops)drawOp(px,op);return px;}

// Put a pixel grid on a canvas of any size. Upscaling stays pixelated; small thumbnails may smooth.
const scratch=typeof document!=='undefined'?document.createElement('canvas'):null;
export function show(canvas,px){
  const ctx=canvas.getContext('2d');
  const img=new ImageData(new Uint8ClampedArray(px.buffer,px.byteOffset,px.byteLength),W,H);
  if(canvas.width===W&&canvas.height===H){ctx.putImageData(img,0,0);return;}
  scratch.width=W;scratch.height=H;scratch.getContext('2d').putImageData(img,0,0);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=canvas.width<W;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(scratch,0,0,canvas.width,canvas.height);ctx.restore();
}
export function renderDrawing(canvas,ops=[]){show(canvas,renderPixels(ops));}
export async function replayDrawing(canvas,ops,duration=3500,signal){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){renderDrawing(canvas,ops);return;}
  const px=blank();show(canvas,px);const start=performance.now();let index=0;
  await new Promise(resolve=>{function step(now){if(signal?.aborted||!canvas.isConnected){resolve();return;}
    const target=Math.min(ops.length,Math.floor((now-start)/duration*ops.length));if(target>index){while(index<target)drawOp(px,ops[index++]);show(canvas,px);}
    if(index<ops.length)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});
}

export class Sketch {
  constructor(canvas,onChange,onColor){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.change=onChange;this.onColor=onColor;this.ops=[];this.redoOps=[];this.revision=0;this.tool='pen';this.color='#29235c';this.size=7;this.alpha=1;this.pressure=true;this.locked=false;this.zoom=1;this.pan={x:0,y:0};this.points=new Map();this.abort=new AbortController();
    this.base=blank();this.view=new Uint32Array(this.base);this.mask=new Uint8Array(W*H);
    const o={signal:this.abort.signal};canvas.addEventListener('pointerdown',e=>this.down(e),o);canvas.addEventListener('pointermove',e=>this.move(e),o);canvas.addEventListener('pointerup',e=>this.up(e),o);canvas.addEventListener('pointercancel',e=>this.up(e),o);canvas.addEventListener('lostpointercapture',e=>this.up(e),o);canvas.addEventListener('contextmenu',e=>e.preventDefault(),o);
    canvas.style.imageRendering='pixelated';show(canvas,this.base);
  }
  load(d){this.ops=d.ops||[];this.revision=d.revision||0;this.redoOps=[];this.rebuild();}
  snapshot(){return {ops:this.ops,revision:this.revision};}
  dispose(){this.abort.abort();}
  point(e){const r=this.canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(799.99,(e.clientX-r.left)/r.width*800))*10)/10,Math.round(Math.max(0,Math.min(599.99,(e.clientY-r.top)/r.height*600))*10)/10,e.pointerType==='pen'&&this.pressure?Math.max(.15,e.pressure||.5):1];}
  down(e){
    if(this.locked||e.button!==0)return;e.preventDefault();this.canvas.setPointerCapture(e.pointerId);this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.points.size>1){this.current=null;this.render();const[a,b]=[...this.points.values()];this.gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,pan:{...this.pan}};return;}
    this.primary=e.pointerId;this.lastScreen={x:e.clientX,y:e.clientY};const p=this.point(e);
    if(this.tool==='pan')return;
    if(this.tool==='picker'){this.color=hexAt(this.base,p[0],p[1]);this.onColor?.(this.color);return;}
    this.current={tool:this.tool,color:this.color,size:Math.max(1,Math.round(this.size)),alpha:this.tool==='eraser'?1:this.alpha,points:[p]};if(this.tool==='fill'){this.commit();return;}
    if(this.freehand()){this.view.set(this.base);this.mask.fill(0);this.extend(null,p);show(this.canvas,this.view);return;}
    this.render();
  }
  move(e){
    if(this.locked){if(this.current){this.current=null;this.render();}return;}
    if(!this.points.has(e.pointerId))return;e.preventDefault();this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.points.size>1&&this.gesture){const[a,b]=[...this.points.values()],g=this.gesture;this.zoom=Math.max(1,Math.min(8,g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/g.distance));this.pan={x:g.pan.x+(a.x+b.x)/2-g.cx,y:g.pan.y+(a.y+b.y)/2-g.cy};this.transform();return;}
    if(e.pointerId!==this.primary)return;
    if(this.tool==='pan'){this.pan.x+=e.clientX-this.lastScreen.x;this.pan.y+=e.clientY-this.lastScreen.y;this.lastScreen={x:e.clientX,y:e.clientY};this.transform();return;}
    if(!this.current)return;
    if(['line','rect','ellipse'].includes(this.current.tool)){this.current.points=[this.current.points[0],this.point(e)];}
    else{let moved=false;for(const ev of e.getCoalescedEvents?.()||[e]){const p=this.point(ev),last=this.current.points.at(-1);if(Math.floor(last[0])===Math.floor(p[0])&&Math.floor(last[1])===Math.floor(p[1]))continue;this.current.points.push(p);this.extend(last,p);moved=true;}if(moved)show(this.canvas,this.view);return;}
    this.render();
  }
  freehand(){return this.current&&(this.current.tool==='pen'||this.current.tool==='eraser');}
  extend(a,b){const c=this.current;strokeSegment(this.view,this.mask,a,b,c.size,c.color,c.alpha,c.tool==='eraser');}
  up(e){if(!this.points.has(e.pointerId))return;this.points.delete(e.pointerId);if(this.current&&e.pointerId===this.primary)this.commit();if(this.points.size<2)this.gesture=null;if(!this.points.size)this.primary=null;}
  commit(){if(!this.current)return;if(this.ops.length>=1800){this.current=null;this.render();return;}const op=this.current;this.current=null;this.ops.push(op);this.redoOps=[];this.revision++;drawOp(this.base,op);this.render();this.change(this.snapshot());}
  // The preview redraws the in-progress op over a copy of the committed pixels.
  render(){if(this.current){this.view.set(this.base);drawOp(this.view,this.current);show(this.canvas,this.view);}else show(this.canvas,this.base);}
  rebuild(){this.base=renderPixels(this.ops);this.render();}
  undo(){if(this.locked||!this.ops.length)return;this.redoOps.push(this.ops.pop());this.revision++;this.rebuild();this.change(this.snapshot());}
  redo(){if(this.locked||!this.redoOps.length)return;const op=this.redoOps.pop();this.ops.push(op);this.revision++;drawOp(this.base,op);this.render();this.change(this.snapshot());}
  clear(){if(this.locked)return;this.ops=[];this.redoOps=[];this.revision++;this.rebuild();this.change(this.snapshot());}
  setZoom(n){this.zoom=Math.max(1,Math.min(8,n));if(this.zoom===1)this.pan={x:0,y:0};this.transform();}
  transform(){const parent=this.canvas.parentElement;this.pan.x=Math.max(-parent.clientWidth*(this.zoom-1),Math.min(0,this.pan.x));this.pan.y=Math.max(-parent.clientHeight*(this.zoom-1),Math.min(0,this.pan.y));this.canvas.style.transform=`translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;const output=document.querySelector('#zoom-value');if(output)output.textContent=Math.round(this.zoom*100)+'%';}
}

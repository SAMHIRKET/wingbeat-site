// Hard-edged pixel drawing: Aseprite-style behaviour, written as our own code.
// The drawing is an 800x600 pixel grid kept in memory. Every tool writes whole
// pixels: no antialiasing, and the bucket fill matches colours exactly, so it
// leaves no halo. The canvas is never read back (getImageData).
// Saved format: {ops:[{tool,color,size,alpha,points:[[x,y,p]], ...extras}],revision}
//   extras (optional): tip 'round'|'square', pp (pixel-perfect, default on for 1px),
//   filled (rect/ellipse), offset [dx,dy] and erase (tool 'move': points = selection polygon).
export const W = 800, H = 600;
const WHITE = 0xffffffff;

export function rgb(hex){const n=parseInt(String(hex).slice(1,7),16)||0;return [(n>>16)&255,(n>>8)&255,n&255];}
const pack=(r,g,b)=>(255<<24|b<<16|g<<8|r)>>>0;
function blend(dst,[r,g,b],a){if(a>=1)return pack(r,g,b);const dr=dst&255,dg=(dst>>8)&255,db=(dst>>16)&255;return pack(Math.round(r*a+dr*(1-a)),Math.round(g*a+dg*(1-a)),Math.round(b*a+db*(1-a)));}
export function hexAt(px,x,y){x=Math.max(0,Math.min(W-1,Math.floor(x)));y=Math.max(0,Math.min(H-1,Math.floor(y)));const v=px[y*W+x];return '#'+[v&255,(v>>8)&255,(v>>16)&255].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function blank(){const px=new Uint32Array(W*H);px.fill(WHITE);return px;}

/* ---------- geometry ---------- */
const stamps=new Map();
function stamp(d,tip='round'){d=Math.max(1,Math.min(80,Math.round(d)));const key=tip+d;let s=stamps.get(key);if(s)return s;s=[];const c=(d-1)/2,o=Math.floor(c),r2=(d/2)*(d/2)+(d>2?.25:0);
  for(let j=0;j<d;j++)for(let i=0;i<d;i++)if(tip==='square'||(i-c)**2+(j-c)**2<=r2)s.push([i-o,j-o]);stamps.set(key,s);return s;}
function line(x0,y0,x1,y1,out){let dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,e=dx+dy;for(;;){out.push(x0,y0);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx;}if(e2<=dx){e+=dx;y0+=sy;}}return out;}
function ellipse(x0,y0,x1,y1,out){
  if(x0>x1)[x0,x1]=[x1,x0];if(y0>y1)[y0,y1]=[y1,y0];
  let a=x1-x0,b=y1-y0;if(a===0||b===0)return line(x0,y0,x1,y1,out);
  let b1=b&1,dx=4*(1-a)*b*b,dy=4*(b1+1)*a*a,err=dx+dy+b1*a*a,e2;
  y0+=(b+1)>>1;y1=y0-b1;a*=8*a;b1=8*b*b;
  do{out.push(x1,y0,x0,y0,x0,y1,x1,y1);e2=2*err;if(e2<=dy){y0++;y1--;err+=dy+=a;}if(e2>=dx||2*err>dy){x0++;x1--;err+=dx+=b1;}}while(x0<=x1);
  while(y0-y1<=b){out.push(x0-1,y0,x1+1,y0++,x0-1,y1,x1+1,y1--);}
  return out;
}
function pixelPerfect(pts){const out=[];for(const p of pts){const n=out.length;if(n&&out[n-1][0]===p[0]&&out[n-1][1]===p[1])continue;
  if(n>=2){const a=out[n-2],b=out[n-1];if((a[0]===b[0]||a[1]===b[1])&&(p[0]===b[0]||p[1]===b[1])&&a[0]!==p[0]&&a[1]!==p[1])out.pop();}out.push(p);}return out;}
// Rows of a filled outline: for each y, fill between the outermost pixels.
function spans(outline){const rows=new Map();for(let i=0;i<outline.length;i+=2){const x=outline[i],y=outline[i+1],r=rows.get(y);if(!r)rows.set(y,[x,x]);else{if(x<r[0])r[0]=x;if(x>r[1])r[1]=x;}}const out=[];rows.forEach(([a,b],y)=>{for(let x=a;x<=b;x++)out.push(x,y);});return out;}
// Pixel mask of a polygon (even-odd, sampled at pixel centres). Returns {mask,x0,y0,x1,y1}.
export function polygonMask(poly){
  const mask=new Uint8Array(W*H);if(!poly||poly.length<3)return {mask,x0:0,y0:0,x1:-1,y1:-1};
  let x0=W,y0=H,x1=0,y1=0;for(const [x,y] of poly){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(W-1,Math.ceil(x1));y1=Math.min(H-1,Math.ceil(y1));
  for(let y=y0;y<=y1;y++){const cy=y+.5,xs=[];for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [ax,ay]=poly[i],[bx,by]=poly[j];if((ay>cy)!==(by>cy))xs.push(ax+(cy-ay)/(by-ay)*(bx-ax));}
    xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2){for(let x=Math.max(x0,Math.ceil(xs[k]-.5));x<=Math.min(x1,Math.floor(xs[k+1]-.5));x++)mask[y*W+x]=1;}}
  return {mask,x0,y0,x1,y1};
}

/* ---------- ops ---------- */
function trace(op){
  const P=op.points.map(([x,y,p])=>[Math.floor(x),Math.floor(y),p??1]),size=Math.max(1,Math.round(op.size||1)),c=[];
  const [x0,y0]=P[0],[x1,y1]=P.at(-1),fixed=()=>size;
  if(op.tool==='line'){line(x0,y0,x1,y1,c);return {centres:c,size:fixed};}
  if(op.tool==='rect'){if(op.filled){const ax=Math.min(x0,x1),bx=Math.max(x0,x1),ay=Math.min(y0,y1),by=Math.max(y0,y1);for(let y=ay;y<=by;y++)for(let x=ax;x<=bx;x++)c.push(x,y);return {centres:c,size:()=>1};}
    line(x0,y0,x1,y0,c);line(x1,y0,x1,y1,c);line(x1,y1,x0,y1,c);line(x0,y1,x0,y0,c);return {centres:c,size:fixed};}
  if(op.tool==='ellipse'){ellipse(x0,y0,x1,y1,c);if(op.filled)return {centres:spans(c),size:()=>1};return {centres:c,size:fixed};}
  const per=[];let path=[];
  for(let i=0;i<P.length;i++){const s=Math.max(1,Math.round(size*Math.max(.25,P[i][2])));
    if(i===0){path.push([P[0][0],P[0][1],s]);continue;}const seg=line(P[i-1][0],P[i-1][1],P[i][0],P[i][1],[]);for(let k=2;k<seg.length;k+=2)path.push([seg[k],seg[k+1],s]);}
  if(size===1&&op.pp!==false)path=pixelPerfect(path);
  for(const [x,y,s] of path){c.push(x,y);per.push(s);}
  return {centres:c,size:i=>per[i]};
}
const MASK=new Uint8Array(W*H);
export function drawOp(px,op){
  if(!op?.points?.length)return;
  if(op.tool==='move'){moveOp(px,op);return;}
  const color=op.tool==='eraser'?[255,255,255]:rgb(op.color),alpha=op.tool==='eraser'?1:Math.max(0,Math.min(1,op.alpha??1));
  if(op.tool==='fill'){fill(px,op.points[0][0],op.points[0][1],color,alpha);return;}
  const {centres,size}=trace(op),touched=[],tip=op.tip==='square'?'square':'round';
  for(let i=0;i<centres.length;i+=2){const s=stamp(size(i/2),tip),cx=centres[i],cy=centres[i+1];
    for(const [ox,oy] of s){const x=cx+ox,y=cy+oy;if(x<0||y<0||x>=W||y>=H)continue;const k=y*W+x;if(MASK[k])continue;MASK[k]=1;touched.push(k);px[k]=blend(px[k],color,alpha);}}
  for(const k of touched)MASK[k]=0;
}
// Move (or clear) the pixels inside a selection polygon. The hole left behind is white.
function moveOp(px,op){
  const {mask,x0,y0,x1,y1}=polygonMask(op.points),dx=Math.round(op.offset?.[0]||0),dy=Math.round(op.offset?.[1]||0),lift=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const k=y*W+x;if(mask[k]){lift.push(x,y,px[k]);px[k]=WHITE;}}
  if(op.erase)return;
  for(let i=0;i<lift.length;i+=3){const x=lift[i]+dx,y=lift[i+1]+dy;if(x>=0&&y>=0&&x<W&&y<H)px[y*W+x]=lift[i+2];}
}
export function fill(px,x,y,color,alpha=1){
  x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=W||y>=H)return;
  const target=px[y*W+x],next=blend(target,color,alpha);if(next===target)return;
  const stack=[x,y];
  while(stack.length){const cy=stack.pop(),cx=stack.pop(),k=cy*W+cx;if(px[k]!==target)continue;
    let l=cx;while(l>0&&px[cy*W+l-1]===target)l--;let r=cx;while(r<W-1&&px[cy*W+r+1]===target)r++;
    let up=false,down=false;
    for(let i=l;i<=r;i++){const j=cy*W+i;px[j]=next;
      if(cy>0){const u=px[j-W]===target;if(u&&!up)stack.push(i,cy-1);up=u;}
      if(cy<H-1){const d=px[j+W]===target;if(d&&!down)stack.push(i,cy+1);down=d;}}
  }
}
export function strokeSegment(px,mask,a,b,c){
  const color=c.tool==='eraser'?[255,255,255]:rgb(c.color),al=c.tool==='eraser'?1:c.alpha,st=stamp(Math.max(1,Math.round(c.size*Math.max(.25,b[2]??1))),c.tip==='square'?'square':'round');
  const seg=a?line(Math.floor(a[0]),Math.floor(a[1]),Math.floor(b[0]),Math.floor(b[1]),[]):[Math.floor(b[0]),Math.floor(b[1])];
  for(let i=a?2:0;i<seg.length;i+=2)for(const [ox,oy] of st){const x=seg[i]+ox,y=seg[i+1]+oy;if(x<0||y<0||x>=W||y>=H)continue;const k=y*W+x;if(mask[k])continue;mask[k]=1;px[k]=blend(px[k],color,al);}
}
export function renderPixels(ops=[],px=blank()){for(const op of ops)drawOp(px,op);return px;}

/* ---------- display ---------- */
const scratch=typeof document!=='undefined'?document.createElement('canvas'):null;
export function show(canvas,px){
  const ctx=canvas.getContext('2d'),img=new ImageData(new Uint8ClampedArray(px.buffer,px.byteOffset,px.byteLength),W,H);
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

/* ---------- the board ---------- */
const PAINT=['pen','eraser','line','rect','ellipse'];
export class Sketch {
  constructor(canvas,onChange,onColor){
    this.canvas=canvas;this.change=onChange;this.onColor=onColor;this.ops=[];this.redoOps=[];this.revision=0;
    this.tool='pen';this.color='#29235c';this.size=7;this.alpha=1;this.pressure=true;this.tip='round';this.pp=true;this.filled=false;
    this.locked=false;this.zoom=1;this.pan={x:0,y:0};this.points=new Map();this.abort=new AbortController();this.spaceHeld=false;
    this.base=blank();this.view=new Uint32Array(this.base);this.mask=new Uint8Array(W*H);this.sel=null;this.selOffset=null;
    const o={signal:this.abort.signal};
    for(const [t,f] of [['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','up'],['lostpointercapture','up']])canvas.addEventListener(t,e=>this[f](e),o);
    canvas.addEventListener('contextmenu',e=>e.preventDefault(),o);
    canvas.parentElement.addEventListener('wheel',e=>this.wheel(e),{...o,passive:false});
    canvas.style.imageRendering='pixelated';show(canvas,this.base);
  }
  load(d){this.ops=d.ops||[];this.revision=d.revision||0;this.redoOps=[];this.rebuild();}
  snapshot(){return {ops:this.ops,revision:this.revision};}
  dispose(){this.abort.abort();}
  point(e){const r=this.canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(799.99,(e.clientX-r.left)/r.width*800))*10)/10,Math.round(Math.max(0,Math.min(599.99,(e.clientY-r.top)/r.height*600))*10)/10,e.pointerType==='pen'&&this.pressure?Math.max(.15,e.pressure||.5):1];}
  activeTool(){return this.spaceHeld?'pan':this.tool;}
  down(e){
    if(this.locked||(e.button!==0&&e.button!==1))return;e.preventDefault();this.canvas.setPointerCapture(e.pointerId);this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.points.size>1){this.current=null;this.drag=null;this.render();const[a,b]=[...this.points.values()];this.gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,pan:{...this.pan}};return;}
    this.primary=e.pointerId;this.lastScreen={x:e.clientX,y:e.clientY};const p=this.point(e),tool=e.button===1?'pan':this.activeTool();
    this.dragTool=tool;
    if(tool==='pan')return;
    if(tool==='picker'){this.color=hexAt(this.base,p[0],p[1]);this.onColor?.(this.color);return;}
    if(tool==='marquee'||tool==='lasso'){this.drag={tool,start:p,poly:[[p[0],p[1]]]};this.sel=null;this.render();return;}
    if(tool==='move'){if(!this.sel)return;this.drag={tool,start:p};this.selOffset=[0,0];return;}
    const op={tool,color:this.color,size:Math.max(1,Math.round(this.size)),alpha:tool==='eraser'?1:this.alpha,points:[p]};
    if(PAINT.includes(tool))op.tip=this.tip;
    if(tool==='pen'&&op.size===1)op.pp=this.pp;
    if(tool==='rect'||tool==='ellipse')op.filled=this.filled;
    this.current=op;if(tool==='fill'){this.commit();return;}
    if(this.freehand()){this.view.set(this.base);this.mask.fill(0);strokeSegment(this.view,this.mask,null,p,op);this.paint(this.view);return;}
    this.render();
  }
  move(e){
    if(this.locked){if(this.current||this.drag){this.current=null;this.drag=null;this.render();}return;}
    if(!this.points.has(e.pointerId))return;e.preventDefault();this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.points.size>1&&this.gesture){const[a,b]=[...this.points.values()],g=this.gesture;this.zoom=Math.max(1,Math.min(8,g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/g.distance));this.pan={x:g.pan.x+(a.x+b.x)/2-g.cx,y:g.pan.y+(a.y+b.y)/2-g.cy};this.transform();return;}
    if(e.pointerId!==this.primary)return;
    if(this.dragTool==='pan'){this.pan.x+=e.clientX-this.lastScreen.x;this.pan.y+=e.clientY-this.lastScreen.y;this.lastScreen={x:e.clientX,y:e.clientY};this.transform();return;}
    const p=this.point(e);
    if(this.drag){const d=this.drag;
      if(d.tool==='marquee')d.poly=[[d.start[0],d.start[1]],[p[0],d.start[1]],[p[0],p[1]],[d.start[0],p[1]]];
      else if(d.tool==='lasso'){const l=d.poly.at(-1);if(Math.hypot(l[0]-p[0],l[1]-p[1])>=2)d.poly.push([p[0],p[1]]);}
      else if(d.tool==='move')this.selOffset=[Math.round(p[0]-d.start[0]),Math.round(p[1]-d.start[1])];
      this.render();return;}
    if(!this.current)return;
    if(['line','rect','ellipse'].includes(this.current.tool)){this.current.points=[this.current.points[0],p];this.render();return;}
    let moved=false;for(const ev of e.getCoalescedEvents?.()||[e]){const q=this.point(ev),last=this.current.points.at(-1);if(Math.floor(last[0])===Math.floor(q[0])&&Math.floor(last[1])===Math.floor(q[1]))continue;this.current.points.push(q);strokeSegment(this.view,this.mask,last,q,this.current);moved=true;}
    if(moved)this.paint(this.view);
  }
  up(e){
    if(!this.points.has(e.pointerId))return;this.points.delete(e.pointerId);
    if(e.pointerId===this.primary){
      if(this.current)this.commit();
      else if(this.drag){const d=this.drag;this.drag=null;
        if(d.tool==='move'){const [dx,dy]=this.selOffset||[0,0];this.selOffset=null;if(dx||dy){this.current={tool:'move',color:'#000000',size:1,alpha:1,points:this.sel.map(([x,y])=>[x,y,1]),offset:[dx,dy]};this.sel=this.sel.map(([x,y])=>[clampX(x+dx),clampY(y+dy)]);this.commit();}else this.render();}
        else{const area=polyArea(d.poly);this.sel=d.poly.length>=3&&area>=1?d.poly.map(([x,y])=>[clampX(x),clampY(y)]):null;this.render();}}
    }
    if(this.points.size<2)this.gesture=null;if(!this.points.size)this.primary=null;
  }
  freehand(){return this.current&&(this.current.tool==='pen'||this.current.tool==='eraser');}
  commit(){if(!this.current)return;if(this.ops.length>=1800){this.current=null;this.render();return;}const op=this.current;this.current=null;this.ops.push(op);this.redoOps=[];this.revision++;drawOp(this.base,op);this.render();this.change(this.snapshot());}
  render(){
    let px=this.base;
    if(this.current){this.view.set(this.base);drawOp(this.view,this.current);px=this.view;}
    else if(this.selOffset&&this.sel){this.view.set(this.base);moveOp(this.view,{points:this.sel,offset:this.selOffset});px=this.view;}
    this.paint(px);
  }
  // Pixels first, then the selection outline as a display-only overlay.
  paint(px){show(this.canvas,px);const poly=this.drag&&this.drag.tool!=='move'?this.drag.poly:this.sel;if(!poly||poly.length<2)return;
    const off=this.selOffset||[0,0],ctx=this.canvas.getContext('2d');ctx.save();ctx.beginPath();poly.forEach(([x,y],i)=>{x=Math.floor(x+off[0])+.5;y=Math.floor(y+off[1])+.5;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});if(!this.drag||this.drag.tool!=='lasso')ctx.closePath();
    ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.strokeStyle='#050505';ctx.stroke();ctx.lineDashOffset=4.5;ctx.strokeStyle='#ff27ba';ctx.stroke();ctx.restore();}
  rebuild(){this.base=renderPixels(this.ops);this.render();}
  undo(){if(this.locked||!this.ops.length)return;this.redoOps.push(this.ops.pop());this.revision++;this.sel=null;this.rebuild();this.change(this.snapshot());}
  redo(){if(this.locked||!this.redoOps.length)return;const op=this.redoOps.pop();this.ops.push(op);this.revision++;this.sel=null;drawOp(this.base,op);this.render();this.change(this.snapshot());}
  clear(){if(this.locked)return;this.ops=[];this.redoOps=[];this.revision++;this.sel=null;this.rebuild();this.change(this.snapshot());}
  deselect(){this.sel=null;this.drag=null;this.selOffset=null;this.render();}
  eraseSelection(){if(this.locked||!this.sel)return;this.current={tool:'move',color:'#000000',size:1,alpha:1,points:this.sel.map(([x,y])=>[x,y,1]),offset:[0,0],erase:true};this.commit();}
  nudge(dx,dy){if(this.locked||!this.sel)return;this.current={tool:'move',color:'#000000',size:1,alpha:1,points:this.sel.map(([x,y])=>[x,y,1]),offset:[dx,dy]};this.sel=this.sel.map(([x,y])=>[clampX(x+dx),clampY(y+dy)]);this.commit();}
  // Zoom keeps the pixel under the cursor (or the board centre) in place.
  setZoom(n,cx,cy){const parent=this.canvas.parentElement,r=parent.getBoundingClientRect(),z0=this.zoom,z1=Math.max(1,Math.min(8,n));
    const px=cx==null?r.width/2:cx-r.left,py=cy==null?r.height/2:cy-r.top;
    this.pan={x:px-(px-this.pan.x)*z1/z0,y:py-(py-this.pan.y)*z1/z0};this.zoom=z1;if(z1===1)this.pan={x:0,y:0};this.transform();}
  wheel(e){e.preventDefault();this.setZoom(this.zoom*(e.deltaY<0?1.25:.8),e.clientX,e.clientY);}
  transform(){const parent=this.canvas.parentElement;this.pan.x=Math.max(-parent.clientWidth*(this.zoom-1),Math.min(0,this.pan.x));this.pan.y=Math.max(-parent.clientHeight*(this.zoom-1),Math.min(0,this.pan.y));this.canvas.style.transform=`translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;const output=document.querySelector('#zoom-value');if(output)output.textContent=Math.round(this.zoom*100)+'%';}
}
const clampX=x=>Math.max(0,Math.min(800,x)),clampY=y=>Math.max(0,Math.min(600,y));
function polyArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]+p[i][0])*(p[j][1]-p[i][1]);return Math.abs(a/2);}

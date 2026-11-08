export function fill(ctx,x,y,color,alpha=1){
  const im=ctx.getImageData(0,0,800,600),d=im.data,at=(Math.floor(y)*800+Math.floor(x))*4,target=Array.from(d.slice(at,at+4)),rgb=color.match(/\w\w/g).map(h=>parseInt(h,16)),replacement=[...rgb.map((c,i)=>Math.round(c*alpha+target[i]*(1-alpha))),255];
  if(replacement.every((c,i)=>Math.abs(c-target[i])<2))return;
  const seen=new Uint8Array(800*600),stack=[Math.floor(y)*800+Math.floor(x)];
  while(stack.length){const p=stack.pop();if(p<0||p>=480000||seen[p])continue;seen[p]=1;const j=p*4;if(!target.every((c,i)=>Math.abs(d[j+i]-c)<24))continue;for(let i=0;i<4;i++)d[j+i]=replacement[i];if(p%800>0)stack.push(p-1);if(p%800<799)stack.push(p+1);if(p>=800)stack.push(p-800);if(p<479200)stack.push(p+800);}
  ctx.putImageData(im,0,0);
}
export function drawOp(ctx,op){
  const pts=op.points;if(!pts?.length)return;ctx.save();ctx.globalAlpha=op.alpha;ctx.strokeStyle=ctx.fillStyle=op.tool==='eraser'?'#ffffff':op.color;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=op.size;
  const [x,y]=pts[0],[ex,ey]=pts.at(-1);
  if(op.tool==='fill'){ctx.restore();fill(ctx,x,y,op.color,op.alpha);return;}
  if(op.tool==='rect')ctx.strokeRect(x,y,ex-x,ey-y);
  else if(op.tool==='ellipse'){ctx.beginPath();ctx.ellipse((x+ex)/2,(y+ey)/2,Math.max(.1,Math.abs(ex-x)/2),Math.max(.1,Math.abs(ey-y)/2),0,0,Math.PI*2);ctx.stroke();}
  else if(op.tool==='line'){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();}
  else if(pts.length===1){ctx.beginPath();ctx.arc(x,y,op.size*Math.max(.25,pts[0][2])/2,0,Math.PI*2);ctx.fill();}
  else{for(let i=1;i<pts.length;i++){ctx.lineWidth=op.size*Math.max(.25,(pts[i][2]+pts[i-1][2])/2);ctx.beginPath();ctx.moveTo(pts[i-1][0],pts[i-1][1]);ctx.lineTo(pts[i][0],pts[i][1]);ctx.stroke();}}
  ctx.restore();
}
export function renderDrawing(canvas,ops=[]){const ctx=canvas.getContext('2d');ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(canvas.width/800,canvas.height/600);for(const op of ops)drawOp(ctx,op);ctx.restore();}
export async function replayDrawing(canvas,ops,duration=3500,signal){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){renderDrawing(canvas,ops);return;}
  renderDrawing(canvas,[]);const start=performance.now();let index=0;
  await new Promise(resolve=>{function step(now){if(signal?.aborted||!canvas.isConnected){resolve();return;}const target=Math.min(ops.length,Math.floor((now-start)/duration*ops.length));const ctx=canvas.getContext('2d');ctx.save();ctx.scale(canvas.width/800,canvas.height/600);while(index<target)drawOp(ctx,ops[index++]);ctx.restore();if(index<ops.length)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});
}
export class Sketch {
  constructor(canvas,onChange,onColor){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});this.change=onChange;this.onColor=onColor;this.ops=[];this.redoOps=[];this.revision=0;this.tool='pen';this.color='#29235c';this.size=7;this.alpha=1;this.pressure=true;this.locked=false;this.zoom=1;this.pan={x:0,y:0};this.points=new Map();this.abort=new AbortController();
    const options={signal:this.abort.signal};canvas.addEventListener('pointerdown',e=>this.down(e),options);canvas.addEventListener('pointermove',e=>this.move(e),options);canvas.addEventListener('pointerup',e=>this.up(e),options);canvas.addEventListener('pointercancel',e=>this.up(e),options);canvas.addEventListener('lostpointercapture',e=>this.up(e),options);canvas.addEventListener('contextmenu',e=>e.preventDefault(),options);renderDrawing(canvas,[]);
  }
  load(d){this.ops=d.ops||[];this.revision=d.revision||0;this.redoOps=[];this.render();}
  snapshot(){return {ops:this.ops,revision:this.revision};}
  dispose(){this.abort.abort();}
  point(e){const r=this.canvas.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(799.99,(e.clientX-r.left)/r.width*800))*10)/10,Math.round(Math.max(0,Math.min(599.99,(e.clientY-r.top)/r.height*600))*10)/10,e.pointerType==='pen'&&this.pressure?Math.max(.15,e.pressure||.5):1];}
  down(e){
    if(this.locked||e.button!==0)return;e.preventDefault();this.canvas.setPointerCapture(e.pointerId);this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.points.size>1){this.current=null;this.render();const[a,b]=[...this.points.values()];this.gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,pan:{...this.pan}};return;}
    this.primary=e.pointerId;this.lastScreen={x:e.clientX,y:e.clientY};const p=this.point(e);
    if(this.tool==='pan')return;
    if(this.tool==='picker'){const rgba=this.ctx.getImageData(Math.floor(p[0]),Math.floor(p[1]),1,1).data;this.color='#'+[...rgba].slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');this.onColor?.(this.color);return;}
    this.current={tool:this.tool,color:this.color,size:this.size,alpha:this.tool==='eraser'?1:this.alpha,points:[p]};if(this.tool==='fill'){this.commit();return;}this.render();
  }
  move(e){
    if(this.locked){this.current=null;return;}
    if(!this.points.has(e.pointerId))return;e.preventDefault();this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.points.size>1&&this.gesture){const[a,b]=[...this.points.values()],g=this.gesture;this.zoom=Math.max(1,Math.min(4,g.zoom*Math.hypot(a.x-b.x,a.y-b.y)/g.distance));this.pan={x:g.pan.x+(a.x+b.x)/2-g.cx,y:g.pan.y+(a.y+b.y)/2-g.cy};this.transform();return;}
    if(e.pointerId!==this.primary)return;
    if(this.tool==='pan'){this.pan.x+=e.clientX-this.lastScreen.x;this.pan.y+=e.clientY-this.lastScreen.y;this.lastScreen={x:e.clientX,y:e.clientY};this.transform();return;}
    if(!this.current)return;
    if(['line','rect','ellipse'].includes(this.current.tool)){this.current.points=[this.current.points[0],this.point(e)];this.render();}
    else{for(const event of e.getCoalescedEvents?.()||[e]){const p=this.point(event),last=this.current.points.at(-1);if(Math.hypot(last[0]-p[0],last[1]-p[1])<1.5)continue;this.current.points.push(p);drawOp(this.ctx,{...this.current,points:[last,p]});}}
  }
  up(e){if(!this.points.has(e.pointerId))return;this.points.delete(e.pointerId);if(this.current&&e.pointerId===this.primary)this.commit();if(this.points.size<2)this.gesture=null;if(!this.points.size)this.primary=null;}
  commit(){if(!this.current)return;if(this.ops.length>=1800){this.current=null;this.render();return;}this.ops.push(this.current);this.current=null;this.redoOps=[];this.revision++;this.render();this.change(this.snapshot());}
  render(){renderDrawing(this.canvas,this.ops);if(this.current)drawOp(this.ctx,this.current);}
  undo(){if(this.locked||!this.ops.length)return;this.redoOps.push(this.ops.pop());this.revision++;this.render();this.change(this.snapshot());}
  redo(){if(this.locked||!this.redoOps.length)return;this.ops.push(this.redoOps.pop());this.revision++;this.render();this.change(this.snapshot());}
  clear(){if(this.locked)return;this.ops=[];this.redoOps=[];this.revision++;this.render();this.change(this.snapshot());}
  setZoom(n){this.zoom=Math.max(1,Math.min(4,n));if(this.zoom===1)this.pan={x:0,y:0};this.transform();}
  transform(){const parent=this.canvas.parentElement;this.pan.x=Math.max(-parent.clientWidth*(this.zoom-1),Math.min(0,this.pan.x));this.pan.y=Math.max(-parent.clientHeight*(this.zoom-1),Math.min(0,this.pan.y));this.canvas.style.transform=`translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;const output=document.querySelector('#zoom-value');if(output)output.textContent=Math.round(this.zoom*100)+'%';}
}

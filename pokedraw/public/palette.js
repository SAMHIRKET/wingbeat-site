// Palette helpers: a shading ramp for the picked colour, and an HSV wheel.
// Ramp: lights lean warm (toward yellow), darks lean cool (toward blue), the
// way pixel artists hue-shift shading. Our own maths, nothing copied.
export function hexToHsv(hex){const n=parseInt(hex.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0;if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;if(h<0)h+=360;}return [h,mx?d/mx:0,mx];}
export function hsvToHex(h,s,v){h=((h%360)+360)%360;s=Math.max(0,Math.min(1,s));v=Math.max(0,Math.min(1,v));const f=k=>{const x=(k+h/60)%6;return v-v*s*Math.max(0,Math.min(x,4-x,1));};
  return '#'+[f(5),f(3),f(1)].map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('');}
// Shortest turn of hue a toward b, by at most amount degrees.
function lean(a,b,amount){let d=((b-a+540)%360)-180;return a+Math.sign(d)*Math.min(Math.abs(d),amount);}
export function ramp(hex,steps=9){
  const [h,s,v]=hexToHsv(hex),mid=(steps-1)/2,out=[];
  for(let i=0;i<steps;i++){const t=(i-mid)/mid; // -1 darkest .. 1 lightest
    if(Math.abs(t)<1e-6){out.push(hex.toLowerCase());continue;}
    const grey=s<.08;
    const hue=grey?h:t<0?lean(h,235,-t*28):lean(h,55,t*24);
    const sat=grey?s:t<0?s+(1-s)*-t*.25:s*(1-t*.55);
    const val=t<0?v*(1+t*.78):v+(1-v)*t*.85;
    out.push(hsvToHex(hue,sat,t>0?Math.max(val,Math.min(1,v+t*.35)):val));}
  return out;
}
// Hue around the ring, saturation out from the centre, value from the slider.
export function paintWheel(canvas,value){
  const n=canvas.width,ctx=canvas.getContext('2d'),img=ctx.createImageData(n,n),c=n/2,R=c-1;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const dx=x+.5-c,dy=y+.5-c,r=Math.hypot(dx,dy),k=(y*n+x)*4;if(r>R)continue;
    const hex=hsvToHex(Math.atan2(dy,dx)*180/Math.PI+90,r/R,value),m=parseInt(hex.slice(1),16);img.data[k]=m>>16&255;img.data[k+1]=m>>8&255;img.data[k+2]=m&255;img.data[k+3]=255;}
  ctx.putImageData(img,0,0);
}
export function wheelAt(canvas,e,value){const r=canvas.getBoundingClientRect(),dx=(e.clientX-r.left)/r.width-.5,dy=(e.clientY-r.top)/r.height-.5;
  return hsvToHex(Math.atan2(dy,dx)*180/Math.PI+90,Math.min(1,Math.hypot(dx,dy)*2),value);}
export function markWheel(canvas,hex,value){paintWheel(canvas,value);const [h,s]=hexToHsv(hex),n=canvas.width,c=n/2,a=(h-90)*Math.PI/180,ctx=canvas.getContext('2d'),x=c+Math.cos(a)*s*(c-1),y=c+Math.sin(a)*s*(c-1);
  ctx.lineWidth=2;ctx.strokeStyle='#050505';ctx.beginPath();ctx.arc(x,y,5,0,7);ctx.stroke();ctx.strokeStyle='#fff';ctx.beginPath();ctx.arc(x,y,3,0,7);ctx.stroke();}

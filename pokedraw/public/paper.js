// Three shared, small paper frames. No noise generation in the animation loop.
const frames=[];
const noise=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};
function frame(seed){
  const c=document.createElement('canvas');c.width=400;c.height=300;
  const p=c.getContext('2d');p.fillStyle='#faf6e9';p.fillRect(0,0,400,300);
  p.fillStyle='#82765d';
  for(let y=0;y<300;y+=2)for(let x=0;x<400;x+=2){const n=noise(x,y);if(n>.65){p.globalAlpha=.018+n*.018;p.fillRect(x+(seed-1)*.25,y,1,1);}}
  p.globalAlpha=1;
  // Broad, faint folds; their centres stay fixed across all three boil frames.
  for(let y=2;y<300;y+=4)for(let x=2;x<400;x+=4){
    const foldA=92+x*.13+7*Math.sin(x/105),foldB=318-y*.24+5*Math.sin(y/67);
    const distance=Math.min(Math.abs(y-foldA),Math.abs(x-foldB));
    if(distance>18)continue;
    const weight=Math.pow(1-distance/18,2),jitter=(noise(x+seed*7,y)-.5)*.5;
    p.fillStyle='#9c8e70';p.globalAlpha=.055+.06*weight;
    p.beginPath();p.arc(x+jitter,y-jitter,.2+.9*weight,0,Math.PI*2);p.fill();
  }
  p.globalAlpha=.28;p.strokeStyle='#fffef7';p.lineWidth=1;
  p.beginPath();for(let x=0;x<=400;x+=4){const y=89+x*.13+7*Math.sin(x/105)+(seed-1)*.2;x?p.lineTo(x,y):p.moveTo(x,y);}p.stroke();
  p.globalAlpha=1;return c;
}
export function paintPaper(canvas,seed=0){
  seed=((seed%3)+3)%3;
  if(canvas._paperSeed===seed&&canvas.width===400&&canvas.height===300)return;
  const source=frames[seed]||(frames[seed]=frame(seed));
  if(canvas.width!==400||canvas.height!==300){canvas.width=400;canvas.height=300;}
  canvas.getContext('2d').drawImage(source,0,0);canvas._paperSeed=seed;
}

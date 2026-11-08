import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../engine.mjs';
import {renderPixels,hexAt,W} from '../public/drawing.js';
import {ramp} from '../public/palette.js';

const colours=px=>new Set(px);
test('square tip, filled shapes and fill stay hard-edged',()=>{
  const px=renderPixels([{tool:'pen',color:'#ff0000',size:6,alpha:1,tip:'square',points:[[100,100,1]]},{tool:'ellipse',color:'#0000ff',size:1,alpha:1,filled:true,points:[[200,200,1],[260,240,1]]},{tool:'rect',color:'#00ff00',size:1,alpha:1,filled:true,points:[[400,400,1],[409,409,1]]}]);
  assert.equal(colours(px).size,4);
  assert.equal(hexAt(px,98,98),'#ff0000');assert.equal(hexAt(px,103,103),'#ff0000');assert.equal(hexAt(px,97,97),'#ffffff');assert.equal(hexAt(px,103,98),'#ff0000');
  assert.equal(hexAt(px,230,220),'#0000ff');
  let n=0;for(const v of px)if(v===px[400*W+400])n++;assert.equal(n,100);
});
test('move lifts the selection, leaves white, and pastes at the offset',()=>{
  const sq=[[50,50,1],[60,50,1],[60,60,1],[50,60,1]];
  const px=renderPixels([{tool:'rect',color:'#123456',size:1,alpha:1,filled:true,points:[[50,50,1],[59,59,1]]},{tool:'move',color:'#000000',size:1,alpha:1,points:sq,offset:[100,0]}]);
  assert.equal(hexAt(px,55,55),'#ffffff');assert.equal(hexAt(px,155,55),'#123456');
  const er=renderPixels([{tool:'rect',color:'#123456',size:1,alpha:1,filled:true,points:[[50,50,1],[59,59,1]]},{tool:'move',color:'#000000',size:1,alpha:1,points:sq,offset:[0,0],erase:true}]);
  assert.equal(colours(er).size,1);
});
test('server accepts the new tool fields and rejects bad ones',()=>{
  const g=new Game();const ok={revision:1,ops:[{tool:'move',color:'#000000',size:1,alpha:1,points:[[1,1,1],[9,1,1],[9,9,1]],offset:[5,-5],erase:false},{tool:'rect',color:'#000000',size:2,alpha:1,tip:'square',filled:true,points:[[1,1,1],[5,5,1]]},{tool:'pen',color:'#000000',size:1,alpha:1,pp:false,points:[[1,1,1]]}]};
  assert.equal(g.validateDrawing(ok).ops.length,3);
  for(const bad of [{tip:'star'},{filled:'yes'},{tool:'move',offset:[9999,0]},{tool:'move'}])assert.throws(()=>g.validateDrawing({ops:[{tool:'pen',color:'#000000',size:1,alpha:1,points:[[1,1,1],[2,2,1],[3,1,1]],...bad}]}));
  g.close();
});
test('shading ramp runs dark to light through the picked colour',()=>{
  const r=ramp('#ff27ba');assert.equal(r.length,9);assert.equal(r[4],'#ff27ba');
  const lum=h=>{const n=parseInt(h.slice(1),16);return (n>>16&255)*.3+(n>>8&255)*.59+(n&255)*.11;};
  for(let i=1;i<9;i++)assert.ok(lum(r[i])>lum(r[i-1]),r.join());
});

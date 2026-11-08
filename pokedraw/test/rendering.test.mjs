import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {FONT_METRICS} from '../public/font-metrics.js';
import {canvasBudget,animationActive,MAX_DECORATIVE_PIXELS,MAX_DECORATIVE_EDGE} from '../public/render-budget.js';

test('every boil frame maps all characters to the matching original atlas',()=>{
  assert.equal(Object.keys(FONT_METRICS.atlases).length,12);
  assert.equal(FONT_METRICS.glyphs,readFileSync('public/fonts/scratch_glyphs.txt','utf8').trimEnd());
  for(const [key,a] of Object.entries(FONT_METRICS.atlases)){
    assert.equal(a.sha256,createHash('sha256').update(readFileSync(`public/fonts/${key}.png`)).digest('hex'));
    assert.equal(a.cells.length,Array.from(FONT_METRICS.glyphs).length);
    let end=0;for(const [x,w] of a.cells){assert.ok(x>end&&w>0&&x+w<=a.width);end=x+w;}
  }
});
test('font discovery works with canvas pixel readback completely unavailable',async()=>{
  let reads=0;
  const source=readFileSync('public/kit.js','utf8').replace(/^import .*\n/gm,'').replaceAll('export ','');
  class Image {set src(path){const a=FONT_METRICS.atlases[path.split('/').at(-1).slice(0,-4)];this.width=a.width;this.height=a.height;queueMicrotask(()=>this.onload());}}
  const document={createElement:()=>({getContext:()=>({getImageData:()=>{reads++;throw Error('Pixel readback unavailable');}})})};
  const fonts=await vm.runInNewContext(source+'\nloadFonts();',{FONT_METRICS,Image,queueMicrotask,performance:{now:()=>0},matchMedia:()=>({matches:false}),ResizeObserver:class{},document,canvasBudget,animationActive});
  assert.equal(reads,0);
  for(const size of ['big','small'])for(const kind of ['ink','fill'])for(let seed=0;seed<3;seed++){
    const cells=fonts[size][kind][seed].cells,a=FONT_METRICS.atlases[`scratch_${size}_${kind}_${seed+1}`];
    for(const [i,ch] of Array.from(FONT_METRICS.glyphs).entries()){assert.equal(cells.get(ch).x,a.cells[i][0]);assert.equal(cells.get(ch).w,a.cells[i][1]);}
  }
});
test('4K screens, high-DPI phones and long galleries stay within canvas bounds',()=>{
  for(const [w,h,dpr] of [[3840,2160,2],[8192,4320,3],[390,844,4],[1240,20000,2],[320,600,1]]){
    const b=canvasBudget(w,h,dpr);assert.ok(b.width*b.height<=MAX_DECORATIVE_PIXELS);assert.ok(b.width<=MAX_DECORATIVE_EDGE&&b.height<=MAX_DECORATIVE_EDGE);
  }
});
test('decorative work stops when idle, hidden, unfocused or reduced-motion',()=>{
  assert.equal(animationActive(14999,0),true);assert.equal(animationActive(15000,0),false);
  for(const state of [{hidden:true},{focused:false},{reduced:true}])assert.equal(animationActive(1,0,state),false);
  assert.equal(animationActive(60001,60000),true);
});

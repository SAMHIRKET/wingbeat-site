import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/preview.js',import.meta.url),'utf8');
test('visual previews preserve the real room seat, tutorial and draft',()=>{
  for(const stage of ['home','drawing','gallery']){
    const saved=new Map([['pd-seat','real-seat'],['pd-tutorial','false'],['pd-draft:ABCDE:1','real-drawing']]);
    const original=[...saved];
    const context={URL,Response,location:new URL('https://example.test/?preview='+stage),window:{fetch(){}},localStorage:{setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},history:{replaceState(){}},addEventListener(){}};
    vm.runInNewContext(source,context);
    for(const [k,v] of original)assert.equal(saved.get(k),v);
    assert.equal(context.window.PD_PREVIEW_ACTIVE,true);
  }
});
test('unknown preview query leaves the real room service active',()=>{
  const fetch=()=>{};const context={URL,location:new URL('https://example.test/?preview=unknown'),window:{fetch}};
  vm.runInNewContext(source,context);
  assert.equal(context.window.fetch,fetch);
  assert.equal(context.window.PD_PREVIEW_ACTIVE,undefined);
});

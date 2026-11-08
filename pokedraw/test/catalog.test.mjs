import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pokemon} from '../pokemon.mjs';
import {HintCatalog} from '../hints.mjs';
test('bundled reference index covers every prompt and works when the API is offline',async()=>{const seed=JSON.parse(fs.readFileSync(new URL('../hints-cache.json',import.meta.url),'utf8')).cards;const hints=new HintCatalog(async()=>{throw new Error('offline');},()=>1000,seed);for(const name of pokemon){const cards=await hints.list(name);assert.ok(cards.length);assert.ok(cards.every(c=>c.name===name&&c.image.startsWith('https://assets.tcgdex.net/')));}});

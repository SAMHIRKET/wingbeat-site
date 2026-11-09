import fs from 'node:fs';
import {GENERATIONS} from '../pokemon.mjs';
import {matchesName} from '../hints.mjs';
const pokemon=GENERATIONS.flat();
const url='https://api.tcgdex.net/v2/en/cards';
const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw new Error(`Catalogue request failed (${response.status}); existing catalogue unchanged.`);
const data=await response.json(),cards={};
// Every species against every card: a few seconds, run by hand when refreshing.
const ok=data.filter(c=>/^https:\/\/assets\.tcgdex\.net\/[a-zA-Z0-9/_-]+$/.test(c.image||''));
for(const name of pokemon)for(const c of ok)if(matchesName(c.name,name))(cards[name]??=[]).push({id:c.id,name:c.name,image:c.image+'/high.webp',source:'TCGdex'});
const missing=pokemon.filter(n=>!cards[n]);if(missing.length>60)throw new Error('Catalogue looks incomplete; existing catalogue unchanged. Missing: '+missing.join(', '));if(missing.length)console.warn('No cards yet (live lookup at play time): '+missing.join(', '));
fs.writeFileSync(new URL('../hints-cache.json',import.meta.url),JSON.stringify({retrieved:new Date().toISOString().slice(0,10),source:'https://tcgdex.dev/rest/cards',cards}));
console.log(`Updated ${Object.values(cards).reduce((n,c)=>n+c.length,0)} cards for ${Object.keys(cards).length} Pokémon.`);

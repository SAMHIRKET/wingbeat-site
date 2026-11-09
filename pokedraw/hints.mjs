// Card metadata is cached, not player drawings. Artwork remains with TCGdex.
// A card counts for a Pokemon when its name holds the Pokemon's name as a whole word:
// "Nidoking", "Nidoking ex", "Dark Nidoking", "Brock's Nidoking"; never "Mewtwo" for "Mew".
const norm=s=>String(s||'').normalize('NFKC').replace(/[\u2019`]/g,"'").toLowerCase();
export function matchesName(cardName,name){const c=norm(cardName),n=norm(name),i=c.indexOf(n);if(i<0)return false;
  const word=/[\p{L}\p{N}]/u;for(let k=i;k>=0;k=c.indexOf(n,k+1)){const before=c[k-1],after=c[k+n.length];if((!before||!word.test(before))&&(!after||!word.test(after)))return true;}return false;}
export class HintCatalog {
  constructor(fetcher=fetch,now=()=>Date.now(),seed={}){this.fetcher=fetcher;this.now=now;this.cache=new Map(Object.entries(seed).map(([name,cards])=>[name,{cards,expires:now()+86400000}]));this.pending=new Map();}
  async list(name){
    const cached=this.cache.get(name);if(cached&&this.now()<cached.expires)return cached.cards;
    if(this.pending.has(name))return this.pending.get(name);
    const work=(async()=>{
      try{
        const url=new URL('https://api.tcgdex.net/v2/en/cards');url.searchParams.set('name',name);
        const res=await this.fetcher(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
        if(!res.ok)throw new Error('Card reference service unavailable.');
        const data=await res.json();if(!Array.isArray(data))throw new Error('Card reference service returned an invalid list.');
        const cards=data.filter(c=>matchesName(c.name,name)&&typeof c.image==='string'&&/^https:\/\/assets\.tcgdex\.net\/[a-zA-Z0-9/_-]+$/.test(c.image)).map(c=>({id:String(c.id),name:c.name,image:c.image+'/high.webp',source:'TCGdex'}));
        if(!cards.length)throw new Error('No card references found for this Pokémon.');
        this.cache.set(name,{expires:this.now()+86400000,cards});return cards;
      }catch(error){if(cached)return cached.cards;throw Object.assign(new Error('Card hints are unavailable right now. Your drawing round can continue.'),{status:503});}
      finally{this.pending.delete(name);}
    })();this.pending.set(name,work);return work;
  }
}

// Card metadata is cached, not player drawings. Artwork remains with TCGdex.
export class HintCatalog {
  constructor(fetcher=fetch,now=()=>Date.now(),seed={}){this.fetcher=fetcher;this.now=now;this.cache=new Map(Object.entries(seed).map(([name,cards])=>[name,{cards,expires:now()+86400000}]));this.pending=new Map();}
  async list(name){
    const cached=this.cache.get(name);if(cached&&this.now()<cached.expires)return cached.cards;
    if(this.pending.has(name))return this.pending.get(name);
    const work=(async()=>{
      try{
        const url=new URL('https://api.tcgdex.net/v2/en/cards');url.searchParams.set('name','eq:'+name);
        const res=await this.fetcher(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
        if(!res.ok)throw new Error('Card reference service unavailable.');
        const data=await res.json();if(!Array.isArray(data))throw new Error('Card reference service returned an invalid list.');
        const cards=data.filter(c=>c.name?.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase()&&typeof c.image==='string'&&/^https:\/\/assets\.tcgdex\.net\/[a-zA-Z0-9/_-]+$/.test(c.image)).map(c=>({id:String(c.id),name:c.name,image:c.image+'/high.webp',source:'TCGdex'}));
        if(!cards.length)throw new Error('No card references found for this Pokémon.');
        this.cache.set(name,{expires:this.now()+86400000,cards});return cards;
      }catch(error){if(cached)return cached.cards;throw Object.assign(new Error('Card hints are unavailable right now. Your drawing round can continue.'),{status:503});}
      finally{this.pending.delete(name);}
    })();this.pending.set(name,work);return work;
  }
}

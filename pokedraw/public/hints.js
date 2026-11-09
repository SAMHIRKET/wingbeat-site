export function chooseHint(cards,lastId,random=Math.random){const available=cards.filter(c=>c.id!==lastId);const pool=available.length?available:cards;return pool.length?pool[Math.min(pool.length-1,Math.floor(random()*pool.length))]:null;}

export class HoldHint {
  constructor(button,panel,load,lock,onError,copy={}){
    this.copy={hintLoading:'loading card',hintRelease:'let go to draw',hintNone:'no card',...copy};
    this.button=button;this.panel=panel;this.load=load;this.lock=lock;this.onError=onError;this.last=null;this.cards=null;this.held=false;this.generation=0;this.abort=new AbortController();
    const opt={signal:this.abort.signal};
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.press();},opt);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>this.release(),opt);
    button.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)this.press();}},opt);
    button.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();this.release();}},opt);
    button.addEventListener('contextmenu',e=>e.preventDefault(),opt);button.addEventListener('blur',()=>this.release(),opt);
    window.addEventListener('blur',()=>this.release(),opt);document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();},opt);
    // Fetch the catalogue once; every new hold samples a fresh card from it.
    this.loading=load().then(cards=>{this.cards=cards;return cards;}).catch(()=>null);
  }
  async press(){
    if(this.held||this.button.disabled)return;clearTimeout(this.unlockTimer);this.held=true;const gen=++this.generation;this.lock(true);this.panel.classList.add('shown');this.panel.setAttribute('aria-hidden','false');this.button.setAttribute('aria-pressed','true');this.button.dispatchEvent(new Event('pointerenter'));this.panel.replaceChildren();const status=document.createElement('p');status.textContent=this.copy.hintLoading;this.panel.append(status);
    try{let cards=this.cards||await this.loading;if(!cards){cards=await this.load();this.cards=cards;}if(!this.held||gen!==this.generation)return;const card=chooseHint(cards,this.last);if(!card)throw new Error('No reference cards available.');this.last=card.id;this.button.dataset.lastHint=card.id;this.button.dataset.imageState='loading';
      const img=new Image();img.alt=`${card.name} reference card ${card.id}`;img.referrerPolicy='no-referrer';img.draggable=false;img.onload=()=>{this.button.dataset.imageState='loaded';if(!this.held||gen!==this.generation)return;this.panel.replaceChildren(img);const label=document.createElement('span');label.textContent=this.copy.hintRelease;label.className='hint-tag';const src=document.createElement('small');src.textContent=card.source;src.className='hint-src';this.panel.append(src);this.panel.append(label);};img.onerror=()=>{this.button.dataset.imageState='error';if(!this.held||gen!==this.generation)return;
        // A missing scan should not end the hint: drop it and try another card.
        this.cards=(this.cards||[]).filter(c=>c.id!==card.id);if(this.cards.length&&(this.tries=(this.tries||0)+1)<6){this.held=false;this.press();}else status.textContent=this.copy.hintNone;};img.src=card.image;
    }catch(e){if(this.held&&gen===this.generation){status.textContent=this.copy.hintNone;this.onError?.(e.message);}}
  }
  release(){this.tries=0;if(!this.held)return;this.held=false;this.generation++;this.panel.classList.remove('shown');this.panel.setAttribute('aria-hidden','true');this.button.setAttribute('aria-pressed','false');this.button.dispatchEvent(new Event('pointerleave'));this.unlockTimer=setTimeout(()=>{if(!this.held){this.panel.replaceChildren();this.lock(false);}},220);}
  dispose(){this.release();clearTimeout(this.unlockTimer);this.lock(false);this.abort.abort();}
}

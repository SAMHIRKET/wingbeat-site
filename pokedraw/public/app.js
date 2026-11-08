// Pokedraw client. Networking/state logic is ChatGPT/Codex's original (unchanged API,
// drawing-op format and room state machine). Markup now uses the WINGBEAT kit
// (kit.js) and the card renderer (card.js). All words come from copy.js.
import {Sketch,renderDrawing,replayDrawing} from './drawing.js';
import {HoldHint} from './hints.js';
import * as WB from './kit.js';
import {paintCard,exportCard,CARD_W,CARD_H,MARGIN} from './card.js';
import {COPY} from './copy.js';
import {paintPaper} from './paper.js';

const $=s=>document.querySelector(s),main=$('#main'),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=['#1833a0','#ffffff','#050505','#ff27ba','#e8341c','#ff9a1f','#ffe72b','#a4ee24','#00b96a','#00d4e8','#1263ff','#7222a4','#9a5a3c','#f7c6a3','#b4bacb','#5d5d6e'];
const storageKey=k=>window.PD_PREVIEW_ACTIVE?window.PD_PREVIEW_STORAGE_PREFIX+k:k;
const storage={get(k){try{return JSON.parse(localStorage.getItem(storageKey(k)));}catch{return null;}},set(k,v){try{localStorage.setItem(storageKey(k),JSON.stringify(v));return true;}catch{return false;}},remove(k){try{localStorage.removeItem(storageKey(k));}catch{}}};
let seat=storage.get('pd-seat'),state=null,sketch=null,viewKey='',serverOffset=0,saveTimer,polling=false,saving=false,dirty=false,localOK=true,lastSaved=0,cardCache=new Map(),revealedIndex=-1,replayAbort,activeCard=null,hint=null,hintLocked=false;
const artStore=document.createElement('div');artStore.hidden=true;document.body.append(artStore);
const artCanvas=new Map(),live=new Set();let cardEpoch=0;
function clearCardMemory(){cardEpoch++;replayAbort?.abort();live.clear();for(const c of artCanvas.values()){c.width=0;c.height=0;c.remove();}artCanvas.clear();cardCache.clear();activeCard=null;$('#card-dialog')?.close();if($('#card-detail'))$('#card-detail').replaceChildren();}

/* ---------- markup helpers ---------- */
// Scratch lettering. size in px; color is a kit token (ink, plum, ice, magenta, cyan, lime, sky) or hex.
const L=(t,size=22,color='ink',more='',cls='')=>`<span class="wb-l ${cls}" data-size="${size}" data-color="${color}" ${more}>${esc(t)}</span>`;
const caps=(close='')=>`<span class="wb-caps" aria-hidden="${close?'false':'true'}"><span></span><span></span>${close?`<button class="wb-cap" ${close} aria-label="close"></button>`:'<span></span>'}</span>`;
const bar=(title,right='',close='')=>`<div class="wb-bar">${L(title,24,'ice','data-align="left"','wb-bar-title')}${right?`<span class="wb-bar-right">${right}</span>`:''}${caps(close)}</div>`;
function win(title,body,{cls='',key='',field='',right='',tone=''}={}){return `<section class="wb-win ${cls}" ${key?`data-key="${esc(key)}"`:''} ${field?`data-field="${field}"`:''} ${tone?`data-tone="${tone}"`:''}>${bar(title,right)}<div class="wb-body">${body}</div></section>`;}
const pillAttrs=a=>a.replace('class="wide"','');
const pill=(label,attrs='',tone='',size=26)=>`<button class="wb-pill${/class="wide"/.test(attrs)?' wide':''}" ${tone?`data-tone="${tone}"`:''} ${pillAttrs(attrs)}>${L(label,size,'ice')}</button>`;
const btn=(label,attrs='',cls='')=>`<button class="wb-btn ${cls}" ${attrs}>${esc(label)}</button>`;
const ICON={pen:'<path d="M4 20l3-1 11-11-2-2L5 17z"/><path d="M14 6l2 2"/>',eraser:'<path d="M3 17l8-8 6 6-4 4H6z"/><path d="M13 19h8"/>',line:'<path d="M5 19L19 5"/>',rect:'<rect x="4" y="6" width="16" height="12"/>',ellipse:'<ellipse cx="12" cy="12" rx="8" ry="6"/>',fill:'<path d="M5 11l6-6 8 8-6 6z"/><path d="M19 15q2 3 0 4-2-1 0-4"/>',picker:'<path d="M14 4l6 6-2 2-6-6z"/><path d="M12 8l-7 7v4h4l7-7"/>',pan:'<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',undo:'<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12"/>',redo:'<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

function notice(s){$('#notice').textContent=s;$('#notice').classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('#notice').classList.remove('visible'),4800);}
async function api(path='',data,auth=true){const r=await fetch('/api/rooms'+path,{method:data===undefined?'GET':'POST',headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(auth&&seat?{Authorization:`Bearer ${seat.token}`}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)});let result;try{result=await r.json();}catch{throw new Error('The room service is unavailable. Please retry.');}if(!r.ok)throw Object.assign(new Error(result.error),{status:r.status});return result;}

/* ---------- entry ---------- */
function home(){
  clearCardMemory();
  hint?.dispose();hint=null;sketch?.dispose();sketch=null;viewKey='home';
  const code=new URL(location.href).searchParams.get('room')||'',name=esc(storage.get('pd-name')||'');
  main.innerHTML=`<div class="home">
    ${win(COPY.mainBar,`<div class="hero"><div class="slab">${L(COPY.title,110,'ice','data-title','hero-title')}</div><p class="strip">${L(COPY.byline,28,'sky')}</p></div>`,{cls:'hero-win',key:'hero'})}
    <div class="home-row">
      ${win(COPY.hostBar,`<form id="host-form" class="form">
        <label>${COPY.name}<input name="name" maxlength="24" autocomplete="nickname" value="${name}" required></label>
        <div class="fields-row">
          <label>${COPY.seconds}<select name="seconds"><option>60</option><option selected>90</option><option>120</option><option>180</option></select></label>
          <label>${COPY.rounds}<select name="rounds"><option>3</option><option selected>5</option><option>8</option><option>10</option></select></label>
          <label>${COPY.seats}<select name="capacity"><option>4</option><option selected>8</option><option>12</option></select></label>
        </div>
        <label class="check"><input type="checkbox" name="public">${COPY.listPublic}</label>
        ${pill(COPY.make,'type="submit" class="wide"')}
      </form>`,{cls:'host-win',key:'host'})}
      ${win(COPY.joinBar,`<form id="join-form" class="form">
        <label>${COPY.name}<input name="name" maxlength="24" autocomplete="nickname" value="${name}" required></label>
        <label>${COPY.code}<input class="code-input" name="code" maxlength="5" pattern="[A-Za-z2-9]{5}" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(code)}" placeholder="ABCDE" required></label>
        ${pill(COPY.join,'type="submit" class="wide"','blue')}
      </form>`,{cls:'join-win',key:'join'})}
    </div>
    ${win(COPY.publicBar,`<div id="public-list" class="public-list"><p class="empty">${COPY.finding}</p></div>`,{cls:'rooms-win',key:'rooms',field:'calm',right:btn(COPY.refresh,'data-action="refresh-public"','small')})}
  </div>`;
  $('#host-form').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.public=!!data.public;await enter('create',data,e.submitter);});
  $('#join-form').addEventListener('submit',async e=>{e.preventDefault();await enter('join',Object.fromEntries(new FormData(e.target)),e.submitter);});
  loadPublic();
}
async function loadPublic(){try{const rooms=await api('',undefined,false);if(!$('#public-list'))return;
  $('#public-list').innerHTML=rooms.length?rooms.map(r=>`<div class="public-row"><span class="room-name">${esc(r.title)}</span><span class="room-meta">${esc(r.stage)} ${r.count}/${r.capacity}</span>${btn(r.code,`data-join="${r.code}" ${r.count>=r.capacity?'disabled':''}`,'code-btn')}</div>`).join(''):`<p class="empty">${COPY.noRooms}</p>`;
}catch(e){if($('#public-list'))$('#public-list').textContent=e.message;}}
async function enter(mode,data,button){button.disabled=true;try{seat=mode==='create'?await api('',data,false):await api('/'+data.code.toUpperCase()+'/join',{name:data.name},false);storage.set('pd-seat',seat);storage.set('pd-name',data.name);history.replaceState(null,'',`?room=${seat.code}`);viewKey='';await poll();if(!storage.get('pd-tutorial'))showTutorial();}catch(e){notice(e.message);}finally{button.disabled=false;}}

/* ---------- room ---------- */
function roomShell(content){return `<div class="room"><div class="room-top">
  <button class="room-code" data-action="invite" aria-label="copy invite link">${L(state.code,34,'ice')}</button>
  <nav class="room-nav"><span class="connection" id="connection">${COPY.connected}</span>${btn(COPY.help,'data-action="help"','small')}${btn(COPY.leave,'data-action="leave"','small')}</nav>
</div>${content}</div>`;}
const isHost=()=>state?.host===state?.me;
function playerList(){return state.players.map((p,i)=>`<li class="${p.ready?'is-ready':''}"><span class="avatar" style="--hue:${(i*67)%360}">${esc(p.name.slice(0,1).toUpperCase())}</span><span class="player-name">${esc(p.name)}<small>${p.id===state.me?COPY.you+' ':''}${p.id===state.host?COPY.host:p.online?'':COPY.away}</small></span><span class="player-status">${p.ready?COPY.isReady:COPY.waiting}</span>${isHost()&&p.id!==state.me?`<button class="wb-btn small kick" data-kick="${p.id}" aria-label="remove ${esc(p.name)}">x</button>`:''}</li>`).join('');}
function lobby(){const me=state.players.find(p=>p.id===state.me);
  main.innerHTML=roomShell(`<div class="lobby">
    ${win(COPY.lobbyBar,`<div class="lobby-tags"><span class="tag">${COPY.secondsTag(state.seconds)}</span><span class="tag">${COPY.roundsTag(state.rounds)}</span><span class="tag">${COPY.seatsTag(state.players.length,state.capacity)}</span><span class="tag">${state.public?COPY.public:COPY.private}</span></div>
      <ul class="players">${playerList()}</ul>
      <div class="lobby-actions">${pill(me.ready?COPY.unready:COPY.ready,`data-action="ready" aria-pressed="${me.ready}"`,me.ready?'lime':'')}${isHost()?pill(COPY.start,`data-action="start" ${state.players.every(p=>p.ready)?'':'disabled'}`,'blue'):''}</div>
      ${state.players.length<3?`<p class="note">${COPY.fewPlayers}</p>`:''}`,{cls:'lobby-win',key:'lobby:'+state.code})}
    ${win(COPY.inviteBar,`<div class="invite">${L(state.code,64,'ink')}${btn(COPY.copyInvite,'data-action="invite"')}</div>`,{cls:'invite-win',key:'invite:'+state.code,field:'calm'})}
  </div>`);}

/* ---------- drawing ---------- */
function drawingView(){
  if(!state.eligible){main.innerHTML=roomShell(win(COPY.drawBar,`<div class="spectate">${L(COPY.watching(state.prompt),28,'ink')}<span class="timer" id="timer">${L('',48,'magenta','id="timer-l"')}</span></div>`,{key:'spec:'+state.round}));return;}
  main.innerHTML=roomShell(win(COPY.drawBar,`<div class="draw-layout">
    <div class="drawing-pane">
      <div class="prompt-row">
        <div class="prompt">${L(state.prompt,64,'ink','data-align="left"','prompt-name')}</div>
        <span class="timer" id="timer" aria-label="time left">${L('0:00',44,'magenta','id="timer-l"')}</span>
        <button id="hold-hint" class="wb-pill hint-button" data-tone="lime" aria-pressed="false" aria-label="${COPY.hint}">${L(COPY.hint,22,'ice')}</button>
      </div>
      <div class="board-viewport"><canvas id="paper" width="400" height="300" aria-hidden="true"></canvas><canvas id="board" width="800" height="600" aria-label="drawing canvas"></canvas>
        <div id="hint-panel" class="hint-panel" aria-hidden="true" aria-live="polite"></div>
        <div id="board-overlay" class="board-overlay hidden"><div class="overlay-box">${L(COPY.submitted,48,'ink','id="overlay-l"')}</div></div>
      </div>
      <div class="drawing-status"><span id="save-status"></span><span id="ready-count"></span></div>
    </div>
    <aside class="tools" aria-label="drawing tools">
      <div class="tool-grid">${['pen','eraser'].map((t,i)=>`<button class="wb-btn tool ${i?'':'active'}" data-tool="${t}" aria-label="${COPY.tools[t]}">${icon(t)}<span>${COPY.tools[t]}</span></button>`).join('')}
        <button class="wb-btn tool" data-action="undo" aria-label="${COPY.undo}">${icon('undo')}<span>${COPY.undo}</span></button><button class="wb-btn tool" data-action="redo" aria-label="${COPY.redo}">${icon('redo')}<span>${COPY.redo}</span></button></div>
      <div class="palette">${colors.map((c,i)=>`<button class="swatch ${i?'':'active'}" style="--c:${c}" data-color="${c}" aria-label="colour ${c}"></button>`).join('')}</div>
      <label class="range">${COPY.size}<input id="brush-size" type="range" min="1" max="60" value="7"></label>
      <details class="advanced"><summary class="wb-btn">${COPY.more}</summary><div class="advanced-body">
        <div class="tool-grid">${['line','rect','ellipse','fill','picker','pan'].map(t=>`<button class="wb-btn tool" data-tool="${t}" aria-label="${COPY.tools[t]}">${icon(t)}<span>${COPY.tools[t]}</span></button>`).join('')}</div>
        <div class="adv-row"><label class="colour">${COPY.custom}<input id="custom-color" type="color" value="#1833a0"></label><label class="range">${COPY.opacity}<input id="opacity" type="range" min="5" max="100" value="100"></label></div>
        <label class="check"><input type="checkbox" id="pressure" checked>${COPY.pressure}</label>
        <div class="zoom-row">${btn('-','data-action="zoom-out" aria-label="zoom out"','small')}<output id="zoom-value">100%</output>${btn('+','data-action="zoom-in" aria-label="zoom in"','small')}${btn('1:1','data-action="zoom-reset" aria-label="reset zoom"','small')}</div>
        <div class="adv-row">${btn(COPY.clear,'data-action="clear"','small danger')}${btn(COPY.saveSketch,'data-action="save-sketch"','small')}</div>
      </div></details>
      ${pill(COPY.submit,'data-action="submit" class="wide"','',30)}
    </aside>
  </div>`,{cls:'draw-win',key:'draw:'+state.code+':'+state.round,field:'calm',right:L(COPY.round(state.round,state.rounds),20,'ice')}));
  const paperFace=WB.face($('#paper'),c=>paintPaper(c,WB.boil().ink));paperFace.live=()=>true;
  sketch=new Sketch($('#board'),onDrawingChange,color=>setColor(color));
  hint=new HoldHint($('#hold-hint'),$('#hint-panel'),()=>api(`/${state.code}/hints`),locked=>{hintLocked=locked;if(sketch){if(locked&&sketch.current)sketch.commit();updateDrawing();}},notice,COPY);
  const forRound=state.round,local=storage.get(draftKey());
  if(local)sketch.load(local);
  api(`/${state.code}/draft/${forRound}`).then(d=>{if(!sketch||state.round!==forRound||state.stage!=='drawing')return;if(d.revision>sketch.revision)sketch.load(d);lastSaved=d.revision;if(sketch.revision>d.revision){dirty=true;flush();}updateDrawing();}).catch(e=>notice(e.message));
  $('#brush-size').oninput=e=>sketch.size=+e.target.value;
  $('#opacity').oninput=e=>sketch.alpha=+e.target.value/100;
  $('#custom-color').oninput=e=>setColor(e.target.value);
  $('#pressure').onchange=e=>sketch.pressure=e.target.checked;
  sketch.color=colors[0];
  updateDrawing();
}
function draftKey(){return `pd-draft:${seat.code}:${state.round}`;}
function onDrawingChange(d){localOK=storage.set(draftKey(),d);dirty=true;$('#save-status').textContent=localOK?COPY.savedLocal:'';clearTimeout(saveTimer);saveTimer=setTimeout(flush,650);}
async function flush(){if(saving||!dirty||!sketch||state.stage!=='drawing'||state.submitted)return;saving=true;dirty=false;const round=state.round,d=structuredClone(sketch.snapshot());
  try{await api(`/${seat.code}/save`,{round,drawing:d});lastSaved=d.revision;if($('#save-status'))$('#save-status').textContent=COPY.saved;}
  catch(e){dirty=true;if($('#save-status'))$('#save-status').textContent=COPY.offline;}
  finally{saving=false;if(dirty&&sketch&&state.stage==='drawing'&&Date.now()+serverOffset<state.deadline)setTimeout(flush,1300);}}
function setColor(color){if(!sketch)return;sketch.color=color;document.querySelectorAll('[data-color]').forEach(el=>el.classList.toggle('active',el.dataset.color===color));if($('#custom-color'))$('#custom-color').value=color;}
function updateDrawing(){if(!state)return;
  const remaining=Math.max(0,Math.ceil((state.deadline-Date.now()-serverOffset)/1000)),t=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
  const tl=$('#timer-l');if(tl){WB.setText(tl,t);$('#timer').classList.toggle('urgent',remaining<=10);}
  if(sketch){sketch.locked=hintLocked||state.submitted||remaining===0;
    const hb=$('#hold-hint');if(hb){const was=hb.disabled;hb.disabled=state.submitted||remaining===0;if(was!==hb.disabled)WB.redraw();}
    const overlay=$('#board-overlay');overlay?.classList.toggle('hidden',!(state.submitted||remaining===0));
    if(overlay&&remaining===0&&!state.submitted)WB.setText($('#overlay-l'),COPY.pencilsDown);
    const b=$('[data-action="submit"]');if(b&&b.disabled!==sketch.locked){b.disabled=sketch.locked;WB.redraw();}
    if($('#ready-count'))$('#ready-count').textContent=COPY.finished(state.players.filter(p=>p.submitted).length,state.players.length);
    if(remaining===0&&dirty)flush();}
}

/* ---------- cards ---------- */
function cardSpec(card,round){const winner=round.winners.includes(card.id);
  const back=state?.stage==='reveal'&&state.current?.round===round.round&&round.cards.indexOf(card)>revealedIndex;
  return {back,backTitle:COPY.title,title:round.prompt,num:'R'+round.round,art:artCanvas.get(card.id)||null,artist:card.artist||(card.mine?COPY.you:COPY.hidden),caption:card.votes==null?'':COPY.votes(card.votes),foot:COPY.cardFoot,footRight:state?.code||'',winner,seed:parseInt(card.id.slice(0,4),16)%97};}
function cardHTML(card,round,i=0,big=false){return `<button class="pd-card ${big?'big':''} ${state?.voted===card.id?'selected':''}" data-card="${card.id}" style="--i:${i};--tilt:${(parseInt(card.id.slice(0,2),16)%9)-4}deg"><canvas class="pd-face" data-face="${card.id}" aria-hidden="true"></canvas><span class="sr">${esc(round.prompt)} ${esc(card.artist||card.label||'')}</span></button>`;}
function rounds(){return state.stage==='gallery'?state.history:state.current?[state.current]:[];}
function findCard(id){for(const round of rounds()){const c=round.cards.find(c=>c.id===id);if(c)return {card:c,round};}return null;}
async function getArt(card){if(!cardCache.has(card.id))cardCache.set(card.id,api(card.download.replace('/api/rooms','')).catch(e=>{cardCache.delete(card.id);throw e;}));return cardCache.get(card.id);}
function artFor(id){let c=artCanvas.get(id);if(!c){c=document.createElement('canvas');c.width=800;c.height=600;artStore.append(c);artCanvas.set(id,c);}return c;}
function refreshFaces(id){document.querySelectorAll(`[data-face="${id}"]`).forEach(WB.dirty);}
// Register every card canvas with the boil clock. Only lifted, shown or replaying cards animate.
function bindFaces(){document.querySelectorAll('canvas[data-face]').forEach(cv=>{if(cv._wbFace)return;const id=cv.dataset.face;
  const f=WB.face(cv,c=>{const found=findCard(id);if(found)paintCard(c,cardSpec(found.card,found.round));});
  f.live=()=>live.has(id)||cv.closest('.pd-card')?.matches(':hover,:focus-visible')||!!cv.closest('#card-detail,.showcase');});}
async function paintCards(){const epoch=cardEpoch;bindFaces();for(const round of rounds())for(const c of round.cards){try{const art=await getArt(c);if(epoch!==cardEpoch)return;if(!live.has(c.id))renderDrawing(artFor(c.id),art.ops);refreshFaces(c.id);}catch(e){if(epoch===cardEpoch)notice(e.message);}}}
async function replay(id,ms){const f=findCard(id);if(!f)return;replayAbort?.abort();replayAbort=new AbortController();const sig=replayAbort.signal;live.add(id);
  try{await replayDrawing(artFor(id),(await getArt(f.card)).ops,ms,sig);}finally{live.delete(id);refreshFaces(id);}}
function comparison(){
  const stage=state.stage,all=rounds(),total=all.reduce((n,r)=>n+r.cards.length,0),barTitle={reveal:COPY.revealBar,voting:COPY.voteBar,results:COPY.resultsBar,gallery:COPY.galleryBar}[stage];
  const timer=['reveal','voting'].includes(stage)?`<span class="timer" id="timer">${L('0:00',40,'magenta','id="timer-l"')}</span>`:'';
  const head=stage==='gallery'?'':`<div class="stage-head">${L(state.prompt,52,'ink','data-align="left"')}${timer}</div>`;
  const decks=all.map(r=>`${stage==='gallery'?`<div class="round-label">${L(r.prompt,30,'ink','data-align="left"')}<span class="tag">R${r.round}</span></div>`:''}<div class="deck" style="--n:${r.cards.length}">${r.cards.map((c,i)=>cardHTML(c,r,i)).join('')||`<p class="empty">${COPY.noCards}</p>`}</div>`).join('');
  const board=stage==='results'||stage==='gallery'?`<ol class="scores">${[...state.players].sort((a,b)=>b.score-a.score).map(p=>`<li><span>${esc(p.name)}</span><b>${p.score}</b></li>`).join('')}</ol>
    <div class="stage-actions">${isHost()&&stage==='results'?`${state.round<state.rounds?pill(COPY.next,'data-action="start"','blue'):''}${pill(COPY.finish,'data-action="gallery"','lime')}`:''}${total?btn(COPY.saveAll,'data-action="save-sheet"'):''}${isHost()&&stage==='gallery'?btn(COPY.deleteRoom,'data-action="delete"','danger'):''}</div>`:'';
  main.innerHTML=roomShell(win(barTitle,`${head}${stage==='reveal'&&total?'<div class="showcase" id="showcase"></div>':''}${board}${decks}`,{cls:'stage-win stage-'+stage,key:stage+':'+state.code+':'+state.round,field:'calm',right:stage==='gallery'?'':L(COPY.round(state.round,state.rounds),20,'ice')}));
  revealedIndex=-1;paintCards();updateDrawing();if(stage==='reveal')updateShowcase();
}
async function updateShowcase(){if(state?.stage!=='reveal'||!$('#showcase'))return;const cards=state.current.cards;if(!cards.length)return;
  const duration=Math.max(5,cards.length*5)*1000,elapsed=duration-(state.deadline-Date.now()-serverOffset),index=Math.min(cards.length-1,Math.max(0,Math.floor(elapsed/5000)));
  if(index===revealedIndex)return;revealedIndex=index;const card=cards[index];
  $('#showcase').innerHTML=cardHTML(card,state.current,0,true);bindFaces();
  document.querySelectorAll('.deck .pd-card').forEach((el,i)=>{el.classList.toggle('dealt',i<index);WB.dirty(el.querySelector('canvas'));});
  try{await replay(card.id,3500);}catch(e){notice(e.message);}}
async function openCard(id){const found=findCard(id);if(!found||cardSpec(found.card,found.round).back)return;activeCard=id;const {card,round}=found;
  $('#card-detail').innerHTML=`<div class="card-view">${cardHTML(card,round,0,true)}</div><div class="card-actions">${btn(COPY.replay,'data-action="replay"')}${btn(COPY.saveCard,'data-action="download-card"')}${navigator.share?btn(COPY.share,'data-action="share-card"'):''}${btn(COPY.hide,'data-action="hide-card"','quiet')}${state.stage==='voting'&&!card.mine&&state.voteEligible?pill(state.voted===id?COPY.voted:COPY.vote,`data-vote="${id}" aria-pressed="${state.voted===id}"`):''}</div>`;
  const dlg=$('#card-dialog');if(!dlg.open){dlg.showModal();WB.reopen(dlg);}bindFaces();refreshFaces(id);}
async function cardImage(card,round){const art=await getArt(card),d=document.createElement('canvas');d.width=800;d.height=600;renderDrawing(d,art.ops);return exportCard({...cardSpec(card,round),art:d});}
async function saveCanvas(canvas,name,share=false){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not export this image.');const file=new File([blob],name,{type:'image/png'});
  if(share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Pokedraw'});return;}catch(e){if(e.name==='AbortError')return;}}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function saveSheet(){const selected=rounds().flatMap(r=>r.cards.map(c=>({c,r})));if(!selected.length)return;
  const cols=Math.min(4,selected.length),tw=CARD_W+MARGIN*2,th=CARD_H+MARGIN*2,sheet=document.createElement('canvas');sheet.width=cols*tw;sheet.height=Math.ceil(selected.length/cols)*th;
  if(sheet.height>8400){notice('Too many cards for one sheet. Save rounds one at a time.');return;}
  const ctx=sheet.getContext('2d');ctx.fillStyle='#e4f7ff';ctx.fillRect(0,0,sheet.width,sheet.height);
  for(let i=0;i<selected.length;i++){const {c,r}=selected[i];ctx.drawImage(await cardImage(c,r),(i%cols)*tw,Math.floor(i/cols)*th,tw,th);}
  await saveCanvas(sheet,`pokedraw-${state.code}.png`);}

/* ---------- state loop (original) ---------- */
async function act(action,data={}){await api(`/${seat.code}/${action}`,data);viewKey='';await poll();}
async function poll(){if(!seat||polling)return;polling=true;
  try{const next=await api('/'+seat.code);serverOffset=next.serverNow-Date.now();state=next;
    const key=state.stage+':'+state.round+(state.stage==='lobby'?JSON.stringify([state.players,state.host]):state.stage==='voting'?state.voted:'')+(isHost()?':host':'');
    if(viewKey!==key){if(hint){hint.dispose();hint=null;}if(sketch){sketch.dispose();sketch=null;}viewKey=key;
      if(state.stage==='lobby')lobby();else if(state.stage==='drawing')drawingView();else comparison();}
    else updateDrawing();
    const cn=$('#connection');if(cn){cn.textContent=COPY.connected;cn.classList.remove('offline');}}
  catch(e){if([403,404].includes(e.status)){seat=null;state=null;storage.remove('pd-seat');home();notice(e.message);}else{const cn=$('#connection');if(cn){cn.textContent=COPY.reconnecting;cn.classList.add('offline');}}}
  finally{polling=false;}}

/* ---------- tutorial ---------- */
function showTutorial(){const d=$('#tutorial');if(!d.open){d.showModal();WB.reopen(d);}}
function closeTutorial(){storage.set('pd-tutorial',true);$('#tutorial').close();}
function buildChrome(){
  $('#tutorial').innerHTML=`${bar(COPY.tutorialBar,'','id="close-tutorial"')}<div class="wb-body"><ol class="steps">${COPY.tutorial.map(([h,t],i)=>`<li>${L(h,30,['magenta','blue','plum'][i%3],'data-align="left"')}<span>${esc(t)}</span></li>`).join('')}</ol>
    <canvas id="practice" width="640" height="180" aria-label="${COPY.practice}"></canvas><p class="note">${COPY.practice}</p>${pill(COPY.gotIt,'id="got-it" class="wide"')}</div>`;
  $('#card-dialog').innerHTML=`${bar('CARD.BMP','','id="close-card"')}<div id="card-detail" class="wb-body"></div>`;
  $('#foot').innerHTML=`<span>${esc(COPY.foot)}</span><a href="https://wingbe.at">${esc(COPY.credit)}</a>`;
  $('#close-tutorial').onclick=closeTutorial;$('#got-it').onclick=closeTutorial;
  $('#close-card').onclick=()=>{$('#card-dialog').close();replayAbort?.abort();};
  $('#card-dialog').addEventListener('close',()=>replayAbort?.abort());
  const practice=$('#practice'),pc=practice.getContext('2d');let pp;
  practice.onpointerdown=e=>{practice.setPointerCapture(e.pointerId);const r=practice.getBoundingClientRect();pp=[(e.clientX-r.left)/r.width*640,(e.clientY-r.top)/r.height*180];};
  practice.onpointermove=e=>{if(!pp)return;const r=practice.getBoundingClientRect(),p=[(e.clientX-r.left)/r.width*640,(e.clientY-r.top)/r.height*180];pc.strokeStyle='#1833a0';pc.lineWidth=5;pc.lineCap='round';pc.beginPath();pc.moveTo(...pp);pc.lineTo(...p);pc.stroke();pp=p;};
  practice.onpointerup=practice.onpointercancel=()=>pp=null;
}
buildChrome();

/* ---------- input ---------- */
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  try{
    if(b.dataset.join){$('#join-form [name="code"]').value=b.dataset.join;$('#join-form [name="name"]').focus();$('#join-form').scrollIntoView({behavior:'smooth',block:'center'});return;}
    if(b.dataset.tool&&sketch){sketch.tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(el=>el.classList.toggle('active',el===b));return;}
    if(b.dataset.color){setColor(b.dataset.color);return;}
    if(b.dataset.card&&!b.closest('#card-detail,.showcase')){await openCard(b.dataset.card);return;}
    if(b.dataset.card&&b.closest('.showcase')){await openCard(b.dataset.card);return;}
    if(b.dataset.vote){await act('vote',{card:b.dataset.vote});$('#card-dialog').close();notice(COPY.voted);return;}
    if(b.dataset.kick){if(confirm('Remove this player?'))await act('kick',{player:b.dataset.kick});return;}
    const action=b.dataset.action;if(!action)return;
    if(action==='help')showTutorial();
    else if(action==='refresh-public')await loadPublic();
    else if(action==='invite'){const url=new URL(location.href);url.searchParams.set('room',seat.code);try{await navigator.clipboard.writeText(url.href);notice(url.href);}catch{prompt('Invite link',url.href);}}
    else if(['ready','start','gallery'].includes(action)){b.disabled=true;await act(action);}
    else if(action==='undo')sketch?.undo();else if(action==='redo')sketch?.redo();
    else if(action==='zoom-in')sketch?.setZoom(sketch.zoom+.5);else if(action==='zoom-out')sketch?.setZoom(sketch.zoom-.5);else if(action==='zoom-reset')sketch?.setZoom(1);
    else if(action==='clear'){if(hintLocked)return;if(confirm('Clear the drawing?'))sketch.clear();}
    else if(action==='submit'){if(!sketch.ops.length)return;b.disabled=true;await act('submit',{round:state.round,drawing:sketch.snapshot()});}
    else if(action==='save-sketch')await saveCanvas(sketch.canvas,`pokedraw-${state.prompt}-sketch.png`);
    else if(action==='replay'){if(activeCard)await replay(activeCard,4000);}
    else if(action==='download-card'||action==='share-card'){const f=findCard(activeCard);if(f)await saveCanvas(await cardImage(f.card,f.round),`pokedraw-${f.round.prompt}-${f.card.artist||f.card.label}.png`,action==='share-card');}
    else if(action==='save-sheet')await saveSheet();
    else if(action==='hide-card'){document.querySelectorAll(`.deck [data-card="${activeCard}"]`).forEach(el=>el.classList.add('hidden'));$('#card-dialog').close();}
    else if(action==='leave'){if(state.stage==='drawing'&&!confirm('Leave this round? Your drawing stays saved.'))return;await flush();await api(`/${seat.code}/leave`,{});seat=null;state=null;storage.remove('pd-seat');history.replaceState(null,'',location.pathname);home();}
    else if(action==='delete'){if(confirm('Delete this room and every card on the server? Save the ones you want first.')){await api(`/${seat.code}/delete`,{});const prefix=`pd-draft:${seat.code}:`;for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key?.startsWith(prefix))storage.remove(key);}seat=null;state=null;storage.remove('pd-seat');history.replaceState(null,'',location.pathname);home();}}
  }catch(error){notice(error.message);b.disabled=false;}});
document.addEventListener('keydown',e=>{if(!sketch||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)sketch.redo();else sketch.undo();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(dirty&&sketch&&seat){fetch(`/api/rooms/${seat.code}/save`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${seat.token}`},body:JSON.stringify({round:state.round,drawing:sketch.snapshot()}),keepalive:true}).catch(()=>{});}}else{poll();flush();}});
window.addEventListener('online',()=>{poll();flush();});
window.addEventListener('resize',()=>sketch?.transform());
setInterval(()=>{if(!document.hidden)poll();},1600);
setInterval(()=>{if(state?.deadline){updateDrawing();updateShowcase();}},200);

WB.boot();
const requested=new URL(location.href).searchParams.get('room');
if(seat&&(!requested||requested.toUpperCase()===seat.code)){main.innerHTML='<div class="home"></div>';poll();}else{seat=null;home();}

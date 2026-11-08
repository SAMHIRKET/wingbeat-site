import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt } from 'node:crypto';
import { pokemon } from './pokemon.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = (n = 18) => randomBytes(n).toString('hex');
const cleanName = value => String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24) || 'Doodlebug';
const clamp = (n, a, b, fallback) => Number.isFinite(+n) ? Math.max(a, Math.min(b, Math.floor(+n))) : fallback;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Game {
  constructor(path = ':memory:', now = () => Date.now(), ttl = 24 * 3600_000) {
    this.db = new DatabaseSync(path); this.now = now; this.ttl = ttl;
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, data TEXT NOT NULL, touched INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS drawings(room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE, round INTEGER NOT NULL, player TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(room,round,player));');
  }
  close() { this.db.close(); }
  save(r, touch = true) { if (touch) r.touched = this.now(); this.db.prepare('INSERT INTO rooms VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data,touched=excluded.touched').run(r.code, JSON.stringify(r), r.touched); }
  cleanup() { this.db.prepare('DELETE FROM rooms WHERE touched < ?').run(this.now() - this.ttl); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  get(code) {
    const row = this.db.prepare('SELECT data,touched FROM rooms WHERE code=?').get(String(code).toUpperCase());
    if (!row || row.touched < this.now() - this.ttl) { if (row) this.db.prepare('DELETE FROM rooms WHERE code=?').run(code); fail('This room has expired or been deleted.', 404); }
    return JSON.parse(row.data);
  }
  create(data = {}) {
    if (this.db.prepare('SELECT count(*) n FROM rooms').get().n >= 200) fail('The room service is full. Please try again later.', 503);
    let code; do { code = Array.from({length: 5}, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (this.db.prepare('SELECT code FROM rooms WHERE code=?').get(code));
    const p = this.player(data.name); const r = {code, title: cleanName(data.title || `${p.name}'s room`), public: !!data.public, host: p.id, players:[p], banned:[], stage:'lobby', round:0, rounds:clamp(data.rounds,1,10,5), seconds:clamp(data.seconds,30,300,90), capacity:clamp(data.capacity,2,12,8), tutorial: true, deadline:null, selected:[], history:[], touched:this.now()};
    this.save(r); return {code, token:p.token};
  }
  player(name) { return {id:id(8), token:id(24), name:cleanName(name), ready:false, active:true, score:0, lastSeen:this.now(), eligible:0, submitted:false}; }
  join(code, data = {}) {
    const r = this.get(code); if (r.players.filter(p=>p.active).length >= r.capacity) fail('This room is full.');
    if (r.players.length >= 64) fail('This room has reached its guest limit. Create a fresh room.');
    const p = this.player(data.name); p.eligible = r.round + 1; r.players.push(p); this.save(r); return {code:r.code,token:p.token};
  }
  auth(r, token) { const p = r.players.find(p=>p.token===token && p.active); if (!p || r.banned.includes(p.id)) fail('Your seat is no longer available. Join another room.',403); return p; }
  host(r,p) { if(r.host!==p.id) fail('Only the host can do that.',403); }
  drawing(r, round, player) { const row = this.db.prepare('SELECT data FROM drawings WHERE room=? AND round=? AND player=?').get(r.code, round, player); return row ? JSON.parse(row.data) : {ops:[], revision:0}; }
  validateDrawing(d) {
    if (!d || !Array.isArray(d.ops) || d.ops.length > 1800) fail('Drawing is too complex. Please use fewer strokes.');
    let points = 0;
    for (const op of d.ops) {
      if (!['pen','eraser','line','rect','ellipse','fill','move'].includes(op.tool) || !/^#[0-9a-f]{6}$/i.test(op.color) || !Number.isFinite(op.size) || op.size < 1 || op.size > 80 || !Number.isFinite(op.alpha) || op.alpha < .05 || op.alpha > 1 || !Array.isArray(op.points) || !op.points.length) fail('Invalid drawing.');
      if (op.tip!==undefined && !['round','square'].includes(op.tip) || op.pp!==undefined && typeof op.pp!=='boolean' || op.filled!==undefined && typeof op.filled!=='boolean' || op.erase!==undefined && typeof op.erase!=='boolean') fail('Invalid drawing.');
      if (op.tool==='move' && (!Array.isArray(op.offset) || op.offset.length!==2 || !op.offset.every(n=>Number.isFinite(n)&&Math.abs(n)<=800) || op.points.length<3)) fail('Invalid drawing.');
      points += op.points.length;
      for (const point of op.points) if(!Array.isArray(point) || point.length!==3 || !point.every(Number.isFinite) || point[0]<0 || point[0]>800 || point[1]<0 || point[1]>600 || point[2]<0 || point[2]>1) fail('Invalid drawing coordinates.');
    }
    if(points>65000 || JSON.stringify(d).length>1_500_000) fail('Drawing has reached its size limit.');
    return {ops:d.ops,revision:clamp(d.revision,0,1e9,0)};
  }
  start(r) {
    r.round++; r.stage='drawing'; r.deadline=this.now()+r.seconds*1000;
    const available=pokemon.filter(n=>!r.selected.includes(n)); r.prompt=available[randomInt(available.length)]; r.selected.push(r.prompt);
    r.players.forEach(p=>{p.submitted=false; p.ready=false; if(p.active)p.eligible=r.round;});
  }
  reveal(r) {
    const cards = r.players.filter(p=>p.eligible===r.round && this.drawing(r,r.round,p.id).ops.length).map(p=>({id:id(8),player:p.id}));
    for(let i=cards.length-1;i>0;i--){const j=randomInt(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}
    r.current={round:r.round,prompt:r.prompt,cards,votes:{},voters:r.players.filter(p=>p.active && p.eligible===r.round).map(p=>p.id),tallied:false};
    r.stage='reveal'; r.deadline=this.now()+Math.max(5,cards.length*5)*1000;
  }
  tally(r) {
    const c=r.current; if(!c || c.tallied)return;
    const counts={};c.cards.forEach(a=>counts[a.id]=0);Object.values(c.votes).forEach(v=>{if(v in counts)counts[v]++;});
    const max=Math.max(0,...Object.values(counts)); c.winners=max ? c.cards.filter(a=>counts[a.id]===max).map(a=>a.id) : [];
    c.cards.forEach(a=>{a.votes=counts[a.id];const p=r.players.find(p=>p.id===a.player);if(p)p.score+=counts[a.id];});
    c.tallied=true;r.history.push(c);r.stage='results';r.deadline=null;
  }
  advance(r) {
    // A short transport grace accepts the final autosave after the canvas locks.
    if(r.deadline && this.now()>=r.deadline+(r.stage==='drawing'?2000:0)) {
      if(r.stage==='drawing')this.reveal(r);
      else if(r.stage==='reveal') { if(r.current.voters.length>=3 && r.current.cards.length>=2){r.stage='voting';r.deadline=this.now()+30000;}else this.tally(r); }
      else if(r.stage==='voting')this.tally(r);
    }
    const host=r.players.find(p=>p.id===r.host && p.active);
    if(!host || this.now()-host.lastSeen>90000) { const next=r.players.find(p=>p.active && this.now()-p.lastSeen<30000 && p.id!==r.host); if(next)r.host=next.id; }
  }
  state(code, token) {
    const r=this.get(code),p=this.auth(r,token);p.lastSeen=this.now();this.advance(r);this.save(r,false);
    const cardData=(c, revealNames) => ({round:c.round,prompt:c.prompt,winners:c.winners||[],cards:c.cards.map((a,i)=>({id:a.id,label:`Card ${i+1}`,mine:a.player===p.id,artist:revealNames?r.players.find(x=>x.id===a.player)?.name:null,votes:revealNames?a.votes:null,download:`/api/rooms/${r.code}/cards/${c.round}/${a.id}`}))});
    return {code:r.code,title:r.title,public:r.public,stage:r.stage,round:r.round,rounds:r.rounds,seconds:r.seconds,capacity:r.capacity,prompt:r.prompt,deadline:r.deadline,serverNow:this.now(),expiresAt:r.touched+this.ttl,host:r.host,me:p.id,eligible:p.eligible===r.round,submitted:p.submitted,players:r.players.filter(x=>x.active).map(({id,name,ready,score,submitted,lastSeen})=>({id,name,ready,score,submitted,online:this.now()-lastSeen<15000})),current:r.current&&r.stage!=='drawing'?cardData(r.current,r.stage==='results'||r.stage==='gallery'):null,history:r.history.map(c=>cardData(c,true)),voted:r.current?.votes[p.id]||null,voteEligible:r.current?.voters.includes(p.id)||false};
  }
  publicRooms() { return this.db.prepare('SELECT data FROM rooms WHERE touched>? ORDER BY touched DESC LIMIT 100').all(this.now()-this.ttl).map(x=>JSON.parse(x.data)).filter(r=>r.public && r.stage!=='gallery' && r.players.some(p=>p.active && this.now()-p.lastSeen<30000)).map(r=>({code:r.code,title:r.title,stage:r.stage,count:r.players.filter(p=>p.active).length,capacity:r.capacity})); }
  act(code, token, action, data = {}) {
    const r=this.get(code),p=this.auth(r,token);this.advance(r);p.lastSeen=this.now();
    if(action==='ready'){if(r.stage!=='lobby')fail('The round has already started.');p.ready=!p.ready;}
    else if(action==='start'){this.host(r,p);if(r.stage!=='lobby' && r.stage!=='results')fail('Finish this round first.');if(r.round>=r.rounds)fail('This game is complete.');if(r.stage==='lobby' && !r.players.filter(x=>x.active).every(x=>x.ready))fail('Everyone needs to be ready first.');this.start(r);}
    else if(action==='save' || action==='submit') {
      if(r.stage!=='drawing' || p.eligible!==r.round || +data.round!==r.round || p.submitted)fail('This drawing round has ended or was already submitted.',409);
      const d=this.validateDrawing(data.drawing), old=this.drawing(r,r.round,p.id);
      if(d.revision>=old.revision){
        const serialized=JSON.stringify(d),previous=this.db.prepare('SELECT length(data) n FROM drawings WHERE room=? AND round=? AND player=?').get(r.code,r.round,p.id)?.n||0;
        const roomBytes=this.db.prepare('SELECT coalesce(sum(length(data)),0) n FROM drawings WHERE room=?').get(r.code).n;
        const allBytes=this.db.prepare('SELECT coalesce(sum(length(data)),0) n FROM drawings').get().n;
        if(roomBytes-previous+serialized.length>16*1024*1024)fail('This room has reached its drawing storage limit. Save your cards and start a new room.',413);
        if(allBytes-previous+serialized.length>256*1024*1024)fail('Drawing storage is full. Your device copy is still available.',507);
        this.db.prepare('INSERT INTO drawings VALUES(?,?,?,?) ON CONFLICT(room,round,player) DO UPDATE SET data=excluded.data').run(r.code,r.round,p.id,serialized);
      }
      if(action==='submit'){p.submitted=true; if(r.players.filter(x=>x.active && x.eligible===r.round).every(x=>x.submitted))this.reveal(r);}
    }
    else if(action==='vote') {
      if(r.stage!=='voting' || !r.current.voters.includes(p.id))fail('Voting is not available.');
      const card=r.current.cards.find(a=>a.id===data.card);if(!card || card.player===p.id)fail('Choose another player’s card.');
      r.current.votes[p.id]=card.id;
    }
    else if(action==='gallery'){this.host(r,p);if(!['results','lobby','gallery'].includes(r.stage))fail('Finish the current round first.');r.stage='gallery';r.deadline=null;}
    else if(action==='leave'){p.active=false; if(r.host===p.id)r.host=r.players.find(x=>x.active)?.id||null;}
    else if(action==='kick'){this.host(r,p);const target=r.players.find(x=>x.id===data.player);if(!target||target.id===p.id)fail('Choose another player.');target.active=false;r.banned.push(target.id);}
    else if(action==='delete'){this.host(r,p);this.db.prepare('DELETE FROM rooms WHERE code=?').run(r.code);return {deleted:true};}
    else fail('Unknown action.');
    this.save(r);return {ok:true};
  }
  getDraft(code,token,round){const r=this.get(code),p=this.auth(r,token);return this.drawing(r,+round,p.id);}
  getCard(code,token,round,card){const r=this.get(code);this.auth(r,token);this.advance(r);const c=r.history.find(h=>h.round===+round)||(r.current?.round===+round?r.current:null);if(!c||r.stage==='drawing'&&c.round===r.round)fail('This card has not been revealed.',403);const a=c.cards.find(x=>x.id===card);if(!a)fail('Card not found.',404);return this.drawing(r,+round,a.player);}
}

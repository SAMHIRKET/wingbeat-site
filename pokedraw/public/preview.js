// Preview mode: fake room service so every screen can be looked at without a server.
// Off unless the page has ?preview=<stage> or sets window.PD_PREVIEW before loading.
// Stages: home lobby drawing reveal voting results gallery
const q=new URL(location.href).searchParams.get('preview'),h=location.hash.slice(1),useHash=!q&&!!window.PD_PREVIEW,stage=q||(useHash&&h)||window.PD_PREVIEW;
// The artifact frame drops query strings, so the hosted preview switches screens by #hash.
const go=s=>{if(useHash){location.hash=s;location.reload();}else location.search='?preview='+s;};
const STAGES=['home','lobby','drawing','reveal','voting','results','gallery'];
if(STAGES.includes(stage)){
  window.PD_PREVIEW_ACTIVE=true;
  window.PD_PREVIEW_STORAGE_PREFIX=`pd-preview:${stage}:`;
  const previewKey=k=>window.PD_PREVIEW_STORAGE_PREFIX+k;
  const now=()=>Date.now(),me='p1',code='KR4BZ';
  const names=['SAM','herew','hoss','jaggi','cocovin'];
  const players=names.map((n,i)=>({id:'p'+(i+1),name:n,ready:stage!=='lobby'||i%2===0,score:[3,5,1,2,0][i],submitted:i<2,online:i!==4}));
  // Doodles in the real drawing-op format.
  function doodle(seed,prompt){
    let s=(seed*7919+13)%233280;const r=()=>((s=(s*9301+49297)%233280)/233280);
    const ink=['#1833a0','#050505','#7222a4'][seed%3],body=['#ffe72b','#a4ee24','#ff9a1f','#00d4e8','#ff27ba'][seed%5];
    const cx=330+r()*140,cy=330+r()*60,rx=130+r()*60,ry=110+r()*40,ops=[];
    ops.push({tool:'fill',color:'#e4f7ff',size:7,alpha:1,points:[[5,5,1]]});
    ops.push({tool:'ellipse',color:ink,size:9,alpha:1,points:[[cx-rx,cy-ry,1],[cx+rx,cy+ry,1]]});
    ops.push({tool:'fill',color:body,size:7,alpha:1,points:[[cx,cy,1]]});
    for(const side of [-1,1]){const ex=cx+side*rx*.55,pts=[];for(let k=0;k<=10;k++){const t=k/10;pts.push([ex+side*t*(40+r()*50)+Math.sin(t*6+seed)*6,cy-ry*.7-t*(120+r()*60),.6+t*.4]);}ops.push({tool:'pen',color:ink,size:10,alpha:1,points:pts});}
    for(const side of [-1,1])ops.push({tool:'ellipse',color:ink,size:14,alpha:1,points:[[cx+side*45-8,cy-30-8,1],[cx+side*45+8,cy-30+8,1]]});
    const m=[];for(let k=0;k<=12;k++){const t=k/12;m.push([cx-50+t*100,cy+30+Math.sin(t*Math.PI)*28*(seed%2?1:-1),1]);}ops.push({tool:'pen',color:ink,size:7,alpha:1,points:m});
    for(let j=0;j<3;j++){const p=[];let x=120+r()*560,y=80+r()*80;for(let k=0;k<14;k++){x+=(r()-.5)*40;y+=(r()-.3)*20;p.push([x,y,.5+r()*.5]);}ops.push({tool:'pen',color:['#ff27ba','#00b96a','#1263ff'][j],size:4+r()*5,alpha:.85,points:p});}
    return {ops,revision:ops.length};
  }
  const prompts=['Pikachu','Psyduck','Gengar','Snorlax'];
  const mkRound=(n,prompt,reveal)=>({round:n,prompt,winners:reveal?[`c${n}0a1b`.padEnd(16,'0')]:[],cards:names.slice(0,4).map((x,i)=>({id:`c${n}${i}a1b`.padEnd(16,'0'),label:`Card ${i+1}`,mine:i===0,artist:reveal?x:null,votes:reveal?[3,1,0,2][i]:null,download:`/api/rooms/${code}/cards/${n}/c${n}${i}a1b`.padEnd(0)}))});
  // ids must be hex for the real API; the preview only needs them unique.
  let state;
  function build(){
    const base={code,title:"SAM's room",public:false,stage,round:stage==='gallery'?3:2,rounds:5,seconds:90,capacity:8,prompt:stage==='gallery'?'Snorlax':'Psyduck',deadline:null,serverNow:now(),host:me,me,eligible:true,submitted:false,players,current:null,history:[],voted:null,voteEligible:true};
    if(stage==='lobby'){base.round=0;base.prompt=null;}
    if(stage==='drawing')base.deadline=now()+78000;
    if(['reveal','voting','results'].includes(stage))base.current=mkRound(2,'Psyduck',stage==='results');
    if(stage==='reveal')base.deadline=now()+20000;
    if(stage==='voting'){base.deadline=now()+30000;}
    if(stage==='results'){base.history=[mkRound(1,'Pikachu',true),base.current];}
    if(stage==='gallery'){base.history=[mkRound(1,'Pikachu',true),mkRound(2,'Psyduck',true),mkRound(3,'Snorlax',true)];}
    return base;
  }
  state=build();
  const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(!url.pathname.startsWith('/api/rooms'))return realFetch(input,init);
    const path=url.pathname.replace('/api/rooms','').split('/').filter(Boolean),method=init.method||'GET';
    await new Promise(r=>setTimeout(r,60));
    if(!path.length&&method==='GET')return json(stage==='home'?[{code:'H0SS2',title:"herew's room",stage:'lobby',count:3,capacity:8},{code:'JAGG1',title:'raptor pack',stage:'drawing',count:8,capacity:8}]:[]);
    if(!path.length&&method==='POST'){go('lobby');return json({code,token:'preview'});}
    const action=path.slice(1).join('/');
    if(path[1]==='join'){go('lobby');return json({code,token:'preview'});}
    if(method==='GET'&&!action){state.serverNow=now();if(state.deadline&&state.deadline<now()+1000)state.deadline=now()+(stage==='drawing'?78000:20000);return json(state);}
    if(action==='hints')return json([{id:'base1-58',name:'Pikachu',image:'https://assets.tcgdex.net/en/base/base1/58/high.webp',source:'TCGdex'},{id:'base4-87',name:'Pikachu',image:'https://assets.tcgdex.net/en/base/base4/87/high.webp',source:'TCGdex'}]);
    if(action.startsWith('draft'))return json({ops:[],revision:0});
    if(action.startsWith('cards/')){const id=path[3]||'';return json(doodle([...id].reduce((n,c)=>n+c.charCodeAt(0),0)%17+1));}
    if(method==='POST'){
      if(action==='ready'){const p=state.players[0];p.ready=!p.ready;}
      if(action==='vote'){state.voted=JSON.parse(init.body||'{}').card;}
      if(action==='submit'){state.submitted=true;}
      if(action==='leave'||action==='delete'){go('home');}
      if(action==='start'){go('drawing');}
      if(action==='gallery'){go('gallery');}
      return json(state);
    }
    return json({error:'Not found'},404);
  };
  // Preview screens must never replace a player's real room seat or drafts.
  try{if(stage==='home')localStorage.removeItem(previewKey('pd-seat'));else localStorage.setItem(previewKey('pd-seat'),JSON.stringify({code,token:'preview'}));localStorage.setItem(previewKey('pd-tutorial'),'true');}catch{}
  if(stage==='home')history.replaceState(null,'',location.pathname+location.search);
  // Stage switcher (preview only).
  addEventListener('DOMContentLoaded',()=>{
    const bar=document.createElement('nav');bar.className='preview-bar';bar.setAttribute('aria-label','preview screens');
    bar.innerHTML=STAGES.map(s=>`<a href="${useHash?'#'+s:'?preview='+s}" data-stage="${s}" ${s===stage?'aria-current="page"':''}>${s}</a>`).join('')+'<a href="#" id="pv-how">how</a>';
    document.body.prepend(bar);
    if(useHash)bar.querySelectorAll('[data-stage]').forEach(a=>a.onclick=e=>{e.preventDefault();go(a.dataset.stage);});
    bar.querySelector('#pv-how').onclick=e=>{e.preventDefault();document.querySelector('[data-action="help"]')?.click()||document.getElementById('tutorial').showModal();};
    const st=document.createElement('style');st.textContent='.preview-bar{position:relative;z-index:5;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px;background:#050505}.preview-bar a{color:#c6ff3a;font:bold 12px monospace;padding:4px 8px;text-decoration:none;border:1px dotted #c6ff3a}.preview-bar a[aria-current]{background:#c6ff3a;color:#050505}';document.head.append(st);
  });
}

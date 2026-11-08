import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {Game} from './engine.mjs';
import {HintCatalog} from './hints.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const error=(message,status)=>Object.assign(new Error(message),{status});

export function createApp({dataDir=process.env.DATA_DIR||path.join(root,'data'),trustProxy=process.env.TRUST_PROXY==='1',publicOrigin=process.env.PUBLIC_ORIGIN||'',now=()=>Date.now()}={}){
  if(publicOrigin){const url=new URL(publicOrigin);if(!['http:','https:'].includes(url.protocol)||url.origin!==publicOrigin)throw new Error('PUBLIC_ORIGIN must be an http(s) origin with no trailing slash or path.');}
  fs.mkdirSync(dataDir,{recursive:true});
  const game=new Game(path.join(dataDir,'pokedraw.sqlite'),now);
  const hints=new HintCatalog(fetch,now,JSON.parse(fs.readFileSync(path.join(root,'hints-cache.json'),'utf8')).cards);
  const rate=new Map();
  function clientIp(req){
    // Enable only on the private Docker network behind the supplied Caddy proxy.
    // Caddy appends the direct peer's address; ignore client-supplied earlier entries.
    if(trustProxy){const forwarded=req.headers['x-forwarded-for']?.split(',').at(-1)?.trim();if(forwarded&&isIP(forwarded))return forwarded;}
    return req.socket.remoteAddress;
  }
  function allowed(req,kind,limit){const key=`${clientIp(req)}:${kind}`,time=now();let b=rate.get(key);if(!b||time>b.until){b={count:0,until:time+60000};rate.set(key,b);}if(++b.count>limit)throw error('Please slow down and try again in a minute.',429);}
  async function body(req){let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>1_600_000)throw error('Drawing is too large.',413);chunks.push(c);}try{const data=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{throw error('Invalid request.',400);}}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://assets.tcgdex.net; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'");
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/healthz'&&['GET','HEAD'].includes(req.method)){game.db.prepare('SELECT 1').get();return send({ok:true});}
      if(url.pathname.startsWith('/api/')){
        if(req.method==='POST'&&req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{throw error('Invalid request origin.',403);}if(publicOrigin?origin.origin!==publicOrigin:origin.host!==req.headers.host)throw error('Request origin does not match.',403);}
        allowed(req,'all',1000);
        const token=req.headers.authorization?.replace(/^Bearer /,'');
        if(req.method==='GET'&&url.pathname==='/api/rooms')return send(game.publicRooms());
        if(req.method==='POST'&&url.pathname==='/api/rooms'){allowed(req,'create',8);game.cleanup();return send(game.create(await body(req)),201);}
        const m=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{5})(?:\/(.*))?$/);if(!m)return send({error:'Not found'},404);
        const [,code,action]=m;
        if(req.method==='POST'&&action==='join'){allowed(req,'join',30);return send(game.join(code,await body(req)));}
        if(req.method==='GET'&&!action)return send(game.state(code,token));
        if(req.method==='GET'&&action==='hints'){const r=game.get(code);game.auth(r,token);if(r.stage!=='drawing')return send({error:'Hints are only available while drawing.'},409);return send(await hints.list(r.prompt));}
        let match;
        if(req.method==='GET'&&(match=action?.match(/^draft\/(\d{1,2})$/)))return send(game.getDraft(code,token,match[1]));
        if(req.method==='GET'&&(match=action?.match(/^cards\/(\d{1,2})\/([a-f0-9]{16})$/)))return send(game.getCard(code,token,match[1],match[2]));
        if(req.method==='POST')return send(game.act(code,token,action,await body(req)));
        return send({error:'Not found'},404);
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
      let rel=url.pathname.replace(/^\/pokedraw\/?/,'/');if(rel==='/'||rel==='')rel='/index.html';
      if(!/^\/(fonts\/)?[a-zA-Z0-9_-]+(\.[a-zA-Z0-9]+)?$/.test(rel)){res.writeHead(404);return res.end('Not found');}
      const file=path.join(root,'public',rel),type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.txt':'text/plain'}[path.extname(file)];
      if(!type||!fs.existsSync(file)){res.writeHead(404);return res.end('Not found');}
      res.writeHead(200,{'Content-Type':type.startsWith('image/')?type:`${type}; charset=utf-8`,'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
    }catch(e){if(!res.headersSent)send({error:e.status?e.message:'Something went wrong. Please retry.'},e.status||500);else res.destroy();if(!e.status)console.error(e);}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  const tick=setInterval(()=>{game.cleanup();for(const[k,v]of rate)if(now()>v.until)rate.delete(k);},60000);tick.unref();
  let closing;
  const close=()=>closing??=(async()=>{clearInterval(tick);await new Promise(resolve=>server.close(resolve));game.close();})();
  return {server,game,close};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp();const portIndex=process.argv.indexOf('--port');const port=Number(process.env.PORT)||Number(portIndex>=0?process.argv[portIndex+1]:0)||3000;
  app.server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Pokédraw listening on port ${app.server.address().port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.close().then(()=>process.exit(0));});
}

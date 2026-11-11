import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API='https://api.autodarts.com', BUS='https://play.ws.autodarts.com/ms/v0';
const secrets=new Set();
function remember(value){if(typeof value==='string'&&value.length)secrets.add(value);}
function clean(value,key='') {
  if(/password|token|authorization|cookie|ticket|secret|email|username|^code$/i.test(key))return '[ENTFERNT]';
  if(typeof value==='string'){
    let text=value;
    for(const secret of [...secrets].sort((a,b)=>b.length-a.length))text=text.split(secret).join('[ENTFERNT]');
    return text.replace(/([?&]code=)[^&\s]+/gi,'$1[ENTFERNT]').replace(/Bearer\s+\S+/gi,'Bearer [ENTFERNT]');
  }
  if(Array.isArray(value))return value.map(v=>clean(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)]));
  return value;
}
function matchEvent(message,board){
  if(message?.channel!=='autodarts.boards'||message.topic!==board+'.matches')return null;
  const d=message.data;
  return d&&typeof d.id==='string'&&['start','finish','delete'].includes(d.event)?d:null;
}
if(process.argv.includes('--self-test')){
  const {default:assert}=await import('node:assert/strict');
  remember('private-value');
  const result=clean({token:'abc',nested:{password:'123',throws:[{segment:{number:20,multiplier:3}}]},url:'wss://example/?code=abc',text:'private-value'});
  assert.equal(result.token,'[ENTFERNT]');assert.equal(result.nested.password,'[ENTFERNT]');assert.equal(result.text,'[ENTFERNT]');assert.equal(result.url,'wss://example/?code=[ENTFERNT]');assert.equal(result.nested.throws[0].segment.multiplier,3);
  assert.equal(matchEvent({channel:'autodarts.boards',topic:'other.matches',data:{id:'match',event:'start'}},'mine'),null);
  assert.equal(matchEvent({channel:'autodarts.boards',topic:'mine.matches',data:{id:'match',event:'start'}},'mine').id,'match');
  console.log('Prüfung bestanden: Zugangsdaten entfernt, Treffer bleiben erhalten, Board-Zuordnung geprüft.');
}else{
  await main().catch(()=>{console.error('Diagnose abgebrochen. Bitte Internetverbindung und Node-Version prüfen.');process.exitCode=1;});
}
async function main(){
  if(typeof WebSocket==='undefined')throw Error('Node 22 oder neuer erforderlich');
  let muted=false;
  const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
  const rl=createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
  console.log('\nAutodarts V2 – echte Cloud-Nachrichten aufzeichnen\nKeine Würfe werden in Dartbracket eingetragen. Ende nach 5 Minuten oder mit Strg+C.\n');
  const username=(await rl.question('Autodarts E-Mail: ')).trim();remember(username);
  process.stdout.write('Autodarts Passwort (Eingabe bleibt unsichtbar): ');muted=true;
  let password;try{password=await rl.question('');}finally{muted=false;process.stdout.write('\n');}remember(password);
  async function request(base,path,access,body){
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(access?{Authorization:'Bearer '+access}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!r.ok)return {ok:false,status:r.status};
    try{return {ok:true,status:r.status,data:await r.json()};}catch{return {ok:false,status:r.status,invalidJSON:true};}
  }
  let auth;
  try{auth=await request(API,'/auth/v1/login',null,{username,password,client_id:'autodarts-play'});}catch{rl.close();console.log('Autodarts-Anmeldung nicht erreichbar.');return;}
  password='';
  if(!auth.ok||typeof auth.data?.access_token!=='string'){rl.close();console.log('Anmeldung fehlgeschlagen (HTTP '+auth.status+'). Dieser Anmeldeweg unterstützt eventuell dein Konto nicht.');return;}
  const access=auth.data.access_token;remember(access);remember(auth.data.refresh_token);
  const listed=await request(API,'/bs/v0/boards',access);
  const boards=Array.isArray(listed.data)?listed.data:listed.data?.boards;
  if(!listed.ok||!Array.isArray(boards)||!boards.length){rl.close();console.log('Keine Scheiben geladen. HTTP '+listed.status);return;}
  boards.forEach((b,i)=>console.log((i+1)+': '+(b.name??'Scheibe')+' ('+b.id+')'));
  const chosen=Number(await rl.question('Nummer deiner Scheibe: '))-1;rl.close();
  const board=boards[chosen];if(!board||typeof board.id!=='string'){console.log('Ungültige Auswahl.');return;}
  const directory=new URL('./recordings/',import.meta.url);mkdirSync(directory,{recursive:true});
  const filename=resolve(fileURLToPath(directory),'autodarts-v2-'+new Date().toISOString().replace(/[:.]/g,'-')+'.txt');
  function log(kind,data){appendFileSync(filename,JSON.stringify({time:new Date().toISOString(),kind,data:clean(data)})+'\n','utf8');}
  log('session',{boardId:board.id,boardName:board.name,node:process.version,durationMinutes:5});
  console.log('\nTextdatei: '+filename+'\nBitte: Scheibe leeren → drei Darts werfen → Darts herausziehen.\nFalls nichts ankommt, zusätzlich die offizielle Autodarts-Seite öffnen und dort dieselbe Scheibe benutzen.\n');
  let stopped=false,ws=null,match=null,polling=false,reconnect=null,interval=null,timeout=null;
  let received=0;
  function finish(){if(stopped)return;stopped=true;clearInterval(interval);clearTimeout(timeout);clearTimeout(reconnect);ws?.close();log('end',{received});console.log('\nFertig. '+received+' Cloud-Nachrichten gespeichert.\n'+filename);}
  process.once('SIGINT',finish);
  function send(channel,topic,type='subscribe'){if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type,channel,topic}));log('subscription',{type,channel,topic});}}
  async function state(){
    if(stopped||polling)return;polling=true;
    try{const r=await request(API,'/bs/v0/boards/'+encodeURIComponent(board.id)+'/state',access);if(!stopped)log('board-state-http',r);}catch{if(!stopped)log('board-state-http',{error:'Nicht erreichbar'});}finally{polling=false;}
  }
  async function imageMetadata(raw,source){
    try{
      const url=new URL(raw,'https://boards.ws.autodarts.com');remember(url.href);
      if(url.protocol!=='https:'||url.hostname!=='boards.ws.autodarts.com'||url.port||url.username||url.password){log('board-image',{...source,error:'Unbekannte Bildadresse'});return;}
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
      const data={...source,status:response.status,contentType:response.headers.get('content-type'),contentLength:response.headers.get('content-length')};
      await response.body?.cancel();if(!stopped)log('board-image',data);
    }catch{if(!stopped)log('board-image',{...source,error:'Bild nicht erreichbar'});}
  }
  async function imageSnapshot(cam){
    try{
      const r=await request(API,'/bs/v0/boards/'+encodeURIComponent(board.id)+'/img/live?cam='+cam+'&warp=true',access);
      if(typeof r.data?.url==='string'){remember(r.data.url);await imageMetadata(r.data.url,{source:'snapshot',cam});}
      else if(!stopped)log('board-image',{source:'snapshot',cam,status:r.status,available:false});
    }catch{if(!stopped)log('board-image',{source:'snapshot',cam,error:'Keine Antwort'});}
  }
  async function connect(){
    if(stopped)return;
    try{
      const ticket=await request(BUS,'/tickets',access,{});
      if(!ticket.ok||typeof ticket.data?.code!=='string'){log('connection',{error:'Kein Verbindungsticket',status:ticket.status});console.log('Kein Cloud-Ticket. HTTP '+ticket.status);finish();return;}
      remember(ticket.data.code);
      if(stopped)return;
      ws=new WebSocket(BUS.replace('https:','wss:')+'/subscribe?code='+encodeURIComponent(ticket.data.code));
      ws.onopen=()=>{log('connection',{state:'open'});console.log('Cloud verbunden. Warte auf echte Nachrichten …');for(const suffix of ['state','events','matches'])send('autodarts.boards',board.id+'.'+suffix);if(match)send('autodarts.matches',match+'.state');for(let cam=0;cam<3;cam++){send('autodarts.boards.images',board.id+'.live?cam='+cam+'&warp=true');void imageSnapshot(cam);}};
      ws.onmessage=async event=>{
        if(stopped)return;
        let text;try{text=typeof event.data==='string'?event.data:event.data instanceof Blob?await event.data.text():new TextDecoder().decode(event.data);}catch{log('message-unreadable',{});return;}
        if(text.length>2000000){log('message-too-large',{length:text.length});return;}
        let message;try{message=JSON.parse(text);}catch{log('message-non-json',text);return;}
        const imageMessage=message.channel==='autodarts.boards.images'&&[0,1,2].some(cam=>message.topic===board.id+'.live?cam='+cam+'&warp=true');
        if(imageMessage){if(typeof message.data?.url==='string'){remember(message.data.url);void imageMetadata(message.data.url,{source:'cloud',topic:message.topic});}}
        received++;log('cloud-message',imageMessage?{...message,data:{...message.data,url:'[BILDADRESSE ENTFERNT]'}}:message);console.log('Nachricht '+received+': '+(message.channel??message.type??'unbekannt')+' / '+(message.topic??''));
        const found=matchEvent(message,board.id);
        if(found?.event==='start'){if(match&&match!==found.id)send('autodarts.matches',match+'.state','unsubscribe');match=found.id;send('autodarts.matches',match+'.state');}
        else if(found&&match===found.id){send('autodarts.matches',match+'.state','unsubscribe');match=null;}
      };
      ws.onerror=()=>log('connection',{state:'error'});
      ws.onclose=event=>{log('connection',{state:'closed',code:event.code});if(!stopped)reconnect=setTimeout(()=>void connect(),3000);};
    }catch{if(!stopped){log('connection',{error:'Verbindung nicht erreichbar'});reconnect=setTimeout(()=>void connect(),3000);}}
  }
  interval=setInterval(()=>void state(),5000);timeout=setTimeout(finish,5*60*1000);
  await state();await connect();
}

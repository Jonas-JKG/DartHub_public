'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import PasswordInput from './PasswordInput';
import { useEffect, useRef, useState } from 'react';
import { BoardCursor, BoardStream, takeoutFinished, boardInterrupted } from '../domain/autodarts';
import { useAutodartsImages } from './useAutodartsImages';
import {autodartsRequest,decodeAutodartsMessage,AutodartsRequestError} from '../client/autodarts-transport';
import { type Hit } from '../domain/scoring';
type Board={id:string;name:string};
export default function AutodartsPanel({scope,tournamentId,matchId,playerId,imageActive,eligible,visitKey,onHit,onTakeout,initialExpanded=false,context='tournament'}:{context?:'tournament'|'dartdeck';initialExpanded?:boolean;scope:string;tournamentId:string;matchId:string;playerId?:string;imageActive:boolean;eligible:boolean;visitKey:string;onHit:(hit:Hit,index:number)=>Promise<boolean>;onTakeout:(visitKey:string)=>Promise<boolean>}) {useLanguage();
  const [expanded,setExpanded]=useState(initialExpanded),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[boards,setBoards]=useState<Board[]>([]),[boardId,setBoardId]=useState(''),[authenticated,setAuthenticated]=useState(false),[run,setRun]=useState(false),[working,setWorking]=useState(false),[status,setStatus]=useState('Manuelle Eingabe'),[error,setError]=useState('');
  const [canLink,setCanLink]=useState(false),[linked,setLinked]=useState(false),[remember,setRemember]=useState(true);
  const [autoNext,setAutoNext]=useState(true),[socket,setSocket]=useState<WebSocket|null>(null);
  const [restoreTick,setRestoreTick]=useState(0),[connectionTick,setConnectionTick]=useState(0),[diagnosticText,setDiagnosticText]=useState('');
  const diagnostic=useRef({socket:'idle',received:0,opened:0,closeCode:null as number|null,cleanClose:null as boolean|null,bootstrapEmpty:false,boardMessages:0,lastDataAt:null as string|null});
  const requests=useRef<Promise<unknown>>(Promise.resolve());
  const armedVisit=useRef<{key:string;matchId:string;playerId?:string}|null>(null);
  const latest=useRef({eligible,visitKey,onHit,onTakeout,autoNext,matchId,playerId});latest.current={eligible,visitKey,onHit,onTakeout,autoNext,matchId,playerId};
  const stream=useRef(new BoardStream()),cursor=useRef(new BoardCursor()),queue=useRef(Promise.resolve()),generation=useRef(0);
  async function api(body:unknown){const task=requests.current.catch(()=>{}).then(()=>autodartsRequest(body,tournamentId?{[context==='dartdeck'?'X-Dartbracket-Dartdeck':'X-Dartbracket-Tournament']:tournamentId}:{},()=>setStatus('Autodarts wird auf einem anderen Gerät erneuert · Warte kurz …')));requests.current=task;return task;}

  const images=useAutodartsImages({context,scope,playerId,id:tournamentId,match:matchId,boardId,live:run,socket:run&&matchId?socket:null,active:imageActive,visit:visitKey,api});
  useEffect(()=>{
    try{setBoardId(localStorage.getItem('autodarts-board:'+scope)??'');setExpanded(!matchId||localStorage.getItem('autodarts-prefer:'+scope)==='autodarts');setAutoNext(localStorage.getItem('autodarts-auto-next:'+scope)!=='off');}catch{}
    let active=true;setRun(false);
    fetch('/api/autodarts',{cache:'no-store',headers:tournamentId?{[context==='dartdeck'?'X-Dartbracket-Dartdeck':'X-Dartbracket-Tournament']:tournamentId}:{}}).then(async r=>{const d=await r.json();if(!r.ok||d.error)throw Error(d.error??'Autodarts-Status konnte nicht geladen werden.');return d;}).then(async d=>{
      if(!active)return;setCanLink(!!d.canLink);setLinked(!!d.linked);setAuthenticated(!!d.authenticated);
      if(!d.authenticated)return;
      try{
        const result=await api({operation:'boards'});if(!active)return;setBoards(result.boards);
        let selected='';try{selected=localStorage.getItem('autodarts-board:'+scope)??'';}catch{}
        const preferred=d.linked?result.boardId:selected;
        const board=result.boards.find((b:Board)=>b.id===preferred)??(!d.linked?result.boards[0]:null);
        if(board){setBoardId(board.id);let enabled=!!result.autoConnect;try{if(d.linked&&localStorage.getItem('autodarts-prefer:'+scope)==='manual')enabled=false;if(!d.linked)enabled=localStorage.getItem('autodarts-enabled:'+scope)==='on';}catch{}if(enabled){setRun(true);setStatus(tournamentId?"Autodarts wird automatisch verbunden …":"Scheibe mit deinem Zugang verknüpft");}}
        else if(d.linked&&preferred)setError('Die gespeicherte Scheibe ist nicht mehr verfügbar. Bitte eine andere Scheibe auswählen.');
      }catch(e){if(active){setAuthenticated(false);setError(e instanceof Error?e.message:'Bitte erneut bei Autodarts anmelden.');}}
    }).catch(e=>{if(active){setError(e instanceof Error?e.message:'Autodarts-Status konnte nicht geladen werden.');setStatus('Autodarts-Status konnte nicht geladen werden.');}});
    return()=>{active=false;generation.current++;};
  },[scope,restoreTick]);
  function feed(raw:unknown,id:string,bootstrap=false){
    const snapshot=stream.current.accept(raw,id);if(!snapshot)return;if(bootstrap)diagnostic.current.bootstrapEmpty=true;else{diagnostic.current.boardMessages++;diagnostic.current.lastDataAt=new Date().toISOString();}images.boardEmpty(snapshot.length===0);
    const finished=takeoutFinished(raw,id),interrupted=boardInterrupted(raw,id),currentGeneration=generation.current;
    queue.current=queue.current.then(async()=>{
      if(currentGeneration!==generation.current)return;
      if(finished||bootstrap&&snapshot.length===0&&armedVisit.current!==null){
        const armed=armedVisit.current;armedVisit.current=null;
        if(armed&&armed.matchId===latest.current.matchId&&armed.playerId===latest.current.playerId&&latest.current.autoNext&&!await latest.current.onTakeout(armed.key)){setRun(false);setError('Automatischer Zugwechsel fehlgeschlagen. Bitte mit Weiter bestätigen.');return;}
      }else if(interrupted){armedVisit.current=null;}
      const hits=cursor.current.accept(snapshot,latest.current.eligible);
      if(snapshot.length===0)setStatus("Board-Daten empfangen · Scheibe leer");
      else if(!latest.current.eligible)setStatus("Board-Daten empfangen · Aktuell keine Eingabe für dich");
      else setStatus("Board-Daten empfangen · "+snapshot.length+" Dart(s) erkannt");
      for(const dart of hits){
        if(currentGeneration!==generation.current)return;
        const visit={key:latest.current.visitKey,matchId:latest.current.matchId,playerId:latest.current.playerId};
        if(!await latest.current.onHit(dart.hit,dart.index)){setRun(false);generation.current++;setError('Automatische Eingabe pausiert. Bitte Spielstand prüfen und bei Bedarf manuell korrigieren.');break;}
        armedVisit.current=visit;
      }
    }).catch(()=>{setRun(false);setError('Eingabe pausiert. Bitte manuell prüfen.');});
  }
  useEffect(()=>{
    if(!run||!boardId||!tournamentId)return;
    let stopped=false,ws:WebSocket|null=null,timer:ReturnType<typeof setTimeout>|undefined,handshake:ReturnType<typeof setTimeout>|undefined,attempt=0,serial=0,lastRestart=0,wasHidden=document.visibilityState==='hidden';
    const reset=(preserveVisit=false)=>{setSocket(null);images.boardEmpty(false);generation.current++;cursor.current=new BoardCursor();stream.current=new BoardStream();if(!preserveVisit)armedVisit.current=null;};
    const clearTimers=()=>{if(timer)clearTimeout(timer);if(handshake)clearTimeout(handshake);};
    reset();setError('');diagnostic.current={socket:'connecting',received:0,opened:0,closeCode:null,cleanClose:null,bootstrapEmpty:false,boardMessages:0,lastDataAt:null};
    async function connect(){
      if(stopped)return;const version=++serial;const current=()=>!stopped&&version===serial;
      setStatus("Autodarts-Cloud wird verbunden …");diagnostic.current.socket='connecting';
      try{
        const d=await api({operation:'ticket',boardId});if(!current())return;
        const socket=new WebSocket(d.url);ws=socket;let messages=Promise.resolve();
        handshake=setTimeout(()=>{if(current()&&socket.readyState===WebSocket.CONNECTING){setError('Autodarts-Verbindung dauert zu lange. Bitte Netzwerk oder Inhaltsblocker prüfen.');socket.close();}},12000);
        socket.onopen=()=>{if(!current()){socket.close();return;}if(handshake)clearTimeout(handshake);setSocket(socket);attempt=0;setError('');diagnostic.current.socket='open';diagnostic.current.opened++;setStatus("Cloud verbunden · Warte auf Board-Daten. Scheibe bitte leeren.");if(d.boardEmpty===true)feed({channel:'autodarts.boards',topic:boardId+'.state',data:{numThrows:0}},boardId,true);for(const suffix of ['state','events'])socket.send(JSON.stringify({type:'subscribe',channel:'autodarts.boards',topic:boardId+'.'+suffix}));if(armedVisit.current&&!d.boardEmpty){const observed=diagnostic.current.boardMessages,visit=latest.current.visitKey;void api({operation:'state',boardId}).then(state=>{if(current()&&state.boardEmpty===true&&latest.current.visitKey===visit&&diagnostic.current.boardMessages===observed)feed({channel:'autodarts.boards',topic:boardId+'.state',data:{numThrows:0}},boardId,true);}).catch(()=>{});}};
        socket.onmessage=e=>{if(!current())return;diagnostic.current.received++;messages=messages.then(async()=>{const raw=await decodeAutodartsMessage(e.data);if(!current()||!raw||typeof raw!=='object')return;const m=raw as {type?:unknown;channel?:unknown;topic?:unknown};if(m.type==='error'){if(m.channel!=='autodarts.boards.images'&&!String(m.topic??'').includes('.live?'))setError('Autodarts hat ein Abonnement abgelehnt. Manuelle Eingabe bleibt möglich.');return;}feed(raw,boardId);}).catch(()=>{});};
        socket.onclose=(event)=>{if(!current())return;diagnostic.current.closeCode=event.code;diagnostic.current.cleanClose=event.wasClean;clearTimers();reset(true);diagnostic.current.socket='closed';setStatus("Cloud-Verbindung unterbrochen · Neuer Versuch …");timer=setTimeout(()=>void connect(),Math.min(30000,250*2**Math.min(attempt++,7)));};
        socket.onerror=()=>{if(current()){diagnostic.current.socket='error';setStatus("Cloud-Verbindung gestört · Manuelle Eingabe bleibt möglich");}};
      }catch(e){if(current()){setError(e instanceof Error?e.message:'Verbindung fehlgeschlagen.');diagnostic.current.socket='error';if(e instanceof AutodartsRequestError&&[400,401,403,404].includes(e.status)){setRun(false);setStatus('Manuelle Eingabe');}else{setStatus('Cloud-Verbindung unterbrochen · Neuer Versuch …');timer=setTimeout(()=>void connect(),Math.min(30000,1000*2**Math.min(attempt++,5)));}}}
    }
    const restart=()=>{if(stopped||Date.now()-lastRestart<250)return;lastRestart=Date.now();clearTimers();serial++;ws?.close();reset(true);void connect();};
    const visible=()=>{if(document.visibilityState==='hidden'){wasHidden=true;return;}if(wasHidden){wasHidden=false;restart();}};
    const pageshow=(e:PageTransitionEvent)=>{if(e.persisted){wasHidden=false;restart();}};
    const online=()=>{if(document.visibilityState!=='hidden')restart();};
    document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',pageshow);window.addEventListener('online',online);
    void connect();return()=>{stopped=true;serial++;generation.current++;clearTimers();ws?.close();document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',pageshow);window.removeEventListener('online',online);};
  // Score and player changes use refs; only reconnect on transport/lifecycle changes.
  },[run,boardId,connectionTick]);
  async function copyDiagnostic(){const text=JSON.stringify({version:1,...diagnostic.current,boardSelected:!!boardId,authenticated,linked,automatic:run,eligible:latest.current.eligible,online:navigator.onLine,visible:document.visibilityState,websocket:typeof WebSocket!=='undefined'},null,2);setDiagnosticText(text);try{await navigator.clipboard.writeText(text);}catch{}}

  async function login(e:React.FormEvent){e.preventDefault();setWorking(true);setError('');try{const d=await api({operation:'login',username,password,remember:canLink&&remember});setLinked(!!d.linked);setPassword('');setAuthenticated(true);setBoards(d.boards);if(d.boards.length&&!d.boards.some((b:Board)=>b.id===boardId))setBoardId(d.boards[0].id);setStatus("Bei Autodarts angemeldet · Scheibe auswählen");}catch(e){setError(e instanceof Error?e.message:'Anmeldung fehlgeschlagen.');}finally{setPassword('');setWorking(false);}}
  async function loadBoards(){setWorking(true);setError('');try{const d=await api({operation:'boards'});setBoards(d.boards);if(d.boards.length&&!d.boards.some((b:Board)=>b.id===boardId))setBoardId(d.boards[0].id);}catch(e){setAuthenticated(false);setError(e instanceof Error?e.message:'Bitte erneut anmelden.');}finally{setWorking(false);}}
  async function disconnect(){localStorage.setItem('autodarts-enabled:'+scope,'off');setRun(false);generation.current++;setWorking(true);try{await api({operation:'disconnect'});setAuthenticated(false);setLinked(false);setBoards([]);setStatus('Manuelle Eingabe');}catch(e){setError(e instanceof Error?e.message:'Abmelden fehlgeschlagen.');}finally{setWorking(false);}}
  async function toggleConnection(){
    setWorking(true);setError('');
    if(run){setRun(false);generation.current++;try{localStorage.setItem('autodarts-enabled:'+scope,'off');}catch{}setStatus('Manuelle Eingabe');}
    try{
      if(run){await api({operation:'pause'});}
      else{await api({operation:'connect',boardId});try{localStorage.setItem('autodarts-board:'+scope,boardId);localStorage.setItem('autodarts-enabled:'+scope,'on');}catch{}setRun(true);if(!tournamentId)setStatus("Scheibe mit deinem Zugang verknüpft");}
    }catch(e){setError(e instanceof Error?e.message:'Verbindung fehlgeschlagen.');}finally{setWorking(false);}
  }
  return <aside className="autodarts-panel">
    <button className="autodarts-heading" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}><strong>{translateUi("Deine Scheibe · Autodarts")} </strong><span>{translateUi(status)} {expanded?'−':'+'}</span></button>
    {expanded&&<div className="autodarts-body"><p>{translateUi(context==='dartdeck'?"Verbinde deine Scheibe. Die Würfe zählen für deinen aktiven Spieler; lokale Mitspieler können dieselbe Scheibe nutzen. Nach dem Herausziehen kann der Versuch automatisch bestätigt werden.":"Verbinde deine eigene Scheibe. Dein Gegner kann manuell spielen oder sein eigenes Board verbinden. Auch beim Ausbullen wird dein Treffer übernommen und beim Herausziehen bestätigt. Nach dem Herausziehen kann automatisch zum nächsten Spieler gewechselt werden. Trefferpunkte zeigen die von Autodarts gemessene Position.")}</p>
      {translateUi(error)&&<div className="notice error" role="alert">{translateUi(error)}</div>}
      {error&&!authenticated&&<button className="button ghost" disabled={working} onClick={()=>setRestoreTick(n=>n+1)}>{translateUi("Verbindung erneut prüfen")}</button>}
      {boardId&&<p className="muted">{translateUi("Ausgewählte Scheibe:")} <strong>{boards.find(b=>b.id===boardId)?.name??translateUi("Bitte auswählen")}</strong></p>}
      {linked&&<p className="muted">{translateUi("Mit deinem Zugang verknüpft. Deine Anmeldung und Scheibenauswahl bleiben für den nächsten Login erhalten. „Autodarts abmelden“ entfernt die Verknüpfung.")}</p>}
      {!authenticated?<form onSubmit={login}><label>{translateUi("Autodarts E-Mail")}<input type="email" autoComplete="username" required value={username} disabled={working} onChange={e=>setUsername(e.target.value)}/></label><label>{translateUi("Autodarts Passwort")}<PasswordInput visibilityLabel={translateUi("Autodarts Passwort")} autoComplete="current-password" required value={password} disabled={working} onChange={e=>setPassword(e.target.value)}/></label><label className="autodarts-auto-next"><input type="checkbox" checked={canLink&&remember} disabled={!canLink||working} onChange={e=>setRemember(e.target.checked)}/>  {translateUi("Autodarts mit meinem Zugang verknüpfen")}</label><button className="button primary" disabled={working}>{translateUi("Bei Autodarts anmelden")}</button><p className="muted">{translateUi("Das Passwort wird nur für die Anmeldung an Autodarts weitergeleitet und nicht gespeichert.")} </p></form>:<><div className="autodarts-controls">{run&&<button className="button ghost" disabled={working} onClick={()=>setConnectionTick(n=>n+1)}>{translateUi("Verbindung neu aufbauen")}</button>}<button className="button ghost" disabled={working||run} onClick={()=>void loadBoards()}>{translateUi("Meine Scheiben laden")}</button><button className="text-button" disabled={working} onClick={()=>void disconnect()}>{translateUi("Autodarts abmelden")}</button></div><label>{translateUi("Deine Autodarts-Scheibe")}<select aria-label={translateUi("Deine Autodarts-Scheibe")} value={boardId} disabled={run||working} onChange={e=>setBoardId(e.target.value)}><option value="">{translateUi("Bitte auswählen")}</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="button primary" disabled={!boardId||working} onClick={()=>void toggleConnection()}>{run?translateUi("Automatische Eingabe ausschalten"):translateUi("Meine Scheibe verbinden")}</button></>}
      <label className="autodarts-auto-next"><input type="checkbox" checked={autoNext} onChange={e=>{setAutoNext(e.target.checked);if(!e.target.checked)armedVisit.current=null;try{localStorage.setItem('autodarts-auto-next:'+scope,e.target.checked?'on':'off');}catch{}}}/>  {translateUi("Nach dem Herausziehen automatisch weiter")}</label>
      <><div className="camera-settings"><label><input type="checkbox" checked={images.enabled} onChange={e=>images.toggle(e.target.checked)}/>  {translateUi("Kamerabild für beide Spieler")}</label><label>{translateUi("Kamera")}<select aria-label={translateUi("Autodarts-Kamera")} value={images.cam} onChange={e=>images.camera(Number(e.target.value))}>{[0,1,2].map(c=><option key={c} value={c}>{translateUi("Kamera")} {c+1}</option>)}</select></label></div>
      {run&&images.enabled&&<p className="muted" role="status">{translateUi(images.status)}</p>}{images.enabled&&images.error&&<p className="camera-error" role="alert">{translateUi(images.error)}</p>}
      </>
      <button className="text-button" onClick={()=>void copyDiagnostic()}>{translateUi("Verbindungsdiagnose kopieren")}</button>{diagnosticText&&<textarea aria-label={translateUi("Verbindungsdiagnose")} readOnly rows={7} value={diagnosticText}/>}
      <p className="muted">{translateUi(context==='dartdeck'?"Erst „Board-Daten empfangen“ bestätigt die Verbindung zu deiner Scheibe. Nach einem Skip bitte steckende Darts herausziehen, bevor du die neue Karte versuchst.":"„Cloud verbunden“ bedeutet noch nicht, dass Treffer ankommen. Erst „Board-Daten empfangen“ bestätigt Daten deiner Scheibe. Das entzerrte Kamerabild wird während deines Zugs auch beim Gegner und bei Zuschauern angezeigt. Ohne verfügbares Bild bleibt die normale Scheibe sichtbar.")}</p>
    </div>}
  </aside>;
}

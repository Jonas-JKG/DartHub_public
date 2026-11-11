'use client';
import { useEffect, useRef, useState } from 'react';
import {decodeAutodartsMessage} from '../client/autodarts-transport';
import { boardImageMessage, boardImageTopic } from '../domain/board-image';
type Options={context?:'tournament'|'dartdeck';scope:string;playerId?:string;id:string;match:string;boardId:string;socket:WebSocket|null;live?:boolean;active:boolean;visit:string;api:(body:unknown)=>Promise<{url?:string}>};
export function useAutodartsImages(options:Options){
  const [enabled,setEnabled]=useState(true),[cam,setCam]=useState(0),[error,setError]=useState(''),[status,setStatus]=useState('Kamerabild noch nicht empfangen');
  const [knownEmpty,setKnownEmpty]=useState(false);
  const latest=useRef(options);latest.current=options;const enabledRef=useRef(enabled);enabledRef.current=enabled;
  const connection=useRef(''),pending=useRef<{url:string;visit:string;connection:string;actor?:string;empty:boolean}|null>(null),sending=useRef(false),frameGeneration=useRef(0),alive=useRef(true),emptyBoard=useRef(false),capturedFor=useRef('');
  useEffect(()=>{alive.current=true;try{setEnabled(localStorage.getItem('autodarts-image:'+options.scope)!=='off');const c=Number(localStorage.getItem('autodarts-camera:'+options.scope));if([0,1,2].includes(c))setCam(c);}catch{}return()=>{alive.current=false;};},[options.scope]);
  async function publish(operation:'frame'|'heartbeat'|'clear',visit:string,conn:string,url?:string,actor=latest.current.playerId,empty=false){
    const current=latest.current;
    const r=await fetch(current.context==='dartdeck'?'/api/dartdeck-image':'/api/game-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.id,match:current.match,operation,connection:conn,visit,url,actor,empty}),keepalive:operation==='clear'});
    const d=await r.json();if(!r.ok)throw Error(d.error??'Scheibenbild nicht verfügbar.');return d.accepted;
  }
  async function receive(url:string,visit:string,empty=false){
    if(!enabled||(!latest.current.active&&!empty)||!connection.current||latest.current.visit!==visit)return;
    pending.current={url,visit,connection:connection.current,actor:latest.current.playerId,empty};if(sending.current)return;sending.current=true;
    try{while(pending.current){const frame=pending.current;pending.current=null;const generation=frameGeneration.current;
      if(frame.connection!==connection.current||frame.visit!==latest.current.visit||(!latest.current.active&&!frame.empty))continue;
      try{const accepted=await publish('frame',frame.visit,frame.connection,frame.url,frame.actor,frame.empty);if(alive.current&&generation===frameGeneration.current&&accepted){setError('');setStatus('Kamerabild für beide Spieler verfügbar');}}
      catch(e){if(alive.current&&generation===frameGeneration.current){setError(e instanceof Error?e.message:'Kamerabild nicht verfügbar.');setStatus('Bildaktualisierung verzögert · Letztes Kamerabild bleibt sichtbar');}}
    }}finally{sending.current=false;}
  }
  const feed=useRef((raw:unknown)=>{});feed.current=(raw:unknown)=>{const url=boardImageMessage(raw,options.boardId,cam);if(url)void receive(url,latest.current.visit,emptyBoard.current);};
  useEffect(()=>{
    const ws=options.socket;if(!enabled||!ws||ws.readyState!==WebSocket.OPEN)return;
    const conn=crypto.randomUUID();connection.current=conn;frameGeneration.current++;setError('');setStatus('Warte auf entzerrtes Scheibenbild …');
    const topic=boardImageTopic(options.boardId,cam);
    ws.send(JSON.stringify({type:'subscribe',channel:'autodarts.boards.images',topic}));
    let messages=Promise.resolve();const listener=(e:MessageEvent)=>{messages=messages.then(async()=>{const raw=await decodeAutodartsMessage(e.data);if(alive.current&&connection.current===conn&&raw)feed.current(raw);}).catch(()=>{});};ws.addEventListener('message',listener);
    return()=>{
      frameGeneration.current++;connection.current='';pending.current=null;ws.removeEventListener('message',listener);
      if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'unsubscribe',channel:'autodarts.boards.images',topic}));
      if(ws.readyState!==WebSocket.OPEN&&alive.current&&enabledRef.current&&latest.current.live!==false){setStatus('Bildaktualisierung verzögert · Letztes Kamerabild bleibt sichtbar');return;}
      const players=latest.current.scope.split(':').at(-1);void publish('clear',latest.current.visit||'idle',conn,undefined,latest.current.playerId??players).catch(()=>{});
    };
  // Image events use refs; darts and turn updates must not reconnect this subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[options.socket,options.boardId,enabled,cam]);
  useEffect(()=>{
    if(!enabled||!options.socket||!knownEmpty||!options.visit)return;
    let stopped=false;const conn=connection.current,captureKey=conn+':'+(options.playerId??'');
    async function snapshot(){if(!conn||capturedFor.current===captureKey||!emptyBoard.current)return;capturedFor.current=captureKey;try{const d=await latest.current.api({operation:'image',boardId:options.boardId,cam});if(!stopped&&d.url&&connection.current===conn&&emptyBoard.current)await receive(d.url,latest.current.visit,true);}catch(e){if(!stopped){capturedFor.current='';setError(e instanceof Error?e.message:'Autodarts hat noch kein Scheibenbild geliefert.');}}finally{if((stopped||!emptyBoard.current)&&capturedFor.current===captureKey)capturedFor.current='';}}
    void snapshot();return()=>{stopped=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[options.socket,options.boardId,options.playerId,enabled,cam,knownEmpty,!!options.visit]);
  useEffect(()=>{
    if(!enabled||!options.socket||!options.visit||!options.active)return;
    const visit=options.visit,conn=connection.current;
    const timer=setInterval(()=>{if(connection.current===conn)void publish('heartbeat',visit,conn).catch(()=>{});},15000);
    return()=>clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[options.socket,options.active,options.visit,options.playerId,enabled,cam]);
  return {enabled,cam,error,status,boardEmpty:(value:boolean)=>{emptyBoard.current=value;setKnownEmpty(value);},toggle:(value:boolean)=>{setEnabled(value);try{localStorage.setItem('autodarts-image:'+options.scope,value?'on':'off');}catch{}},camera:(value:number)=>{setCam(value);try{localStorage.setItem('autodarts-camera:'+options.scope,String(value));}catch{}}};
}

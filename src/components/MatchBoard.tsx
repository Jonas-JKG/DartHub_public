'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import { useEffect, useState } from 'react';
import Dartboard from './Dartboard';
import type { Hit } from '../domain/scoring';
const phoneFrames=new Map<string,string>();
const emptyFrames=new Map<string,string>();
export default function MatchBoard({id,match,player,name,visit,hits,enabled,onHit,bull,keyboard,context='tournament'}:{context?:'tournament'|'dartdeck';id:string;match:string;player:string;name:string;visit:string;hits:{hit:Hit;label:string;color?:string}[];enabled:boolean;onHit:(hit:Hit)=>void;bull:boolean;keyboard:boolean}) {useLanguage();
  const boardKey=context+':'+id+':'+match+':'+player,key=boardKey+':'+visit;
  const [frame,setFrame]=useState<{key:string;image:string|null}>({key:'',image:null}),[failed,setFailed]=useState('');
  useEffect(()=>{
    let stopped=false,busy=false,etag='';const controller=new AbortController();
    async function refresh(){
      if(busy||stopped)return;busy=true;
      try{
        const params=new URLSearchParams({id,match,player,visit});
        const r=await fetch((context==='dartdeck'?'/api/dartdeck-image?':'/api/game-image?')+params,{headers:etag?{'If-None-Match':etag}:{},cache:'no-store',signal:controller.signal});
        if(stopped)return;
        if(r.status!==304){
          if(!r.ok){etag='';if([401,403,404].includes(r.status)){emptyFrames.delete(boardKey);phoneFrames.delete(boardKey);setFrame({key,image:null});}return;}
          const d=await r.json();if(d.pending){etag='';return;}
          const image=typeof d.image==='string'?d.image:null;
          // Decode off-screen before swapping the visible SVG image.
          if(image){const next=new Image();next.src=image;await next.decode();if(stopped)return;}
          etag=r.headers.get('etag')??'';
          if(image&&(d.empty||d.cached)){emptyFrames.set(boardKey,image);if(emptyFrames.size>20)emptyFrames.delete(emptyFrames.keys().next().value!);}else if(!image)emptyFrames.delete(boardKey);
          if(image&&d.source==='phone'){phoneFrames.set(boardKey,image);if(phoneFrames.size>20)phoneFrames.delete(phoneFrames.keys().next().value!);}else if(!image)phoneFrames.delete(boardKey);
          setFrame({key,image});
        }
      }catch{if(!stopped)etag='';}finally{busy=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),400);
    return()=>{stopped=true;controller.abort();clearInterval(timer);};
  },[id,match,player,visit,key,boardKey]);
  const candidate=frame.key===key?frame.image:phoneFrames.get(boardKey)??emptyFrames.get(boardKey)??null;
  const image=candidate!==failed?candidate:null;
  return <><div className={'board-area '+(keyboard?'force-keyboard':image?'has-camera':'show-board')}>
    <Dartboard hits={hits} enabled={enabled} onHit={onHit} bull={bull} image={image} onImageError={()=>setFailed(image??'')}/>
  </div>{image&&!keyboard&&<div className="camera-caption" role="status"><i/>{translateUi("Scheibe von")} {name}  {translateUi("· Bild nach jedem Wurf")}</div>}</>;
}

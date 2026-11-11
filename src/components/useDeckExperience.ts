'use client';
import {useEffect,useRef,useState} from 'react';
import {DeckEffectsAudio,DeckEffectTracker} from '../client/dartdeck-effects';
import {CallerAudio} from '../client/caller-audio';
import type {PublicDeckGame} from '../domain/dartdeck';
export default function useDeckExperience(game:PublicDeckGame|null|undefined){
 const audio=useRef<DeckEffectsAudio|null>(null),tracker=useRef(new DeckEffectTracker()),attempted=useRef(''),music=useRef<CallerAudio|null>(null),animationTimer=useRef<ReturnType<typeof setTimeout>|null>(null),gameId=useRef('');
 const [sounds,setSounds]=useState(true),[volume,setVolume]=useState(.25),[fullscreenNeeded,setFullscreenNeeded]=useState(false);
 const [celebration,setCelebration]=useState<{type:'skip'|'finish';key:string}|null>(null);
 function dismiss(){setCelebration(null);music.current?.stopMusic();if(animationTimer.current)clearTimeout(animationTimer.current);}
 const current=useRef(game);current.current=game;
 function fullscreen(){
  if(document.fullscreenElement){setFullscreenNeeded(false);return;}
  if(!document.documentElement.requestFullscreen)return;
  try{void document.documentElement.requestFullscreen().then(()=>setFullscreenNeeded(false),()=>setFullscreenNeeded(true));}catch{setFullscreenNeeded(true);}
 }
 function autoFullscreen(){try{if(localStorage.getItem('match-fullscreen')==='off'){setFullscreenNeeded(false);return;}}catch{}fullscreen();}
 useEffect(()=>{
  const player=new DeckEffectsAudio();audio.current=player;
  // Reuse Safari-safe music playback only. No voice clips are ever enqueued.
  const song=new CallerAudio(new Audio(),new Audio(),()=>{});music.current=song;
  try{setSounds(localStorage.getItem('dartdeck-sounds')!=='off');const saved=Number(localStorage.getItem('dartdeck-volume')??'.25');if(Number.isFinite(saved))setVolume(Math.max(0,Math.min(1,saved)));}catch{}
  const unlock=()=>{player.unlock();song.unlock();};window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);
  return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);player.dispose();song.dispose();music.current=null;audio.current=null;if(animationTimer.current)clearTimeout(animationTimer.current);};
 },[]);
 useEffect(()=>{audio.current?.volume(volume);music.current?.volume(0,volume);if(!sounds||!volume){audio.current?.stop();music.current?.stopMusic();}try{localStorage.setItem('dartdeck-sounds',sounds?'on':'off');localStorage.setItem('dartdeck-volume',String(volume));}catch{}},[sounds,volume]);
 useEffect(()=>{
  if(!game){gameId.current='';dismiss();return;}
  if(gameId.current!==game.id){gameId.current=game.id;dismiss();}
  const effects=tracker.current.update(game);
  for(const effect of effects){
   if(sounds)audio.current?.play(effect);
   if(effect==='skip'||effect==='finish'){
    if(animationTimer.current)clearTimeout(animationTimer.current);
    setCelebration({type:effect,key:game.id+':'+game.draw+':'+game.phase});
    if(effect==='finish'&&sounds&&volume>0)music.current?.startMusic('/audio/effects/match-win.mp3');
    animationTimer.current=setTimeout(dismiss,effect==='finish'?25000:1800);
   }
  }
 },[game,sounds]);
 useEffect(()=>{
  if(!game||game.phase!=='playing'||attempted.current===game.id)return;attempted.current=game.id;autoFullscreen();
 },[game?.id,game?.phase]);
 useEffect(()=>{const changed=()=>{if(document.fullscreenElement)setFullscreenNeeded(false);};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
 useEffect(()=>{
  const retry=()=>{if(!current.current||current.current.phase!=='playing'||document.fullscreenElement)return;fullscreen();};
  // Safari and other browsers require a gesture after an asynchronous room update.
  if(!fullscreenNeeded)return;window.addEventListener('pointerdown',retry,{once:true});window.addEventListener('keydown',retry,{once:true});
  return()=>{window.removeEventListener('pointerdown',retry);window.removeEventListener('keydown',retry);};
 },[fullscreenNeeded]);
 return {celebration,dismiss,sounds,setSounds,volume,setVolume,fullscreenNeeded,fullscreen,prepare:()=>{audio.current?.unlock();music.current?.unlock();autoFullscreen();}};
}

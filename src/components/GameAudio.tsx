'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import { useEffect,useRef,useState } from 'react';
import { CallerTracker,callClips } from '../domain/caller';
import { callerPackEnabled,walkOnSongs } from '../domain/audio-assets';
import { CallerAudio } from '../client/caller-audio';
import {SoundEffectTracker} from '../domain/sound-effects';
import {SoundEffectsAudio} from '../client/sound-effects';
import {gameView,type Game} from '../domain/scoring';
export default function GameAudio({game,configure=false,victoryDismissed}:{game:Game|null;configure?:boolean;victoryDismissed?:string}){useLanguage();
  const voice=useRef<HTMLAudioElement>(null),music=useRef<HTMLAudioElement>(null),engine=useRef<CallerAudio|null>(null),tracker=useRef(new CallerTracker()),walkStarted=useRef(false);
  const effects=useRef<SoundEffectsAudio|null>(null),effectTracker=useRef(new SoundEffectTracker()),previousEffectGame=useRef<Game|null>(null);
  const [effectsEnabled,setEffectsEnabled]=useState(true),[effectsVolume,setEffectsVolume]=useState(.65);
  const [ready,setReady]=useState(false);
  const [walkEnabled,setWalkEnabled]=useState(true);
  const [enabled,setEnabled]=useState(true),[musicPlaying,setMusicPlaying]=useState(false),[song,setSong]=useState(''),[callerVolume,setCallerVolume]=useState(1),[musicVolume,setMusicVolume]=useState(.2),[error,setError]=useState(''),[lastCall,setLastCall]=useState('');
  useEffect(()=>{
    const audio=new CallerAudio(voice.current!,music.current!,setError,setMusicPlaying);engine.current=audio;
    const fx=new SoundEffectsAudio(()=>setError('Bitte einmal Audio erneut freigeben, um die Soundeffekte zu hören.'));effects.current=fx;
    // Safari grants touch activation at touchend/click, after pointerdown.
    const gestures=['pointerdown','pointerup','touchend','click','keydown'] as const,unlock=(event:Event)=>{fx.unlock();if(!(event.target instanceof Element)||!event.target.closest('[data-walk-on-control]'))audio.unlock();};for(const event of gestures)document.addEventListener(event,unlock,true);
    try{setEffectsEnabled(localStorage.getItem('effects-enabled')!=='off');const e=Number(localStorage.getItem('effects-volume')??'.65');if(Number.isFinite(e)&&e>=0&&e<=1)setEffectsVolume(e);setEnabled(localStorage.getItem('caller-enabled')!=='off');setWalkEnabled(localStorage.getItem('walk-on-enabled')!=='off');const c=Number(localStorage.getItem('caller-volume')??'1'),m=Number(localStorage.getItem('walk-on-volume')??'.2');if(Number.isFinite(c)&&c>=0&&c<=1)setCallerVolume(c);if(Number.isFinite(m)&&m>=0&&m<=1)setMusicVolume(m);}catch{}
    setReady(true);
    return()=>{for(const event of gestures)document.removeEventListener(event,unlock,true);walkStarted.current=false;audio.dispose();fx.dispose();engine.current=null;effects.current=null;};
  },[]);
  useEffect(()=>{engine.current?.volume(callerVolume,musicVolume);},[callerVolume,musicVolume]);
  useEffect(()=>{effects.current?.volume(effectsVolume);},[effectsVolume]);
  // Start the chime before handling the voice queue, with no caller delay.
  useEffect(()=>{if(!ready||!game)return;const old=previousEffectGame.current;if(old?.phase==='playing'&&gameView(old).current.checkout&&game.turns.length<=old.turns.length&&!gameView(game).current.checkout)effects.current?.stopVictory();previousEffectGame.current=game;const events=effectTracker.current.update(game);if(effectsEnabled)for(const effect of events)effects.current?.play(effect);},[game,ready,effectsEnabled]);
  useEffect(()=>{
    if(!ready)return;
    if(!enabled||!callerPackEnabled){tracker.current=new CallerTracker();return;}
    if(!game)return;
    for(const call of tracker.current.update(game)){setLastCall(call.type==='require'?'You require '+call.value:call.type==='gameon'?'Game on':String(call.value));engine.current?.enqueue(callClips(call));}
  },[game,enabled,ready]);
  useEffect(()=>{if(victoryDismissed)effects.current?.stopVictory();},[victoryDismissed]);
  function startWalkOn(){const file=walkOnSongs[Math.floor(Math.random()*walkOnSongs.length)];setError('');setSong(file.replace('.mp3','').split('-').map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' '));walkStarted.current=true;engine.current?.startMusic('/audio/walk-on/'+file);}
  useEffect(()=>{if(ready&&!configure&&walkEnabled&&game?.phase==='bull'&&!walkStarted.current)startWalkOn();},[ready,configure,walkEnabled,game?.phase]);
  function activate(){setError('');engine.current?.unlock();setEnabled(true);try{localStorage.setItem('caller-enabled','on');}catch{}if(!configure&&walkEnabled&&!walkStarted.current&&(!game||game.turns.length===0&&game.current.length===0))startWalkOn();}
  return <section className="game-audio" aria-label={translateUi("Caller und Walk-on")}>
    <audio ref={voice} preload="none" data-audio-channel="caller"/><audio ref={music} preload="none" data-audio-channel="music" onEnded={()=>setMusicPlaying(false)} onError={()=>setMusicPlaying(false)}/>
    <div className="game-audio-main"><div><strong>{translateUi("Caller, Effekte & Walk-on")}</strong><span>{!callerPackEnabled?translateUi("Caller-Paket nicht installiert"):enabled?lastCall||translateUi("Caller bereit"):translateUi("Ton auf diesem Gerät aktivieren")}{musicPlaying?' · '+song:''}</span></div><div className="game-audio-buttons"><button disabled={!callerPackEnabled} className={enabled?'button ghost':'button primary'} onClick={()=>{if(enabled){engine.current?.stopVoice();setEnabled(false);try{localStorage.setItem('caller-enabled','off');}catch{}setLastCall('');}else activate();}}>{enabled?translateUi("Caller ausschalten"):walkStarted.current?translateUi("Caller einschalten"):translateUi("Ton aktivieren")}</button><button data-walk-on-control className="button ghost" onClick={()=>{if(musicPlaying){engine.current?.stopMusic();setMusicPlaying(false);}else startWalkOn();}}>{musicPlaying?translateUi("Walk-on stoppen"):translateUi("Walk-on starten")}</button></div></div>
    <label className="preference-check"><input type="checkbox" checked={effectsEnabled} onChange={e=>{setEffectsEnabled(e.target.checked);localStorage.setItem('effects-enabled',e.target.checked?'on':'off');if(!e.target.checked)effects.current?.stop();else effects.current?.unlock();}}/>  {translateUi("Treffer- und Siegessounds")}</label>
    <label className="preference-check"><input type="checkbox" checked={walkEnabled} onChange={e=>{setWalkEnabled(e.target.checked);localStorage.setItem('walk-on-enabled',e.target.checked?'on':'off');if(!e.target.checked){walkStarted.current=false;engine.current?.stopMusic();setMusicPlaying(false);}else if(!configure&&game?.phase==='bull')startWalkOn();}}/>  {translateUi("Walk-on beim Ausbullen automatisch starten")}</label><div className="game-audio-volumes"><label>Caller <input aria-label={translateUi("Caller Lautstärke")} type="range" min="0" max="1" step=".05" disabled={!callerPackEnabled} value={callerVolume} onChange={e=>{const v=Number(e.target.value);setCallerVolume(v);try{localStorage.setItem('caller-volume',String(v));}catch{}}}/></label><label>Walk-on <input aria-label={translateUi("Walk-on Lautstärke")} type="range" min="0" max="1" step=".05" value={musicVolume} onChange={e=>{const v=Number(e.target.value);setMusicVolume(v);try{localStorage.setItem('walk-on-volume',String(v));}catch{}}}/></label><label>{translateUi("Effekte")} <input aria-label={translateUi("Soundeffekte Lautstärke")} type="range" min="0" max="1" step=".05" value={effectsVolume} onChange={e=>{const v=Number(e.target.value);setEffectsVolume(v);localStorage.setItem('effects-volume',String(v));}}/></label><span>{translateUi("Walk-on zufällig · Musik, Effekte und Ansagen unabhängig")}</span></div>
    {translateUi(error)&&<p className="audio-error" role="alert">{translateUi(error)} <button className="text-button" onClick={()=>{setError('');engine.current?.unlock();effects.current?.unlock();}}>{translateUi("Audio erneut freigeben")}</button></p>}
  </section>;
}

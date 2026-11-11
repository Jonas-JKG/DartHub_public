'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import MatchBoard from './MatchBoard';
import {FullscreenButton} from './DevicePreferences';
import AutodartsPanel from './AutodartsPanel';
import ScoringSource from './ScoringSource';
import {autodartsSlot} from '../domain/autodarts';
import GameAudio from './GameAudio';
import GameSettings from './GameSettings';
import DeviceAccounts from './DeviceAccounts';
import {victoryDuration} from '../domain/sound-effects';
import { boardHit, recommendation, defaultRules, gameView, practiceView, hitLabel, hitDistanceMm, keypadHit, points, type Game, type GameAction, type Hit } from '../domain/scoring';
import type { Match, Tournament } from '../domain/tournament';
type Data={sharedDevice?:boolean;ownerSupport?:boolean;canReset?:boolean;tournament:Tournament;match:Match;game:Game|null;session:{role:string;participantId:string|null;participantIds?:string[];tournamentId:string|null}|null};
export default function GameScreen({id,matchId,returnTo}:{id:string;matchId:string;returnTo?:string}) {useLanguage();
  const router=useRouter(),[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[networkError,setNetworkError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<number|null>(null),[multiplier,setMultiplier]=useState<1|2|3>(1),[keyboard,setKeyboard]=useState(false),[distance,setDistance]=useState('30'),[connection,setConnection]=useState('Verbindung wird hergestellt');
  const [celebration,setCelebration]=useState<{key:string;player:string;playerId:string;leg:number;legs:number[];match:boolean}|null>(null),celebrated=useRef(new Set<string>()),celebrationReady=useRef(false);
  const [dismissedVictory,setDismissedVictory]=useState('');
  const finishCelebration=useRef<(player:string)=>Promise<void>>(async()=>{});
  const backHref=returnTo??`/tournaments/${id}`;
  const [controlled,setControlled]=useState<string[]|null>(null),[bullActor,setBullActor]=useState<string|null>(null);
  const [bullCamera,setBullCamera]=useState<string|null>(null);
  const lastConflict=useRef(false),writing=useRef(false),latestGame=useRef<Game|null>(null);
  useEffect(()=>{const preference=()=>{let saved:string|null=null;try{saved=localStorage.getItem('match-input-mode');}catch{}setKeyboard(saved?saved==='keyboard':window.matchMedia('(max-width:760px)').matches);};preference();window.addEventListener('dartbracket-preferences',preference);try{if(localStorage.getItem('match-fullscreen')!=='off'&&!document.fullscreenElement)void document.documentElement.requestFullscreen().catch(()=>{});}catch{}return()=>{window.removeEventListener('dartbracket-preferences',preference);};},[]);
  const everStarted=useRef(false),previousTurn=useRef(''),requestSerial=useRef(0);
  const refreshInFlight=useRef<Promise<void>|null>(null),refreshAbort=useRef<AbortController|null>(null);
  const refresh=useCallback(()=>{
    if(refreshInFlight.current)return refreshInFlight.current;
    const controller=new AbortController();refreshAbort.current=controller;
    const task=(async()=>{
    const serial=++requestSerial.current,timer=setTimeout(()=>controller.abort(),12000);
    try {
      const r=await fetch(`/api/game?id=${id}&match=${encodeURIComponent(matchId)}`,{cache:'no-store',signal:controller.signal}),d=await r.json();
      if(serial!==requestSerial.current)return;
      if(d.redirect){router.replace(d.redirect);return;}if(d.error)throw Error(d.error);
      if(everStarted.current&&!d.game){router.replace(backHref);return;}
      if(d.game){everStarted.current=true;if(!latestGame.current||d.game.version>=latestGame.current.version)latestGame.current=d.game;}
      setData(old=>{if(old?.game&&d.game&&old.game.version>d.game.version)return {...old,session:d.session};if(old&&old.game?.version===d.game?.version&&old.tournament.version===d.tournament.version&&old.match.status===d.match.status&&JSON.stringify(old.session)===JSON.stringify(d.session)&&old.ownerSupport===d.ownerSupport&&old.canReset===d.canReset)return old;return d;});setNetworkError('');
    }catch(e){if(serial===requestSerial.current)setNetworkError(controller.signal.aborted?'Der Match-Abruf dauert zu lange. Bitte Verbindung prüfen oder erneut versuchen.':e instanceof Error?e.message:'Verbindung unterbrochen.');}
    finally{clearTimeout(timer);}
    })();
    refreshInFlight.current=task;void task.finally(()=>{if(refreshInFlight.current===task){refreshInFlight.current=null;refreshAbort.current=null;}});return task;
  },[id,matchId,router]);
  useEffect(()=>{
    void refresh();const poll=setInterval(()=>void refresh(),600);
    const focus=()=>void refresh();window.addEventListener('online',focus);window.addEventListener('focus',focus);window.addEventListener('dartbracket-device-accounts',focus);
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    let cleanup=()=>{};
    if(url&&key){
      const db=createClient(url,key,{auth:{persistSession:false}});
      const c=db.channel(`game-${id}-${matchId}`).on('postgres_changes',{event:'*',schema:'public',table:'match_games',filter:`tournament_id=eq.${id}`},()=>void refresh()).subscribe(state=>setConnection(state==='SUBSCRIBED'?'Live verbunden':'Live-Abgleich aktiv'));
      cleanup=()=>{void db.removeChannel(c);};
    }
    return ()=>{requestSerial.current++;refreshAbort.current?.abort();refreshInFlight.current=null;clearInterval(poll);cleanup();window.removeEventListener('online',focus);window.removeEventListener('focus',focus);window.removeEventListener('dartbracket-device-accounts',focus);};
  },[refresh,id,matchId]);
  const g=data?.game,view=useMemo(()=>g?gameView(g):null,[g]),primary=data?.session&&['editor','owner'].includes(data.session.role)&&data.session.tournamentId===id?data.session.participantId:null;
  const available=(data?.session?.participantIds??(primary?[primary]:[])).filter(p=>!!primary&&data?.match.players.includes(p)&&(!g?.solo||g.players[g.starter??0]===p));
  const control=(controlled??(available.length<=1||g?.sharedDevice||data?.sharedDevice?available:[])).filter(p=>available.includes(p));
  useEffect(()=>{
    if(!data?.session||!['owner','editor'].includes(data.session.role))return;
    const presence=()=>{const players=control;void fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,match:matchId,operation:'presence',expectedVersion:0,players})}).catch(()=>{});};
    presence();const timer=setInterval(presence,4000);document.addEventListener('visibilitychange',presence);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',presence);};
  },[id,matchId,JSON.stringify(control),data?.session?.role,data?.ownerSupport]);
  useEffect(()=>()=>{void fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,match:matchId,operation:'presence',expectedVersion:0,players:[]}),keepalive:true}).catch(()=>{});},[id,matchId]);
  const myId=g?.phase==='playing'&&view&&control.includes(g.players[view.active])?g.players[view.active]:g?.phase==='bull'?(bullActor&&control.includes(bullActor)&&!g.bullConfirmed?.[g.players.indexOf(bullActor)]?bullActor:control.find(p=>!g.bullConfirmed?.[g.players.indexOf(p)])??control[0]):control[0]??null;
  if(!latestGame.current||g&&g.version>=latestGame.current.version)latestGame.current=g??null;
  const isParticipant=control.length>0,canThrow=!!g&&!!view&&!!myId&&(g.phase==='bull'?!g.bullConfirmed?.[g.players.indexOf(myId)]:g.players[view.active]===myId);
  const win=g&&view&&g.phase!=='bull'?(view.current.checkout?{player:view.active,leg:view.leg,turnCount:g.turns.length+1}:view.lastLegWin):null;
  const winKey=win?win.leg+':'+win.player+':'+win.turnCount:'';
  useEffect(()=>{
    if(!g||!view)return;
    if(!celebrationReady.current){celebrationReady.current=true;if(win&&!view.current.checkout){celebrated.current.add(winKey);return;}}
    if(celebration&&celebration.key!==winKey)setCelebration(null);
    if(!win||celebrated.current.has(winKey))return;
    celebrated.current.add(winKey);
    const legs:number[]=[...view.legs];if(view.current.checkout)legs[win.player]++;
    setCelebration({key:winKey,playerId:g.players[win.player],player:data?.tournament.participants.find(p=>p.id===g.players[win.player])?.name??translateUi("Spieler"),leg:win.leg,legs,match:legs[win.player]>=g.rules.legsToWin});
  },[winKey,g,view,data,win,celebration]);
  useEffect(()=>{if(!celebration)return;const timer=setTimeout(()=>{void finishCelebration.current(celebration.playerId);},celebration.match?victoryDuration.match:victoryDuration.leg);return()=>clearTimeout(timer);},[celebration]);
  const turnKey=g?`${g.phase}:${g.turns.length}:${view?.active}:${g.bullRound}`:'';
  useEffect(()=>{if(previousTurn.current!==turnKey){setSelected(null);setMultiplier(1);previousTurn.current=turnKey;}},[turnKey]);
  useEffect(()=>{if(g?.phase!=='finished'&&data?.match.status!=='finished')return;if((celebration?.match&&dismissedVictory!==celebration.key)||(win&&!celebrated.current.has(winKey)))return;router.replace(backHref);},[g?.phase,data?.match.status,id,router,celebration,winKey,win,dismissedVictory]);
  async function send(operation:'join'|'action'|'reset',action?:GameAction,actingPlayer?:string) {
    if(writing.current)return false;writing.current=true;lastConflict.current=false;setBusy(true);setError('');
    try {
      const r=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,match:matchId,operation,expectedVersion:latestGame.current?.version??0,actor:actingPlayer??myId??undefined,action,confirmed:operation==='reset'})}),d=await r.json();
      if(d.error){if(d.conflict){lastConflict.current=true;await refresh();}else if(action?.type==='next'){requestSerial.current++;refreshAbort.current?.abort();refreshInFlight.current=null;await refresh();if(latestGame.current?.phase==='finished'){setError('');setCelebration(null);router.replace(backHref);return true;}}throw Error(d.error);}
      requestSerial.current++;
      if(d.reset){router.replace(backHref);return;}
      if(d.game){latestGame.current=d.game;everStarted.current=true;setData(old=>old?{...old,game:d.game}:old);if(action?.type==='next'&&d.game.phase==='bull'){const next=d.game.players.find((p:string)=>control.includes(p)&&!d.game.bullConfirmed?.[d.game.players.indexOf(p)])??null;setBullActor(next);setBullCamera(next);}}
      if(action?.type==='next'&&d.game?.phase==='finished'){setCelebration(null);router.replace(backHref);return true;}
      setSelected(null);void refresh();return true;
    }catch(e){setError(e instanceof Error?e.message:'Speichern fehlgeschlagen.');return false;}finally{writing.current=false;setBusy(false);}
  }
  finishCelebration.current=async player=>{
    const victory=celebration;if(!victory||writing.current)return;
    if(!control.includes(player)){setDismissedVictory(victory.key);setCelebration(null);return;}
    for(let attempt=0;attempt<2;attempt++){
      const current=latestGame.current;if(!current)return;
      const state=gameView(current);
      if(current.phase==='playing'&&state.current.checkout&&current.players[state.active]===player){
        if(!await send('action',{type:'next'},player)){if(lastConflict.current)continue;return;}
      }
      const saved=latestGame.current,win=saved?gameView(saved).lastLegWin:null;
      const confirmed=!!saved&&(victory.match?saved.phase==='finished':!!win&&`${win.leg}:${win.player}:${win.turnCount}`===victory.key);
      if(!confirmed){setError('Das Ergebnis wurde noch nicht gespeichert. Bitte erneut bestätigen.');return;}
      setError('');setDismissedVictory(victory.key);setCelebration(null);
      if(saved.phase==='finished')router.replace(backHref);
      return;
    }
  };
  async function sendAs(player:string,action:GameAction){setBullActor(player);setBullCamera(player);return send('action',action,player);}
  function add(h:Hit) {
    if(!canThrow||busy)return;
    void send('action',g?.phase==='bull'?{type:'bull',hit:h}:{type:'dart',hit:h,...(selected!==null?{index:selected}:{})});
  }
  async function automaticHit(hit:Hit,index:number):Promise<boolean> {
    const current=latestGame.current;
    if(!current||!myId||!current.players.includes(myId))return false;
    if(current.phase==='bull'){
      const own=current.players.indexOf(myId);
      if(autodartsSlot(index,0)===null||current.bull[own]||current.bullConfirmed?.[own])return true;
      if(!hit.position)return false;
      if(await send('action',{type:'bull',hit}))return true;
      if(!lastConflict.current)return false;
      const fresh=latestGame.current;
      if(!fresh||fresh.phase!=='bull'||fresh.bullRound!==current.bullRound||fresh.bull[own]||fresh.bullConfirmed?.[own])return true;
      return !!await send('action',{type:'bull',hit});
    }
    if(current.phase!=='playing'||current.players[gameView(current).active]!==myId)return false;
    if(autodartsSlot(index,current.current.length)===null)return true;
    const state=gameView(current);if(state.current.bust||state.current.checkout||current.practice&&practiceView(current).turnComplete||current.current.length===3)return true;
    return !!await send('action',{type:'dart',hit});
  }
  async function automaticNext(visitKey:string):Promise<boolean> {
    const current=latestGame.current;
    if(!current||!myId)return true;
    if(current.phase==='bull'){const own=current.players.indexOf(myId);if(current.phase+':'+current.bullRound!==visitKey||own<0||!current.bull[own]||current.bullConfirmed?.[own])return true;if(await send('action',{type:'next'}))return true;const fresh=latestGame.current;if(!lastConflict.current||!fresh||fresh.phase!==current.phase||fresh.bullRound!==current.bullRound||fresh.bullConfirmed?.[own])return !lastConflict.current?false:true;return !!await send('action',{type:'next'});}
    if(current.phase!=='playing'||current.players[gameView(current).active]!==myId||current.phase+':'+current.turns.length!==visitKey||!current.current.length)return true;
    // A winning visit stays pending until the result/Next Leg is confirmed.
    if(gameView(current).current.checkout)return true;
    return !!await send('action',{type:'next'});
  }
  const adviceForTurn=useMemo(()=>g&&!g.practice&&view&&g.phase==='playing'&&!view.current.bust&&!view.current.checkout&&g.current.length<3?recommendation(view.remaining[view.active],g.rules.out,3-g.current.length):null,[g,view]);
  if(!data)return <main className="game-shell"><Link href={backHref} className="back">{translateUi("← Zum Turnier")}</Link><h1>{translateUi("Match wird geladen …")}</h1>{(translateUi(error)||translateUi(networkError))&&<div className="notice error" role="alert">{translateUi(error||networkError)}<button className="button ghost" onClick={()=>{requestSerial.current++;refreshAbort.current?.abort();refreshInFlight.current=null;void refresh();}}>{translateUi("Erneut versuchen")}</button></div>}</main>;
  const clock=g?.practice?practiceView(g):null;
  const practiceName=g?.practice==='segments'?translateUi('Segmenttraining'):g?.practice==='checkout'?translateUi('Zufälliges Checkout'):'Around the Clock';
  const label=(hit:Hit)=>hit.number===0?'Miss':hitLabel(hit);
  const name=(player:string|null)=>data.tournament.participants.find(p=>p.id===player)?.name??translateUi("Noch offen"),rules=g?.rules??data.tournament.scoring??defaultRules;
  const editable=canThrow&&!busy&&!networkError&&(!celebration||dismissedVictory===celebration.key);
  const ended=!!view&&(!!clock?.turnComplete||view.current.bust||view.current.checkout||g!.current.length===3),advice=adviceForTurn,route=advice?.route??[];
  const markers=g?.phase==='bull'?g.bull.flatMap((h,i)=>h?[{hit:h,label:i===0?'A':'B',color:i===0?'#4fe0a0':'#ffc45b'}]:[]):g?.current.map((hit,i)=>({hit,label:String(i+1)}))??[];
  const settingsPanel=(<GameSettings toolbar>
    {data?.session&&['owner','editor'].includes(data.session.role)&&<DeviceAccounts/>}
    <GameAudio key={id+':'+matchId} game={g??null} victoryDismissed={dismissedVictory}/>
    {!!primary&&available.length>0&&<ScoringSource scope={id+':'+primary} id={id} match={matchId} player={myId??primary} visit={g?g.phase+':'+(g.phase==='bull'?g.bullRound:g.turns.length):''} eligible={!!g&&canThrow&&!networkError&&(g.phase==='bull'?!g.bull[g.players.indexOf(myId!)]:g.phase==='playing'&&!view?.current.bust&&!view?.current.checkout&&(!g.practice||!practiceView(g).turnComplete)&&g.current.length<3)} active={!!g&&(g.phase==='bull'||g.phase==='playing')} onHit={automaticHit} onTakeout={automaticNext}><AutodartsPanel key={id+':'+primary} scope={id+':'+primary} playerId={myId??primary} tournamentId={id} matchId={matchId} imageActive={!!g&&!!myId&&(g.phase==='bull'||g.phase==='playing'&&g.players[view!.active]===myId)} eligible={!!g&&canThrow&&!translateUi(networkError)&&(g.phase==='bull'?!g.bull[g.players.indexOf(myId!)]:g.phase==='playing'&&!view?.current.bust&&!view?.current.checkout&&(!g.practice||!practiceView(g).turnComplete)&&g.current.length<3)} visitKey={g?g.phase+':'+(g.phase==='bull'?g.bullRound:g.turns.length):''} onHit={automaticHit} onTakeout={automaticNext}/></ScoringSource>}
    {(data.canReset??data.session?.role==='owner')&&<button className="text-button" onClick={()=>{if(window.confirm(translateUi("Dieses Spiel auf den Stand vor dem Ausbullen zurücksetzen? Die eingegebenen Darts werden entfernt.")))void send('reset');}}>{translateUi("Spiel zurücksetzen")}</button>}
    </GameSettings>);
  return <div className="game-shell">
    {celebration&&dismissedVictory!==celebration.key&&<div className={'leg-celebration '+(celebration.match?'match-celebration':'small-leg-celebration')} role="status" aria-live="polite"><div className="celebration-card"><button type="button" className="celebration-close" aria-label={translateUi("Siegesanzeige schließen")} disabled={busy} onClick={()=>void finishCelebration.current(celebration.playerId)}>×</button>{error&&<p className="notice error" role="alert">{translateUi(error)}</p>}<span className="celebration-aura" aria-hidden="true"/><span className="celebration-star" aria-hidden="true">★</span><div className="eyebrow">{celebration.match?translateUi(clock?"TRAINING ABGESCHLOSSEN":"MATCH GEWONNEN"):translateUi("LEG {0} GEWONNEN",celebration.leg)}</div><strong>{celebration.player}</strong><span className="celebration-score">{clock?clock.darts:celebration.legs[g?.solo?(g.starter??0):0]}{clock?' Darts':!g?.solo&&<> <i>:</i> {celebration.legs[1]}</>}</span><span className="celebration-progress" aria-hidden="true"><span style={{animationDuration:(celebration.match?victoryDuration.match:victoryDuration.leg)/1000+'s'}}/></span>{!!g&&control.includes(celebration.playerId)&&<div className="celebration-actions"><button className="button primary" disabled={busy} onClick={()=>void finishCelebration.current(celebration.playerId)}>{translateUi(celebration.match?"Weiter →":"Nächstes Leg")}</button>{view?.current.checkout&&<button className="button ghost" disabled={busy} onClick={()=>void send('action',{type:'undo'},celebration.playerId)}>{translateUi("Dart korrigieren")}</button>}</div>}</div></div>}

    {(translateUi(error)||translateUi(networkError))&&<div className="notice error" role="alert">{translateUi(error||networkError)}</div>}
    {available.length>1&&!g?.sharedDevice&&!data.sharedDevice&&controlled===null&&<div className="modal-overlay"><div className="dialog" role="dialog" aria-label={translateUi("Spieler für dieses Match")}><h2>{data.ownerSupport?translateUi("Unbesetzte Seiten steuern"):translateUi("Wer spielt an diesem Gerät?")}</h2>{data.ownerSupport&&<p>{translateUi("Spieler, die das Match selbst geöffnet haben, steuern ihre Seite. Du kannst für die anderen einspringen.")}</p>}{available.map(p=><button key={p} className="button ghost" onClick={()=>setControlled([p])}>{translateUi("Als")} {name(p)}  {translateUi("spielen")}</button>)}<button className="button primary" onClick={()=>setControlled(available)}>{translateUi(available.length>2?"Alle Spieler an diesem Gerät":"Beide Spieler an diesem Gerät")}</button></div></div>}

    {!isParticipant&&<div className="spectator-note">{data.ownerSupport?(available.length?translateUi("Du kannst für unbesetzte Spieler einspringen."):translateUi("Die Spieler steuern ihre Seite selbst. Du schaust als Admin zu.")):translateUi("Du schaust live zu. Nur die Teilnehmer können Würfe eintragen.")}{data.ownerSupport&&available.length>0&&<button className="button ghost" onClick={()=>setControlled(available)}>{translateUi("Freie Seite übernehmen")}</button>}{!data.session&&<> <Link href="/login">{translateUi("Anmelden →")}</Link></>}</div>}

    {!g?<><header className="match-toolbar"><Link href={backHref} className="match-back">{translateUi("← Zurück")}</Link><h1>{translateUi("Match starten")}</h1><div className="match-tools"><FullscreenButton/>    {settingsPanel}</div></header><div className="game-wait panel"><div className="eyebrow">{translateUi("BEREIT AM OCHE")}</div><h1>{name(data.match.players[0])} <span className="muted">{translateUi("gegen")}</span> {name(data.match.players[1])}</h1><p>{isParticipant?translateUi("Starte das Ausbullen. Dein Gegner kann auf seinem Gerät dasselbe Match öffnen."):translateUi("Sobald ein Spieler das Match startet, erscheint hier der gemeinsame Spielstand.")}</p>{isParticipant&&<button className="button primary" disabled={busy||data.tournament.status!=='running'} onClick={()=>void send('join')}>{translateUi("Ausbullen starten →")}</button>}</div></>:<>
      <header className="match-toolbar"><Link href={backHref} className="match-back" aria-label={translateUi("Zurück zum Turnier")}>← <span>{data.tournament.name}</span></Link><div className="game-heading"><h1>{g.phase==='bull'?(control.length>1?name(myId)+translateUi(" wirft zum Ausbullen"):translateUi("Wer beginnt?")):translateUi("{0} ist am Zug",name(g.players[view!.active]))}</h1></div><div className="match-tools"><span className="game-role">{data.ownerSupport?(isParticipant?translateUi("Admin · Vertretung"):translateUi("Admin · Zuschauer")):control.length>1?translateUi("Gemeinsames Gerät"):isParticipant?name(myId):translateUi("Zuschauer")}</span><FullscreenButton/>    {settingsPanel}</div></header>
      {g.practice==='around-clock'&&!g.solo&&g.phase==='playing'&&<div className="clock-turn-order">{translateUi("Nächster Spieler:")} <strong>{name(g.players[(view!.active+1)%g.players.length])}</strong><span>{view!.active+1}/{g.players.length}</span></div>}
      <div className={'game-layout' +(g.solo||clock?' solo-game':'')}>
        {g.players.map((p,i)=>{if(clock?i!==view!.active:g.solo&&i!==(g.starter??0))return null;
          const own=control.includes(p),active=g.phase==='playing'&&view!.active===i;
           const victory=celebration?.playerId===p?(celebration.match?' match-victory':' leg-victory'):'';
          const shown=active?g.current:view!.legTurns.filter(t=>t.player===i).at(-1)?.darts??[];
          return <section key={p} className={`game-player player-${i} ${active?'at-oche':''}${victory}`}>
            {!!victory&&<span className="victory-halo" aria-hidden="true"/>}
            <div className="game-player-title"><span>{own?translateUi("DU"):isParticipant?translateUi("GEGNER"):translateUi("SPIELER ")+(i+1)}</span>{active&&<b>{translateUi("AM OCHE")}</b>}</div><div className="player-name-score"><h2>{name(p)}</h2>{g.phase!=='bull'&&!clock&&<div className="leg-score" aria-label={translateUi("{0} gewonnene Legs",view!.legs[i])}><strong>{view!.legs[i]}</strong><span>LEGS</span></div>}</div>
            {g.phase==='bull'?<><div className="bull-result">{g.bull[i]?<><strong>{g.bull[i]!.number===25?hitLabel(g.bull[i]!):`${hitDistanceMm(g.bull[i]!).toFixed(1)} mm`}</strong><span>{g.bullConfirmed?.[i]?translateUi("Bestätigt · Gegner abwarten"):translateUi("Treffer gesetzt · Mit Weiter bestätigen")}</span></>:<><strong>—</strong><span>{translateUi("Treffer noch offen")}</span></>}</div><div className="game-player-actions"><button className="button ghost" disabled={!own||busy||!g.bull[i]} onClick={()=>void sendAs(p,{type:'undo'})}>{translateUi("↶ Zurück")}</button><button className="button primary" disabled={!own||busy||!g.bull[i]||!!g.bullConfirmed?.[i]} onClick={()=>void sendAs(p,{type:'next'})}>{g.bullConfirmed?.[i]?translateUi("Bestätigt ✓"):translateUi("Weiter →")}</button></div></>:<>
              <div className="remaining-score"><span data-player-score={i}>{clock?(g.practice!=='checkout'&&clock.target===25?'Bull':clock.target??translateUi("Fertig")):view!.remaining[i]}</span><small>{translateUi(clock?"NÄCHSTES ZIEL":"RESTPUNKTE")}</small></div><div className="player-stats">{clock?<><div><strong>{clock.completed}/{clock.total}</strong><span>{translateUi(g.practice==='segments'?"Treffer":g.practice==='checkout'?"Checkouts":"Ziele")}</span></div><div><strong>{clock.darts}</strong><span>Darts</span></div><div><strong>{clock.accuracy.toFixed(1)} %</strong><span>{translateUi("Trefferquote")}</span></div></>:<><div><strong>{view!.legAverage[i].toFixed(1)}</strong><span>Leg Average</span></div><div><strong>{view!.average[i].toFixed(1)}</strong><span>Match Average</span></div><div><strong>{view!.legDarts[i]}</strong><span>{translateUi("Darts im Leg")}</span></div></>}</div>
              <div className="visit-darts">{[0,1,2].map(n=><button key={n} className={`${shown[n]?'has-hit':''} ${active&&selected===n?'selected':''} ${!shown[n]&&active&&route[n-g.current.length]?'has-recommendation':''}`} disabled={!own||!active||busy||n>=shown.length} onClick={()=>setSelected(n)}><small>DART {n+1}</small><strong>{shown[n]?(clock?label(shown[n]):points(shown[n])):active?route[n-g.current.length]??'—':'—'}</strong><span>{shown[n]?label(shown[n]):active&&route[n-g.current.length]?translateUi("Empfehlung"):''}</span></button>)}</div>
              <div className="visit-total"><span>{translateUi(clock?"Darts in diesem Zug":"Punkte in diesem Zug")}<small>{active?translateUi("Aktueller Zug"):translateUi("Letzter Zug")}</small></span><strong>{clock?shown.length+' / 3':shown.reduce((sum,h)=>sum+points(h),0)}{active&&view!.current.bust&&<small>  {translateUi("· Überworfen")}</small>}</strong></div>
              <div className="game-player-actions"><button className="button ghost" disabled={!own||!active||busy||(!g.current.length&&(!g.turns.length||!!clock&&g.turns.at(-1)?.player!==view!.active))} onClick={()=>void send('action',{type:'undo'})}>{translateUi("↶ Zurück")}</button><button className="button primary" disabled={!own||!active||busy||!g.current.length} onClick={()=>void send('action',{type:'next'})}>{translateUi("Weiter →")}</button></div>
            </>}
          </section>;
        })}
        <section className="game-input">
          {g.phase==='playing'&&<div className="checkout-line">{clock?<><span>{translateUi("ZIEL")}</span><strong>{g.practice!=='checkout'&&clock.target===25?'Bull':clock.target??translateUi("Fertig")}</strong></>:route.length?<><span>{advice?.kind==='setup'?translateUi("STELLEN AUF {0}",advice.leave):'CHECKOUT'}</span><strong>{route.join(' → ')}</strong></>:<span>{ended?translateUi("Aufnahme bestätigen oder Dart korrigieren"):selected!==null?translateUi("Dart {0} neu setzen",selected+1):''}</span>}</div>}
          {g.phase==='bull'&&<div className="bull-camera-choice" aria-label={translateUi("Scheibe zum Ausbullen")}>{g.players.map(p=><button key={p} className={(bullCamera??(isParticipant?myId:g.players[0]))===p?'active':''} onClick={()=>{setBullCamera(p);if(control.includes(p))setBullActor(p);}}>{translateUi("Scheibe von")} {name(p)}</button>)}</div>}
          <MatchBoard id={id} match={matchId} player={g.phase==='bull'?(bullCamera??(isParticipant?myId!:g.players[0])):g.players[view!.active]} name={name(g.phase==='bull'?(bullCamera??(isParticipant?myId:g.players[0])):g.players[view!.active])} visit={g.phase+':'+(g.phase==='bull'?g.bullRound:g.turns.length)} hits={markers} enabled={editable&&(!ended||selected!==null)} onHit={add} bull={g.phase==='bull'} keyboard={keyboard}/>
          {g.phase==='playing'?<>
            <div className={`dart-keypad ${keyboard?'show-keyboard':''}`}>
              <div className="multiplier-toggle">{([1,2,3] as const).map(n=><button key={n} className={multiplier===n?'active':''} disabled={!editable} onClick={()=>setMultiplier(n)}>{n===1?'Single':n===2?'Double':'Triple'}</button>)}</div>
              <div className="number-pad">{Array.from({length:20},(_,i)=>i+1).map(n=><button key={n} disabled={!editable||(ended&&selected===null)} onClick={()=>add(keypadHit(n,multiplier))}>{n}</button>)}</div>
              <div className="bull-pad"><button disabled={!editable||(ended&&selected===null)} onClick={()=>add(keypadHit(0,1))}>Miss</button><button disabled={!editable||(ended&&selected===null)} onClick={()=>add(keypadHit(25,1))}>25</button><button disabled={!editable||(ended&&selected===null)} onClick={()=>add(keypadHit(25,2))}>Bull · 50</button></div>
            </div>

          </>:keyboard?<div className="mobile-bull bull-keypad"><p>{translateUi("Wo ist dein Dart gelandet?")}</p><div className="bull-pad"><button disabled={!editable} onClick={()=>add(keypadHit(25,2))}>Bull · 50</button><button disabled={!editable} onClick={()=>add(keypadHit(25,1))}>25</button></div><label>{translateUi("Abstand zur Mitte, außerhalb des Bulls (mm)")}<input type="number" min="16" max="340" step=".1" value={distance} onChange={e=>setDistance(e.target.value)}/></label><button className="button ghost" disabled={!editable||Number(distance)<16||Number(distance)>340} onClick={()=>add(boardHit(Number(distance)/170,0))}>{translateUi("Abstand eintragen")}</button></div>:null}
          <button className="input-mode-button" onClick={()=>{setKeyboard(!keyboard);localStorage.setItem('match-input-mode',keyboard?'board':'keyboard');}}>{keyboard?translateUi("Dartscheibe anzeigen"):translateUi("Mit Zahlentastatur eingeben")}</button>
        </section>
      </div>
      <div className="game-rules">{clock?<span>{practiceName} · {g.practice==='around-clock'?'1–20 · 25 / Bull':g.practice==='segments'?(g.practiceSettings?.segments.join(', ')+' · 30 Darts'):(rules.out==='double'?'Double Out':'Single Out')+' · '+translateUi('10 Aufgaben')}</span>:<><span>{g.solo?'Solo X01 · ':'X01 · '}{rules.start} · {rules.out==='double'?'Double Out':'Single Out'}</span><span>{translateUi("Erster mit")} {rules.legsToWin}  {translateUi("Legs gewinnt")}</span></>}<span className="connection"><i className="connected"/>{translateUi(connection)}</span></div>

      {(data.canReset??data.session?.role==='owner')&&<button className="text-button reset-game" onClick={()=>{if(window.confirm(translateUi("Dieses Spiel auf den Stand vor dem Ausbullen zurücksetzen? Die eingegebenen Darts werden entfernt.")))void send('reset');}}>{translateUi("Spiel zurücksetzen")}</button>}
    </>}
  </div>;
}

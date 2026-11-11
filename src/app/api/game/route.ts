import {completedGameTournament} from '../../../domain/game-result';
import {viewTournament} from '../../../server/view-access';
import {matchIdentity} from '../../../server/match-identity';
import {playSession,primarySession,devicePlaySessions} from '../../../server/play-context';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createGame, defaultRules, gameAction, gameView, type Game, type GameAction } from '../../../domain/scoring';
import { DomainError, rulesForMatch, updateMatch, type Tournament } from '../../../domain/tournament';
import { db, DatabaseError, repository, rpc } from '../../../server/repositories/supabase';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const hit=z.object({number:z.number().int().min(0).max(25),multiplier:z.union([z.literal(1),z.literal(2),z.literal(3)]),x:z.number().min(-2).max(2),y:z.number().min(-2).max(2),position:z.object({x:z.number().min(-2).max(2),y:z.number().min(-2).max(2)}).optional()});
const action=z.discriminatedUnion('type',[z.object({type:z.literal('bull'),hit}),z.object({type:z.literal('dart'),hit,index:z.number().int().min(0).max(6).optional()}),z.object({type:z.literal('undo')}),z.object({type:z.literal('next')})]);
function fail(e:unknown) {
  if(e instanceof DomainError||e instanceof z.ZodError)return json({error:e instanceof DomainError?e.message:'Bitte Eingaben prüfen.'},400);
  if(e instanceof DatabaseError) {
    if(e.code==='40001')return json({error:'Der Spielstand wurde inzwischen geändert. Bitte erneut versuchen.',conflict:true},409);
    if(e.code==='42501'&&e.message==='Strukturelle Änderung nicht erlaubt')return json({error:'Das Ergebnis enthält unzulässige Turnieränderungen. Bitte die Seite neu laden.'},403);
    if(e.code==='42501'&&e.message==='Du bist nicht an der Reihe')return json({error:'Du bist gerade nicht an der Reihe.'},403);
    if(e.code==='42501')return json({error:e.message==='Dieser Spieler steuert seine Seite selbst. Du schaust zu.'?e.message:'Keine Berechtigung für diese Spielaktion.',errorCode:'SCORING_PERMISSION_DENIED'},403);
    if(e.code==='28000')return json({error:'Sitzung abgelaufen. Bitte erneut anmelden.',errorCode:'SESSION_EXPIRED'},403);
    if(e.code==='55000')return json({error:e.message},409);
    if(['PGRST202','PGRST205'].includes(e.code))return json({error:'Bitte zuerst 010_device_settings.sql im SQL Editor der Version-2-Datenbank ausführen.'},503);
  }
  console.error('Scoring-API:',e instanceof Error?e.name:'Fehler');return json({error:'Spielstand konnte nicht geladen oder gespeichert werden.'},503);
}
async function load(id:string,match:string) {
  const {data,error}=await db().from('match_games').select('state,version').eq('tournament_id',id).eq('match_id',match).maybeSingle();
  if(error)throw new DatabaseError(error.message,error.code);return data?.state as Game|null;
}
export async function GET(r:NextRequest) {
  try {
    const id=z.string().uuid().parse(r.nextUrl.searchParams.get('id')),match=z.string().min(1).max(100).parse(r.nextUrl.searchParams.get('match'));
    const identity=await matchIdentity(r,id,match),access=await viewTournament(r,id,identity.session),s=access.session,t=access.tournament;
    if(!t)return json({error:'Turnier nicht verfügbar.'},404);
    const account=identity.root,canReset=account?.role==='owner'&&(!account.manager_id||account.manager_id===t.managerId);
    const m=t.matches.find(m=>m.id===match);if(!m)return t.kind==='training'?json({redirect:'/training/'+id}):json({error:'Match nicht verfügbar.'},404);
    return json({ownerSupport:identity.shadow,sharedDevice:identity.deviceShared===true,canReset,tournament:t,match:m,game:await load(id,match),session:s?{role:s.role,participantId:s.participant_id??null,participantIds:s.participant_ids??(s.participant_id?[s.participant_id]:[]),tournamentId:s.role==='owner'?s.playing_tournament_id??null:s.tournament_id}:null});
  }catch(e){return fail(e);}
}
export async function POST(r:NextRequest) {
  try {
    if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)return json({error:'Diese Anfrage stammt nicht von der Anwendung.'},403);
    const text=await r.text();if(text.length>3000)return json({error:'Anfrage zu groß.'},413);
    let raw:unknown;try{raw=JSON.parse(text);}catch{throw new DomainError('Ungültige Anfrage.');}
    const p=z.object({id:z.string().uuid(),match:z.string().min(1).max(100),operation:z.enum(['join','action','reset','presence']),actor:z.string().uuid().optional(),players:z.array(z.string().uuid()).max(6).optional(),expectedVersion:z.number().int().min(0),action:action.optional(),confirmed:z.boolean().optional()}).parse(raw);
    const primary=await primarySession(r);if(p.operation==='presence'){
     if(!primary)return json({error:'Bitte anmelden.'},401);
     const sessions=r.cookies.get('dartbracket_device_accounts')?await devicePlaySessions(r,p.id,primary):[{root:primary,session:await playSession(r,p.id,primary)}];
     const allowed=new Set(sessions.flatMap(a=>a.session?.participant_ids??(a.session?.participant_id?[a.session.participant_id]:[])));
     if(!(primary.role==='owner'&&!primary.manager_id)&&(p.players??[]).some(id=>!allowed.has(id)))return json({error:'Nur eigene Spieler dürfen als anwesend gemeldet werden.'},403);
     for(const a of sessions){if(!a.session)continue;const ids=(p.players??[]).filter(id=>(a.session!.participant_ids??[a.session!.participant_id]).includes(id));await rpc('match_player_presence',{p_hash:a.session.token_hash,p_id:p.id,p_match:p.match,p_players:ids});}
     return json({ok:true});
    }
    const identity=p.operation==='reset'?{root:primary,shadow:false,session:primary}:await matchIdentity(r,p.id,p.match,primary,p.actor);const s=p.operation==='reset'?primary:identity.session;if(!s)return json({error:'Bitte anmelden.'},401);
    const actor=p.actor??s.participant_id;
    const [tournamentResult,gameResult]=await Promise.allSettled([repository.get(p.id,s),load(p.id,p.match)]);
    if(tournamentResult.status==='rejected')throw tournamentResult.reason;
    const t=tournamentResult.value,m=t?.matches.find(m=>m.id===p.match);
    if(!t||!m)return json({error:'Match nicht verfügbar.'},404);
    // Display metadata (e.g. managerName) must never become a structural score edit.
    const storedState=async()=>{const state=await repository.get(p.id,s,{stateOnly:true});if(!state||state.version!==t.version)throw new DatabaseError('Turnier inzwischen geändert.','40001');return state;};
    if(gameResult.status==='rejected')throw gameResult.reason;
    const old=gameResult.value;
    if(p.operation==='reset') {
      if(s.role!=='owner'||s.manager_id&&s.manager_id!==t.managerId||!p.confirmed)return json({error:'Nur der Admin darf ein Spiel nach Bestätigung zurücksetzen.'},403);
      if(!old)return json({ok:true});
      const next=updateMatch(await storedState(),m.id,{legs:old.initialLegs??[null,null],status:'pending',forfeited:null}).tournament;
      next.version=t.version+1;next.updatedAt=new Date().toISOString();
      await rpc('reset_game',{p_id:t.id,p_match:m.id,p_hash:s.token_hash,p_state:next,p_expected:t.version});
      return json({ok:true,reset:true});
    }
    if(!['editor','owner'].includes(s.role)||(s.role==='owner'?s.playing_tournament_id:s.tournament_id)!==t.id||!actor||!(s.participant_ids??[s.participant_id]).includes(actor)||!m.players.includes(actor))return json({error:'Du kannst dieses Match nur als Zuschauer verfolgen.'},403);
    // A winning takeout and a manual confirmation may arrive together. Return
    // the saved result to an already authorised participant without writing again.
    if(p.operation==='action'&&p.action?.type==='next'&&old?.phase==='finished')return json({ok:true,game:old});
    if(t.status!=='running'||m.automatic||m.status==='finished'||!m.players.every(Boolean))return json({error:'Dieses Match kann gerade nicht gespielt werden.'},409);
    let g:Game,updated:Tournament|null=null;
    if(p.operation==='join') {
      if(old)return json({ok:true,game:old});
      g=createGame(m.players as [string,string],rulesForMatch(t,m));
      g.initialLegs=[m.legs[0]??0,m.legs[1]??0];
      if(g.initialLegs.some(n=>n>=g.rules.legsToWin))throw new DomainError('Das eingegebene Leg-Ergebnis erreicht bereits das Spielziel. Bitte zuerst das Ergebnis prüfen.');
      updated=updateMatch(await storedState(),m.id,{legs:g.initialLegs,status:'running',forfeited:null}).tournament;
    }else {
      if(!old||old.version!==p.expectedVersion)return json({error:'Spielstand inzwischen geändert. Bitte erneut versuchen.',conflict:true},409);
      if(!p.action)throw new DomainError('Spielaktion fehlt.');
      g=gameAction(old,actor,p.action as GameAction);
      if(g.phase==='finished')updated=completedGameTournament(await storedState(),m.id,g);
    }
    if(updated){updated.version=t.version+1;updated.updatedAt=new Date().toISOString();}
    await rpc(identity.shadow?'write_owner_game':actor!==s.participant_id?'write_device_game':'write_game',{...(identity.shadow||actor!==s.participant_id?{p_actor:actor}:{}),p_id:t.id,p_match:m.id,p_expected:old?.version??0,p_hash:s.token_hash,p_state:{...g,activePlayer:g.players[gameView(g).active]},p_tournament:updated,p_tournament_expected:updated?t.version:null});
    return json({ok:true,game:g});
  }catch(e){return fail(e);}
}

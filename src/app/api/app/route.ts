import {ADMIN_SESSION_MS} from '../../../server/session-lifetime';
import {deviceAccounts} from '../../../server/device-accounts';
import {playSession,primarySession,playerCookie,devicePlaySessions} from '../../../server/play-context';
import { gameView, type Game } from '../../../domain/scoring';
import { NextRequest, NextResponse } from 'next/server';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { can, createTournament, createTournamentLobby, drawTournamentLobby, decideRanking, DomainError, selectLive, updateMatch, type Tournament } from '../../../domain/tournament';
import { configured, DatabaseError, db, repository, rpc } from '../../../server/repositories/supabase';
import { encrypt, hashToken, rateKey, token, verifyPassword } from '../../../server/security';
import {managerAccountsEnabled,OWNER_MANAGER_ID} from '../../../server/tenant';
import {buildParticipantAccess,managerProfile} from '../../../server/manager-access';
import type { Credentials, Session } from '../../../server/repositories/interface';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cookieName = 'dartbracket_session';
const createSchema = z.object({ accounts:z.array(z.string().uuid()).min(0).max(20).optional(), name: z.string().trim().min(1).max(100), names: z.array(z.string().max(80)).min(0).max(20), mode: z.enum(['knockout','groups']), groupSize: z.number().int().min(2).max(20), advancePerGroup: z.number().int().min(1).max(20), scoring: z.object({ start:z.union([z.literal(301),z.literal(501),z.literal(701)]),out:z.enum(['single','double']),legsToWin:z.number().int().min(1).max(20),groupLegsToWin:z.number().int().min(1).max(20).optional() }).optional() });
const scoreSchema = z.object({ legs: z.tuple([z.number().int().min(0).max(9999).nullable(), z.number().int().min(0).max(9999).nullable()]), status: z.enum(['pending','running','finished']), forfeited: z.string().max(100).nullable() });
const envelope = z.object({ action: z.enum(['login','logout','create','score','ranking','redraw','rename','status','delete','lobby','draw','scoring']), id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(), confirmation: z.string().max(200).optional(), payload: z.unknown().optional() });

function response(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function session(request: NextRequest) {
  const raw = request.cookies.get(cookieName)?.value;
  const found = configured() ? await primarySession(request) : null;
  return found?.role === 'admin' ? null : found;
}
function fail(error: unknown) {
  if (error instanceof z.ZodError) return response({ error: 'Bitte Eingaben prüfen.', details: error.issues.map(x => x.message) }, 400);
  if (error instanceof DomainError) return response({ error: error.message }, 400);
  if (error instanceof DatabaseError) {
    if(error.message==='PLAYER_IN_USE')return response({error:'Dieser Spieler ist bereits auf einem anderen Gerät angemeldet.',needsTakeover:true},409);
    if(error.code==='MANAGER_SCHEMA')return response({error:error.message},503);
    if (['PGRST202','PGRST205'].includes(error.code)) return response({ error: 'Bitte 017_account_lobbies.sql im Supabase SQL Editor ausführen. Die bisherigen Migrationen 011 bis 016 müssen bereits installiert sein.' }, 503);
    if (error.code === '40001') return response({ error: 'Das Turnier wurde inzwischen geändert. Bitte den aktuellen Stand laden; deine Eingabe wurde nicht überschrieben.', conflict: true }, 409);
    if (['42501','28000'].includes(error.code)) return response({ error: 'Keine Berechtigung oder Sitzung abgelaufen.' }, 403);
    if(error.code==='22023')return response({error:error.message},400);
    if (error.code === '55000') return response({error:error.message},409);
    if (error.code === 'P0002') return response({ error: 'Turnier nicht gefunden.' }, 404);
  }
  console.error('Dartbracket-API:', error instanceof Error ? error.name : 'Unbekannter Fehler');
  return response({ error: 'Die Datenbank ist noch nicht bereit oder momentan nicht erreichbar. Bitte Einrichtung und Verbindung prüfen.' }, 503);
}
export async function GET(request: NextRequest) {
  try {
    if (!configured()) return response({ setup: true, tournaments: [], session: null });
    const s = await session(request), url = request.nextUrl;
    const id = url.searchParams.get('id');
    if(!s||s.role!=='owner')return response({error:'Bitte anmelden.'},401);
    if(id&&url.searchParams.get('history')){const target=await repository.get(id,s);if(!target||s.manager_id&&target.managerId!==s.manager_id)return response({error:'Keine Berechtigung.'},403);}
    if (url.searchParams.get('history')) {
      if (!s || !id || !can(s.role, s.tournament_id, id, 'manage')) return response({ error: 'Keine Berechtigung.' }, 403);
      const { data, error } = await db().from('audit_events').select('id,actor_role,action,detail,created_at').eq('tournament_id', id).order('id', { ascending: false }).limit(100);
      if (error) throw error; return response({ history: data });
    }
    const tournaments = await repository.list(s);
    if(request.cookies.get('dartbracket_device_accounts')){for(const account of await deviceAccounts(request,s)){for(const t of await rpc('account_linked_tournaments',{p_hash:account.session.token_hash}) as Tournament[]){if(!tournaments.some(o=>o.id===t.id))tournaments.push(t);}}}
    const active=await playSession(request,id);const ui=active&&s&&active.account_session_hash===s.token_hash?{...s,...active,role:s!.role,manager_id:s!.manager_id,playing_tournament_id:active.tournament_id}:s;
    if(id&&ui&&request.cookies.get('dartbracket_device_accounts')){const all=await devicePlaySessions(request,id,s);const ids=[...new Set(all.flatMap(a=>a.session.participant_ids??[]))];if(ids.length){ui.participant_ids=ids;ui.participant_id??=ids[0];ui.playing_tournament_id=id;}}
    if(!tournaments.length)return response({setup:false,accountsEnabled:managerAccountsEnabled(),appOrigin:process.env.APP_ORIGIN,tournaments:[],activeGames:[],liveId:null,session:ui?{role:ui.role,managerId:ui.manager_id??null,guestName:ui.guest_name??null,trainingId:ui.training_id??null,tournamentId:ui.tournament_id,participantId:ui.participant_id??null,participantIds:ui.participant_ids??[],rememberedParticipantIds:ui.remembered_participant_ids??[],rememberedTournamentId:ui.remembered_tournament_id??null,playingTournamentId:ui.playing_tournament_id,authorizedParticipantIds:ui.authorized_participant_ids??ui.participant_ids??[],playerLocked:!!ui.player_access_id}:null});
    let gamesQuery=db().from('match_games').select('tournament_id,match_id,state').neq('state->>phase','finished');
    if(managerAccountsEnabled()||s?.manager_id||s?.player_access_id)gamesQuery=gamesQuery.in('tournament_id',tournaments.map(t=>t.id));
    const {data:games,error:gameError}=await gamesQuery;
    if(gameError&&gameError.code!=='PGRST205')throw new DatabaseError(gameError.message,gameError.code);
    const activeGames=(games??[]).filter(g=>tournaments.some(t=>t.id===g.tournament_id)).map(g=>`${g.tournament_id}:${g.match_id}`);
    const liveTournaments=tournaments.map(t=>({...t,matches:t.matches.map(m=>{const game=games?.find(g=>g.tournament_id===t.id&&g.match_id===m.id)?.state as Game|undefined;return game?{...m,legs:gameView(game).legs,status:'running' as const}:m;})}));
    return response({ setup: false, accountsEnabled:managerAccountsEnabled(), activeGames, tournaments:liveTournaments, liveId: selectLive(tournaments)?.id ?? null, appOrigin: process.env.APP_ORIGIN, session: ui ? { role: ui.role, managerId:ui.manager_id??null,guestName:ui.guest_name??null,trainingId:ui.training_id??null, authorizedParticipantIds:ui.authorized_participant_ids??ui.participant_ids??[],playerLocked:!!ui.player_access_id, tournamentId: ui.tournament_id, participantId:ui.participant_id??null,participantIds:ui.participant_ids??(ui.participant_id?[ui.participant_id]:[]), rememberedParticipantIds:ui.remembered_participant_ids??[],rememberedTournamentId:ui.remembered_tournament_id??null,playingTournamentId:ui.playing_tournament_id??ui.tournament_id } : null });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    if (!configured()) return response({ error: 'Bitte zuerst Supabase und das Admin-Passwort einrichten.' }, 503);
    const origin = request.headers.get('origin');
    const appOrigin = new URL(process.env.APP_ORIGIN ?? request.url).origin;
    if (!origin || origin !== appOrigin) return response({ error: 'Diese Anfrage stammt nicht von der Anwendung.' }, 403);
    const text = await request.text();
    if (text.length > 16_000) return response({ error: 'Die Anfrage ist zu groß.' }, 413);
    let raw: unknown; try { raw = JSON.parse(text); } catch { return response({ error: 'Ungültige Anfrage.' }, 400); }
    const body = envelope.parse(raw);
    if (body.action === 'login') {
      const p = z.object({ role: z.enum(['owner','editor']).optional(), password: z.string().min(1).max(200),takeover:z.boolean().optional() }).parse(body.payload);
      const role='owner';
      const ip=process.env.VERCEL?request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()??'unknown':'local';
      if(!await rpc('consume_login_attempt',{p_key:rateKey('owner-ip:'+ip),p_max:40})||!await rpc('consume_login_attempt',{p_key:rateKey('owner'),p_max:15}))return response({error:'Zu viele Anmeldeversuche. Bitte nach 15 Minuten erneut versuchen.'},429);
      if(p.role==='editor')return response({error:'Bitte mit deinem Spielerkonto anmelden.'},410);
      if(!await verifyPassword(p.password,process.env.OWNER_PASSWORD_HASH!))return response({error:'Zugangsdaten ungültig oder Zugang deaktiviert.'},401);
      const tournamentId=null,credentialVersion=1;
      const rawToken = token(), expires = new Date(Date.now()+ADMIN_SESSION_MS);
      const { error } = await db().from('sessions').insert({ token_hash: hashToken(rawToken), role, tournament_id: tournamentId, credential_version: credentialVersion, expires_at: expires.toISOString() });
      if (error) throw error;

      const out = response({ ok: true, role:'admin', tournamentId, redirect: '/' });
      out.cookies.delete(playerCookie);out.cookies.delete('dartbracket_device_accounts');
      out.cookies.set(cookieName, rawToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', expires });
      return out;
    }
    let s = await session(request);
    if(body.action==='score'&&body.id){
      const root=s;let target=s?.role==='owner'?await repository.get(body.id,s):null;
      if(!target||s?.manager_id&&target.managerId!==s.manager_id){
        s=await playSession(request,body.id,root);
        if(request.cookies.get('dartbracket_device_accounts')){
          const accounts=await devicePlaySessions(request,body.id,root);
          if(!target&&accounts[0])target=await repository.get(body.id,accounts[0].session);
          const matchId=(body.payload as {matchId?:unknown}|undefined)?.matchId;
          const players=target?.matches.find(m=>m.id===matchId)?.players??[];
          s=accounts.find(a=>players.some(p=>p&&(a.session.participant_ids??[a.session.participant_id]).includes(p)))?.session??s;
        }
      }
    }
    if (!s) return response({ error: 'Bitte zuerst anmelden.' }, 401);
    if (body.action === 'logout') {
      await db().from('sessions').delete().eq('token_hash', s.token_hash);
      const out = response({ ok: true }); out.cookies.delete(cookieName);out.cookies.delete(playerCookie);out.cookies.delete('dartbracket_device_accounts');if(s.role==='guest')out.cookies.delete('dartbracket_guest');out.cookies.delete('dartbracket_spectator'); return out;
    }
    if (body.action === 'create') {
      if (s.role !== 'owner') return response({ error: 'Nur der Admin darf Turniere erstellen.' }, 403);
      const input = createSchema.parse(body.payload), id = randomUUID();if(!input.accounts)return response({error:'Bitte Spielerkonten auswählen.'},400);
      const t = createTournamentLobby({ ...input, id },randomUUID);
      const credentials: Credentials = { tournament_id:id,admin_hash:'',admin_version:1,editor_link_hash:hashToken(token()),editor_pin_hash:'unused',editor_secret:encrypt('{}'),editor_enabled:true,editor_version:1 };
      t.managerId=s.manager_id??OWNER_MANAGER_ID;t.createdByName=(await managerProfile(t.managerId)).name;credentials.player_codes=await buildParticipantAccess(t);
      await rpc('create_account_tournament',{p_hash:s.token_hash,p_state:t,p_credentials:credentials,p_accounts:input.accounts});
      return response({ ok: true, id });
    }
    const id = body.id;
    if (!id) return response({ error: 'Turnier-ID fehlt.' }, 400);
    const permission = body.action === 'score' ? 'score' : body.action === 'delete' ? 'delete' : body.action === 'status' && (body.payload as { status?: string })?.status === 'archived' ? 'archive' : 'manage';
    if (!can(s.role, s.tournament_id, id, permission)) return response({ error: 'Für diese Aktion oder dieses Turnier hast du keine Berechtigung.' }, 403);
    if((managerAccountsEnabled()||s.manager_id)&&!await repository.get(id,s))return response({error:'Keine Berechtigung.'},403);
    if(s.role==='owner'&&s.manager_id&&permission!=='score'){const t=await repository.get(id,s);if(t?.managerId!==s.manager_id)return response({error:'Keine Berechtigung.'},403);}
    const old = await repository.get(id, s,{stateOnly:true});
    if (!old) return response({ error: 'Turnier nicht gefunden.' }, 404);
    if (body.expectedVersion !== old.version) return response({ error: 'Das Turnier wurde inzwischen geändert. Bitte aktuellen Stand laden.', conflict: true }, 409);
    if (body.action === 'delete') {
      const fingerprint = rateKey(`delete:${id}:${old.version}`);
      if (body.confirmation !== fingerprint) return response({ needsConfirmation: true, confirmation: fingerprint, message: 'Dieses Turnier einschließlich seiner Zugänge endgültig löschen?', resets: old.matches.filter(m => !m.automatic && m.status !== 'pending').map(m => m.id) });
      await repository.remove(id, old.version, s); return response({ ok: true, deleted: true });
    }
    if(body.action==='lobby'){
      if(old.setupPhase!=='lobby'||old.status!=='planned')throw new DomainError('Die Auslosung hat bereits stattgefunden.');
      const input=createSchema.parse(body.payload);if(!input.accounts)return response({error:'Bitte Spielerkonten auswählen.'},400);
      const current=await rpc('tournament_account_players',{p_hash:s.token_hash,p_id:id}) as {id:string;participantId:string}[];
      const next=createTournamentLobby({...input,id},randomUUID);
      next.participants.forEach((participant,i)=>{participant.id=current.find(x=>x.id===input.accounts![i])?.participantId??participant.id;});
      Object.assign(next,{managerId:old.managerId,createdByName:old.createdByName,createdAt:old.createdAt,version:old.version+1});
      await rpc('save_account_lobby',{p_hash:s.token_hash,p_state:next,p_expected:old.version,p_accounts:input.accounts,p_access:await buildParticipantAccess(next)});
      return response({ok:true,tournament:next});
    }
    let next: Tournament = structuredClone(old), resets: string[] = [];
    if(body.action==='draw'){next=drawTournamentLobby(old,randomInt);}
    else if (body.action === 'score') {
      const p = z.object({ matchId: z.string().max(100), result: scoreSchema }).parse(body.payload);
      const target=old.matches.find(m=>m.id===p.matchId);
      if(s.role==='editor'&&!target?.players.some(p=>p&&(s.participant_ids??[s.participant_id]).includes(p)))return response({error:'Du darfst nur Matches deiner zugeordneten Spieler bearbeiten.'},403);
      if(s.role==='editor'){const actor=target?.players.find(p=>p&&(s.participant_ids??[s.participant_id]).includes(p));if(actor&&actor!==s.participant_id)s.acting_id=actor;}
      const result = updateMatch(old, p.matchId, p.result); next = result.tournament; resets = result.resets;
    } else if(body.action==='scoring'){
      next.scoring=createSchema.shape.scoring.unwrap().parse(body.payload);
    } else if (body.action === 'ranking') {
      const p = z.object({ groupId: z.string().max(100), order: z.array(z.string().uuid()).min(2).max(20) }).parse(body.payload);
      const result = decideRanking(old, p.groupId, p.order); next = result.tournament; resets = result.resets;
    } else if (body.action === 'rename') {
      next.name = z.object({ name: z.string().trim().min(1).max(100) }).parse(body.payload).name;
    } else if (body.action === 'redraw') {
      if (old.status === 'archived') throw new DomainError('Archivierte Turniere können nicht neu ausgelost werden.');
      const p = createSchema.parse(body.payload);if(!p.accounts)return response({error:'Bitte Spielerkonten auswählen.'},400);
      // Stable randomness/IDs for the preview and its subsequent confirmed request.
      const seed = rateKey(JSON.stringify([id, old.version, p])); let counter = 0;
      const deterministicRandom = (max: number) => parseInt(hashToken(`${seed}:${counter++}`).slice(0,12),16) % max;
      let playerCounter = 0;
      next = createTournament({ ...p, id }, deterministicRandom, () => {
        const hex = hashToken(`${seed}:player:${playerCounter++}`);
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
      });
      next.createdAt = old.createdAt;next.managerId=old.managerId;next.createdByName=old.createdByName;next.setupPhase='drawn';
      resets = old.matches.filter(m => !m.automatic && (m.status !== 'pending' || m.legs.some(x => x !== null))).map(m => m.id);
    } else if (body.action === 'status') {
      if(old.setupPhase==='lobby')throw new DomainError('Bitte zuerst in der Lobby auslosen und starten.');
      const p = z.object({ status: z.enum(['planned','running','completed','archived']) }).parse(body.payload);
      if (old.status === 'archived' && s.role !== 'owner') throw new DomainError('Nur der Admin darf archivierte Turniere wieder öffnen.');
      if (p.status === 'completed' && !old.winner) throw new DomainError('Ein Turnier kann erst nach einem gültigen Finale abgeschlossen werden.');
      if (p.status === 'planned' && old.matches.some(m => !m.automatic && (m.status !== 'pending' || m.legs.some(x => x !== null)))) throw new DomainError('Für einen Neustart bitte die bestätigte Neuauslosung verwenden.');
      if (p.status === 'running' && old.winner) throw new DomainError('Das Finale ist bereits beendet. Zum Wiederöffnen muss sein Ergebnis korrigiert werden.');
      next.status = p.status; if (p.status === 'running' && old.status !== 'running') next.startedAt = new Date().toISOString();
    }
    if (resets.length) {
      const fingerprint = rateKey(JSON.stringify([id, old.version, body.action, body.payload, resets]));
      if (body.confirmation !== fingerprint) return response({ needsConfirmation: true, confirmation: fingerprint, resets, message: `${resets.length} erfasste Folgeergebnisse werden zurückgesetzt. Diese Änderung bestätigen?` });
    }
    next.version = old.version + 1; next.updatedAt = new Date().toISOString();
    await repository.save(next, old.version, s, permission, { action: body.action, matchId:body.action==='score'?(body.payload as {matchId:string}).matchId:undefined, resets,...(body.action==='redraw'?{player_codes:await buildParticipantAccess(next),accounts:createSchema.parse(body.payload).accounts}:{}) });
    return response({ ok: true, tournament: next });
  } catch (error) { return fail(error); }
}

import {AccountRequestError} from '../../../server/account-http';
import {deckAccess} from '../../../server/dartdeck';
import {playSession} from '../../../server/play-context';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { repository, rpc } from '../../../server/repositories/supabase';
import { encrypt, decrypt, rateKey } from '../../../server/security';
import { AutodartsError, loginAutodarts, refreshAutodarts, listAutodartsBoards, autodartsTicket, autodartsImage, autodartsBoardEmpty } from '../../../server/autodarts';
import {savedAutodartsProfile,linkAutodarts,profileOperation,withSavedAutodarts,SavedAutodartsError} from '../../../server/saved-autodarts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const cookie='dartbracket_autodarts';
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const auth=z.object({refresh:z.string().max(1400),session:z.string(),player:z.string(),tournament:z.string(),expires:z.number()});
async function identity(r:NextRequest){const deck=r.headers.get('x-dartbracket-dartdeck');if(deck){if(!z.string().uuid().safeParse(deck).success)return null;const access=await deckAccess(r,deck);const player=access.members.find(m=>access.controlled.includes(m.id));if(!player)return null;return {...access.root,participant_id:player.id,playing_tournament_id:deck};}const context=r.headers.get('x-dartbracket-tournament');if(context&&!z.string().uuid().safeParse(context).success)return null;const s=await playSession(r,context);return s&&['editor','owner','guest'].includes(s.role)?s:null;}
function saved(r:NextRequest,s:NonNullable<Awaited<ReturnType<typeof identity>>>){
  try{const a=auth.parse(JSON.parse(decrypt(r.cookies.get(cookie)?.value??'')));return a.session===s.token_hash&&a.player===s.participant_id&&a.tournament===(s.role==='owner'?s.playing_tournament_id:s.tournament_id)&&a.expires>Date.now()?a:null;}catch{return null;}
}
function setAuth(response:NextResponse,s:NonNullable<Awaited<ReturnType<typeof identity>>>,refresh:string){
  response.cookies.set(cookie,encrypt(JSON.stringify({refresh,session:s.token_hash,player:s.participant_id,tournament:s.role==='owner'?s.playing_tournament_id:s.tournament_id,expires:Date.now()+24*60*60*1000})),{httpOnly:true,secure:new URL(process.env.APP_ORIGIN??'http://localhost').protocol==='https:',sameSite:'strict',path:'/api/autodarts',maxAge:24*60*60});return response;
}
export async function GET(r:NextRequest){try{const s=await identity(r),profile=s?await savedAutodartsProfile(s):null;return respond({authenticated:!!s&&(!!profile?.linked||!!saved(r,s)),canLink:!!profile,linked:!!profile?.linked,boardId:profile?.boardId??null,autoConnect:profile?.autoConnect??false});}catch(e){return respond({error:e instanceof AccountRequestError?e.message:'Bitte erneut anmelden.'},e instanceof AccountRequestError?e.status:401);}}
export async function POST(r:NextRequest){
  try{
    if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)return respond({error:'Diese Anfrage stammt nicht von der Anwendung.'},403);
    const s=await identity(r);if(!s)return respond({error:'Bitte mit deinem Spielerkonto anmelden.'},401);
    const text=await r.text();if(text.length>8000)return respond({error:'Anfrage zu groß.'},413);
    let input:unknown;try{input=JSON.parse(text);}catch{return respond({error:'Ungültige Anfrage.'},400);}
    const p=z.discriminatedUnion('operation',[z.object({operation:z.literal('login'),username:z.string().trim().min(1).max(254),password:z.string().min(1).max(512),remember:z.boolean().default(false)}),z.object({operation:z.literal('connect'),boardId:z.string().min(1).max(100)}),z.object({operation:z.literal('pause')}),z.object({operation:z.literal('ticket'),boardId:z.string().min(1).max(100)}),z.object({operation:z.literal('state'),boardId:z.string().min(1).max(100)}),z.object({operation:z.literal('image'),boardId:z.string().min(1).max(100),cam:z.number().int().min(0).max(2)}),z.object({operation:z.literal('boards')}),z.object({operation:z.literal('disconnect')})]).parse(input);
    const profile=await savedAutodartsProfile(s);
    if(p.operation==='disconnect'){if(profile)await profileOperation(s,'unlink');const response=respond({ok:true});response.cookies.set(cookie,'',{path:'/api/autodarts',maxAge:0});return response;}
    if(p.operation==='pause'){if(profile?.linked)await profileOperation(s,'pause');return respond({ok:true});}
    if(['ticket','image','state'].includes(p.operation)&&(!s.participant_id||!(s.role==='owner'?s.playing_tournament_id:s.tournament_id))&&!(s.role==='owner'&&!s.manager_id&&profile?.linked))return respond({error:'Dein Konto ist hier keinem Spieler zugeordnet.'},401);
    const allowed=await rpc('consume_login_attempt',{p_key:rateKey('autodarts:'+s.token_hash+':'+(p.operation==='login'?'login':'connection')),p_max:p.operation==='login'?15:120});
    if(!allowed)return respond({error:'Zu viele Verbindungsversuche. Bitte später erneut versuchen.'},429);
    if(p.operation==='login'){
      if(!s.participant_id&&!profile)return respond({error:'Dein Konto ist hier keinem Spieler zugeordnet.'},401);
      if(!p.remember&&!s.participant_id)return respond({error:'Bitte Autodarts mit deinem Konto verknüpfen.'},401);
      if(p.remember&&!profile)return respond({error:'Bitte zuerst 012_saved_autodarts.sql in Supabase ausführen.'},503);
      const a=await loginAutodarts(p.username,p.password),boards=await listAutodartsBoards(a.access_token);
      if(p.remember)await linkAutodarts(s,a.refresh_token);else if(profile?.linked)await profileOperation(s,'unlink');
      const out=respond({ok:true,boards,linked:p.remember});
      if(p.remember){out.cookies.set(cookie,'',{path:'/api/autodarts',maxAge:0});return out;}
      return setAuth(out,s,a.refresh_token);
    }
    if(profile?.linked){
      const result=await withSavedAutodarts(s,async access=>{
        const boards=await listAutodartsBoards(access);
        if(p.operation==='boards')return {boards,linked:true,boardId:profile.boardId,autoConnect:profile.autoConnect};
        if(!boards.some(b=>b.id===p.boardId))throw new SavedAutodartsError('Diese Scheibe gehört nicht zu deiner Autodarts-Anmeldung.',403);
        if(p.operation==='connect')return {ok:true};
        if(p.operation==='image')return {url:await autodartsImage(access,p.boardId,p.cam)};
        const boardEmpty=await autodartsBoardEmpty(access,p.boardId).catch(()=>false);if(p.operation==='state')return {boardEmpty};return {url:await autodartsTicket(access),boardEmpty};
      },p.operation==='connect'?p.boardId:undefined);
      return respond(result);
    }
    const old=saved(r,s);if(!old)return respond({error:'Bitte bei Autodarts anmelden.'},401);
    const a=await refreshAutodarts(old.refresh),boards=await listAutodartsBoards(a.access_token);
    if(p.operation==='boards')return setAuth(respond({boards}),s,a.refresh_token);
    if(!boards.some(b=>b.id===p.boardId))return setAuth(respond({error:'Diese Scheibe gehört nicht zu deiner Autodarts-Anmeldung.'},403),s,a.refresh_token);
    if(p.operation==='connect')return setAuth(respond({ok:true}),s,a.refresh_token);
    if(p.operation==='image')return setAuth(respond({url:await autodartsImage(a.access_token,p.boardId,p.cam)}),s,a.refresh_token);
    const boardEmpty=await autodartsBoardEmpty(a.access_token,p.boardId).catch(()=>false);
    if(p.operation==='state')return setAuth(respond({boardEmpty}),s,a.refresh_token);
    const url=await autodartsTicket(a.access_token);
    return setAuth(respond({url,boardEmpty}),s,a.refresh_token);
  }catch(e){return respond({...(e instanceof SavedAutodartsError&&e.retryAfter?{retryAfter:e.retryAfter}:{}),error:e instanceof AccountRequestError?e.message:e instanceof SavedAutodartsError?e.message:e instanceof AutodartsError?e.message:e instanceof z.ZodError?'Bitte Eingaben prüfen.':'Autodarts konnte nicht verbunden werden. Manuelle Eingabe bleibt möglich.'},e instanceof AccountRequestError?e.status:e instanceof SavedAutodartsError?e.status:e instanceof z.ZodError?400:502);}
}

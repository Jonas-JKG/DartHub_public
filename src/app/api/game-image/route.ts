import {cameraFrame} from '../../../server/camera';
import {viewTournament} from '../../../server/view-access';
import {matchIdentity} from '../../../server/match-identity';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, repository, rpc, DatabaseError } from '../../../server/repositories/supabase';
import { rateKey } from '../../../server/security';
import { gameView, type Game } from '../../../domain/scoring';
import {downloadBoardFrame,BoardFrameError} from '../../../server/board-frame';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200,etag?:string)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store',...(etag?{ETag:etag}:{})}});
const ids=z.object({id:z.string().uuid(),match:z.string().min(1).max(100)});
const selection=ids.extend({player:z.string().uuid(),visit:z.string().max(100)});
export async function GET(r:NextRequest){
  try{
    const p=selection.parse(Object.fromEntries(r.nextUrl.searchParams)),s=(await matchIdentity(r,p.id,p.match)).session;
    const {tournament:t}=await viewTournament(r,p.id,s);
    if(!t||!t.matches.some(m=>m.id===p.match&&m.players.includes(p.player)))return json({image:null},404);
    const phone=await cameraFrame('tournament',p.id,p.match,p.player,r.headers.get('if-none-match'));if(phone){if(r.headers.get('if-none-match')===phone.etag)return new NextResponse(null,{status:304,headers:{ETag:phone.etag,'Cache-Control':'no-store'}});return json({image:phone.image,cached:phone.stale,source:'phone',...(phone.pending?{pending:true}:{})},200,phone.pending?undefined:phone.etag);}
    const q=db().from('match_board_images');
    const {data:meta,error}=await q.select('revision,session_hash,visit_key,updated_at,empty_revision').eq('tournament_id',p.id).eq('match_id',p.match).eq('player_id',p.player).maybeSingle();
    if(error){if(['42P01','PGRST205'].includes(error.code))return json({image:null});throw error;}
    if(!meta)return json({image:null});
    const cached=meta.visit_key!==p.visit||Date.now()-Date.parse(meta.updated_at)>45000;
    if(cached&&!meta.empty_revision)return json({image:null});
    const owner=await rpc('read_session',{p_hash:meta.session_hash}) as {participant_id?:string;participant_ids?:string[];playing_tournament_id?:string;tournament_id?:string;role?:string;manager_id?:string|null}|null;
    if(owner?.role==='owner'&&!owner.manager_id){const free=await rpc('owner_available_players',{p_hash:meta.session_hash,p_id:p.id,p_match:p.match});if(Array.isArray(free)){if(!free.includes(p.player))return json({image:null});owner.participant_ids=[p.player];owner.playing_tournament_id=p.id;}}
    if(!owner||!(owner.participant_ids??[owner.participant_id]).includes(p.player)||(owner.role==='owner'?owner.playing_tournament_id:owner.tournament_id)!==p.id)return json({image:null});
    const etag='"'+(cached?meta.empty_revision+':'+p.visit:meta.revision)+'"';
    if(r.headers.get('if-none-match')===etag)return new NextResponse(null,{status:304,headers:{ETag:etag,'Cache-Control':'no-store'}});
    const {data,error:frameError}=await db().from('match_board_images').select('image,empty_image').eq('tournament_id',p.id).eq('match_id',p.match).eq('player_id',p.player).eq(cached?'empty_revision':'revision',cached?meta.empty_revision:meta.revision).maybeSingle();
    if(frameError)throw frameError;
    // A newer frame can arrive between the metadata and image reads. Retry it
    // on the next poll without clearing the frame already shown in the browser.
    if(!data)return json({image:null,pending:true});
    const image=cached?data?.empty_image:data?.image??data?.empty_image;
    return json({image:image??null,cached,empty:cached||!data?.image},200,image?etag:undefined);
  }catch{return json({image:null},503);}
}
export async function POST(r:NextRequest){
  try{
    if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)return json({error:'Fremde Anfrage.'},403);
    const text=await r.text();if(text.length>7000)return json({error:'Anfrage zu groß.'},413);
    const p=ids.extend({operation:z.enum(['frame','heartbeat','clear']),connection:z.string().uuid(),visit:z.string().min(1).max(100),url:z.string().max(4096).optional(),actor:z.string().uuid().optional(),empty:z.boolean().optional()}).parse(JSON.parse(text));
    const identity=await matchIdentity(r,p.id,p.match,undefined,p.actor),s=identity.session,tid=s?.role==='owner'?s.playing_tournament_id:s?.tournament_id;
    if(!s||!['owner','editor'].includes(s.role)||!s.participant_id||tid!==p.id)return json({error:'Bitte als Spieler anmelden.'},403);
    const actor=p.actor??s.participant_id;
    if(!(s.participant_ids??[s.participant_id]).includes(actor))return json({error:'Spieler ist diesem Gerät nicht zugeordnet.'},403);
    const t=await repository.get(p.id,s);
    if(!t||!t.matches.some(m=>m.id===p.match&&m.players.includes(actor)))return json({error:'Nur eigene Matches.'},403);
    const started=new Date().toISOString();let image:string|null=null;
    if(p.operation==='frame'){
      const {data:row,error:gameError}=await db().from('match_games').select('state').eq('tournament_id',p.id).eq('match_id',p.match).maybeSingle();
      if(gameError)throw new DatabaseError(gameError.message,gameError.code);
      const game=row?.state as Game|undefined;
      if(!game||game.phase==='finished'||game.phase+':'+(game.phase==='bull'?game.bullRound:game.turns.length)!==p.visit||(!p.empty&&game.phase==='playing'&&game.players[gameView(game).active]!==actor))return json({ok:true,accepted:false});
      if(!await rpc('consume_login_attempt',{p_key:rateKey('board-image:'+s.token_hash),p_max:900}))return json({error:'Zu viele Bildanfragen. Bitte kurz warten.'},429);
      image=await downloadBoardFrame(p.url);
    }
    const accepted=await rpc(identity.shadow?'write_owner_board_image':'write_cached_board_image',{p_actor:actor,p_empty:!!p.empty,p_id:p.id,p_match:p.match,p_hash:s.token_hash,p_connection:p.connection,p_visit:p.visit,p_operation:p.operation,p_image:image,p_frame_at:started});
    return json({ok:true,accepted});
  }catch(e){
    if(e instanceof BoardFrameError)return json({error:e.message},e.status);
    if(e instanceof z.ZodError||e instanceof SyntaxError)return json({error:'Ungültige Anfrage.'},400);
    if(e instanceof DatabaseError&&['PGRST202','PGRST205','42P01'].includes(e.code))return json({error:'Für das Scheibenbild bitte 010_device_settings.sql im Supabase SQL Editor ausführen.'},503);
    return json({error:'Scheibenbild momentan nicht verfügbar. Manuelle Eingabe bleibt möglich.'},502);
  }
}

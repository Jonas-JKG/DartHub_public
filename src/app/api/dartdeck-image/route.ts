import {cameraFrame} from '../../../server/camera';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {deckAccess,checkDeckError} from '../../../server/dartdeck';
import {managerId} from '../../../server/manager-access';
import {db,rpc,DatabaseError} from '../../../server/repositories/supabase';
import {AccountRequestError} from '../../../server/account-http';
import {downloadBoardFrame,BoardFrameError} from '../../../server/board-frame';
import {deckVisitKey} from '../../../domain/dartdeck';
import {rateKey} from '../../../server/security';
import type {Session} from '../../../server/repositories/interface';
export const runtime='nodejs';export const dynamic='force-dynamic';
const uuid=z.string().uuid(),ids=z.object({id:uuid,match:uuid}),selection=ids.extend({player:uuid,visit:z.string().min(1).max(120)});
const json=(data:unknown,status=200,etag?:string)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store',...(etag?{ETag:etag}:{})}});
function fail(e:unknown){if(e instanceof AccountRequestError||e instanceof BoardFrameError)return json({error:e.message},e.status);if(e instanceof z.ZodError||e instanceof SyntaxError)return json({error:'Ungültige Anfrage.'},400);if(e instanceof DatabaseError&&['PGRST202','PGRST205','42P01','42883'].includes(e.code))return json({error:'Für DartDeck-Kamerabilder bitte 025_dartdeck_images.sql im Supabase SQL Editor ausführen.'},503);return json({error:'Scheibenbild momentan nicht verfügbar. Manuelle Eingabe bleibt möglich.'},502);}
export async function GET(r:NextRequest){try{
 const p=selection.parse(Object.fromEntries(r.nextUrl.searchParams)),a=await deckAccess(r,p.id),player=a.members.find(m=>m.id===p.player&&m.accepted);
 if((!a.host&&!a.controlled.length)||!player)throw new AccountRequestError('Keine Berechtigung für dieses Bild.',403);
 if(!a.room.game||a.room.game.id!==p.match)return json({image:null},404);
 const phone=await cameraFrame('dartdeck',p.id,p.match,p.player,r.headers.get('if-none-match'));if(phone){if(r.headers.get('if-none-match')===phone.etag)return new NextResponse(null,{status:304,headers:{ETag:phone.etag,'Cache-Control':'no-store'}});return json({image:phone.image,cached:phone.stale,source:'phone',...(phone.pending?{pending:true}:{})},200,phone.pending?undefined:phone.etag);}
 const {data:meta,error}=await db().from('dartdeck_board_images').select('revision,session_hash,visit_key,updated_at,empty_revision').eq('room_id',p.id).eq('match_id',p.match).eq('player_id',p.player).maybeSingle();checkDeckError(error);if(!meta)return json({image:null});
 const owner=await rpc('read_session',{p_hash:meta.session_hash}) as Session|null;if(owner?.role!=='owner'||managerId(owner)!==player.controller_id)return json({image:null});
 const cached=meta.visit_key!==p.visit||Date.now()-Date.parse(meta.updated_at)>45000;if(cached&&!meta.empty_revision)return json({image:null});
 const etag='"'+(cached?meta.empty_revision+':'+p.visit:meta.revision)+'"';if(r.headers.get('if-none-match')===etag)return new NextResponse(null,{status:304,headers:{'Cache-Control':'no-store',ETag:etag}});
 const frame=await db().from('dartdeck_board_images').select('image,empty_image').eq('room_id',p.id).eq('match_id',p.match).eq('player_id',p.player).eq(cached?'empty_revision':'revision',cached?meta.empty_revision:meta.revision).maybeSingle();checkDeckError(frame.error);if(!frame.data)return json({image:null,pending:true});
 const image=cached?frame.data.empty_image:frame.data.image??frame.data.empty_image;return json({image:image??null,cached,empty:cached||!frame.data.image},200,image?etag:undefined);
}catch(e){return fail(e);}}
export async function POST(r:NextRequest){try{
 if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)throw new AccountRequestError('Fremde Anfrage.',403);
 const text=await r.text();if(text.length>7000)throw new AccountRequestError('Anfrage zu groß.',413);
 const p=ids.extend({operation:z.enum(['frame','heartbeat','clear']),actor:uuid,connection:uuid,visit:z.string().min(1).max(120),url:z.string().max(4096).optional(),empty:z.boolean().optional()}).parse(JSON.parse(text));
 const a=await deckAccess(r,p.id),player=a.members.find(m=>m.id===p.actor&&m.accepted),actor=player&&a.accounts.find(s=>managerId(s)===player.controller_id);if(!actor)throw new AccountRequestError('Nur eigene Spielerbilder.',403);
 const g=a.room.game;if(!g||g.id!==p.match||g.phase!=='playing'||(p.operation!=='clear'&&deckVisitKey(g)!==p.visit)||(!p.empty&&p.operation==='frame'&&g.players[g.active].id!==p.actor))return json({ok:true,accepted:false});
 const started=new Date().toISOString();let image:string|null=null;
 if(p.operation==='frame'){if(!await rpc('consume_login_attempt',{p_key:rateKey('deck-image:'+actor.token_hash),p_max:900}))throw new AccountRequestError('Zu viele Bildanfragen. Bitte kurz warten.',429);image=await downloadBoardFrame(p.url);}
 const accepted=await rpc('write_dartdeck_image',{p_hash:actor.token_hash,p_id:p.id,p_match:p.match,p_actor:p.actor,p_connection:p.connection,p_visit:p.visit,p_operation:p.operation,p_image:image,p_frame_at:started,p_empty:!!p.empty});return json({ok:true,accepted});
}catch(e){return fail(e);}}

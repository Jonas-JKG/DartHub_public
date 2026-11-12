import type {NextRequest} from 'next/server';
import {z} from 'zod';
import {hashToken} from './security';
import {primarySession} from './play-context';
import {db,rpc,DatabaseError} from './repositories/supabase';
import {AccountRequestError,accountResponse} from './account-http';
import {matchIdentity} from './match-identity';
import type {Session} from './repositories/interface';
import {deckAccess,deckAccounts} from './dartdeck';
import {type Game} from '../domain/scoring';
export const cameraConfig=z.object({zoom:z.number().min(1).max(5),lens:z.number().min(-100).max(100),model:z.enum(['s_960','s_1280']),camera:z.string().max(300),run:z.boolean(),armed:z.boolean(),profileRevision:z.number().int().min(0).max(1000000).optional()});
export const cameraBinding=z.object({context:z.enum(['tournament','dartdeck']),id:z.uuid(),match:z.string().min(1).max(100),player:z.uuid(),visit:z.string().max(120)});
export function cameraRequestHash(r:NextRequest){if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)throw new AccountRequestError('Fremde Anfrage.',403);const raw=r.cookies.get('dartbracket_session')?.value;if(!raw)throw new AccountRequestError('Bitte anmelden.',401);return hashToken(raw);}
export async function cameraSession(r:NextRequest,write=false){if(write&&r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)throw new AccountRequestError('Fremde Anfrage.',403);const s=await primarySession(r);if(s?.role!=='owner')throw new AccountRequestError('Bitte anmelden.',401);return s;}
export async function cameraMatch(r:NextRequest,b:z.infer<typeof cameraBinding>,known?:Session){if(b.context==='dartdeck'){const a=await deckAccess(r,b.id,known?await deckAccounts(r,known):undefined);if(!a.room.game||a.room.game.id!==b.match||a.room.game.phase!=='playing'||!a.controlled.includes(b.player))throw new AccountRequestError('Nur eigene laufende Partien.',403);return;}
 const identity=await matchIdentity(r,b.id,b.match,known,b.player),s=identity.session;if(!s||(s.role==='owner'?s.playing_tournament_id:s.tournament_id)!==b.id||!(s.participant_ids??[s.participant_id]).includes(b.player))throw new AccountRequestError('Nur eigene Spieler dürfen eine Kamera verwenden.',403);
 const {data,error}=await db().from('match_games').select('state').eq('tournament_id',b.id).eq('match_id',b.match).maybeSingle();if(error)throw new DatabaseError(error.message,error.code);const g=data?.state as Game|undefined;if(!g||g.phase==='finished'||!g.players.includes(b.player))throw new AccountRequestError('Match nicht aktiv.',409);
}
export function cameraError(e:unknown){if(e instanceof DatabaseError&&e.code==='23505'&&e.message.includes('camera_owner_name_unique'))return accountResponse({error:'Du hast bereits eine Kamera mit diesem Namen. Bitte wähle einen anderen Namen.'},409);if(e instanceof AccountRequestError)return accountResponse({error:e.message},e.status);if(e instanceof z.ZodError||e instanceof SyntaxError)return accountResponse({error:'Ungültige Kamera-Eingaben.'},400);if(e instanceof DatabaseError){if(['42P01','42703','42883','PGRST202','PGRST205'].includes(e.code))return accountResponse({error:'Bitte 026_camera_devices.sql in Supabase ausführen.',setupRequired:true},503);if(e.code==='54000')return accountResponse({error:e.message},429);if(['28000','42501','22023','55000','40001'].includes(e.code))return accountResponse({error:e.message},e.code==='40001'||e.code==='55000'?409:403);}return accountResponse({error:'Kameraverbindung momentan nicht verfügbar.'},503);}
/** Called only after the existing image route checked match-view authorization. */
export async function cameraFrame(context:string,id:string,match:string,player:string,etag?:string|null){
 const tag=(r:{id:string;generation?:number;image_seq:number;image_revision?:number;media_generation?:number;observation?:{imageRevision?:number}})=>r.media_generation===r.generation&&r.image_revision!==undefined&&r.image_revision>=0?'\"camera:'+r.id+':'+r.generation+':media:'+r.image_revision+'\"':r.observation?.imageRevision===undefined?'"camera:'+r.id+':'+r.image_seq+'"':'"camera:'+r.id+':'+(r.generation??0)+':event:'+r.observation.imageRevision+'"';
 try{
  let legacySchema=false;const initial=await db().from('camera_devices').select('id,generation,image_seq,image_revision,media_generation,observation,updated_at,binding,status').contains('binding',{context,id,match,player}).order('updated_at',{ascending:false}).limit(1);
  let data:({id:string;generation:number;image_seq:number;image_revision?:number;media_generation?:number;observation?:{imageRevision?:number};updated_at:string;status:string;binding?:{session_hash?:string}})[]|null=initial.data;let error=initial.error;
  if(error?.code==='42703'){legacySchema=true;const legacy=await db().from('camera_devices').select('id,generation,image_seq,observation,updated_at,binding,status').contains('binding',{context,id,match,player}).order('updated_at',{ascending:false}).limit(1);data=legacy.data;error=legacy.error;}
  if(error&&['42P01','PGRST205'].includes(error.code))return null;if(error)return {image:null,etag:'',stale:true,pending:true};if(!data?.[0])return null;
  const row=data[0];if(!row.binding?.session_hash||!await rpc('camera_allowed',{p_hash:row.binding.session_hash}))return null;
  const stale=Date.now()-Date.parse(row.updated_at)>8000||row.status!=='active';if(tag(row)===etag)return {image:null,etag:tag(row),stale};
  // Read image and its revision together: a new report may arrive after the metadata query.
  const frame=legacySchema?await db().from('camera_devices').select('image,generation,image_seq,observation').eq('id',row.id).maybeSingle():await db().from('camera_devices').select('image,generation,image_seq,observation,image_revision,media_generation').eq('id',row.id).maybeSingle();
  if(!frame.data?.image)return {image:null,etag:'',stale,pending:true};return {image:frame.data.image as string,etag:tag({...row,...frame.data}),stale};
 }catch{return {image:null,etag:'',stale:true,pending:true};}}

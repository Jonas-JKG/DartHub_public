import {NextRequest} from 'next/server';
import {z} from 'zod';
import {accountResponse,AccountRequestError} from '../../../server/account-http';
import {primarySession} from '../../../server/play-context';
import {db,rpc} from '../../../server/repositories/supabase';
import {socialBody,socialRequest,socialError} from '../../../server/social-http';
import {token,hashToken,encrypt,decrypt} from '../../../server/security';
import {selectLive} from '../../../domain/tournament';
import {gameView,aroundClockView,practiceView,type Game} from '../../../domain/scoring';
import type {Tournament} from '../../../domain/tournament';
export const dynamic='force-dynamic';
export async function POST(r:NextRequest){try{const p=z.object({id:z.string().uuid()}).parse(await socialBody(r));await socialRequest(r,'spectator-link',60);const s=await primarySession(r);if(s?.role!=='owner')throw new AccountRequestError('Bitte anmelden.',401);const raw=token();const secret=await rpc('manage_spectator_link',{p_hash:s.token_hash,p_id:p.id,p_token_hash:hashToken(raw),p_secret:encrypt(raw)}) as string;return accountResponse({url:new URL('/watch/'+decrypt(secret),process.env.APP_ORIGIN??r.url).href});}catch(e){return socialError(e,'016_player_accounts.sql');}}
export async function GET(r:NextRequest){try{
 const raw=r.nextUrl.searchParams.get('token');if(!raw||!/^[A-Za-z0-9_-]{30,100}$/.test(raw))throw new AccountRequestError('Zuschauerlink ungültig.',404);
 const {data:link,error:linkError}=await db().from('tournament_spectator_links').select('tournament_id').eq('token_hash',hashToken(raw)).maybeSingle();if(linkError)throw linkError;
 let id=link?.tournament_id;
 if(!id){const {data:m,error}=await db().from('managers').select('id').eq('live_token_hash',hashToken(raw)).eq('enabled',true).eq('approved',true).is('deletion_requested_at',null).maybeSingle();if(error)throw error;if(!m)throw new AccountRequestError('Zuschauerlink ungültig.',404);
 const found=await db().from('tournaments').select('state').eq('manager_id',m.id).neq('status','archived');if(found.error)throw found.error;id=selectLive((found.data??[]).map(t=>t.state as Tournament).filter(t=>t.kind!=='training'))?.id;}
 if(!id)return accountResponse({tournament:null});
 const {data:row,error}=await db().from('tournaments').select('state,manager:managers!tournaments_manager_id_fkey(name,enabled,approved,deletion_requested_at)').eq('id',id).maybeSingle();if(error)throw error;
 const m=(Array.isArray(row?.manager)?row.manager[0]:row?.manager) as {name:string;enabled:boolean;approved:boolean;deletion_requested_at:string|null}|undefined;
 if(!row||!m?.enabled||!m.approved||m.deletion_requested_at)throw new AccountRequestError('Zuschaueransicht nicht verfügbar.',404);
 const {data:games,error:ge}=await db().from('match_games').select('match_id,state').eq('tournament_id',id);if(ge)throw ge;
 // Explicit public projection: no manager IDs, session data, links, provider data or other tournaments.
 const t=row.state as Tournament;
 return accountResponse({tournament:{id:t.id,name:t.name,mode:t.mode,kind:t.kind,trainingMode:t.trainingMode,setupPhase:t.setupPhase,status:t.status,participants:t.participants.map(p=>({id:p.id,name:p.name})),groups:t.groups,matches:t.matches.map(match=>{const game=games?.find(g=>g.match_id===match.id)?.state as Game|undefined;return game?{...match,legs:gameView(game).legs,status:game.phase==='finished'?'finished':'running'}:match;}),winner:t.winner,createdByName:t.createdByName??m.name},games:(games??[]).map(g=>{const game=g.state as Game,v=gameView(game);return {id:g.match_id,players:game.players,remaining:v.remaining,legs:v.legs,phase:game.phase,...(game.practice?{practice:game.practice,active:v.active,solo:game.solo,completed:game.players.map((_,i)=>game.practice==='around-clock'?aroundClockView(game,i).completed:i===v.active?practiceView(game).completed:0),total:practiceView(game).total,darts:v.darts}:{})};})});
}catch(e){return socialError(e,'016_player_accounts.sql');}}

import {NextRequest} from 'next/server';
import {z} from 'zod';
import {normalizeUsername,usernamePattern} from '../../../domain/username';
import {accountResponse,AccountRequestError} from '../../../server/account-http';
import {socialBody,socialRequest,socialError} from '../../../server/social-http';
import {primarySession} from '../../../server/play-context';
import {rpc} from '../../../server/repositories/supabase';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(r:NextRequest){try{const s=await primarySession(r);if(s?.role!=='owner')return accountResponse({account:false});const snapshot=await rpc('social_snapshot',{p_hash:s.token_hash}) as {invitations?:{kind?:string;name?:string}[]};if(snapshot?.invitations)snapshot.invitations=snapshot.invitations.map(i=>i.kind==='dartdeck'?{...i,name:'Minigames'}:i);let context:unknown=[];const id=r.nextUrl.searchParams.get('context');if(id)context=await rpc('social_context',{p_hash:s.token_hash,p_id:z.string().uuid().parse(id)});return accountResponse({account:true,...snapshot as object,context,handle:await rpc('social_self_handle',{p_hash:s.token_hash}),showManagers:!s.manager_id});}catch(e){return socialError(e,'020_username_search.sql');}}
export async function POST(r:NextRequest){try{
 const p=z.object({operation:z.enum(['dismiss-invitation','search','set-handle','request-handle','heartbeat','request','accept','remove','invite','invitation']),id:z.string().uuid().optional(),context:z.string().uuid().optional(),target:z.string().uuid().optional(),handle:z.string().transform(normalizeUsername).pipe(z.string().regex(usernamePattern)).optional()}).parse(await socialBody(r));
 await socialRequest(r,p.operation==='heartbeat'?'presence':'social',p.operation==='heartbeat'?600:60);
 const s=await primarySession(r);if(s?.role!=='owner')throw new AccountRequestError('Bitte mit deinem Konto anmelden.',401);
 if(p.operation==='search'){if(!p.handle)throw new AccountRequestError('Bitte einen Nutzernamen eingeben.',400);return accountResponse({result:await rpc('social_search_handle',{p_hash:s.token_hash,p_handle:p.handle})});}
 else if(p.operation==='set-handle'||p.operation==='request-handle'){if(!p.handle)throw new AccountRequestError('Bitte einen Nutzernamen eingeben.',400);await rpc(p.operation==='set-handle'?'social_set_handle':'social_request_handle',{p_hash:s.token_hash,p_handle:p.handle});}
 else if(p.operation==='heartbeat')await rpc('social_presence',{p_hash:s.token_hash});
 else if(p.operation==='request')await rpc('social_request',{p_hash:s.token_hash,p_link_hash:null,p_target:p.target??null,p_context:p.context??null});
 else if(p.operation==='accept'||p.operation==='remove'){if(!p.id)throw new AccountRequestError('Anfrage fehlt.',400);await rpc('social_friend_action',{p_hash:s.token_hash,p_id:p.id,p_action:p.operation});}
 else if(p.operation==='invite'){if(!p.id||!p.target)throw new AccountRequestError('Lobby und Freund fehlen.',400);await rpc('social_invite',{p_hash:s.token_hash,p_room:p.id,p_friend:p.target});}
 else if(p.operation==='dismiss-invitation'){if(!p.id)throw new AccountRequestError('Einladung fehlt.',400);await rpc('social_dismiss_invitation',{p_hash:s.token_hash,p_id:p.id});}
 else if(p.operation==='invitation'){if(!p.id)throw new AccountRequestError('Einladung fehlt.',400);const result=await rpc('accept_account_invitation',{p_hash:s.token_hash,p_id:p.id}) as {redirect?:string};if(result?.redirect?.startsWith('/dartdeck/'))result.redirect=result.redirect.replace('/dartdeck/','/minigames/');return accountResponse(result);}
 return accountResponse({ok:true});
}catch(e){return socialError(e,'020_username_search.sql');}}

import {refreshPersistentCookies} from '../../../server/session-lifetime';
import {NextRequest} from 'next/server';
import {z} from 'zod';
import {accountResponse,AccountRequestError} from '../../../server/account-http';
import {socialBody,socialRequest,socialError} from '../../../server/social-http';
import {primarySession} from '../../../server/play-context';
import {rpc} from '../../../server/repositories/supabase';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(r:NextRequest){try{const s=await primarySession(r);if(s?.role!=='owner')return accountResponse({signedIn:false});const identity=await rpc('account_identity',{p_hash:s.token_hash}) as {signedIn?:boolean}|null;return identity?.signedIn?refreshPersistentCookies(accountResponse(identity),r,s):accountResponse(identity);}catch(e){return socialError(e,'018_navigation_email_friends.sql');}}
export async function POST(r:NextRequest){try{const p=z.object({operation:z.enum(['heartbeat','complete-setup'])}).parse(await socialBody(r));await socialRequest(r,'identity:'+p.operation,600);const s=await primarySession(r);if(s?.role!=='owner')throw new AccountRequestError('Bitte anmelden.',401);if(p.operation==='heartbeat')await rpc('social_presence',{p_hash:s.token_hash});else await rpc('complete_account_setup',{p_hash:s.token_hash});return refreshPersistentCookies(accountResponse({ok:true}),r,s);}catch(e){return socialError(e,'018_navigation_email_friends.sql');}}

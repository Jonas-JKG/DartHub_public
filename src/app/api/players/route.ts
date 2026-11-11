import {normalizeUsername} from '../../../domain/username';
import {NextRequest} from 'next/server';
import {accountResponse,AccountRequestError} from '../../../server/account-http';
import {primarySession} from '../../../server/play-context';
import {rpc} from '../../../server/repositories/supabase';
import {socialError} from '../../../server/social-http';
export const dynamic='force-dynamic';
export async function GET(r:NextRequest){try{const s=await primarySession(r);if(s?.role!=='owner')throw new AccountRequestError('Bitte anmelden.',401);const tid=r.nextUrl.searchParams.get('tournament');if(tid){if(!/^[a-f0-9-]{36}$/.test(tid))throw new AccountRequestError('Turnier ungültig.',400);return accountResponse({players:await rpc('tournament_account_players',{p_hash:s.token_hash,p_id:tid})});}const q=normalizeUsername(r.nextUrl.searchParams.get('q')??'');if(q&&!/^[a-zäöüß0-9_]{1,24}$/.test(q))return accountResponse({players:[]});return accountResponse({players:await rpc('player_search',{p_hash:s.token_hash,p_query:q})});}catch(e){return socialError(e,'020_username_search.sql');}}

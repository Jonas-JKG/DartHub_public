import type {NextRequest} from 'next/server';
import {db,DatabaseError} from './repositories/supabase';
import {primarySession} from './play-context';
import {deviceAccounts} from './device-accounts';
import {managerId} from './manager-access';
import {AccountRequestError} from './account-http';
import type {Session} from './repositories/interface';
import {wholePointGame,type DeckGame,type DeckSettings,type PublicDeckGame} from '../domain/dartdeck';
export type DeckRoom={id:string;host_id:string;phase:'waiting'|'playing'|'finished';settings:DeckSettings;game:DeckGame|null;last_game:DeckGame|null;version:number;created_at:string;updated_at:string};
export type DeckMember={id:string;room_id:string;account_id:string|null;controller_id:string;name:string;local:boolean;accepted:boolean;position:number};
export function checkDeckError(error:{message:string;code?:string}|null){if(error)throw new DatabaseError(error.message,error.code??'UNKNOWN');}
export async function deckAccounts(r:NextRequest,knownRoot?:Session|null){const root=knownRoot===undefined?await primarySession(r):knownRoot;if(root?.role!=='owner')throw new AccountRequestError('Bitte mit deinem Spielerkonto anmelden.',401);return {root,accounts:[root,...(await deviceAccounts(r,root)).map(a=>a.session)]};}
export async function deckAccess(r:NextRequest,id:string,known?:Awaited<ReturnType<typeof deckAccounts>>){
 const context=known??await deckAccounts(r);
 const [roomResult,membersResult]=await Promise.all([db().from('dartdeck_rooms').select('*').eq('id',id).maybeSingle(),db().from('dartdeck_members').select('*').eq('room_id',id).order('position')]);checkDeckError(roomResult.error);
 const room=roomResult.data as DeckRoom|null;if(!room)throw new AccountRequestError('Lobby nicht gefunden.',404);
 checkDeckError(membersResult.error);const members=(membersResult.data??[]) as DeckMember[];
 const ids=context.accounts.map(managerId),host=!context.root.manager_id||managerId(context.root)===room.host_id;
 if(!host&&!members.some(p=>p.account_id&&ids.includes(p.account_id)))throw new AccountRequestError('Du bist nicht zu dieser Lobby eingeladen.',403);
 return {...context,room,members,host,controlled:members.filter(p=>p.accepted&&ids.includes(p.controller_id)).map(p=>p.id)};
}
export function publicDeckGame(game:DeckGame|null):PublicDeckGame|null{if(!game)return null;const {deck:_deck,...view}=game;return wholePointGame(view);}
export function publicDeckRoom(room:DeckRoom){return {...room,game:publicDeckGame(room.game),last_game:publicDeckGame(room.last_game)};}

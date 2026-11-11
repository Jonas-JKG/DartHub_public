import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{session:mock.session},db:vi.fn(),rpc:mock.rpc}));
import {playSession} from '../src/server/play-context';
const parent={role:'owner',token_hash:'parent-a',manager_id:'manager-a'};
const child={role:'editor',token_hash:'child-a',manager_id:'manager-b',tournament_id:'foreign',account_session_hash:'parent-a',account_manager_id:'manager-a'};
const req=()=>new NextRequest('https://example.test/api/game',{headers:{cookie:'dartbracket_session=account; dartbracket_player=player'}});
beforeEach(()=>{mock.rpc.mockResolvedValue(null);mock.session.mockImplementation(async(raw:string)=>raw==='account'?parent:child);});
it('gebundener Spielerzugang gilt ausschließlich für sein Konto und Turnier',async()=>{expect(await playSession(req(),'foreign')).toEqual(child);expect(await playSession(req(),'own')).toEqual(parent);});
it('liegengebliebene Spieler-Cookies eines anderen Kontos werden ignoriert',async()=>{mock.session.mockImplementation(async(raw:string)=>raw==='account'?{...parent,token_hash:'parent-b'}:child);expect((await playSession(req(),'foreign'))?.token_hash).toBe('parent-b');});
it('ohne primäre Kontositzung und bei abgelaufenem Kind gibt es keine Spielerrechte',async()=>{mock.session.mockImplementation(async(raw:string)=>raw==='account'?null:child);expect(await playSession(req())).toBeNull();mock.session.mockImplementation(async(raw:string)=>raw==='account'?parent:null);expect(await playSession(req())).toEqual(parent);});

it('Konten erhalten nur die serverseitig zugeordnete Spielersitzung',async()=>{mock.rpc.mockResolvedValue(child);expect(await playSession(req(),'own')).toEqual(child);expect(mock.rpc).toHaveBeenCalledWith('account_play_session',{p_hash:parent.token_hash,p_id:'own'});});

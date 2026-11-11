import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
const m=vi.hoisted(()=>({access:vi.fn(),profile:vi.fn(),work:vi.fn(),boards:vi.fn(),ticket:vi.fn(),empty:vi.fn(),rpc:vi.fn()}));
vi.mock('../src/server/dartdeck',()=>({deckAccess:m.access}));
vi.mock('../src/server/play-context',()=>({playSession:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{},rpc:m.rpc}));
vi.mock('../src/server/saved-autodarts',()=>({savedAutodartsProfile:m.profile,withSavedAutodarts:m.work,profileOperation:vi.fn(),linkAutodarts:vi.fn(),SavedAutodartsError:class extends Error{constructor(message:string,public status:number){super(message);}}}));
vi.mock('../src/server/autodarts',()=>({listAutodartsBoards:m.boards,autodartsTicket:m.ticket,autodartsBoardEmpty:m.empty,autodartsImage:vi.fn(),loginAutodarts:vi.fn(),refreshAutodarts:vi.fn(),AutodartsError:class extends Error{}}));
import {POST} from '../src/app/api/autodarts/route';
const id=randomUUID(),player=randomUUID();
const request=(boardId='mine',context:string=id)=>new NextRequest('https://example.test/api/autodarts',{method:'POST',headers:{origin:'https://example.test','x-dartbracket-dartdeck':context},body:JSON.stringify({operation:'ticket',boardId})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_ORIGIN','https://example.test');vi.stubEnv('RATE_LIMIT_HMAC_KEY','2'.repeat(64));m.access.mockResolvedValue({root:{role:'owner',manager_id:randomUUID(),token_hash:'root'},members:[{id:player}],controlled:[player]});m.profile.mockResolvedValue({linked:true});m.rpc.mockResolvedValue(true);m.work.mockImplementation(async(_s,fn)=>fn('private-token'));m.boards.mockResolvedValue([{id:'mine',name:'Own board'}]);m.ticket.mockResolvedValue('wss://play.ws.autodarts.com/test');m.empty.mockResolvedValue(true);});
it('issues a ticket for an authenticated DartDeck participant using their own account profile',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(m.profile).toHaveBeenCalledWith(expect.objectContaining({role:'owner',participant_id:player,playing_tournament_id:id}));expect(await r.text()).not.toContain('private-token');});
it('a context header alone grants no board access and foreign boards are rejected',async()=>{m.access.mockResolvedValue({root:{role:'owner'},members:[],controlled:[]});expect((await POST(request())).status).toBe(401);expect(m.ticket).not.toHaveBeenCalled();m.access.mockRejectedValue(Error('not invited'));expect((await POST(request())).status).not.toBe(200);expect(m.ticket).not.toHaveBeenCalled();expect((await POST(request('mine','bad-id'))).status).toBe(401);});
it('membership does not grant access to a board owned by somebody else',async()=>{expect((await POST(request('foreign'))).status).toBe(403);expect(m.ticket).not.toHaveBeenCalled();});
it('issues the short-lived ticket only after the board bootstrap has completed',async()=>{
 let release!:(empty:boolean)=>void;m.empty.mockImplementation(()=>new Promise<boolean>(resolve=>{release=resolve;}));const response=POST(request());await vi.waitFor(()=>expect(m.empty).toHaveBeenCalledOnce());expect(m.ticket).not.toHaveBeenCalled();release(false);expect((await response).status).toBe(200);expect(m.ticket).toHaveBeenCalledOnce();
});

import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const m=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),get:vi.fn(),db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{session:m.session,get:m.get},rpc:m.rpc,db:m.db,DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
import {deviceAccounts,deviceTokens,setDeviceAccounts,deviceAccountsCookie} from '../src/server/device-accounts';
import {matchIdentity} from '../src/server/match-identity';
import {POST,GET} from '../src/app/api/game/route';
import {encrypt,hashToken} from '../src/server/security';
import {createTournament} from '../src/domain/tournament';
import {createGame,keypadHit} from '../src/domain/scoring';
import {randomUUID} from 'node:crypto';
import type {Session} from '../src/server/repositories/interface';
const root={role:'owner',token_hash:hashToken('root'),manager_id:randomUUID(),expires_at:'2099-01-01T00:00:00Z'} as Session;
const rawExtra='extra-account-token'.repeat(2),other={...root,token_hash:hashToken(rawExtra),manager_id:randomUUID()};
let t:ReturnType<typeof createTournament>,children:Session[],game:ReturnType<typeof createGame>;
function req(body?:unknown,cookie=encrypt(JSON.stringify({parent:root.token_hash,tokens:[rawExtra]}))){return new NextRequest('https://example.test/api/game'+(body?'':`?id=${t.id}&match=${t.matches[0].id}`),{method:body?'POST':'GET',headers:{origin:'https://example.test',cookie:`dartbracket_session=root; ${deviceAccountsCookie}=${cookie}`},...(body?{body:JSON.stringify({id:t.id,match:t.matches[0].id,expectedVersion:game.version,...body as object})}:{})});}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('ACCESS_ENCRYPTION_KEY','2'.repeat(64));vi.stubEnv('APP_ORIGIN','https://example.test');
 t=createTournament({id:randomUUID(),name:'Shared board',names:['One','Two','Three','Four'],mode:'knockout',groupSize:4,advancePerGroup:2},()=>0,randomUUID);t.status='running';
 game=createGame(t.matches[0].players as [string,string]);
 children=[root,other].map((r,i)=>({...r,role:'editor',token_hash:r.token_hash+':'+t.id,account_session_hash:r.token_hash,tournament_id:t.id,participant_id:game.players[i],participant_ids:[game.players[i]]}));
 m.session.mockImplementation(async(raw:string)=>raw==='root'?root:raw===rawExtra?other:null);
 m.rpc.mockImplementation(async(name:string,p:any)=>name==='account_play_session'?children.find(c=>c.account_session_hash===p.p_hash)??null:undefined);
 m.get.mockResolvedValue(t);m.db.mockReturnValue({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{state:game},error:null})};return q;}});
});
it('additional credentials are encrypted in an HttpOnly cookie bound to the exact primary login',async()=>{
 const response=setDeviceAccounts(NextResponse.json({ok:true}),root,[rawExtra]);const cookie=response.cookies.get(deviceAccountsCookie)!.value;
 expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);expect(response.headers.get('set-cookie')).toMatch(/SameSite=strict/i);expect(cookie).not.toContain(rawExtra);
 expect(deviceTokens(req(undefined,cookie),root)).toEqual([rawExtra]);expect(deviceTokens(req(undefined,cookie),{...root,token_hash:'different-login'})).toEqual([]);
 expect(deviceTokens(req(undefined,cookie.slice(0,-4)+'abcd'),root)).toEqual([]);expect(deviceTokens(req(undefined,cookie),null)).toEqual([]);
 expect((await deviceAccounts(req(undefined,cookie),root))[0].session.manager_id).toBe(other.manager_id);
 m.session.mockResolvedValue(null);expect(await deviceAccounts(req(undefined,cookie),root)).toEqual([]);
});
it('display combines owned players, but each action resolves to exactly one real scoped session',async()=>{
 const identity=await matchIdentity(req(),t.id,t.matches[0].id);expect(identity.session?.participant_ids).toEqual(game.players);expect(identity.deviceShared).toBe(true);
 for(const [i,actor] of game.players.entries()){
  m.rpc.mockClear();const r=await POST(req({operation:'action',actor,action:{type:'bull',hit:keypadHit(25,1)}}));expect(r.status).toBe(200);
  expect(m.rpc.mock.calls.find(([n])=>n==='write_game')?.[1]).toMatchObject({p_hash:children[i].token_hash});
  expect(m.rpc.mock.calls.filter(([n])=>n==='write_device_game'||n==='write_owner_game')).toHaveLength(0);
 }
 const data=await (await GET(req())).json();expect(data.sharedDevice).toBe(true);expect(data.session.participantIds).toEqual(game.players);expect(JSON.stringify(data)).not.toContain(rawExtra);
});
it('missing, revoked, tampered or differently bound accounts cannot act as the second player',async()=>{
 const post=(cookie?:string)=>POST(req({operation:'action',actor:game.players[1],action:{type:'bull',hit:keypadHit(25,1)}},cookie));
 for(const cookie of ['broken',encrypt(JSON.stringify({parent:'other-root',tokens:[rawExtra]})),encrypt(JSON.stringify({parent:root.token_hash,tokens:[]}))])expect((await post(cookie)).status).toBe(403);
 m.session.mockImplementation(async(raw:string)=>raw==='root'?root:null);expect((await post()).status).toBe(403);
 expect(m.rpc.mock.calls.filter(([n])=>n.startsWith('write_'))).toHaveLength(0);
});
it('presence is split by account and cannot announce an unrelated player',async()=>{
 expect((await POST(req({operation:'presence',players:game.players}))).status).toBe(200);
 expect(m.rpc.mock.calls.filter(([n])=>n==='match_player_presence').map(([,p])=>p)).toEqual(children.map(c=>({p_hash:c.token_hash,p_id:t.id,p_match:t.matches[0].id,p_players:c.participant_ids})));
 m.rpc.mockClear();expect((await POST(req({operation:'presence',players:[randomUUID()]}))).status).toBe(403);expect(m.rpc.mock.calls.some(([n])=>n==='match_player_presence')).toBe(false);
});
it('new matches receive the group override while knockout matches keep their target',async()=>{
 m.db.mockReturnValue({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:null})};return q;}});
 t.scoring={start:501,out:'double',legsToWin:2,groupLegsToWin:1};
 for(const phase of ['group','knockout'] as const){t.matches[0].phase=phase;const r=await POST(req({operation:'join',actor:game.players[0]}));expect(r.status).toBe(200);expect((await r.json()).game.rules.legsToWin).toBe(phase==='group'?1:2);}
});
it('board images use the active account session on the shared board',async()=>{
 const {POST:postImage}=await import('../src/app/api/game-image/route');
 const actor=game.players[1],r=await postImage(req({operation:'heartbeat',actor,connection:randomUUID(),visit:'bull:0'}));expect(r.status).toBe(200);
 expect(m.rpc.mock.calls.find(([n])=>n==='write_cached_board_image')?.[1]).toMatchObject({p_actor:actor,p_hash:children[1].token_hash});
});
it('three signed-in accounts can share a device without controlling someone else’s match',async()=>{
 const thirdRaw='third-account-token'.repeat(2),third={...root,token_hash:hashToken(thirdRaw),manager_id:randomUUID()},thirdChild={...children[0],account_session_hash:third.token_hash,token_hash:third.token_hash+':'+t.id,participant_id:t.participants.find(p=>!game.players.includes(p.id))!.id};thirdChild.participant_ids=[thirdChild.participant_id];
 m.session.mockImplementation(async raw=>raw==='root'?root:raw===rawExtra?other:raw===thirdRaw?third:null);
 m.rpc.mockImplementation(async(name,p)=>name==='account_play_session'?[...children,thirdChild].find(c=>c.account_session_hash===p.p_hash):undefined);
 const cookie=encrypt(JSON.stringify({parent:root.token_hash,tokens:[rawExtra,thirdRaw]}));expect((await matchIdentity(req(undefined,cookie),t.id,t.matches[0].id)).session?.participant_ids).toHaveLength(3);
 expect((await POST(req({operation:'action',actor:thirdChild.participant_id,action:{type:'bull',hit:keypadHit(25,1)}},cookie))).status).toBe(403);expect(m.rpc.mock.calls.some(([n])=>n.startsWith('write_'))).toBe(false);
});
it('admin sees attached players even when both sides are occupied by their own account presence',async()=>{
 m.session.mockImplementation(async raw=>raw==='root'?{...root,manager_id:null}:raw===rawExtra?other:null);
 m.rpc.mockImplementation(async(name,p)=>name==='account_play_session'?children.find(c=>c.account_session_hash===p.p_hash):name==='owner_available_players'?[]:undefined);
 const identity=await matchIdentity(req(),t.id,t.matches[0].id);expect(identity.session?.participant_ids).toEqual(game.players);expect(identity.session?.participant_id).toBe(game.players[0]);expect(identity.deviceShared).toBe(true);
 expect((await POST(req({operation:'action',actor:game.players[1],action:{type:'bull',hit:keypadHit(25,1)}}))).status).toBe(200);expect(m.rpc.mock.calls.find(([n])=>n==='write_game')?.[1].p_hash).toBe(children[1].token_hash);
});
it('a primary account’s remembered player from another tournament cannot mask the attached account',async()=>{
 m.session.mockImplementation(async raw=>raw==='root'?{...root,participant_id:randomUUID(),playing_tournament_id:randomUUID()}:raw===rawExtra?other:null);
 m.rpc.mockImplementation(async(name,p)=>name==='account_play_session'&&p.p_hash===other.token_hash?children[1]:null);
 const r=await GET(req());expect(r.status).toBe(200);const data=await r.json();expect(data.session).toMatchObject({participantId:game.players[1],participantIds:[game.players[1]],tournamentId:t.id});
});

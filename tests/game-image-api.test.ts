vi.mock('../src/server/camera',()=>({cameraFrame:async()=>null}));
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({session:vi.fn(),get:vi.fn(),rpc:vi.fn(),db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{session:mocks.session,get:mocks.get},rpc:mocks.rpc,db:mocks.db,DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
import { GET,POST } from '../src/app/api/game-image/route';
import { randomUUID } from 'node:crypto';
import { createGame,gameAction,gameView,keypadHit } from '../src/domain/scoring';
const id=randomUUID(),a=randomUUID(),b=randomUUID(),connection=randomUUID(),match='match-a';
const session={role:'editor',participant_id:a,tournament_id:id,token_hash:'owner-hash'};
let g=createGame([a,b],{start:301,out:'double',legsToWin:2});
g=gameAction(g,a,{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,b,{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,a,{type:'next'});g=gameAction(g,b,{type:'next'});
const body={id,match,connection,visit:'playing:0',operation:'frame',url:'https://boards.ws.autodarts.com/image/frame.jpg'};
function request(input:unknown=body,origin='http://localhost:3000'){return new NextRequest('http://localhost:3000/api/game-image',{method:'POST',headers:{origin,cookie:'dartbracket_session=test'},body:JSON.stringify(input)});}
function query(data:unknown){const q:{[key:string]:unknown}={maybeSingle:vi.fn().mockResolvedValue({data,error:null})};for(const k of ['select','eq','not'])q[k]=vi.fn(()=>q);return {from:()=>q};}
beforeEach(()=>{vi.clearAllMocks();process.env.APP_ORIGIN='http://localhost:3000';process.env.RATE_LIMIT_HMAC_KEY='2'.repeat(64);mocks.session.mockResolvedValue(session);mocks.get.mockResolvedValue({matches:[{id:match,players:[a,b]}]});mocks.rpc.mockResolvedValue(true);mocks.db.mockReturnValue(query({state:g}));vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>Promise.resolve(new Response(new Uint8Array([255,216,255,217]),{headers:{'content-type':'image/jpeg'}}))));});
afterEach(()=>vi.unstubAllGlobals());
it('fremde Anfrage, Zuschauer und Spieler eines anderen Matches laden kein Bild',async()=>{
 expect((await POST(request(body,'https://evil.test'))).status).toBe(403);mocks.session.mockResolvedValue({...session,participant_id:randomUUID()});expect((await POST(request())).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
});
it('nur Bilder vom Anbieter, in der aktuellen eigenen Aufnahme und begrenzter Größe werden geteilt',async()=>{
 expect((await POST(request({...body,url:'http://localhost:8000'}))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
 expect(await(await POST(request({...body,visit:'playing:99'}))).json()).toMatchObject({accepted:false});expect(fetch).not.toHaveBeenCalled();
 mocks.session.mockResolvedValue({...session,participant_id:b});expect(gameView(g).active).toBe(0);expect(await(await POST(request())).json()).toMatchObject({accepted:false});expect(fetch).not.toHaveBeenCalled();
 mocks.session.mockResolvedValue(session);const r=await POST(request());expect(r.status).toBe(200);expect(mocks.rpc).toHaveBeenLastCalledWith('write_cached_board_image',expect.objectContaining({p_hash:'owner-hash',p_image:'data:image/jpeg;base64,/9j/2Q=='}));expect(await r.text()).not.toContain('owner-hash');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('large',{headers:{'content-type':'image/jpeg','content-length':'1000001'}})));expect((await POST(request())).status).toBe(413);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})));expect((await POST(request())).status).toBe(502);
});
it('Lesen prüft Spieler-Lease, Aufnahme und Alter; unveränderte Bilder kosten keine erneute Übertragung',async()=>{
 const revision=randomUUID(),meta={revision,session_hash:'owner-hash',visit_key:'playing:0',updated_at:new Date().toISOString()};mocks.db.mockReturnValue(query(meta));mocks.rpc.mockResolvedValue(session);
 const r=new NextRequest('http://localhost:3000/api/game-image?'+new URLSearchParams({id,match,player:a,visit:'playing:0'}),{headers:{'if-none-match':'"'+revision+'"'}});
 expect((await GET(r)).status).toBe(304);mocks.rpc.mockResolvedValue({...session,participant_id:b});expect(await(await GET(r)).json()).toEqual({image:null});
 mocks.rpc.mockResolvedValue(session);mocks.db.mockReturnValue(query({...meta,updated_at:new Date(Date.now()-46000).toISOString()}));expect(await(await GET(r)).json()).toEqual({image:null});
 mocks.db.mockReturnValue(query({...meta,visit_key:'playing:2'}));expect(await(await GET(r)).json()).toEqual({image:null});
});

it('neue Aufnahme erhält nur die gespeicherte leere Scheibe, niemals alte Dartbilder',async()=>{
 const image='data:image/jpeg;base64,/9j/2Q==',empty_revision=randomUUID(),meta={revision:randomUUID(),empty_revision,session_hash:'owner-hash',visit_key:'playing:0',updated_at:new Date().toISOString()};let calls=0;mocks.db.mockImplementation(()=>query(calls++===0?meta:{image:'old-darts',empty_image:image}));mocks.rpc.mockResolvedValue({...session,participant_ids:[a,b]});const r=new NextRequest('http://localhost:3000/api/game-image?'+new URLSearchParams({id,match,player:a,visit:'playing:2'}));const response=await GET(r);expect(await response.json()).toEqual({image,cached:true,empty:true});expect(response.headers.get('etag')).toContain(empty_revision);
});

it('paralleles neues Bild erzeugt einen Retry statt eines leeren Kamerabildes',async()=>{
 const meta={revision:randomUUID(),session_hash:'owner-hash',visit_key:'playing:0',updated_at:new Date().toISOString()};let calls=0;
 mocks.db.mockImplementation(()=>query(calls++===0?meta:null));mocks.rpc.mockResolvedValue(session);
 const response=await GET(new NextRequest('http://localhost:3000/api/game-image?'+new URLSearchParams({id,match,player:a,visit:'playing:0'})));
 expect(await response.json()).toEqual({image:null,pending:true});expect(response.headers.get('etag')).toBeNull();
});

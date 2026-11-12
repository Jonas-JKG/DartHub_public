vi.mock('../src/server/camera',()=>({cameraFrame:async()=>null}));
import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
const m=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),db:vi.fn(),get:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({configured:()=>true,repository:{session:m.session,get:m.get},rpc:m.rpc,db:m.db,DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
import {POST as identity,GET as identityGET} from '../src/app/api/identity/route';
import {POST as training} from '../src/app/api/training/route';
import {GET as boardImage} from '../src/app/api/game-image/route';
import {POST as game} from '../src/app/api/game/route';
import {createTournament} from '../src/domain/tournament';
import {createGame} from '../src/domain/scoring';
import {hashToken,encrypt} from '../src/server/security';
const id=randomUUID(),guest={role:'guest',token_hash:'guest-hash',guest_id:randomUUID(),guest_name:'Gast'},owner={role:'owner',token_hash:'owner-hash',manager_id:null};
const req=(path:string,body:unknown,origin='https://example.test',cookie='dartbracket_session=current')=>new NextRequest('https://example.test/api/'+path,{method:'POST',headers:{origin,cookie},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_ORIGIN','https://example.test');vi.stubEnv('ACCESS_ENCRYPTION_KEY','11'.repeat(32));vi.stubEnv('RATE_LIMIT_HMAC_KEY','r'.repeat(64));m.session.mockResolvedValue(null);m.rpc.mockImplementation(async(name:string)=>['social_schema_ready','identity_schema_ready','consume_login_attempt'].includes(name)?true:null);});
it('Gastzugänge können nicht mehr angelegt werden und setzen kein Cookie',async()=>{const r=await identity(req('identity',{operation:'guest',name:'Anna'}));expect(r.status).toBe(400);expect(r.headers.get('set-cookie')).toBeNull();expect(m.rpc.mock.calls.some(([n])=>n==='create_guest_identity')).toBe(false);});
it('fremde Herkunft verändert keine Zugänge oder Einladungen',async()=>{for(const operation of ['heartbeat'])expect((await identity(req('identity',{operation,name:'Gast'},'https://evil.test'))).status).toBe(403);expect(m.session).not.toHaveBeenCalled();});
it('Freigabe und Anwesenheit verwenden nur die authentifizierte Kontositzung',async()=>{m.session.mockResolvedValue(owner);await identity(req('identity',{operation:'heartbeat'}));expect(m.rpc).toHaveBeenCalledWith('social_presence',{p_hash:owner.token_hash});});
it('Owner-Eingabe verwendet Vertretungsrechte; belegte Seiten bleiben gesperrt',async()=>{const t={...createTournament({id,kind:'training',name:'Owner',names:['A','B'],mode:'knockout',groupSize:2,advancePerGroup:1},()=>0,randomUUID),status:'running' as const};const g=createGame(t.matches[0].players as [string,string],t.scoring);m.session.mockResolvedValue(owner);m.get.mockResolvedValue(t);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{state:g},error:null})};m.db.mockReturnValue({from:()=>q});m.rpc.mockImplementation(async(name:string)=>name==='owner_available_players'?[g.players[0]]:true);const body={id,match:t.matches[0].id,operation:'action',actor:g.players[1],expectedVersion:g.version,action:{type:'undo'}};expect((await game(req('game',body))).status).toBe(403);expect(m.rpc.mock.calls.some(([n])=>n==='write_owner_game')).toBe(false);});

it('alte gespeicherte Owner-Spielerauswahl hält kein Vertretungsbild eines inzwischen anwesenden Spielers offen',async()=>{const t=createTournament({id,kind:'training',name:'Bilder',names:['A','B'],mode:'knockout',groupSize:2,advancePerGroup:1},()=>0,randomUUID),player=t.matches[0].players[1]!;m.session.mockResolvedValue(owner);m.get.mockResolvedValue(t);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{revision:randomUUID(),session_hash:owner.token_hash,visit_key:'bull:1',updated_at:new Date().toISOString()},error:null})};m.db.mockReturnValue({from:()=>q});m.rpc.mockImplementation(async(name:string)=>name==='read_session'?{...owner,participant_ids:[player],playing_tournament_id:id}:name==='owner_available_players'?[t.matches[0].players[0]]:true);const r=await boardImage(new NextRequest('https://example.test/api/game-image?id='+id+'&match='+t.matches[0].id+'&player='+player+'&visit=bull:1',{headers:{cookie:'dartbracket_session=current'}}));expect(r.status).toBe(200);expect(await r.json()).toEqual({image:null});expect(m.db.mock.calls).toHaveLength(1);});

it('only verified persistent identities refresh cookies; finite Admin sessions and failed checks do not',async()=>{
 const persistent={...owner,manager_id:randomUUID(),expires_at:'infinity'};
 m.session.mockResolvedValue(persistent);m.rpc.mockImplementation(async(name)=>name==='account_identity'?{signedIn:true,role:'player'}:true);
 const request=new NextRequest('https://example.test/api/identity',{headers:{cookie:'dartbracket_session=current; dartbracket_device_accounts=encrypted'}});
 const response=await identityGET(request);expect(response.cookies.get('dartbracket_session')?.value).toBe('current');expect(response.cookies.get('dartbracket_device_accounts')?.value).toBe('encrypted');
 m.rpc.mockResolvedValue({signedIn:false});expect((await identityGET(request)).headers.get('set-cookie')).toBeNull();
 m.session.mockResolvedValue(owner);expect((await identityGET(request)).headers.get('set-cookie')).toBeNull();
});

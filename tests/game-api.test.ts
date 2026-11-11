import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomInt,randomUUID } from 'node:crypto';
import { createTournament,type Tournament } from '../src/domain/tournament';
import { createGame,gameAction,keypadHit,type Game } from '../src/domain/scoring';
const mocks=vi.hoisted(()=>({session:vi.fn(),get:vi.fn(),rpc:vi.fn(),db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({
  repository:{session:mocks.session,get:mocks.get},rpc:mocks.rpc,db:mocks.db,
  DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}},
}));
import { GET, POST } from '../src/app/api/game/route';
let t:Tournament,g:Game;
const session={role:'editor',tournament_id:'',participant_id:'',token_hash:'a'.repeat(64)};
function request(action:unknown,expected=g.version,origin='http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/game',{method:'POST',headers:{origin,'content-type':'application/json',cookie:'dartbracket_session=test'},body:JSON.stringify({id:t.id,match:t.matches[0].id,operation:'action',expectedVersion:expected,action})});
}
beforeEach(()=>{
  vi.clearAllMocks();process.env.APP_ORIGIN='http://localhost:3000';
  t=createTournament({id:randomUUID(),name:'API Spiel',names:['Jonas','Leon','Anton','Saru'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);t.status='running';
  g=createGame(t.matches[0].players as [string,string]);
  session.tournament_id=t.id;session.participant_id=g.players[0];mocks.session.mockResolvedValue(session);mocks.get.mockResolvedValue(t);mocks.rpc.mockResolvedValue(undefined);
  const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockImplementation(()=>Promise.resolve({data:{state:g},error:null}))};
  mocks.db.mockReturnValue({from:()=>chain});
});
describe('Game-API',()=>{
  it('Admin spielt nur als ausgewählter Teilnehmer des richtigen Turniers',async()=>{
    mocks.session.mockResolvedValue({...session,role:'owner',tournament_id:null,playing_tournament_id:t.id});
    expect((await POST(request({type:'bull',hit:keypadHit(25,2)}))).status).toBe(200);
    mocks.rpc.mockClear();mocks.session.mockResolvedValue({...session,role:'owner',tournament_id:null,playing_tournament_id:randomUUID()});
    expect((await POST(request({type:'bull',hit:keypadHit(25,2)}))).status).toBe(403);expect(mocks.rpc.mock.calls.filter(([name])=>name.startsWith('write_'))).toHaveLength(0);
  });
  it('fremde Origin wird vor jedem Zugriff abgewiesen',async()=>{expect((await POST(request({type:'undo'},g.version,'https://evil.example'))).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();});
  it('Gast, nicht ausgewählter Spieler und fremder Spieler dürfen nicht schreiben',async()=>{
    for(const user of [null,{...session,participant_id:null},{...session,participant_id:randomUUID()}]){
      mocks.session.mockResolvedValue(user);expect((await POST(request({type:'bull',hit:keypadHit(25,2)}))).status).toBe(user?403:401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('Ausbullen trägt ausschließlich den eigenen Marker ein',async()=>{
    const r=await POST(request({type:'bull',hit:keypadHit(25,2)}));expect(r.status).toBe(200);
    const args=mocks.rpc.mock.calls[0][1];expect(args.p_state.bull[0].number).toBe(25);expect(args.p_state.bull[1]).toBeNull();
  });
  it('Gegner am falschen Zug und manipulierte Feldwerte werden abgewiesen',async()=>{
    g=gameAction(g,g.players[0],{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,g.players[1],{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,g.players[0],{type:'next'});g=gameAction(g,g.players[1],{type:'next'});
    mocks.session.mockResolvedValue({...session,participant_id:g.players[1]});
    expect((await POST(request({type:'dart',hit:keypadHit(20,3)}))).status).toBe(400);
    mocks.session.mockResolvedValue(session);
    expect((await POST(request({type:'dart',hit:{...keypadHit(20,3),number:1}}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('veraltete Version verändert keine Daten',async()=>{
    expect((await POST(request({type:'bull',hit:keypadHit(25,2)},g.version-1))).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it('gemeinsames Gerät darf als zweiter reservierter Spieler handeln, Fremde bleiben gesperrt',async()=>{
 mocks.session.mockResolvedValue({...session,participant_ids:g.players});
 const as=(actor:string)=>new NextRequest('http://localhost:3000/api/game',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',cookie:'dartbracket_session=test'},body:JSON.stringify({id:t.id,match:t.matches[0].id,operation:'action',expectedVersion:g.version,actor,action:{type:'bull',hit:keypadHit(25,1)}})});
 expect((await POST(as(g.players[1]))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('write_device_game',expect.objectContaining({p_actor:g.players[1]}));mocks.rpc.mockClear();expect((await POST(as(randomUUID()))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
});

it('Owner darf ohne Spielerzuordnung administrativ zurücksetzen; Spieler und unbestätigte Anfragen nicht',async()=>{
 const reset=(confirmed:boolean)=>new NextRequest('http://localhost:3000/api/game',{method:'POST',headers:{origin:'http://localhost:3000',cookie:'dartbracket_session=test'},body:JSON.stringify({id:t.id,match:t.matches[0].id,operation:'reset',expectedVersion:g.version,confirmed})});
 expect((await POST(reset(true))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 mocks.session.mockResolvedValue({...session,role:'owner',tournament_id:null,playing_tournament_id:null,participant_id:null});
 expect((await POST(reset(false))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 expect((await POST(reset(true))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('reset_game',expect.objectContaining({p_id:t.id,p_match:t.matches[0].id,p_expected:t.version}));
 expect(mocks.rpc.mock.calls[0][1].p_state.matches[0]).toMatchObject({status:'pending',legs:[null,null]});
});

it('Host behält Reset-Recht bei gebundenem Spielerzugang, fremde Manager erhalten es nicht',async()=>{
 const ma=randomUUID();t.managerId=ma;
 const parent={role:'owner',manager_id:ma,token_hash:'parent'},child={...session,account_session_hash:'parent'};
 mocks.session.mockImplementation(async(raw:string)=>raw==='account'?parent:child);
 const request=new NextRequest('http://localhost:3000/api/game?id='+t.id+'&match='+t.matches[0].id,{headers:{cookie:'dartbracket_session=account; dartbracket_player=child'}});
 expect(await (await GET(request)).json()).toMatchObject({canReset:true,session:{role:'editor'}});
 t.managerId=randomUUID();expect(await (await GET(request)).json()).toMatchObject({canReset:false});
});

it('a duplicate final confirmation returns the saved game without another write; spectators stay forbidden',async()=>{
 g={...g,phase:'finished',version:42};t.status='completed';t.matches[0].status='finished';
 const response=await POST(request({type:'next'},41));expect(response.status).toBe(200);expect((await response.json()).game.version).toBe(42);expect(mocks.rpc).not.toHaveBeenCalled();
 mocks.session.mockResolvedValue({...session,participant_id:randomUUID()});expect((await POST(request({type:'next'},41))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
});

it('solo Around-the-Clock completion writes real leg values that older training databases accept',async()=>{
 const {createTrainingGame}=await import('../src/domain/scoring');
 g=createTrainingGame(t.matches[0].players as string[],{start:501,out:'single',legsToWin:1},true,'around-clock',session.participant_id);
 for(const n of [...Array.from({length:20},(_,i)=>i+1),25]){g=gameAction(g,session.participant_id,{type:'dart',hit:keypadHit(n,1)});if(g.current.length===3&&n!==25)g=gameAction(g,session.participant_id,{type:'next'});}
 const response=await POST(request({type:'next'}));expect(response.status).toBe(200);
 const args=mocks.rpc.mock.calls.find(([name])=>name==='write_game')![1];expect(args.p_state.phase).toBe('finished');expect(args.p_tournament.matches[0]).toMatchObject({status:'finished',winner:session.participant_id,legs:[1,0]});
});

it('Clock writes use canonical state rather than enriched repository metadata',async()=>{
 const {createTrainingGame}=await import('../src/domain/scoring');g=createTrainingGame(t.matches[0].players as string[],{start:501,out:'single',legsToWin:1},true,'around-clock',session.participant_id);
 for(const n of [...Array.from({length:20},(_,i)=>i+1),25]){g=gameAction(g,session.participant_id,{type:'dart',hit:keypadHit(n,1)});if(g.current.length===3&&n!==25)g=gameAction(g,session.participant_id,{type:'next'});}
 mocks.get.mockImplementation(async(_id,_session,options)=>options?.stateOnly?t:{...t,managerName:'Added for display',managerId:'not-in-json',viewerOnly:false,linkedParticipantIds:[session.participant_id]});
 expect((await POST(request({type:'next'}))).status).toBe(200);expect(mocks.get).toHaveBeenCalledWith(t.id,expect.anything(),{stateOnly:true});const saved=mocks.rpc.mock.calls.find(([name])=>name==='write_game')![1].p_tournament;
 for(const key of ['managerName','managerId','viewerOnly','linkedParticipantIds'])expect(saved).not.toHaveProperty(key);expect(saved.matches[0].status).toBe('finished');
});
it('a changed canonical tournament rejects the completion before writing',async()=>{
 mocks.get.mockImplementation(async(_id,_session,options)=>options?.stateOnly?{...t,version:t.version+1}:t);
 const reset=new NextRequest('http://localhost:3000/api/game',{method:'POST',headers:{origin:'http://localhost:3000',cookie:'dartbracket_session=test'},body:JSON.stringify({id:t.id,match:t.matches[0].id,operation:'reset',expectedVersion:g.version,confirmed:true})});
 mocks.session.mockResolvedValue({...session,role:'owner',tournament_id:null,playing_tournament_id:null});expect((await POST(reset)).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('a structural write rejection is not reported as an expired login',async()=>{
 const {DatabaseError}=await import('../src/server/repositories/supabase');mocks.rpc.mockRejectedValue(new DatabaseError('Strukturelle Änderung nicht erlaubt','42501'));
 const response=await POST(request({type:'bull',hit:keypadHit(25,2)}));expect(response.status).toBe(403);expect((await response.json()).error).toContain('Turnieränderungen');
});

it('permission and expired-session errors remain distinguishable',async()=>{
 const {DatabaseError}=await import('../src/server/repositories/supabase');
 for(const [code,errorCode] of [['42501','SCORING_PERMISSION_DENIED'],['28000','SESSION_EXPIRED']]){
  mocks.rpc.mockRejectedValue(new DatabaseError('Nicht erlaubt',code));const r=await POST(request({type:'bull',hit:keypadHit(25,2)}));expect(r.status).toBe(403);expect(await r.json()).toMatchObject({errorCode});
 }
});

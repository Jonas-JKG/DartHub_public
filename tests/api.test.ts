import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomInt, randomUUID } from 'node:crypto';
import { createTournament, updateMatch, type Tournament } from '../src/domain/tournament';
import { decrypt, encrypt, hashPassword, hashToken, verifyPassword } from '../src/server/security';
const mocks=vi.hoisted(()=>({session:vi.fn(),get:vi.fn(),save:vi.fn(),create:vi.fn(),remove:vi.fn(),list:vi.fn(),rpc:vi.fn(),db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({
  configured:()=>true,repository:{session:mocks.session,get:mocks.get,save:mocks.save,create:mocks.create,remove:mocks.remove,list:mocks.list},rpc:mocks.rpc,db:mocks.db,
  DatabaseError:class extends Error {code:string;constructor(message:string,code:string){super(message);this.code=code;}},
}));
import { DatabaseError } from '../src/server/repositories/supabase';
import { GET, POST } from '../src/app/api/app/route';
import { createGame,gameAction,gameView,keypadHit } from '../src/domain/scoring';
let t:Tournament;
let pinHash:string;
const owner={role:'owner',tournament_id:null,token_hash:hashToken('owner-session'),credential_version:1,expires_at:'2099-01-01'};
function request(action:string,payload?:unknown,id=t.id,expectedVersion=t.version,confirmation?:string,origin='http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/app',{method:'POST',headers:{origin,'content-type':'application/json',cookie:'dartbracket_session=test-token'},body:JSON.stringify({action,payload,id,expectedVersion,confirmation})});
}
beforeAll(async()=>{
  process.env.APP_ORIGIN='http://localhost:3000';process.env.ACCESS_ENCRYPTION_KEY='b'.repeat(64);process.env.RATE_LIMIT_HMAC_KEY='c'.repeat(64);
  pinHash=await hashPassword('012345');process.env.OWNER_PASSWORD_HASH=await hashPassword('mein-admin-passwort');
});
beforeEach(()=>{
  vi.clearAllMocks();
  t=createTournament({id:randomUUID(),name:'API-Test',names:['Anna','Berta','Clara','Dora'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);t.status='running';
  mocks.session.mockResolvedValue(owner);mocks.get.mockImplementation(()=>Promise.resolve(t));mocks.save.mockResolvedValue(undefined);mocks.rpc.mockResolvedValue(true);
  const credential={tournament_id:t.id,admin_hash:pinHash,admin_version:1,editor_secret:encrypt(JSON.stringify({link:'x'.repeat(43),pin:'012345'})),editor_pin_hash:pinHash,editor_enabled:true,editor_version:1};
  const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:credential,error:null}),maybeSingle:vi.fn().mockResolvedValue({data:credential}),then:(resolve:(value:unknown)=>void)=>resolve({data:[credential],error:null}),insert:vi.fn().mockResolvedValue({error:null}),delete:vi.fn().mockReturnThis()};mocks.db.mockReturnValue({from:()=>chain});
});
describe('Serverseitige API-Sicherheitsgrenzen',()=>{
  it('alte Spielerauswahl und Codeverwaltung sind keine API-Aktionen mehr',async()=>{for(const action of ['choose-player','join-player','access'])expect((await POST(request(action,{}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
  it('fremde Origin wird vor jedem Datenzugriff abgelehnt',async()=>{const res=await POST(request('score',{},t.id,t.version,undefined,'https://fremd.example'));expect(res.status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();});
  it('Zuschauer darf keine Ergebnisse schreiben',async()=>{mocks.session.mockResolvedValue(null);expect((await POST(request('score',{}))).status).toBe(401);expect(mocks.save).not.toHaveBeenCalled();});
  for(const action of ['create','rename','redraw','status','delete','ranking','lobby','draw','scoring'])it(`Editor darf ${action} nicht aufrufen`,async()=>{
    mocks.session.mockResolvedValue({...owner,role:'editor',tournament_id:t.id,participant_id:t.matches[0].players[0]});expect((await POST(request(action,{}))).status).toBe(403);expect(mocks.save).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
  });
  it('Editor kann keine fremde Turnier-ID verwenden',async()=>{mocks.session.mockResolvedValue({...owner,role:'editor',tournament_id:randomUUID()});expect((await POST(request('score',{}))).status).toBe(403);expect(mocks.get).not.toHaveBeenCalled();});
  it('Match-ID eines anderen Turniers wird abgelehnt',async()=>{mocks.session.mockResolvedValue({...owner,role:'editor',tournament_id:t.id,participant_id:t.matches[0].players[0]});const res=await POST(request('score',{matchId:'fremdes-match',result:{legs:[3,1],status:'finished',forfeited:null}}));expect(res.status).toBe(403);expect(mocks.save).not.toHaveBeenCalled();});
  it('veraltete Version schreibt nichts',async()=>{const res=await POST(request('score',{},t.id,t.version+1));expect(res.status).toBe(409);expect((await res.json()).conflict).toBe(true);expect(mocks.save).not.toHaveBeenCalled();});
  it('Editor schreibt Ergebnis und Gewinnerfortschreibung',async()=>{
    mocks.session.mockResolvedValue({...owner,role:'editor',tournament_id:t.id,participant_id:t.matches[0].players[0]});const m=t.matches[0];
    const res=await POST(request('score',{matchId:m.id,result:{legs:[3,1],status:'finished',forfeited:null}}));expect(res.status).toBe(200);
    const written=mocks.save.mock.calls[0][0] as Tournament;expect(written.matches[0].winner).toBe(m.players[0]);expect(written.matches.at(-1)?.players[0]).toBe(m.players[0]);
  });
  it('Folgeergebnisse benötigen passende Bestätigung, die bei Versionsänderung verfällt',async()=>{
    while(!t.winner){const m=t.matches.find(m=>!m.automatic&&m.status!=='finished'&&m.players.every(Boolean))!;t=updateMatch(t,m.id,{legs:[3,1],status:'finished',forfeited:null}).tournament;}
    const payload={matchId:t.matches[0].id,result:{legs:[1,3],status:'finished',forfeited:null}};
    const preview=await (await POST(request('score',payload))).json();expect(preview.needsConfirmation).toBe(true);expect(preview.resets).toEqual(['ko-2-0']);expect(mocks.save).not.toHaveBeenCalled();
    const saved=await POST(request('score',payload,t.id,t.version,preview.confirmation));expect(saved.status).toBe(200);expect(mocks.save).toHaveBeenCalledOnce();
    mocks.save.mockClear();const oldVersion=t.version;t.version++;const stale=await POST(request('score',payload,t.id,oldVersion,preview.confirmation));expect(stale.status).toBe(409);expect(mocks.save).not.toHaveBeenCalled();
  });
  it('alte persönliche PINs melden keinen Spieler mehr an',async()=>{for(const password of ['999999','012345']){const r=await POST(request('login',{role:'editor',password}));expect(r.status).toBe(410);expect(r.headers.get('set-cookie')).toBeNull();}});
  it('Rate-Limit beendet Anmeldung vor der Passwortprüfung',async()=>{mocks.rpc.mockResolvedValue(false);const res=await POST(request('login',{role:'owner',password:'012345'}));expect(res.status).toBe(429);expect(mocks.db).not.toHaveBeenCalled();});
  it('ungültige Legs und Gleichstand werden serverseitig abgelehnt',async()=>{for(const legs of [[-1,0],[1,1]]){const res=await POST(request('score',{matchId:t.matches[0].id,result:{legs,status:'finished',forfeited:null}}));expect(res.status).toBe(400);}expect(mocks.save).not.toHaveBeenCalled();});
  it('Turnier-Erstellung ohne ausgewählte Konten wird abgelehnt',async()=>{const r=await POST(request('create',{name:'Neues Turnier',names:['Anna','Berta','Clara'],mode:'knockout',groupSize:4,advancePerGroup:2}));expect(r.status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();});
  it('Admin-Anmeldung und vorhandene Admin-Sitzungen werden abgelehnt',async()=>{
    expect((await POST(request('login',{role:'admin',password:'012345'}))).status).toBe(400);
    mocks.session.mockResolvedValue({...owner,role:'admin',tournament_id:t.id});
    expect((await POST(request('rename',{name:'Neu'}))).status).toBe(401);expect(mocks.save).not.toHaveBeenCalled();
  });
  it('gemeinsame Anmeldung erkennt Admin-Passwort ohne Rollenwahl',async()=>{
    const res=await POST(request('login',{password:'mein-admin-passwort'}));
    expect(res.status).toBe(200);expect(await res.json()).toMatchObject({role:'admin',redirect:'/',tournamentId:null});
    const expires=res.cookies.get('dartbracket_session')!.expires as Date;expect(Math.abs(expires.getTime()-Date.now()-7*86400000)).toBeLessThan(3000);
  });
  it('PINs öffnen auch bei behaupteter Owner-Rolle kein Turnier',async()=>{const r=await POST(request('login',{password:'012345',role:'owner'}));expect(r.status).toBe(401);expect(r.headers.get('set-cookie')).toBeNull();});
  it('deaktivierte PIN funktioniert auch über die gemeinsame Anmeldung nicht',async()=>{
    mocks.db.mockReturnValue({from:()=>({select:()=>Promise.resolve({data:[{tournament_id:t.id,editor_secret:encrypt(JSON.stringify({pin:'012345'})),editor_enabled:false,editor_pin_hash:pinHash}],error:null})})});
    expect((await POST(request('login',{password:'012345'}))).status).toBe(401);
  });
});

it('Bracket zeigt bestätigte Live-Legs ohne den Sieger vorzeitig fortzuschreiben',async()=>{
 const m=t.matches[0],players=m.players as [string,string];let g=createGame(players,{start:301,out:'single',legsToWin:2});
 g=gameAction(g,players[0],{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,players[1],{type:'bull',hit:keypadHit(25,1)});for(const player of players)g=gameAction(g,player,{type:'next'});
 for(let i=0;i<3;i++)g=gameAction(g,players[0],{type:'dart',hit:keypadHit(20,3)});g=gameAction(g,players[0],{type:'next'});
 g=gameAction(g,players[1],{type:'dart',hit:keypadHit(0,1)});g=gameAction(g,players[1],{type:'next'});
 for(const h of [keypadHit(20,3),keypadHit(15,3),keypadHit(16,1)])g=gameAction(g,players[0],{type:'dart',hit:h});g=gameAction(g,players[0],{type:'next'});
 expect(gameView(g).legs).toEqual([1,0]);expect(g.phase).toBe('playing');mocks.list.mockResolvedValue([t]);
 const chain={select:vi.fn().mockReturnThis(),neq:vi.fn().mockResolvedValue({data:[{tournament_id:t.id,match_id:m.id,state:g}],error:null})};mocks.db.mockReturnValue({from:()=>chain});
 const r=await GET(new NextRequest('http://localhost:3000/api/app',{headers:{cookie:'dartbracket_session=test'}}));expect(r.status).toBe(200);const d=await r.json();expect(d.tournaments[0].matches[0].legs).toEqual([1,0]);expect(d.tournaments[0].matches[0].winner).toBeNull();expect(d.tournaments[0].version).toBe(t.version);expect(t.matches[0].legs).not.toEqual([1,0]);expect(mocks.save).not.toHaveBeenCalled();
});
it.each([null,'00000000-0000-4000-8000-000000000002'])('Owner und Ersteller dürfen Ergebnisse anderer Teilnehmer korrigieren, auch wenn sie selbst mitspielen (%s)',async(managerId)=>{t.managerId=managerId??'00000000-0000-4000-8000-000000000001';mocks.session.mockResolvedValue({...owner,manager_id:managerId});const target=t.matches[1];mocks.rpc.mockImplementation(async(name:string)=>name==='account_play_session'?{role:'editor',participant_id:t.matches[0].players[0],participant_ids:[t.matches[0].players[0]],account_session_hash:owner.token_hash}:true);const r=await POST(request('score',{matchId:target.id,result:{legs:[2,1],status:'finished',forfeited:null}}));expect(r.status).toBe(200);expect(mocks.save.mock.calls[0][2]).toMatchObject({role:'owner',manager_id:managerId});expect(mocks.rpc.mock.calls.some(([name])=>name==='account_play_session')).toBe(false);});

it('future phase leg targets can change without redrawing participants, matches or results',async()=>{
 t.mode='groups';const before=structuredClone(t);const r=await POST(request('scoring',{start:501,out:'double',legsToWin:2,groupLegsToWin:1}));expect(r.status).toBe(200);
 const saved=mocks.save.mock.calls[0][0];expect(saved.scoring).toEqual({start:501,out:'double',legsToWin:2,groupLegsToWin:1});expect(saved.participants).toEqual(before.participants);expect(saved.matches).toEqual(before.matches);expect(saved.version).toBe(before.version+1);
 expect(mocks.get).toHaveBeenCalledWith(t.id,expect.anything(),{stateOnly:true});
});
it('phase targets reject zero, fractions and excessive goals without writes',async()=>{for(const groupLegsToWin of [0,1.5,21])expect((await POST(request('scoring',{start:501,out:'double',legsToWin:2,groupLegsToWin}))).status).toBe(400);expect(mocks.save).not.toHaveBeenCalled();});

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { createTournament, updateMatch, type Tournament } from '../src/domain/tournament';
import { hashToken } from '../src/server/security';
let db:PGlite;
const owner=hashToken('test-owner'),admin=hashToken('test-admin'),editor=hashToken('test-editor');
const credentials={admin_hash:'test-hash',editor_link_hash:hashToken('test-link'),editor_pin_hash:'test-pin-hash',editor_secret:'test-encrypted'};
let tournament:Tournament;
const call=(name:string,args:unknown[])=>db.query<{result:unknown}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args);
beforeAll(async()=>{
  db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
  await db.exec(await readFile(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8'));
  await db.query("insert into public.sessions values ($1,'owner',null,1,now()+interval '1 day')",[owner]);
  tournament=createTournament({id:randomUUID(),name:'Datenbanktest',names:['Anna','Berta','Clara','Dora'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);
  await call('create_tournament',[tournament,credentials,owner]);
  await db.query("insert into public.sessions values ($1,'admin',$2,1,now()+interval '1 day'),($3,'editor',$2,1,now()+interval '1 day')",[admin,tournament.id,editor]);
},30000);
afterAll(async()=>{await db?.close();});

describe('Echte PostgreSQL-Migration und Berechtigungen',()=>{
  it('normalisiert Teilnehmer, Matches, Ergebnisse und Freigaben',async()=>{
    expect((await db.query<{count:number}>('select count(*)::integer as count from public.tournament_participants')).rows[0].count).toBe(4);
    expect((await db.query<{count:number}>('select count(*)::integer as count from public.matches')).rows[0].count).toBe(3);
    expect((await db.query('select * from public.match_dependencies')).rows).toHaveLength(2);
  });
  it('Zuschauer kann ausschließlich öffentliche Daten lesen',async()=>{
    await db.exec('set role anon');
    try{
      expect((await db.query('select state from public.public_tournament_snapshots')).rows).toHaveLength(1);
      await expect(db.query('select * from public.tournament_credentials')).rejects.toThrow();
      await expect(db.query("update public.public_tournament_snapshots set archived=true")).rejects.toThrow();
      await expect(call('read_session',[owner])).rejects.toThrow();
    }finally{await db.exec('reset role');}
  });
  it('Editor und Admin können kein anderes Turnier verwalten',async()=>{
    await expect(call('assert_session',[editor,randomUUID(),'score'])).rejects.toThrow();
    await expect(call('assert_session',[admin,randomUUID(),'manage'])).rejects.toThrow();
    await expect(call('assert_session',[editor,tournament.id,'manage'])).rejects.toThrow();
    await expect(call('assert_session',[editor,tournament.id,'access'])).rejects.toThrow();
    await expect(call('assert_session',[admin,tournament.id,'delete'])).rejects.toThrow();
  });
  it('Owner startet; Editor speichert Score und Fortschreibung atomar',async()=>{
    tournament={...tournament,status:'running',startedAt:new Date().toISOString(),version:2,updatedAt:new Date().toISOString()};
    await call('save_tournament',[tournament,1,owner,'manage',{}]);
    const m=tournament.matches[0];const next=updateMatch(tournament,m.id,{legs:[3,1],status:'finished',forfeited:null}).tournament;
    next.version=3;next.updatedAt=new Date().toISOString();
    await call('save_tournament',[next,2,editor,'score',{action:'score'}]);tournament=next;
    const snapshot=(await db.query<{state:Tournament}>('select state from public.public_tournament_snapshots')).rows[0].state;
    expect(snapshot.matches[0].winner).toBe(m.players[0]);expect(snapshot.matches.at(-1)?.players[0]).toBe(m.players[0]);
    expect((await db.query('select * from public.audit_events')).rows).toHaveLength(3);
  });
  it('zweite gleichzeitige Änderung überschreibt den ersten Stand nicht',async()=>{
    const next={...tournament,version:4,updatedAt:new Date().toISOString()};
    const results=await Promise.allSettled([call('save_tournament',[next,3,editor,'score',{}]),call('save_tournament',[next,3,editor,'score',{}])]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);tournament=next;
  });
  it('Editor darf keine Teilnehmer ändern oder archivieren',async()=>{
    const changed={...tournament,version:5,participants:tournament.participants.map((p,i)=>i===0?{...p,name:'Manipuliert'}:p)};
    await expect(call('save_tournament',[changed,4,editor,'score',{}])).rejects.toThrow();
    await expect(call('save_tournament',[{...tournament,status:'archived',version:5},4,editor,'score',{}])).rejects.toThrow();
    expect((await db.query<{version:number}>('select version from public.tournaments')).rows[0].version).toBe(4);
  });
  it('ungültiges Ergebnis rollt Zustand, Snapshot und Historie zurück',async()=>{
    const invalid=structuredClone(tournament);invalid.version=5;invalid.matches[0].legs=[1,1];
    await expect(call('save_tournament',[invalid,4,owner,'manage',{}])).rejects.toThrow();
    expect((await db.query<{version:number}>('select version from public.tournaments')).rows[0].version).toBe(4);
    expect((await db.query<{version:number}>('select version from public.public_tournament_snapshots')).rows[0].version).toBe(4);
  });
  it('persistentes Rate-Limit zählt Versuche',async()=>{
    for(let i=0;i<3;i++){const result=await call('consume_login_attempt',['test-rate',2]);expect(result.rows[0].result).toBe(i<2);}
  });
  it('Widerruf macht alle Editor-Sitzungen ungültig, PIN bleibt gleich',async()=>{
    expect((await call('read_session',[editor])).rows[0].result).toBeTruthy();
    await call('manage_access',[tournament.id,owner,'revoke',null]);
    expect((await call('read_session',[editor])).rows[0].result).toBeNull();
    expect((await db.query<{editor_pin_hash:string}>('select editor_pin_hash from public.tournament_credentials')).rows[0].editor_pin_hash).toBe('test-pin-hash');
  });
  it('archiviertes Turnier verschwindet aus öffentlicher Ansicht und Live-Auswahl',async()=>{
    const next={...tournament,status:'archived',version:5,updatedAt:new Date().toISOString()};await call('save_tournament',[next,4,owner,'archive',{}]);
    await db.exec('set role anon');try{expect((await db.query('select * from public.public_tournament_snapshots')).rows).toHaveLength(0);}finally{await db.exec('reset role');}
    expect((await db.query<{tournament_id:string|null}>('select tournament_id from public.public_live_state')).rows[0].tournament_id).toBeNull();
  });
  for(const n of [3,5,13,20])it(`${n} Spieler: Freilose werden mit Constraints gespeichert`,async()=>{
    const t=createTournament({id:randomUUID(),name:'Freilos-Test',names:Array.from({length:n},(_,i)=>`Spieler ${i}`),mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);
    await call('create_tournament',[t,{...credentials,editor_link_hash:hashToken(t.id)},owner]);
    const rows=(await db.query('select * from public.matches where tournament_id=$1 and automatic',[t.id])).rows;
    expect(rows).toHaveLength(2**Math.ceil(Math.log2(n))-n);
  });
  it('Gruppen, Qualifikation und Finale werden transaktional normalisiert',async()=>{
    let t=createTournament({id:randomUUID(),name:'Gruppen-DB-Test',names:['Anna','Berta','Clara','Dora','Eva','Frida','Gina','Hanna'],mode:'groups',groupSize:4,advancePerGroup:2},randomInt,randomUUID);
    await call('create_tournament',[t,{...credentials,editor_link_hash:hashToken(t.id)},owner]);
    t.status='running';t.version=2;t.startedAt=new Date().toISOString();await call('save_tournament',[t,1,owner,'manage',{}]);
    while(!t.winner){const m=t.matches.find(m=>!m.automatic&&m.status!=='finished'&&m.players.every(Boolean))!;const a=t.participants.findIndex(p=>p.id===m.players[0]),b=t.participants.findIndex(p=>p.id===m.players[1]);const oldVersion=t.version;t=updateMatch(t,m.id,{legs:a<b?[3,1]:[1,3],status:'finished',forfeited:null}).tournament;t.version=oldVersion+1;t.updatedAt=new Date().toISOString();await call('save_tournament',[t,oldVersion,owner,'score',{}]);}
    expect((await db.query('select * from public.group_qualifications where tournament_id=$1',[t.id])).rows).toHaveLength(4);
    expect((await db.query<{status:string}>('select status from public.tournaments where id=$1',[t.id])).rows[0].status).toBe('completed');
  });
  it('Funktionsreparatur ist wiederholbar und erhält Turniere und Zugänge',async()=>{
    const before=(await db.query<{count:number}>('select count(*)::integer as count from public.tournaments')).rows[0].count;
    const repair=await readFile(new URL('../supabase/migrations/002_restore_functions.sql',import.meta.url),'utf8');
    await db.exec(repair);await db.exec(repair);
    expect((await db.query<{count:number}>('select count(*)::integer as count from public.tournaments')).rows[0].count).toBe(before);
    expect((await call('read_session',[owner])).rows[0].result).toBeTruthy();
    expect((await call('installation_health',[])).rows[0].result).toEqual({schema_version:1,ready:true});
  });
  it('Owner löscht ein Turnier samt abhängigen Daten und aktualisiert die Live-Auswahl',async()=>{
    const repair=await readFile(new URL('../supabase/migrations/004_fix_tournament_deletion.sql',import.meta.url),'utf8');
    await db.exec(repair);await db.exec(repair);
    const countBefore=(await db.query<{count:number}>('select count(*)::integer as count from public.tournaments')).rows[0].count;
    const version=(await db.query<{version:number}>('select version from public.tournaments where id=$1',[tournament.id])).rows[0].version;
    await expect(call('delete_tournament',[tournament.id,version,admin])).rejects.toThrow();
    await expect(call('delete_tournament',[tournament.id,version-1,owner])).rejects.toThrow();
    await call('delete_tournament',[tournament.id,version,owner]);
    expect((await db.query('select * from public.tournaments where id=$1',[tournament.id])).rows).toHaveLength(0);
    expect((await db.query('select * from public.matches where tournament_id=$1',[tournament.id])).rows).toHaveLength(0);
    expect((await db.query('select * from public.tournament_credentials where tournament_id=$1',[tournament.id])).rows).toHaveLength(0);
    expect((await call('read_session',[owner])).rows[0].result).toBeTruthy();
    expect((await db.query("select * from public.audit_events where tournament_id=$1 and action='delete'",[tournament.id])).rows).toHaveLength(1);
    expect((await db.query<{count:number}>('select count(*)::integer as count from public.tournaments')).rows[0].count).toBe(countBefore-1);
    expect((await db.query('select * from public.match_results where tournament_id=$1',[tournament.id])).rows).toHaveLength(0);
    const live=(await db.query<{tournament_id:string|null}>('select tournament_id from public.public_live_state')).rows[0].tournament_id;
    expect(live).not.toBe(tournament.id);
    expect((await db.query('select * from public.tournaments where id=$1',[live])).rows).toHaveLength(1);
  });
});

import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { randomInt, randomUUID } from 'node:crypto';
import { createTournament } from '../src/domain/tournament';
import { hashToken } from '../src/server/security';

it('vollständige Einrichtung funktioniert in leerer Datenbank und erhält Daten bei Wiederholung',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
    const sql=await readFile(new URL('../supabase/DATENBANK_EINRICHTEN.sql',import.meta.url),'utf8');
    await db.exec(sql);
    const owner=hashToken('setup-owner');
    await db.query("insert into public.sessions(token_hash,role,tournament_id,credential_version,expires_at) values($1,'owner',null,1,now()+interval '1 day')",[owner]);
    const t=createTournament({id:randomUUID(),name:'Einrichtungstest',names:['Anna','Berta','Clara'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);
    await db.query('select public.create_tournament($1,$2,$3)',[t,{admin_hash:'test',editor_link_hash:hashToken('setup-link'),editor_pin_hash:'test',editor_secret:'test'},owner]);
    await db.exec(sql);
    const health=await db.query<{result:{ready:boolean}}>('select public.installation_health() as result');
    expect(health.rows[0].result.ready).toBe(true);
    expect((await db.query('select * from public.tournaments where id=$1',[t.id])).rows).toHaveLength(1);
    expect((await db.query('select * from public.sessions where token_hash=$1',[owner])).rows).toHaveLength(1);
    expect((await db.query('select * from public.tournament_credentials where tournament_id=$1',[t.id])).rows).toHaveLength(1);
    await db.exec('set role anon');
    expect((await db.query('select * from public.public_tournament_snapshots')).rows).toHaveLength(1);
    await expect(db.query('select * from public.sessions')).rejects.toThrow();
    await db.exec('reset role');
    await db.query('select public.delete_tournament($1,$2,$3)',[t.id,t.version,owner]);
    expect((await db.query('select * from public.tournaments where id=$1',[t.id])).rows).toHaveLength(0);
    expect((await db.query('select * from public.public_live_state where tournament_id is null')).rows).toHaveLength(1);
  }finally{await db.close();}
},30000);

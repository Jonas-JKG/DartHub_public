import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTournament } from '../src/domain/tournament';
import { hashToken } from '../src/server/security';

it('Zugangsreparatur entzieht Admin-Rechte und wechselt PIN und Sitzungen atomar',async()=>{
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;');
    await db.exec(await readFile(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8'));
    const owner=hashToken('access-owner'),admin=hashToken('access-admin'),editor=hashToken('access-editor');
    await db.query("insert into public.sessions values($1,'owner',null,1,now()+interval '1 day')",[owner]);
    const t=createTournament({id:randomUUID(),name:'Zugangstest',names:['Anna','Berta','Clara'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);
    await db.query('select public.create_tournament($1,$2,$3)',[t,{admin_hash:'old-admin',editor_link_hash:hashToken('access-link'),editor_pin_hash:'old-pin',editor_secret:'old-secret'},owner]);
    await db.query("insert into public.sessions values($1,'admin',$3,1,now()+interval '1 day'),($2,'editor',$3,1,now()+interval '1 day')",[admin,editor,t.id]);
    const sql=await readFile(new URL('../supabase/migrations/005_owner_editor_access.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql);
    expect((await db.query<{result:unknown}>('select public.read_session($1) as result',[admin])).rows[0].result).toBeNull();
    await expect(db.query('select public.assert_session($1,$2,$3)',[admin,t.id,'manage'])).rejects.toThrow();
    await expect(db.query('select public.manage_editor_access($1,$2,$3,$4,$5)',[t.id,editor,'revoke','new-pin','new-secret'])).rejects.toThrow();
    await expect(db.query('select public.manage_editor_access($1,$2,$3)',[t.id,owner,'revoke'])).rejects.toThrow();
    expect((await db.query<{editor_pin_hash:string}>('select editor_pin_hash from public.tournament_credentials')).rows[0].editor_pin_hash).toBe('old-pin');
    await db.query('select public.manage_editor_access($1,$2,$3,$4,$5)',[t.id,owner,'revoke','new-pin','new-secret']);
    const row=(await db.query<{editor_pin_hash:string;editor_secret:string;editor_version:number;editor_enabled:boolean;editor_link_hash:string}>('select * from public.tournament_credentials')).rows[0];
    expect(row.editor_pin_hash).toBe('new-pin');expect(row.editor_secret).toBe('new-secret');expect(row.editor_version).toBe(2);expect(row.editor_enabled).toBe(true);expect(row.editor_link_hash).toBe(hashToken('access-link'));
    expect((await db.query<{result:unknown}>('select public.read_session($1) as result',[editor])).rows[0].result).toBeNull();
    expect((await db.query('select * from public.sessions where token_hash=$1',[owner])).rows).toHaveLength(1);
    expect((await db.query('select * from public.tournaments where id=$1',[t.id])).rows).toHaveLength(1);
    const common=await readFile(new URL('../supabase/migrations/006_common_login.sql',import.meta.url),'utf8');
    await db.exec(common);await db.exec(common);
    expect((await db.query<{editor_pin_hash:string}>('select editor_pin_hash from public.tournament_credentials')).rows[0].editor_pin_hash).toBe('new-pin');
    const other=createTournament({id:randomUUID(),name:'Anderes Turnier',names:['Dora','Eva','Frida'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID);
    const codeHash=hashToken('unique-code');
    const credentials={editor_link_hash:hashToken(other.id),editor_pin_hash:'other-pin',editor_secret:'other-secret',editor_code_hash:codeHash};
    await db.query('select public.create_tournament($1,$2,$3)',[other,credentials,owner]);
    await expect(db.query('select public.manage_editor_access($1,$2,$3,$4,$5,$6)',[t.id,owner,'revoke','collision-pin','collision-secret',codeHash])).rejects.toThrow();
    expect((await db.query<{editor_pin_hash:string}>('select editor_pin_hash from public.tournament_credentials where tournament_id=$1',[t.id])).rows[0].editor_pin_hash).toBe('new-pin');
    await db.query('select public.manage_editor_access($1,$2,$3,$4,$5,$6)',[t.id,owner,'revoke','last-pin','last-secret',hashToken('other-code')]);
    expect((await db.query<{editor_code_hash:string}>('select editor_code_hash from public.tournament_credentials where tournament_id=$1',[t.id])).rows[0].editor_code_hash).toBe(hashToken('other-code'));
    await db.exec('set role anon');
    await expect(db.query('select public.manage_editor_access($1,$2,$3,$4,$5)',[t.id,owner,'revoke','bad','bad'])).rejects.toThrow();
  } finally {await db.close();}
},30000);

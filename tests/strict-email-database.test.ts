import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createTournament,type Tournament} from '../src/domain/tournament';
import {hashToken} from '../src/server/security';
let db:PGlite,t:Tournament;const ids=[randomUUID(),randomUUID()],a=hashToken('strict-a'),b=hashToken('strict-b'),owner=hashToken('strict-owner'),expires=new Date(Date.now()+86400000).toISOString(),ownerId='00000000-0000-4000-8000-000000000001';
const migration=()=>readFile(new URL('../supabase/migrations/019_strict_email_verification.sql',import.meta.url),'utf8');
const call=async(name:string,args:unknown[]=[])=>(await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const prove=(id:string,email:string)=>db.query('update public.managers set email_verified_at=now(),email_verified_address=$2,email_verification_required=false,email_verification_version=1 where id=$1',[id,email]);
beforeAll(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');
 for(const file of ['DATENBANK_EINRICHTEN.sql',...['011_manager_accounts','012_saved_autodarts','013_shared_players_and_managers','014_training_and_friends','015_guest_invitations','016_player_accounts','017_account_lobbies','018_navigation_email_friends'].map(f=>'migrations/'+f+'.sql')])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 for(const [i,id] of ids.entries())await db.query('insert into public.managers(id,email,name,public_handle,email_verified_at,email_verified_address,email_verification_required) values($1,$2,$3,$3,now(),$2,false)',[id,`p${i}@example.test`,`player${i}`]);
 await db.query('update public.managers set public_handle=$2 where id=$1',[ownerId,'owner19']);
 for(const [hash,id] of [[a,ids[0]],[b,ids[1]],[owner,null]])await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'owner',$2,1,$3)",[hash,id,expires]);
 t={...createTournament({id:randomUUID(),name:'Existing',names:['player0','player1','owner19'],mode:'knockout',groupSize:4,advancePerGroup:2},()=>0,randomUUID),managerId:ids[0]};
 const credentials={editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'internal',player_codes:t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'internal'}))};
 await call('create_account_tournament',[a,t,credentials,[...ids,ownerId]]);await call('account_play_session',[b,t.id]);await call('account_play_session',[owner,t.id]);
 await db.exec(await migration());
},30000);
afterAll(async()=>{await db?.close();});
it('018-imported timestamps do not authorize existing root or derived player sessions',async()=>{
 expect(await call('read_session',[a])).toBeNull();expect(await call('read_session',[b+':'+t.id])).toBeNull();
 await expect(call('social_account',[a])).rejects.toThrow();await expect(call('account_play_session',[b,t.id])).rejects.toThrow();
});
it('Owner password and its assigned player remain available without email confirmation',async()=>{expect((await call('read_session',[owner])).role).toBe('owner');expect((await call('read_session',[owner+':'+t.id])).account_manager_id).toBe(ownerId);});
it('a real proof restores the same account, tournament and player; the creator need not be signed in',async()=>{
 await prove(ids[1],'p1@example.test');expect((await call('read_session',[b])).manager_id).toBe(ids[1]);expect((await call('account_play_session',[b,t.id])).participant_id).toBe(t.participants[1].id);
 expect(await call('read_session',[a])).toBeNull();expect((await db.query('select id from public.tournaments where id=$1',[t.id])).rows).toHaveLength(1);
});
it('a proof for another address cannot authorize even an existing derived cookie',async()=>{await prove(ids[1],'wrong@example.test');expect(await call('read_session',[b])).toBeNull();expect(await call('read_session',[b+':'+t.id])).toBeNull();await prove(ids[1],'p1@example.test');});
it('rerunning 019 preserves true proofs and keeps unverified accounts blocked',async()=>{await db.exec(await migration());expect(await call('read_session',[a])).toBeNull();expect(await call('read_session',[b])).toBeTruthy();});
it('email markers, diagnostic events and old base entrypoints are inaccessible to browser roles',async()=>{
 for(const role of ['anon','authenticated'])for(const sql of ["select * from public.account_mail_events","insert into public.account_mail_events(id,operation,stage,outcome) values(gen_random_uuid(),'signup','request-mail','accepted')","update public.managers set email_verification_version=1","select public.read_session_strict_email_base('x')","select public.read_session_email_base('x')"]){await db.exec('set role '+role);try{await expect(db.exec(sql)).rejects.toThrow();}finally{await db.exec('reset role');}}
});

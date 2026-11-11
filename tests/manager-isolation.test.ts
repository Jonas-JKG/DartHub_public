import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomInt,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createTournament} from '../src/domain/tournament';
import {hashToken} from '../src/server/security';
it('Manager, persönliche Codes und Zuschauer bleiben auf ihren Bereich begrenzt, auch direkt in SQL',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');
 await db.exec(await readFile(new URL('../supabase/DATENBANK_EINRICHTEN.sql',import.meta.url),'utf8'));
 const root=hashToken('root'),a=hashToken('manager-a'),b=hashToken('manager-b'),ma=randomUUID(),mb=randomUUID();
 await db.query("insert into public.sessions(token_hash,role,tournament_id,credential_version,expires_at) values($1,'owner',null,1,now()+interval '1 day')",[root]);
 const migration=await readFile(new URL('../supabase/migrations/011_manager_accounts.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
 await db.query("insert into public.managers(id,email,name) values($1,'a@example.test','A'),($2,'b@example.test','B')",[ma,mb]);
 await db.query("insert into public.sessions(token_hash,role,tournament_id,manager_id,credential_version,expires_at) values($1,'owner',null,$3,1,now()+interval '1 day'),($2,'owner',null,$4,1,now()+interval '1 day')",[a,b,ma,mb]);
 const call=async(name:string,args:unknown[])=>db.query<{result:unknown}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args);
 const make=async(manager:string,session:string)=>{const t={...createTournament({id:randomUUID(),name:'Private Lobby',names:['Anna','Berta','Clara'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID),managerId:manager};const codes=t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'encrypted'}));await call('create_tournament',[t,{editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'unused',player_codes:codes},session]);return t;};
 const ta=await make(ma,a),tb=await make(mb,b);
 const changed={...ta,name:'Geändert',version:2,updatedAt:new Date().toISOString()};
 await call('save_tournament',[changed,1,a,'manage',{action:'rename'}]);
 expect((await db.query<{state:{name:string};manager_id:string}>('select state,manager_id from public.tournaments where id=$1',[ta.id])).rows[0]).toMatchObject({manager_id:ma,state:{name:'Geändert'}});
 await expect(call('save_tournament',[{...changed,managerId:mb,version:3},2,a,'manage',{action:'rename'}])).rejects.toThrow('nicht geändert');

 await expect(call('assert_session',[a,tb.id,'manage'])).rejects.toThrow('Keine Berechtigung');
 await expect(call('delete_tournament',[tb.id,tb.version,a])).rejects.toThrow('Keine Berechtigung');
 await expect(call('choose_device_players',[a,tb.id,[tb.participants[0].id],false])).rejects.toThrow('Keine Berechtigung');
 expect((await call('assert_session',[root,tb.id,'manage'])).rows[0].result).toBeTruthy();
 await expect(call('create_tournament',[{...ta,id:randomUUID(),managerId:mb},{},a])).rejects.toThrow('Fremder Manager-Bereich');
 const player=hashToken('personal-player');const logged=(await call('login_player_session',[hashToken(ta.participants[0].id),player,new Date(Date.now()+86400000).toISOString(),false])).rows[0].result;
 expect(logged).toMatchObject({tournamentId:ta.id,participantId:ta.participants[0].id});
 expect((await call('read_session',[player])).rows[0].result).toMatchObject({role:'editor',manager_id:ma,participant_id:ta.participants[0].id});
 await expect(call('choose_device_players',[player,ta.id,[ta.participants[1].id],false])).rejects.toThrow('nur für deinen Spieler');
 await expect(call('assert_session',[player,tb.id,'score'])).rejects.toThrow('Keine Berechtigung');
 await expect(call('login_player_session',[hashToken(ta.participants[0].id),hashToken('other'),new Date(Date.now()+86400000).toISOString(),false])).rejects.toThrow('PLAYER_IN_USE');
 const viewer=hashToken('viewer');await db.query("insert into public.sessions(token_hash,role,tournament_id,manager_id,credential_version,expires_at) values($1,'viewer',null,$2,1,now()+interval '1 day')",[viewer,ma]);
 await expect(call('assert_session',[viewer,ta.id,'score'])).rejects.toThrow('Keine Berechtigung');
 await db.exec('set role anon');for(const table of ['managers','player_access_codes','public_tournament_snapshots','public_live_state','match_games'])await expect(db.query('select * from public.'+table)).rejects.toThrow();await expect(call('read_session',[a])).rejects.toThrow();await db.exec('reset role');
 await db.query('update public.managers set enabled=false where id=$1',[ma]);
 for(const key of [a,player,viewer])expect((await call('read_session',[key])).rows[0].result).toBeNull();
 expect((await call('read_session',[b])).rows[0].result).toBeTruthy();
 const rotated=tb.participants.map(p=>({participant_id:p.id,code_hash:hashToken('rotated:'+p.id),code_secret:'encrypted-rotated'}));
 await call('save_tournament',[{...tb,version:2,updatedAt:new Date().toISOString()},1,b,'manage',{action:'redraw',player_codes:rotated}]);
 const audit=(await db.query<{detail:Record<string,unknown>}>('select detail from public.audit_events where tournament_id=$1 order by id desc limit 1',[tb.id])).rows[0].detail;
 expect(audit).not.toHaveProperty('player_codes');
 expect((await db.query<{code_hash:string}>('select code_hash from public.player_access_codes where tournament_id=$1 and participant_id=$2',[tb.id,tb.participants[0].id])).rows[0].code_hash).toBe(rotated[0].code_hash);

 }finally{await db.close();}
},30000);

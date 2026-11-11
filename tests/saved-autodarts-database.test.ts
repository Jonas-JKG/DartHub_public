import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import {it,expect} from 'vitest';
import {createTournament} from '../src/domain/tournament';
import {hashToken} from '../src/server/security';
it('dauerhafte Scheiben bleiben beim Owner, Manager oder persönlichen Code; Rotation und Abmelden konkurrieren sicher',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');
 for(const file of ['DATENBANK_EINRICHTEN.sql','migrations/011_manager_accounts.sql','migrations/012_saved_autodarts.sql','migrations/012_saved_autodarts.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 const ma=randomUUID(),mb=randomUUID(),root=hashToken('root'),a=hashToken('a'),a2=hashToken('a-new-session'),b=hashToken('b');
 await db.query("insert into public.managers(id,email,name) values($1,'a','A'),($2,'b','B')",[ma,mb]);
 await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'owner',null,1,now()+interval '1 day'),($2,'owner',$5,1,now()+interval '1 day'),($3,'owner',$5,1,now()+interval '1 day'),($4,'owner',$6,1,now()+interval '1 day')",[root,a,a2,b,ma,mb]);
 const call=async(hash:string,op:string,secret:string|null=null,board:string|null=null,lease:string|null=null)=>(await db.query<{result:Record<string,unknown>|null}>('select public.autodarts_profile($1,$2,$3,$4,$5::uuid) result',[hash,op,secret,board,lease])).rows[0].result;
 await call(a,'link','encrypted-a');await call(b,'link','encrypted-b');await call(root,'link','encrypted-root');
 expect(await call(a2,'read')).toMatchObject({linked:true,accountKey:'manager:'+ma});expect(await call(a2,'read')).not.toHaveProperty('secret');
 const lease=randomUUID();expect(await call(a2,'claim',null,null,lease)).toMatchObject({secret:'encrypted-a'});expect(await call(a,'claim',null,null,randomUUID())).toEqual({busy:true});
 expect(await call(a,'finish','rotated-a','board-a',lease)).toEqual({ok:true});expect(await call(a2,'read')).toMatchObject({boardId:'board-a',autoConnect:true});
 await call(a2,'pause');expect(await call(a,'read')).toMatchObject({autoConnect:false});
 const stale=randomUUID();await call(a,'claim',null,null,stale);await call(a2,'unlink');expect(await call(a,'finish','stale-token','board-a',stale)).toEqual({ok:false});expect(await call(a,'read')).toMatchObject({linked:false});
 expect(await call(b,'claim',null,null,randomUUID())).toMatchObject({secret:'encrypted-b'});expect(await call(root,'claim',null,null,randomUUID())).toMatchObject({secret:'encrypted-root'});
 const t={...createTournament({id:randomUUID(),name:'Players',names:['Anna','Berta','Clara'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID),managerId:ma};
 const codes=t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'encrypted'}));
 await db.query('select public.create_tournament($1,$2,$3)',[t,{editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'unused',player_codes:codes},a]);
 const player=hashToken('player'),player2=hashToken('player-takeover');
 for(const key of [player,player2]){
  await db.query("select public.login_player_session($1,$2,now()+interval '1 day',true)",[codes[0].code_hash,key]);
  if(key===player)await call(player,'link','encrypted-player');
 }
 expect(await call(player2,'read')).toMatchObject({linked:true,accountKey:expect.stringMatching(/^player:/)});expect(await call(a,'read')).toMatchObject({linked:false});await expect(call(player,'read')).rejects.toThrow('Nicht angemeldet');
 const viewer=hashToken('viewer');await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'viewer',$2,1,now()+interval '1 day')",[viewer,ma]);await expect(call(viewer,'read')).rejects.toThrow('Keine Berechtigung');
 await db.exec('set role anon');await expect(db.query('select * from public.saved_autodarts')).rejects.toThrow();await expect(call(a,'read')).rejects.toThrow();await db.exec('reset role');
 await db.exec('set role authenticated');await expect(db.query('select * from public.saved_autodarts')).rejects.toThrow();await expect(call(a,'read')).rejects.toThrow();await db.exec('reset role');
 await db.query('update public.managers set enabled=false where id=$1',[ma]);await expect(call(player2,'claim',null,null,randomUUID())).rejects.toThrow('Nicht angemeldet');
 await db.query('delete from public.player_access_codes where tournament_id=$1',[t.id]);expect((await db.query('select * from public.saved_autodarts where player_access_id is not null')).rows).toHaveLength(0);
 }finally{await db.close();}
},30000);

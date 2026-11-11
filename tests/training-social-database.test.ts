import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createTournament,type Tournament} from '../src/domain/tournament';
import {createGame,gameAction,gameView,keypadHit,type Game} from '../src/domain/scoring';
import {hashToken} from '../src/server/security';
let db:PGlite,t:Tournament;
const ma=randomUUID(),mb=randomUUID(),mc=randomUUID(),root=hashToken('social-root'),a=hashToken('social-a'),b=hashToken('social-b'),c=hashToken('social-c'),host=hashToken('training-host'),guest=hashToken('training-guest');
const expires=new Date(Date.now()+86400000).toISOString();
const call=async(name:string,args:unknown[]=[])=>(await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const creds=(t:Tournament)=>({editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'encrypted',player_codes:t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'encrypted'}))});
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');for(const file of ['DATENBANK_EINRICHTEN.sql','migrations/011_manager_accounts.sql','migrations/012_saved_autodarts.sql','migrations/013_shared_players_and_managers.sql','migrations/014_training_and_friends.sql','migrations/014_training_and_friends.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));for(const [id,name,hash] of [[ma,'Anna',a],[mb,'Berta',b],[mc,'Clara',c]]){await db.query("insert into public.managers(id,email,name) values($1,$2,$3)",[id,name+'@example.test',name]);await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'owner',$2,1,$3)",[hash,id,expires]);}await db.query("insert into public.sessions(token_hash,role,credential_version,expires_at) values($1,'owner',1,$2)",[root,expires]);},30000);
afterAll(async()=>{await db?.close();});
it('nur bestätigte Konten eröffnen eine private 1v1-Lobby mit gebundenem Spielerzugang',async()=>{
 t={...createTournament({id:randomUUID(),kind:'training',name:'Training',names:['Anna','Gast'],mode:'knockout',groupSize:2,advancePerGroup:1},randomInt,randomUUID),managerId:ma};
 await expect(call('create_training_room',[hashToken('unknown'),t,creds(t),hashToken('invite'),'encrypted',host,expires,null])).rejects.toThrow();
 await call('create_training_room',[a,t,creds(t),hashToken('invite'),'encrypted',host,expires,null]);
 expect(await call('read_session',[host])).toMatchObject({role:'editor',account_manager_id:ma,account_session_hash:a,training_id:t.id});
 await expect(call('training_details',[b,t.id,b])).rejects.toThrow('Keine Berechtigung');
 expect(await call('training_preview',[t.id,hashToken('wrong')])).toBeNull();expect(await call('training_preview',[t.id,hashToken('invite')])).toMatchObject({name:'Training'});
 expect(await call('training_details',[host,t.id,a])).toMatchObject({phase:'waiting',round:1});
});
it('Gast betritt per Link, belegte Plätze und Hostverwaltung bleiben geschützt',async()=>{
 await expect(call('start_training_match',[a,t.id,createGame(t.matches[0].players as [string,string],t.scoring!)])).rejects.toThrow('Beide Spieler');
 await call('join_training_room',[t.id,hashToken('invite'),null,null,guest,expires,'Gast',false,null]);
 expect(await call('read_session',[guest])).toMatchObject({training_id:t.id});
 await expect(call('join_training_room',[t.id,hashToken('invite'),null,null,hashToken('steal'),expires,'Dieb',true,null])).rejects.toThrow('Platz ist belegt');
 await expect(call('close_training_room',[guest,t.id])).rejects.toThrow();await expect(call('start_training_match',[b,t.id,{}])).rejects.toThrow('Lobby-Ersteller');
});
it('Autodarts nutzt das Konto des Teilnehmers; Gastprofil bleibt am persönlichen Code',async()=>{
 await call('autodarts_profile',[host,'link','host-secret',null,null]);await call('autodarts_profile',[guest,'link','guest-secret',null,null]);
 expect(await call('autodarts_profile',[a,'read',null,null,null])).toMatchObject({accountKey:'manager:'+ma,linked:true});expect(await call('autodarts_profile',[guest,'read',null,null,null])).toMatchObject({accountKey:'player:'+(await call('read_session',[guest])).player_access_id,linked:true});
});
it('beide Spieler verwenden echten Bull-off- und Scoringweg; Fremde dürfen nicht schreiben',async()=>{
 const players=t.matches[0].players as [string,string];let g=createGame(players,{start:301,out:'single',legsToWin:1});t.scoring=g.rules;
 await call('training_next',[a,t.id,g.rules]);t=(await call('training_details',[host,t.id,a])).tournament;
 await call('start_training_match',[a,t.id,{...g,activePlayer:players[0]}]);t=(await call('training_details',[host,t.id,a])).tournament;
 const write=async(next:Game,old:number,sid:string,actor:string,done=false)=>{let updated:any=null;if(done){const {updateMatch}=await import('../src/domain/tournament');updated=updateMatch(t,t.matches[0].id,{legs:[gameView(next).legs[0],gameView(next).legs[1]],status:'finished',forfeited:null}).tournament;updated.version=t.version+1;}
 await call('write_device_game',[t.id,t.matches[0].id,old,sid,actor,{...next,activePlayer:next.players[gameView(next).active]},updated,updated?t.version:null]);if(updated)t=updated;};
 for(const [i,n] of [25,1].entries()){const actor=players[i],old=g.version;g=gameAction(g,actor,{type:'bull',hit:keypadHit(n,1)});await write(g,old,actor===t.participants[0].id?host:guest,actor);}
 for(const actor of players){const old=g.version;g=gameAction(g,actor,{type:'next'});await write(g,old,actor===t.participants[0].id?host:guest,actor);}
 expect(g.phase).toBe('playing');await expect(call('write_game',[t.id,t.matches[0].id,g.version,b,g,null,null])).rejects.toThrow();
 // A complete 301 single-out leg, alternating actual players and takeout actions.
 while(g.phase!=='finished'){
  const actor=g.players[gameView(g).active],sid=actor===t.participants[0].id?host:guest;
  for(let i=0;i<3;i++){const v=gameView(g);if(v.current.bust||v.current.checkout)break;const remaining=v.remaining[v.active];const hit=remaining>=60?keypadHit(20,3):remaining>20?keypadHit(20,1):keypadHit(remaining,1);const old=g.version;g=gameAction(g,actor,{type:'dart',hit});await write(g,old,sid,actor);}
  const old=g.version;g=gameAction(g,actor,{type:'next'});await write(g,old,sid,actor,g.phase==='finished');
 }
 expect((await call('training_details',[host,t.id,a])).game.phase).toBe('finished');
 await call('training_next',[a,t.id,{start:501,out:'double',legsToWin:2}]);const room=await call('training_details',[host,t.id,a]);expect(room).toMatchObject({phase:'waiting',round:2,matchId:'training-2'});expect(room.game).toBeNull();expect(room.lastResult.game.phase).toBe('finished');expect(gameView(room.lastResult.game).average.some((x:number)=>x>0)).toBe(true);
});
it('Codeverknüpfung exklusiv, accountgebunden, nach Rotation ungültig',async()=>{
 const pc=t.participants[1];await call('link_player_account',[b,hashToken(pc.id)]);await expect(call('link_player_account',[c,hashToken(pc.id)])).rejects.toThrow('anderen Konto');
 const child=hashToken('berta-child');await call('activate_account_players',[b,t.id,[pc.id],child,expires,true,null]);expect(await call('read_session',[guest])).toBeNull();expect(await call('read_session',[child])).toMatchObject({account_manager_id:mb,account_session_hash:b});
 await call('training_remove_guest',[a,t.id,hashToken('new-code'),'new-secret']);expect(await call('read_session',[child])).toBeNull();expect((await call('social_snapshot',[b])).links).toHaveLength(0);expect(await call('read_session',[b])).toBeTruthy();
});
it('Freundschaften benötigen Link/Kontext, Bestätigung und geben nur Freunden Präsenz frei',async()=>{
 await call('social_friend_link',[a,hashToken('friend-a'),'encrypted-a']);await call('social_friend_link',[b,hashToken('friend-b'),'encrypted-b']);
 await expect(call('social_request',[b,null,ma,null])).rejects.toThrow('ungültig');await call('social_request',[b,hashToken('friend-a'),null,null]);
 const f=(await call('social_snapshot',[a])).friends[0];expect(f).toMatchObject({accountId:mb,incoming:true,status:'pending',online:false});await expect(call('social_friend_action',[b,f.id,'accept'])).rejects.toThrow();await expect(call('social_friend_action',[c,f.id,'remove'])).rejects.toThrow();
 await call('social_presence',[b]);expect((await call('social_snapshot',[a])).friends[0].online).toBe(false);await call('social_friend_action',[a,f.id,'accept']);expect((await call('social_snapshot',[a])).friends[0].online).toBe(true);expect((await call('social_snapshot',[c])).friends).toHaveLength(0);
 await call('social_invite',[a,t.id,mb]);const invitation=(await call('social_snapshot',[b])).invitations[0];expect(await call('social_invitation_secret',[b,invitation.id])).toMatchObject({roomId:t.id,secret:'encrypted'});expect(await call('social_invitation_secret',[c,invitation.id])).toBeNull();await expect(call('social_invite',[a,t.id,mc])).rejects.toThrow();
 await call('social_friend_action',[a,f.id,'remove']);expect(await call('social_invitation_secret',[b,invitation.id])).toBeNull();
});
it('Kontextfreundschaften nur für nachgewiesene Teilnehmer und zugehörige Konten',async()=>{
 await expect(call('social_context',[c,t.id])).rejects.toThrow();await call('link_player_account',[b,hashToken('new-code')]);expect(await call('social_context',[b,t.id])).toContainEqual({id:ma,name:'Anna'});await call('social_request',[b,null,ma,t.id]);await expect(call('social_request',[b,null,mc,t.id])).rejects.toThrow();
});
it('gemeinsames Trainingsgerät ordnet beide Plätze zu und Codes bleiben exklusiv',async()=>{
 const room={...createTournament({id:randomUUID(),kind:'training',name:'Gemeinsam',names:['Host','Gast'],mode:'knockout',groupSize:2,advancePerGroup:1},randomInt,randomUUID),managerId:ma};
 const shared=hashToken('shared-training');await call('create_training_room',[a,room,creds(room),hashToken('shared-invite'),'encrypted',shared,expires,null]);
 await call('add_device_player',[shared,hashToken(room.participants[1].id),false]);const s=await call('read_session',[shared]);expect(s.participant_ids.sort()).toEqual(room.participants.map(p=>p.id).sort());expect((await call('training_details',[shared,room.id,a])).seats.every((s:{ready:boolean})=>s.ready)).toBe(true);
 await call('training_remove_guest',[a,room.id,hashToken('shared-new'),'new-secret']);expect((await call('read_session',[shared])).participant_ids).toEqual([room.participants[0].id]);await call('add_device_player',[shared,hashToken('shared-new'),false]);
 await call('start_training_match',[a,room.id,createGame(room.matches[0].players as [string,string],room.scoring!)]);
 await expect(call('link_player_account',[c,hashToken('shared-new')])).rejects.toThrow('anderen Konto');await call('close_training_room',[a,room.id]);
});
it('Entfernte Kontoverknüpfung sperrt auch gebundene Zugänge anderer Geräte',async()=>{
 const room={...createTournament({id:randomUUID(),kind:'training',name:'Code widerrufen',names:['Host','Gast'],mode:'knockout',groupSize:2,advancePerGroup:1},randomInt,randomUUID),managerId:ma},child=hashToken('unlink-child');
 await call('create_training_room',[a,room,creds(room),hashToken('unlink-invite'),'encrypted',child,expires,null]);const aid=(await call('read_session',[child])).player_access_id;
 await db.query('delete from public.account_player_links where access_id=$1',[aid]);expect(await call('read_session',[child])).toBeNull();expect(await call('read_session',[a])).toBeTruthy();await call('close_training_room',[a,room.id]);
});
it('Abmelden des Kontos widerruft den Kindzugang; Schließen widerruft alle Gastzugänge und Links',async()=>{
 const child=hashToken('parent-child');await call('activate_account_players',[b,t.id,[t.participants[1].id],child,expires,true,null]);await db.query('delete from public.sessions where token_hash=$1',[b]);expect(await call('read_session',[child])).toBeNull();
 await call('close_training_room',[a,t.id]);expect(await call('read_session',[host])).toBeNull();expect(await call('training_preview',[t.id,hashToken('invite')])).toBeNull();expect((await call('training_details',[a,t.id,a])).phase).toBe('closed');await expect(call('join_training_room',[t.id,hashToken('invite'),null,null,guest,expires,'Gast',true,null])).rejects.toThrow();
});
it('Managerlöschung entfernt soziale Zugänge und überträgt erhaltene Turniere an den Owner',async()=>{
 await expect(call('prepare_manager_deletion',[a,mc])).rejects.toThrow('Nur der Owner');expect(await call('prepare_manager_deletion',[root,ma])).toBe(true);expect(await call('read_session',[a])).toBeNull();expect((await call('training_details',[root,t.id,root])).seats).toEqual([]);expect((await db.query('select * from public.friendships where sender_id=$1 or receiver_id=$1',[ma])).rows).toHaveLength(0);expect((await db.query('select * from public.account_player_links where manager_id=$1',[ma])).rows).toHaveLength(0);expect((await db.query<{phase:string}>('select phase from public.training_rooms where host_manager_id=$1',[ma])).rows.every(r=>r.phase==='closed')).toBe(true);expect((await db.query<{manager_id:string}>('select manager_id from public.tournaments where id=$1',[t.id])).rows[0].manager_id).toBe('00000000-0000-4000-8000-000000000001');
});
it('Migration wiederholbar und Tabellen/Funktionen für Browser gesperrt',async()=>{await db.exec(await readFile(new URL('../supabase/migrations/014_training_and_friends.sql',import.meta.url),'utf8'));for(const role of ['anon','authenticated']){await db.exec('set role '+role);await expect(db.query('select * from public.training_rooms')).rejects.toThrow();await expect(call('social_snapshot',[a])).rejects.toThrow();await expect(call('training_details',[a,t.id,a])).rejects.toThrow();await db.exec('reset role');}});

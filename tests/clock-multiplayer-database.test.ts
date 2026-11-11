import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createTournament,updateMatch,type Tournament} from '../src/domain/tournament';
import {createTrainingGame,gameAction,gameView,aroundClockView,keypadHit,type Game} from '../src/domain/scoring';
import {hashToken} from '../src/server/security';
let db:PGlite;const accounts=[randomUUID(),randomUUID(),randomUUID()],hashes=accounts.map(hashToken),owner=hashToken('training-admin'),expiry=new Date(Date.now()+86400000).toISOString();
const call=async(name:string,args:unknown[]=[])=>(await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
beforeAll(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');
 for(const file of ['DATENBANK_EINRICHTEN.sql',...['011_manager_accounts','012_saved_autodarts','013_shared_players_and_managers','014_training_and_friends','015_guest_invitations','016_player_accounts','017_account_lobbies','018_navigation_email_friends','019_strict_email_verification','020_username_search','021_training_modes','022_clock_multiplayer','023_practice_modes','023_practice_modes'].map(n=>'migrations/'+n+'.sql')])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 for(const [i,id] of accounts.entries()){
  await db.query('insert into public.managers(id,email,name,public_handle,email_verified_at,email_verified_address,email_verification_version,email_verification_required) values($1,$2,$3,$3,now(),$2,1,false)',[id,`local${i}@example.test`,`local_host${i}`]);
  await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'owner',$2,1,$3)",[hashes[i],id,expiry]);
 }
 await db.query("insert into public.sessions(token_hash,role,credential_version,expires_at) values($1,'owner',1,$2)",[owner,expiry]);
},30000);
afterAll(async()=>{await db?.close();});
async function room(mode:import('../src/domain/scoring').TrainingMode='x01',admin=false){
 const t: Tournament={...createTournament({id:randomUUID(),kind:'training',name:'Practice',names:['Host','Mitspieler'],mode:'knockout',groupSize:2,advancePerGroup:1,scoring:{start:301,out:'single',legsToWin:1}},()=>0,randomUUID),trainingMode:mode,practiceSettings:{segments:[20,19,18]},managerId:admin?'00000000-0000-4000-8000-000000000001':accounts[0]};
 if(mode==='around-clock')t.scoring={start:501,out:'single',legsToWin:1};
 const creds={editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'internal',player_codes:t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'internal'}))};
 await call('create_training_room',[admin?owner:hashes[0],t,creds,null,null,hashToken(t.id+'child'),expiry,null]);return t;
}
async function details(t:Tournament,hash=hashes[0]){const s=await call('account_play_session',[hash,t.id]);return {s,d:await call('training_details',[s?.token_hash??hash,t.id,hash])};}
it('adds five local names without accounts, enforces six, and revokes only the removed seat',async()=>{
 const t=await room('around-clock'),count=(await db.query('select * from public.managers')).rows.length;
 await expect(call('training_add_local',[hashes[1],t.id,'Steal'])).rejects.toThrow();
 for(let i=1;i<=5;i++)await call('training_add_local',[hashes[0],t.id,'Local '+i]);
 let {s,d}=await details(t);expect(s.participant_ids).toHaveLength(6);expect(d.seats).toHaveLength(6);expect(d.seats.every((seat:any)=>seat.ready)).toBe(true);expect(d.clockMultiplayerReady).toBe(true);
 expect((await db.query('select * from public.managers')).rows).toHaveLength(count);await expect(call('training_add_local',[hashes[0],t.id,'Seventh'])).rejects.toThrow('sechs');
 const removed=d.seats[3].participantId,remaining=d.seats[4].participantId;
 await call('training_remove_clock_player',[hashes[0],t.id,removed,hashToken(t.id+'rotate'),'internal']);
 expect((await call('read_session',[s.token_hash])).participant_ids).not.toContain(removed);expect((await call('read_session',[s.token_hash])).participant_ids).toContain(remaining);
 await expect(call('training_remove_clock_player',[hashes[0],t.id,t.participants[0].id,hashToken('no'),'internal'])).rejects.toThrow();
 await call('training_add_local',[hashes[0],t.id,'Replacement']);({s,d}=await details(t));expect(s.participant_ids).toHaveLength(6);expect(d.seats).toHaveLength(6);expect(d.tournament.participants.find((p:any)=>p.id===removed).name).toBe('Replacement');
});
it('account invitations allocate independent seats beside local players, with no bearer access',async()=>{
 const t=await room('around-clock');for(const name of ['Local A','Local B'])await call('training_add_local',[hashes[0],t.id,name]);
 await call('social_invite',[hashes[0],t.id,accounts[1]]);await call('social_invite',[hashes[0],t.id,accounts[2]]);const inv=(await call('social_snapshot',[hashes[1]])).invitations.find((i:any)=>i.roomId===t.id);
 await expect(call('accept_account_invitation',[hashes[0],inv.id])).rejects.toThrow();await call('accept_account_invitation',[hashes[1],inv.id]);
 const {s,d}=await details(t),remote=(await details(t,hashes[1])).s;
 expect(s.participant_ids).toHaveLength(3);expect(remote.participant_ids).toHaveLength(1);expect(d.seats[3]).toMatchObject({ready:true,accountId:accounts[1],local:false});
 await expect(call('social_invite',[hashes[0],t.id,accounts[1]])).rejects.toThrow('bereits');
 expect((await call('player_search',[hashes[1],'Local A']))).toEqual([]);
 const another=(await call('social_snapshot',[hashes[2]])).invitations.find((i:any)=>i.roomId===t.id);expect(another).toBeTruthy();await call('accept_account_invitation',[hashes[2],another.id]);expect((await details(t,hashes[2])).s.participant_ids).toHaveLength(1);
 const bad=gameAction(createTrainingGame(d.seats.map((s:any)=>s.participantId),t.scoring!,false,'around-clock'),s.participant_id,{type:'dart',hit:keypadHit(1,1)});
 await expect(call('write_device_game',[t.id,t.matches[0].id,1,remote.token_hash,s.participant_id,bad,null,null])).rejects.toThrow();
});
it('six players rotate, a third-seat winner is saved correctly and public spectators see the full result',async()=>{
 const t=await room('around-clock');for(let i=1;i<=5;i++)await call('training_add_local',[hashes[0],t.id,'Player '+i]);
 let {s,d}=await details(t),g=createTrainingGame(d.seats.map((s:any)=>s.participantId),t.scoring!,false,'around-clock');g.sharedDevice=true;
 await call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[0]}]);({s,d}=await details(t));
 const winner=g.players[2];
 const write=async(next:Game,actor:string)=>{
  let updated:Tournament|null=null;
  if(next.phase==='finished')updated={...d.tournament,status:'completed',winner,version:d.tournament.version+1,matches:d.tournament.matches.map((m:any)=>({...m,status:'finished',winner,legs:[null,null]}))};
  await call(actor===s.participant_id?'write_game':'write_device_game',actor===s.participant_id?[t.id,d.matchId,g.version,s.token_hash,{...next,activePlayer:next.players[gameView(next).active]},updated,updated?d.tournament.version:null]:[t.id,d.matchId,g.version,s.token_hash,actor,{...next,activePlayer:next.players[gameView(next).active]},updated,updated?d.tournament.version:null]);g=next;
 };
 while(g.phase!=='finished'){
  const actor=g.players[gameView(g).active];
  for(let dart=0;dart<(actor===winner?3:1);dart++){
   const target=actor===winner?aroundClockView(g).target!:0;await write(gameAction(g,actor,{type:'dart',hit:keypadHit(target,1)}),actor);if(aroundClockView(g).complete)break;
  }
  await write(gameAction(g,actor,{type:'next'}),actor);
 }
 expect(gameView(g).active).toBe(2);expect(aroundClockView(g,2)).toMatchObject({complete:true,darts:21});
 const stored=await call('training_details',[s.token_hash,t.id,hashes[0]]);expect(stored.tournament.winner).toBe(winner);
 const snapshot=(await db.query<{state:any}>('select state from public.public_tournament_snapshots where id=$1',[t.id])).rows[0].state;expect(snapshot.matches[0].players).toHaveLength(6);expect(snapshot.matches[0].winner).toBe(winner);
 expect((await db.query<{winner:string}>('select winner from public.match_results where tournament_id=$1',[t.id])).rows[0].winner).toBe(winner);
 expect((await db.query('select * from public.player_match_history where account_id=$1',[accounts[0]])).rows.filter((r:any)=>r.event_key.startsWith(t.id))).toHaveLength(1);
 await call('training_next',[hashes[0],t.id,t.scoring]);const next=await call('training_details',[s.token_hash,t.id,hashes[0]]);expect(next).toMatchObject({round:2,phase:'waiting',game:null,lastResult:{game:{phase:'finished'}}});expect(next.seats).toHaveLength(6);
});
it('start rejects stale rosters and inactive seats; anonymous callers cannot allocate or control players',async()=>{
 const t=await room('around-clock');await call('training_add_local',[hashes[0],t.id,'Local']);let {s,d}=await details(t);const g=createTrainingGame(d.seats.map((s:any)=>s.participantId),t.scoring!,false,'around-clock');
 await call('training_add_local',[hashes[0],t.id,'Another']);({s,d}=await details(t));await expect(call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[0]}])).rejects.toThrow('geändert');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await expect(call('clock_free_seat',[t.id])).rejects.toThrow();await expect(call('training_add_local',[hashes[0],t.id,'No'])).rejects.toThrow();await db.exec('reset role');}
});

it.each(['segments','checkout'] as const)('persists %s solo practice, rejects extra seats and stale configuration, and keeps results for a new round',async mode=>{
 const t=await room(mode);let {s,d}=await details(t);
 await expect(call('training_add_local',[hashes[0],t.id,'No'])).rejects.toThrow('Solotraining');await expect(call('social_invite',[hashes[0],t.id,accounts[1]])).rejects.toThrow('Solotraining');
 let g=createTrainingGame(t.matches[0].players as string[],t.scoring!,true,mode,t.participants[0].id,t.practiceSettings,mode==='checkout'?Array(10).fill(40):undefined);
 await expect(call('start_training_match',[s.token_hash,t.id,{...g,practiceSettings:{segments:[1]},activePlayer:g.players[g.starter??0]}])).rejects.toThrow('Trainingsstart');
 await expect(call('start_training_match',[hashes[1],t.id,{...g,activePlayer:g.players[g.starter??0]}])).rejects.toThrow();
 await call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[g.starter??0]}]);({s,d}=await details(t));
 while(g.phase!=='finished'){
  const actor=g.players[g.starter??0];
  const next=gameAction(g,actor,g.current.length===3?{type:'next'}:{type:'dart',hit:keypadHit(mode==='checkout'?0:20,1)});
  const updated=next.phase==='finished'?updateMatch(d.tournament,d.matchId,{legs:gameView(next).legs as [number,number],status:'finished',forfeited:null}).tournament:null;
  if(updated)updated.version=d.tournament.version+1;
  await call('write_game',[t.id,d.matchId,g.version,s.token_hash,{...next,activePlayer:actor},updated,updated?d.tournament.version:null]);g=next;
 }
 expect((await details(t)).d.game.phase).toBe('finished');await call('training_next',[hashes[0],t.id,t.scoring]);expect((await details(t)).d).toMatchObject({phase:'waiting',practiceModesReady:true,lastResult:{game:{practice:mode}}});
});

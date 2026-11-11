import {completedGameTournament} from '../src/domain/game-result';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const scoringServer=vi.hoisted(()=>({session:vi.fn(),get:vi.fn(),rpc:vi.fn(),db:vi.fn()}));
vi.mock('../src/server/repositories/supabase',()=>({repository:{session:scoringServer.session,get:scoringServer.get},rpc:scoringServer.rpc,db:scoringServer.db,DatabaseError:class extends Error{constructor(message:string,public code:string){super(message);}}}));
import {POST as scorePOST} from '../src/app/api/game/route';
import {createTournament,updateMatch,type Tournament} from '../src/domain/tournament';
import {createTrainingGame,gameAction,gameView,keypadHit,type Game} from '../src/domain/scoring';
import {hashToken} from '../src/server/security';
let db:PGlite;const accounts=[randomUUID(),randomUUID()],hashes=accounts.map(hashToken),owner=hashToken('training-admin'),expiry=new Date(Date.now()+86400000).toISOString();
const call=async(name:string,args:unknown[]=[])=>(await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
beforeAll(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');
 for(const file of ['DATENBANK_EINRICHTEN.sql',...['011_manager_accounts','012_saved_autodarts','013_shared_players_and_managers','014_training_and_friends','015_guest_invitations','016_player_accounts','017_account_lobbies','018_navigation_email_friends','019_strict_email_verification','020_username_search','021_training_modes','021_training_modes'].map(n=>'migrations/'+n+'.sql')])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 for(const [i,id] of accounts.entries()){
  await db.query('insert into public.managers(id,email,name,public_handle,email_verified_at,email_verified_address,email_verification_version,email_verification_required) values($1,$2,$3,$3,now(),$2,1,false)',[id,`local${i}@example.test`,`local_host${i}`]);
  await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'owner',$2,1,$3)",[hashes[i],id,expiry]);
 }
 await db.query("insert into public.sessions(token_hash,role,credential_version,expires_at) values($1,'owner',1,$2)",[owner,expiry]);
},30000);
afterAll(async()=>{await db?.close();});
async function room(mode:'x01'|'around-clock'='x01',admin=false){
 const t: Tournament={...createTournament({id:randomUUID(),kind:'training',name:'Practice',names:['Host','Mitspieler'],mode:'knockout',groupSize:2,advancePerGroup:1,scoring:{start:301,out:'single',legsToWin:1}},()=>0,randomUUID),trainingMode:mode,managerId:admin?'00000000-0000-4000-8000-000000000001':accounts[0]};
 if(mode==='around-clock')t.scoring={start:501,out:'single',legsToWin:1};
 const creds={editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'internal',player_codes:t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'internal'}))};
 await call('create_training_room',[admin?owner:hashes[0],t,creds,null,null,hashToken(t.id+'child'),expiry,null]);return t;
}
it('local participants have no new account, get both scoped seats, share the host board and cannot be stolen',async()=>{
 const t=await room(),count=(await db.query('select * from public.managers')).rows.length;
 await expect(call('training_add_local',[hashes[1],t.id,'Lokal'])).rejects.toThrow();
 await call('training_add_local',[hashes[0],t.id,'Bärbel']);
 const s=await call('account_play_session',[hashes[0],t.id]);expect(s.participant_ids).toEqual(t.participants.map(p=>p.id));
 const d=await call('training_details',[s.token_hash,t.id,hashes[0]]);expect(d.seats[1]).toMatchObject({ready:true,local:true,accountId:null});expect(d.tournament.participants[1].name).toBe('Bärbel');
 expect((await db.query('select * from public.managers')).rows).toHaveLength(count);expect(await call('player_search',[hashes[1],'Bärbel'])).toEqual([]);
 expect(await call('account_play_session',[hashes[1],t.id])).toBeNull();
 await call('autodarts_profile',[s.token_hash,'link','encrypted-board',null,null]);expect(await call('autodarts_profile',[hashes[0],'read',null,null,null])).toMatchObject({accountKey:'manager:'+accounts[0],linked:true});
 await expect(call('social_invite',[hashes[0],t.id,accounts[1]])).rejects.toThrow();
 const g=createTrainingGame(t.matches[0].players as [string,string],t.scoring!,false);await call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[gameView(g).active]}]);
 const bull=gameAction(g,g.players[1],{type:'bull',hit:keypadHit(25,1)});
 await call('write_device_game',[t.id,t.matches[0].id,1,s.token_hash,g.players[1],{...bull,activePlayer:g.players[gameView(g).active]},null,null]);
 expect((await call('training_details',[s.token_hash,t.id,hashes[0]])).game.bull[1]).toBeTruthy();
 await expect(call('training_add_local',[hashes[0],t.id,'Andere'])).rejects.toThrow();
});
it('local removal revokes both-seat control, permits account invitations again, and rejects occupied seats',async()=>{
 const t=await room();await call('training_add_local',[hashes[0],t.id,'Local']);
 const child=await call('account_play_session',[hashes[0],t.id]);
 await call('training_remove_player',[hashes[0],t.id,hashToken('replace-'+t.id),'internal']);
 expect((await call('read_session',[child.token_hash])).participant_ids).toEqual([t.participants[0].id]);
 expect((await call('training_details',[child.token_hash,t.id,hashes[0]])).seats[1]).toMatchObject({local:false,ready:false});
 await call('social_invite',[hashes[0],t.id,accounts[1]]);const inv=(await call('social_snapshot',[hashes[1]])).invitations.find((i:any)=>i.roomId===t.id);await call('accept_account_invitation',[hashes[1],inv.id]);
 await expect(call('training_add_local',[hashes[0],t.id,'Steal'])).rejects.toThrow('belegt');
 const solo=createTrainingGame(t.matches[0].players as [string,string],t.scoring!,true,'x01',t.participants[0].id);await expect(call('start_training_match',[hashes[0],t.id,solo])).rejects.toThrow('frei');
});
it.each(['x01','around-clock'] as const)('%s solo starts with one ready seat, writes real results and retains stats for the next round',async(mode)=>{
 const t=await room(mode),s=await call('account_play_session',[hashes[0],t.id]);let g=createTrainingGame(t.matches[0].players as [string,string],t.scoring!,true,mode,t.participants[0].id);
 await call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[gameView(g).active]}]);
 const write=async(next:Game)=>{
  const d=await call('training_details',[s.token_hash,t.id,hashes[0]]),done=next.phase==='finished',updated=done?completedGameTournament(d.tournament,d.matchId,next):null;
  if(updated)updated.version=d.tournament.version+1;
  if(updated){const decorated={...updated,managerName:'Anzeigename'};await expect(call('write_game',[t.id,t.matches[0].id,g.version,s.token_hash,{...next,activePlayer:next.players[gameView(next).active]},decorated,d.tournament.version])).rejects.toThrow('Strukturelle Änderung nicht erlaubt');}
  if(updated&&mode==='around-clock'){const invalid={...updated,matches:updated.matches.map((m:any)=>({...m,legs:[null,null]}))};await expect(call('write_game',[t.id,t.matches[0].id,g.version,s.token_hash,{...next,activePlayer:next.players[gameView(next).active]},invalid,d.tournament.version])).rejects.toThrow('Ungültiges Endergebnis');}
  await call('write_game',[t.id,t.matches[0].id,g.version,s.token_hash,{...next,activePlayer:next.players[gameView(next).active]},updated,updated?d.tournament.version:null]);g=next;
 };
 const hits=mode==='x01'?[20,20,20,20,20,1]:[...Array.from({length:20},(_,i)=>i+1),25];
 for(const [i,n] of hits.entries()){
  await write(gameAction(g,t.participants[0].id,{type:'dart',hit:keypadHit(n,mode==='x01'&&n===20?3:1)}));
  if(g.current.length===3||i===hits.length-1)await write(gameAction(g,t.participants[0].id,{type:'next'}));
 }
 expect(g.phase).toBe('finished');await call('training_next',[hashes[0],t.id,t.scoring]);const d=await call('training_details',[s.token_hash,t.id,hashes[0]]);expect(d).toMatchObject({round:2,phase:'waiting',game:null,lastResult:{game:{solo:true,phase:'finished'}}});
 expect((await db.query('select * from public.player_match_history where account_id=$1',[accounts[0]])).rows.length).toBeGreaterThan(0);
});
it('Admin can host local practice and anonymous callers retain no access',async()=>{
 const t=await room('x01',true);await call('training_add_local',[owner,t.id,'Local Admin']);expect((await call('account_play_session',[owner,t.id])).participant_ids).toHaveLength(2);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await expect(call('training_add_local',[owner,t.id,'No'])).rejects.toThrow();await db.exec('reset role');}
});
it('Around the Clock has no invitations or local opponents, and local names are validated in SQL',async()=>{
 const clock=await room('around-clock');await expect(call('training_add_local',[hashes[0],clock.id,'Local'])).rejects.toThrow('Solotraining');await expect(call('social_invite',[hashes[0],clock.id,accounts[1]])).rejects.toThrow();
 const t=await room();for(const name of ['', 'Host','x'.repeat(41),'bad\nname'])await expect(call('training_add_local',[hashes[0],t.id,name])).rejects.toThrow();
});
it('reset returns solo training to a startable lobby with its original participant and mode',async()=>{
 const t=await room('around-clock'),s=await call('account_play_session',[hashes[0],t.id]),g=createTrainingGame(t.matches[0].players as [string,string],t.scoring!,true,'around-clock',t.participants[0].id);
 await call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[g.starter!]}]);
 const d=await call('training_details',[s.token_hash,t.id,hashes[0]]),reset=updateMatch(d.tournament,d.matchId,{legs:[null,null],status:'pending',forfeited:null}).tournament;reset.version=d.tournament.version+1;
 await call('reset_game',[t.id,d.matchId,hashes[0],reset,d.tournament.version]);
 expect(await call('training_details',[s.token_hash,t.id,hashes[0]])).toMatchObject({phase:'waiting',game:null,tournament:{status:'planned',trainingMode:'around-clock'}});
 await call('start_training_match',[s.token_hash,t.id,{...g,activePlayer:g.players[g.starter!]}]);
});

it('global admin can persist the complete solo Clock result through the same owner route as the API',async()=>{
 const t=await room('around-clock',true);let g=createTrainingGame(t.matches[0].players as string[],t.scoring!,true,'around-clock',t.participants[0].id);
 await call('start_training_match',[owner,t.id,{...g,activePlayer:t.participants[0].id}]);
 for(const n of [...Array.from({length:20},(_,i)=>i+1),25]){
  for(const action of [{type:'dart',hit:keypadHit(n,1)},...(g.current.length===2||n===25?[{type:'next'}]:[])] as const){
   const next=gameAction(g,t.participants[0].id,action as any),d=await call('training_details',[owner,t.id,owner]),updated=next.phase==='finished'?completedGameTournament(d.tournament,d.matchId,next):null;
   if(updated)updated.version=d.tournament.version+1;
   await call('write_owner_game',[t.id,t.matches[0].id,g.version,owner,t.participants[0].id,{...next,activePlayer:t.participants[0].id},updated,updated?d.tournament.version:null]);g=next;
  }
 }
 expect(g.phase).toBe('finished');expect((await call('training_details',[owner,t.id,owner])).game.phase).toBe('finished');
});

it('the real scoring API completes Clock with a verified account, enriched reads and real SQL authorisation',async()=>{
 const t=await room('around-clock'),actor=t.participants[0].id;let g=createTrainingGame(t.matches[0].players as string[],t.scoring!,true,'around-clock',actor);
 await call('start_training_match',[hashes[0],t.id,{...g,activePlayer:actor}]);
 for(const n of [...Array.from({length:20},(_,i)=>i+1),25]){g=gameAction(g,actor,{type:'dart',hit:keypadHit(n,1)});if(g.current.length===3&&n!==25)g=gameAction(g,actor,{type:'next'});}
 await db.query('update public.match_games set state=$1,version=$2 where tournament_id=$3',[{...g,activePlayer:actor},g.version,t.id]);
 scoringServer.session.mockImplementation(raw=>call('read_session',[hashToken(raw)]));
 scoringServer.get.mockImplementation(async(id,_session,options)=>{const row=(await db.query<{state:Tournament}>('select state from public.tournaments where id=$1',[id])).rows[0];return options?.stateOnly?row.state:{...row.state,managerName:'Joined manager display name'};});
 scoringServer.rpc.mockImplementation(async(name,args)=>{
  const entries=Object.entries(args);try{return (await db.query<{result:any}>(`select public.${name}(${entries.map(([key],i)=>key+' => $'+(i+1)).join(',')}) result`,entries.map(([,v])=>v))).rows[0].result;}catch(error){const {DatabaseError}=await import('../src/server/repositories/supabase');throw new DatabaseError((error as Error).message,(error as any).code);}
 });
 scoringServer.db.mockReturnValue({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{state:(await db.query<{state:Game}>('select state from public.match_games where tournament_id=$1',[t.id])).rows[0].state},error:null})};return q;}});
 vi.stubEnv('APP_ORIGIN','https://example.test');
 const result=await scorePOST(new NextRequest('https://example.test/api/game',{method:'POST',headers:{origin:'https://example.test',cookie:'dartbracket_session='+accounts[0]},body:JSON.stringify({id:t.id,match:t.matches[0].id,operation:'action',action:{type:'next'},actor,expectedVersion:g.version})}));
 expect(result.status).toBe(200);expect((await result.json()).game.phase).toBe('finished');
 expect((await call('read_session',[hashes[0]])).role).toBe('owner');const details=await call('training_details',[hashes[0],t.id,hashes[0]]);expect(details.game.phase).toBe('finished');expect(details.tournament.status).toBe('completed');expect(details.tournament).not.toHaveProperty('managerName');vi.unstubAllEnvs();
});

it('two verified accounts on one device finish a real match with individual SQL identities and statistics',async()=>{
 const {encrypt}=await import('../src/server/security');vi.stubEnv('ACCESS_ENCRYPTION_KEY','2'.repeat(64));vi.stubEnv('APP_ORIGIN','https://example.test');
 try{
 const t=await room();await call('social_invite',[hashes[0],t.id,accounts[1]]);const invite=(await call('social_snapshot',[hashes[1]])).invitations.find((i:any)=>i.roomId===t.id);await call('accept_account_invitation',[hashes[1],invite.id]);
 const sessions=await Promise.all(hashes.map(h=>call('account_play_session',[h,t.id])));let g=createTrainingGame(t.matches[0].players as [string,string],t.scoring!,false);
 await call('start_training_match',[sessions[0].token_hash,t.id,{...g,activePlayer:g.players[0]}]);
 scoringServer.session.mockImplementation(raw=>call('read_session',[hashToken(raw)]));
 scoringServer.get.mockImplementation(async(id,_s,options)=>{const row=(await db.query<{state:Tournament}>('select state from public.tournaments where id=$1',[id])).rows[0];return options?.stateOnly?row.state:{...row.state,managerName:'Display-only name'};});
 scoringServer.rpc.mockImplementation(async(name,args)=>{const entries=Object.entries(args);try{return (await db.query<{result:any}>(`select public.${name}(${entries.map(([key],i)=>key+' => $'+(i+1)).join(',')}) result`,entries.map(([,v])=>v))).rows[0].result;}catch(error){const {DatabaseError}=await import('../src/server/repositories/supabase');throw new DatabaseError((error as Error).message,(error as any).code);}});
 scoringServer.db.mockReturnValue({from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{state:(await db.query<{state:Game}>('select state from public.match_games where tournament_id=$1',[t.id])).rows[0].state},error:null})};return q;}});
 const cookie=encrypt(JSON.stringify({parent:hashes[0],tokens:[accounts[1]]}));
 const act=async(actor:string,action:unknown,attached=true)=>{const r=await scorePOST(new NextRequest('https://example.test/api/game',{method:'POST',headers:{origin:'https://example.test',cookie:`dartbracket_session=${accounts[0]}; ${attached?'dartbracket_device_accounts='+cookie:''}`},body:JSON.stringify({id:t.id,match:t.matches[0].id,operation:'action',actor,action,expectedVersion:g.version})}));const d=await r.json();if(r.ok)g=d.game;return {status:r.status,data:d};};
 expect((await act(sessions[1].participant_id,{type:'bull',hit:keypadHit(25,1)},false)).status).toBe(403);
 expect((await act(g.players[0],{type:'bull',hit:keypadHit(25,2)})).status).toBe(200);expect((await act(g.players[1],{type:'bull',hit:keypadHit(25,1)})).status).toBe(200);
 for(const actor of g.players)expect((await act(actor,{type:'next'})).status).toBe(200);
 for(const hit of [keypadHit(20,3),keypadHit(20,3),keypadHit(20,3)])expect((await act(g.players[0],{type:'dart',hit})).status).toBe(200);
 expect((await act(g.players[0],{type:'next'})).status).toBe(200);expect((await act(g.players[1],{type:'dart',hit:keypadHit(0,1)})).status).toBe(200);expect((await act(g.players[1],{type:'next'})).status).toBe(200);
 for(const hit of [keypadHit(20,3),keypadHit(20,3),keypadHit(1,1)])expect((await act(g.players[0],{type:'dart',hit})).status).toBe(200);
 expect((await act(g.players[0],{type:'next'})).status).toBe(200);expect(g.phase).toBe('finished');
 const result=await call('training_details',[sessions[0].token_hash,t.id,hashes[0]]);expect(result.tournament.status).toBe('completed');
 const history=(await db.query<{account_id:string}>('select account_id from public.player_match_history where event_key like $1',[t.id+':%'])).rows;expect(history.map(row=>row.account_id).sort()).toEqual([...accounts].sort());
 const writes=scoringServer.rpc.mock.calls.filter(([name,args])=>name==='write_game'&&args.p_id===t.id);expect(new Set(writes.map(([,args])=>args.p_hash))).toEqual(new Set(sessions.map(s=>s.token_hash)));
 }finally{vi.unstubAllEnvs();}
});

import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createTournament,updateMatch,type Tournament} from '../src/domain/tournament';
import {createGame,gameAction,gameView,keypadHit} from '../src/domain/scoring';
import {hashToken} from '../src/server/security';
let db:PGlite,t:Tournament,other:Tournament;
const ma=randomUUID(),mb=randomUUID(),root=hashToken('root'),a=hashToken('manager-a'),b=hashToken('manager-b'),player=hashToken('player'),second=hashToken('second');
const call=async(name:string,args:unknown[])=>(await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
async function newSession(hash:string,manager:string|null){await db.query("insert into public.sessions(token_hash,role,manager_id,credential_version,expires_at) values($1,'owner',$2,1,now()+interval '1 day')",[hash,manager]);}
async function make(manager:string,session:string){const t={...createTournament({id:randomUUID(),name:'Gemeinsames Gerät',names:['Anna','Berta','Clara','Dora'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID),managerId:manager,createdByName:manager===ma?'Manager A':'Manager B',status:'running' as const};await call('create_tournament',[t,{editor_link_hash:hashToken(t.id),editor_pin_hash:'unused',editor_secret:'unused',player_codes:t.participants.map(p=>({participant_id:p.id,code_hash:hashToken(p.id),code_secret:'encrypted'}))},session]);return t;}
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');for(const file of ['DATENBANK_EINRICHTEN.sql','migrations/011_manager_accounts.sql','migrations/012_saved_autodarts.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));await db.query("insert into public.managers(id,email,name) values($1,'a@example.test','Manager A'),($2,'b@example.test','Manager B')",[ma,mb]);await newSession(root,null);await newSession(a,ma);await newSession(b,mb);t=await make(ma,a);other=await make(mb,b);await call('choose_device_players',[a,t.id,[t.participants[3].id],false]);for(let i=0;i<2;i++)await db.exec(await readFile(new URL('../supabase/migrations/013_shared_players_and_managers.sql',import.meta.url),'utf8'));},30000);
afterAll(async()=>{await db?.close();});
it('Migration übernimmt eine schon vorher aktive Manager-Spielerwahl',async()=>{const choice=(await db.query<{participant_ids:string[]}>('select participant_ids from public.manager_player_choices where manager_id=$1 and tournament_id=$2',[ma,t.id])).rows[0];expect(choice.participant_ids).toEqual([t.participants[3].id]);});
it('eigene Codes werden mit bestätigter Geräteübernahme verbunden; fehlgeschlagene Übernahme gewährt keine Teilrechte',async()=>{
 await call('login_player_session',[hashToken(t.participants[0].id),player,new Date(Date.now()+86400000).toISOString(),false]);await call('login_player_session',[hashToken(t.participants[1].id),second,new Date(Date.now()+86400000).toISOString(),false]);
 await expect(call('add_device_player',[player,hashToken(t.participants[1].id),false])).rejects.toThrow('PLAYER_IN_USE');expect((await call('read_session',[player])).authorized_participant_ids).toEqual([t.participants[0].id]);
 await call('add_device_player',[player,hashToken(t.participants[1].id),true]);await call('add_device_player',[player,hashToken(t.participants[2].id),false]);
 const s=await call('read_session',[player]);expect(s.participant_ids.sort()).toEqual(t.participants.slice(0,3).map(p=>p.id).sort());expect(s.authorized_participant_ids.sort()).toEqual(s.participant_ids);expect(await call('read_session',[second])).toBeNull();
});
it('fremde Turniere, falsche Codes und nicht autorisierte Namen bleiben gesperrt',async()=>{
 await expect(call('add_device_player',[player,hashToken(other.participants[0].id),false])).rejects.toThrow('anderen Turnier');await expect(call('add_device_player',[player,hashToken('invalid'),false])).rejects.toThrow('ungültig');await expect(call('choose_device_players',[player,t.id,[t.participants[3].id],false])).rejects.toThrow('eigener Code');await expect(call('assert_session',[player,other.id,'score'])).rejects.toThrow('Keine Berechtigung');
});
it('alle angemeldeten Spieler können als Akteur handeln; Auswahl eines Einzelspielers verliert keine Codeberechtigung',async()=>{
 await call('begin_device_action',[player,t.id,t.participants[1].id]);expect((await call('read_session',[player])).participant_id).toBe(t.participants[1].id);await expect(call('begin_device_action',[player,t.id,t.participants[3].id])).rejects.toThrow('nicht zugeordnet');
 await call('choose_device_players',[player,t.id,[t.participants[2].id],false]);expect((await call('read_session',[player])).authorized_participant_ids).toHaveLength(3);await call('choose_device_players',[player,t.id,t.participants.slice(0,3).map(p=>p.id),false]);
});
it('zwei über Codes freigeschaltete Akteure schreiben dasselbe Spiel über den echten Geräteweg',async()=>{
 const selected=t.participants.slice(0,3).map(p=>p.id),m=t.matches.find(m=>m.players.every(p=>p&&selected.includes(p)))!;
 const players=m.players as [string,string];let game=createGame(players,t.scoring!);
 const next=updateMatch(t,m.id,{legs:[0,0],status:'running',forfeited:null}).tournament;next.version=t.version+1;next.updatedAt=new Date().toISOString();
 await call('write_device_game',[t.id,m.id,0,player,players[0],{...game,activePlayer:game.players[gameView(game).active]},next,t.version]);t=next;
 for(const actor of players){const previous=game.version;game=gameAction(game,actor,{type:'bull',hit:keypadHit(25,1)});await call('write_device_game',[t.id,m.id,previous,player,actor,{...game,activePlayer:game.players[gameView(game).active]},null,null]);}
 const state=(await db.query<{state:{bull:unknown[]}}>('select state from public.match_games where tournament_id=$1 and match_id=$2',[t.id,m.id])).rows[0].state;expect(state.bull.every(Boolean)).toBe(true);
});
it('Manager-Auswahl und Nicht-Mitspielen werden dauerhaft wiederhergestellt; aktive Geräte benötigen Übernahme',async()=>{
 await call('choose_device_players',[a,t.id,[t.participants[3].id],true]);const fresh=hashToken('manager-fresh');await newSession(fresh,ma);expect(await call('restore_manager_player',[fresh])).toMatchObject({needsTakeover:true,tournamentId:t.id});expect(await call('read_session',[fresh])).toMatchObject({participant_id:null,remembered_tournament_id:t.id,remembered_participant_ids:[t.participants[3].id]});
 await db.query('delete from public.sessions where token_hash=$1',[a]);expect(await call('restore_manager_player',[fresh])).toMatchObject({participantIds:[t.participants[3].id]});
 await call('choose_device_players',[fresh,t.id,[],false]);const notPlaying=hashToken('not-playing');await newSession(notPlaying,ma);expect(await call('restore_manager_player',[notPlaying])).toMatchObject({participantIds:[],tournamentId:t.id});expect(await call('read_session',[notPlaying])).toMatchObject({participant_id:null,remembered_tournament_id:t.id});
});
it('Wiederholte Migration erhält gemeinsame Codes und gespeicherte Nichtteilnahme',async()=>{await db.exec(await readFile(new URL('../supabase/migrations/013_shared_players_and_managers.sql',import.meta.url),'utf8'));expect((await call('read_session',[player])).authorized_participant_ids).toHaveLength(3);const choice=(await db.query<{participant_ids:string[]}>('select participant_ids from public.manager_player_choices where manager_id=$1 and tournament_id=$2',[ma,t.id])).rows[0];expect(choice.participant_ids).toEqual([]);});
it('Archivieren verbirgt Turnier für Spieler, Wiederöffnen stellt es wieder her',async()=>{
 await db.query("update public.tournaments set status='archived' where id=$1",[t.id]);expect(await call('read_session',[player])).toBeNull();expect(await call('private_list_archived',[root])).toBeTruthy();await db.query("update public.tournaments set status='running' where id=$1",[t.id]);expect(await call('read_session',[player])).toBeTruthy();
});
it('nur Owner löscht Manager, Turniere bleiben erhalten und alte Codes, Sitzungen und Token sind widerrufen',async()=>{
 await expect(call('prepare_manager_deletion',[b,ma])).rejects.toThrow('Nur der Owner');await expect(call('prepare_manager_deletion',[root,'00000000-0000-4000-8000-000000000001'])).rejects.toThrow('Nur der Owner');
 await db.query("insert into public.saved_autodarts(manager_id,refresh_secret) values($1,'encrypted')",[ma]);
 expect(await call('prepare_manager_deletion',[root,ma])).toBe(true);expect(await call('prepare_manager_deletion',[root,ma])).toBe(true);
 const saved=(await db.query<{manager_id:string;state:typeof t}>('select manager_id,state from public.tournaments where id=$1',[t.id])).rows[0];expect(saved.manager_id).toBe('00000000-0000-4000-8000-000000000001');expect(saved.state.createdByName).toBe('Manager A');expect(saved.state.matches).toEqual(t.matches);expect(await call('read_session',[player])).toBeNull();expect(await call('login_player_session',[hashToken(t.participants[0].id),hashToken('old-code'),new Date(Date.now()+86400000).toISOString(),true])).toBeNull();expect((await db.query('select * from public.saved_autodarts where manager_id=$1',[ma])).rows).toHaveLength(0);await expect(call('manage_manager_status',[root,ma,'enable'])).rejects.toThrow('zur Löschung');expect(await call('read_session',[b])).toBeTruthy();
});
it('neue Tabellen und privilegierte Funktionen sind für Browserrollen gesperrt',async()=>{for(const role of ['anon','authenticated']){await db.exec('set role '+role);await expect(db.query('select * from public.manager_player_choices')).rejects.toThrow();await expect(call('add_device_player',[player,hashToken('x'),false])).rejects.toThrow();await expect(call('prepare_manager_deletion',[root,mb])).rejects.toThrow();await db.exec('reset role');}});

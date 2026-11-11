import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import {createTournament,updateMatch} from '../src/domain/tournament';
import {createGame,gameAction,gameView,keypadHit,type Game} from '../src/domain/scoring';
import {hashToken} from '../src/server/security';
it('gemeinsames Gerät reserviert Spieler atomar, spielt beide Seiten und verliert nur übernommene Namen',async()=>{
 const db=new PGlite();const owner=hashToken('shared-admin'),device=hashToken('shared-device'),other=hashToken('shared-other');
 const call=(name:string,args:unknown[])=>db.query<Record<string,unknown>>('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args);
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;');await db.exec(await readFile(new URL('../supabase/DATENBANK_EINRICHTEN.sql',import.meta.url),'utf8'));
  await db.query("insert into public.sessions(token_hash,role,credential_version,expires_at) values($1,'owner',1,now()+interval '1 day')",[owner]);
  let t=createTournament({id:randomUUID(),name:'Ein Board',names:['A','B','C','D'],mode:'knockout',groupSize:4,advancePerGroup:2,scoring:{start:301,out:'single',legsToWin:2}},randomInt,randomUUID);t.status='running';
  await call('create_tournament',[t,{admin_hash:'',editor_link_hash:hashToken(t.id),editor_pin_hash:'pin',editor_secret:'secret'},owner]);
  for(const hash of [device,other])await db.query("insert into public.sessions(token_hash,role,tournament_id,credential_version,expires_at) values($1,'editor',$2,1,now()+interval '1 day')",[hash,t.id]);
  const m=t.matches[0],players=m.players as [string,string], outsider=t.participants.find(p=>!players.includes(p.id))!.id;
  await call('choose_device_players',[device,t.id,players,false]);await expect(call('choose_tournament_player',[other,t.id,players[1],false])).rejects.toThrow('PLAYER_IN_USE');
  let g=createGame(players,t.scoring!);const state=(g:Game)=>({...g,activePlayer:g.players[gameView(g).active]});
  const next=updateMatch(t,m.id,{legs:[0,0],status:'running',forfeited:null}).tournament;next.version++;await call('write_device_game',[t.id,m.id,0,device,players[0],state(g),next,t.version]);t=next;
  const act=async(player:string,action:Parameters<typeof gameAction>[2])=>{const next=gameAction(g,player,action);await call('write_device_game',[t.id,m.id,g.version,device,player,state(next),null,null]);g=next;};
  await act(players[0],{type:'bull',hit:keypadHit(25,2)});await act(players[0],{type:'next'});await act(players[1],{type:'bull',hit:keypadHit(25,1)});await act(players[1],{type:'next'});
  await expect(call('write_device_game',[t.id,m.id,g.version,device,outsider,state({...g,version:g.version+1}),null,null])).rejects.toThrow('nicht zugeordnet');
  const conn=randomUUID(),jpg='data:image/jpeg;base64,/9j/AA==';await call('write_cached_board_image',[t.id,m.id,device,players[0],conn,'playing:0','frame',jpg,new Date().toISOString(),true]);
  await act(players[0],{type:'dart',hit:keypadHit(20,1)});await act(players[0],{type:'next'});await act(players[1],{type:'dart',hit:keypadHit(20,1)});
  await call('write_cached_board_image',[t.id,m.id,device,players[1],conn,'playing:1','frame',jpg,new Date().toISOString(),false]);
  await call('write_cached_board_image',[t.id,m.id,device,players[1],conn,'playing:1','clear',null,new Date().toISOString(),false]);
  expect((await db.query('select image,empty_image from public.match_board_images')).rows).toEqual([{image:null,empty_image:null},{image:null,empty_image:null}]);
  expect((await call('read_session',[device])).rows[0].read_session).toMatchObject({participant_id:players[0],participant_ids:players});
  await call('choose_tournament_player',[other,t.id,players[1],true]);expect((await call('read_session',[device])).rows[0].read_session).toMatchObject({participant_id:players[0],participant_ids:[players[0]]});
  await expect(call('write_device_game',[t.id,m.id,g.version,device,players[1],state({...g,version:g.version+1}),null,null])).rejects.toThrow('nicht zugeordnet');
  await db.exec('set role anon');await expect(call('choose_device_players',[device,t.id,players,true])).rejects.toThrow();await db.exec('reset role');
 }finally{await db.close();}
},30000);

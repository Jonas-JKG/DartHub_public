-- Run after 021. Around the Clock supports one to six account/local players.
begin;
alter table public.training_seats drop constraint if exists training_seats_position_check;
alter table public.training_seats add constraint training_seats_position_check check(position between 0 and 5);
alter table public.tournaments drop constraint if exists tournament_participant_count;
alter table public.tournaments add constraint tournament_participant_count check(
 case when state->>'kind'='training' then case when state->>'trainingMode'='around-clock' then jsonb_array_length(state->'participants') between 2 and 6 else jsonb_array_length(state->'participants')=2 end
 when state->>'setupPhase'='lobby' then status='planned' and jsonb_array_length(state->'participants') between 0 and 20 and state->'matches'='[]'::jsonb and state->'groups'='[]'::jsonb
 else jsonb_array_length(state->'participants') between 3 and 20 end);
create or replace function public.clock_multiplayer_ready() returns boolean language sql security definer set search_path='' as $$select true$$;
do $$ begin
 if to_regprocedure('public.sync_tournament_clock_base(jsonb)') is null then alter function public.sync_tournament(jsonb) rename to sync_tournament_clock_base;end if;
 if to_regprocedure('public.training_add_local_clock_base(text,uuid,text)') is null then alter function public.training_add_local(text,uuid,text) rename to training_add_local_clock_base;end if;
 if to_regprocedure('public.social_invite_clock_base(text,uuid,uuid)') is null then alter function public.social_invite(text,uuid,uuid) rename to social_invite_clock_base;end if;
 if to_regprocedure('public.accept_account_invitation_clock_base(text,uuid)') is null then alter function public.accept_account_invitation(text,uuid) rename to accept_account_invitation_clock_base;end if;
 if to_regprocedure('public.start_training_match_clock_base(text,uuid,jsonb)') is null then alter function public.start_training_match(text,uuid,jsonb) rename to start_training_match_clock_base;end if;
 if to_regprocedure('public.training_details_clock_base(text,uuid,text)') is null then alter function public.training_details(text,uuid,text) rename to training_details_clock_base;end if;
end $$;
-- The full roster and actual winner remain in tournament/game JSON. The legacy
-- relational match index has two player columns; project that index only.
create or replace function public.sync_tournament(p_state jsonb) returns void language plpgsql security definer set search_path='' as $$
declare projected jsonb:=p_state;m jsonb;a text;b text;begin
 if p_state->>'kind'='training' and p_state->>'trainingMode'='around-clock' then
  m:=p_state->'matches'->0;
  a:=case when m->>'status'='finished' then m->>'winner' else m->'players'->>0 end;
  if a is null or not exists(select 1 from jsonb_array_elements(p_state->'participants') p where p->>'id'=a) then raise exception 'Ungültiger Trainingsspieler.' using errcode='22023';end if;
  select p->>'id' into b from jsonb_array_elements(p_state->'participants') p where p->>'id'<>a limit 1;
  m:=m||jsonb_build_object('players',jsonb_build_array(a,b),'sources',jsonb_build_array(jsonb_build_object('kind','participant','id',a),jsonb_build_object('kind','participant','id',b)));
  if m->>'status'='finished' then m:=m||jsonb_build_object('legs',jsonb_build_array(1,0));end if;
  projected:=jsonb_set(projected,'{matches}',jsonb_build_array(m));
 end if;
 perform public.sync_tournament_clock_base(projected);
 -- Public spectators must receive the full roster, never the two-column index.
 if p_state->>'kind'='training' and p_state->>'trainingMode'='around-clock' then
  update public.public_tournament_snapshots set state=p_state where id=(p_state->>'id')::uuid;
 end if;
end $$;
-- Private helper: allocate an account-only seat; no guest/code login is enabled.
create or replace function public.clock_free_seat(p_id uuid) returns public.training_seats language plpgsql security definer set search_path='' as $$
declare st jsonb;seat public.training_seats;pid uuid;aid uuid;pos integer;begin
 select state into st from public.tournaments where id=p_id for update;
 if st->>'trainingMode' is distinct from 'around-clock' or not exists(select 1 from public.training_rooms where id=p_id and phase='waiting') then raise exception 'Nur in einer offenen Around-the-Clock-Lobby möglich.' using errcode='55000';end if;
 select s.* into seat from public.training_seats s where s.room_id=p_id and s.position>0 and not exists(select 1 from public.account_player_links l where l.access_id=s.access_id) order by s.position limit 1;
 if seat.access_id is not null then return seat;end if;
 select count(*) into pos from public.training_seats where room_id=p_id;
 if pos>=6 then raise exception 'Höchstens sechs Spieler möglich.' using errcode='55000';end if;
 pid:=gen_random_uuid();aid:=gen_random_uuid();
 st:=st||jsonb_build_object('participants',st->'participants'||jsonb_build_array(jsonb_build_object('id',pid,'name','Mitspieler '||pos)),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 insert into public.player_access_codes(id,tournament_id,participant_id,code_hash,code_secret) values(aid,p_id,pid,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'internal-account-only');
 insert into public.training_seats(room_id,position,participant_id,access_id) values(p_id,pos,pid,aid) returning * into seat;
 return seat;
end $$;
create or replace function public.training_add_local(p_hash text,p_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
declare host uuid;seat public.training_seats;st jsonb;name text:=trim(p_name);begin
 perform public.training_host(p_hash,p_id);select state into st from public.tournaments where id=p_id for update;
 if st->>'trainingMode' is distinct from 'around-clock' then perform public.training_add_local_clock_base(p_hash,p_id,p_name);return;end if;
 if name is null or length(name) not between 1 and 40 or name ~ '[[:cntrl:]]' or exists(select 1 from jsonb_array_elements(st->'participants') p where lower(p->>'name')=lower(name)) then raise exception 'Bitte einen anderen Namen mit 1–40 Zeichen wählen.' using errcode='22023';end if;
 seat:=public.clock_free_seat(p_id);select host_manager_id into host from public.training_rooms where id=p_id;
 update public.training_seats set is_local=true where room_id=p_id and participant_id=seat.participant_id;
 insert into public.account_player_links(access_id,manager_id,version) select id,host,version from public.player_access_codes where id=seat.access_id;
 select state into st from public.tournaments where id=p_id;
 st:=st||jsonb_build_object('participants',(select jsonb_agg(case when p->>'id'=seat.participant_id::text then p||jsonb_build_object('name',name) else p end order by ord) from jsonb_array_elements(st->'participants') with ordinality x(p,ord)),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 delete from public.sessions where tournament_id=p_id and role='editor' and account_session_hash in(select token_hash from public.sessions where role='owner' and coalesce(manager_id,'00000000-0000-4000-8000-000000000001')=host);
 perform public.account_play_session(p_hash,p_id);
end $$;
create or replace function public.training_remove_clock_player(p_hash text,p_id uuid,p_player uuid,p_code_hash text,p_secret text) returns void language plpgsql security definer set search_path='' as $$
declare seat public.training_seats;st jsonb;begin
 perform public.training_host(p_hash,p_id);select state into st from public.tournaments where id=p_id for update;
 if st->>'trainingMode' is distinct from 'around-clock' or not exists(select 1 from public.training_rooms where id=p_id and phase='waiting') then raise exception 'Nur zwischen Trainingsrunden möglich.' using errcode='55000';end if;
 select * into seat from public.training_seats where room_id=p_id and participant_id=p_player and position>0;
 if seat.access_id is null then raise exception 'Dieser Spieler kann nicht entfernt werden.' using errcode='42501';end if;
 update public.sessions set participant_ids=array_remove(participant_ids,p_player),participant_id=(array_remove(participant_ids,p_player))[1],player_access_ids=array_remove(player_access_ids,seat.access_id),player_access_versions=player_access_versions-seat.access_id::text where role='editor' and player_access_id<>seat.access_id and seat.access_id=any(player_access_ids);
 delete from public.sessions where role='editor' and (player_access_id=seat.access_id or seat.access_id=any(player_access_ids));
 delete from public.account_player_links where access_id=seat.access_id;
 update public.player_access_codes set code_hash=p_code_hash,code_secret=p_secret,version=version+1 where id=seat.access_id;
 update public.training_seats set is_local=false,session_hash=null where room_id=p_id and participant_id=p_player;
 st:=st||jsonb_build_object('participants',(select jsonb_agg(case when p->>'id'=p_player::text then p||jsonb_build_object('name','Mitspieler '||seat.position) else p end order by ord) from jsonb_array_elements(st->'participants') with ordinality x(p,ord)),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
end $$;
create or replace function public.social_invite(p_hash text,p_room uuid,p_friend uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.training_host(p_hash,p_room);perform 1 from public.tournaments where id=p_room for update;
 if exists(select 1 from public.tournaments where id=p_room and state->>'trainingMode'='around-clock') then
  if (select count(*) from public.training_seats s join public.account_player_links l on l.access_id=s.access_id where s.room_id=p_room)>=6 then raise exception 'Höchstens sechs Spieler möglich.' using errcode='55000';end if;
  if exists(select 1 from public.account_player_links l join public.training_seats s on s.access_id=l.access_id where s.room_id=p_room and l.manager_id=p_friend) then raise exception 'Dieser Spieler ist bereits dabei.' using errcode='22023';end if;
  perform public.social_invite_modes_base(p_hash,p_room,p_friend);
 else perform public.social_invite_clock_base(p_hash,p_room,p_friend);end if;
end $$;
create or replace function public.accept_account_invitation(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);inv public.training_invitations;seat public.training_seats;pc public.player_access_codes;st jsonb;username text;begin
 select i.* into inv from public.training_invitations i join public.tournaments t on t.id=i.room_id where i.id=p_id and i.receiver_id=account and t.state->>'trainingMode'='around-clock';
 if inv.id is null then return public.accept_account_invitation_clock_base(p_hash,p_id);end if;
 perform 1 from public.tournaments where id=inv.room_id for update;
 select * into inv from public.training_invitations where id=p_id and receiver_id=account;
 if inv.id is null then raise exception 'Einladung nicht verfügbar.' using errcode='42501';end if;
 if not exists(select 1 from public.training_rooms where id=inv.room_id and phase='waiting') then raise exception 'Die Lobby ist nicht mehr offen.' using errcode='55000';end if;
 if not exists(select 1 from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version where p.tournament_id=inv.room_id and l.manager_id=account) then
  seat:=public.clock_free_seat(inv.room_id);select * into pc from public.player_access_codes where id=seat.access_id;
  select coalesce(public_handle,name) into username from public.managers where id=account;
  select state into st from public.tournaments where id=inv.room_id;
  if exists(select 1 from jsonb_array_elements(st->'participants') p where p->>'id'<>seat.participant_id::text and lower(p->>'name')=lower(username)) then raise exception 'Dieser Name wird in der Lobby bereits verwendet.' using errcode='22023';end if;
  st:=st||jsonb_build_object('participants',(select jsonb_agg(case when p->>'id'=seat.participant_id::text then p||jsonb_build_object('name',username) else p end order by ord) from jsonb_array_elements(st->'participants') with ordinality x(p,ord)),'version',(st->>'version')::integer+1,'updatedAt',now());
  update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=inv.room_id;perform public.sync_tournament(st);
  insert into public.account_player_links(access_id,manager_id,version) values(pc.id,account,pc.version);
 end if;
 perform public.account_play_session(p_hash,inv.room_id);
 -- Other invitees must keep their own pending invitations in a multiplayer room.
 delete from public.training_invitations where id=p_id;
 return jsonb_build_object('redirect','/training/'||inv.room_id::text);
end $$;
create or replace function public.training_details(p_hash text,p_id uuid,p_account_hash text default null) returns jsonb language sql security definer set search_path='' as $$
 select public.training_details_clock_base(p_hash,p_id,p_account_hash)||jsonb_build_object('clockMultiplayerReady',true)
$$;
create or replace function public.start_training_match(p_hash text,p_id uuid,p_game jsonb) returns void language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;st jsonb;s jsonb:=public.read_session(p_hash);roster jsonb;occupied integer;host boolean;m jsonb;begin
 perform 1 from public.tournaments where id=p_id for update;select state into st from public.tournaments where id=p_id;
 if st->>'trainingMode' is distinct from 'around-clock' then perform public.start_training_match_clock_base(p_hash,p_id,p_game);return;end if;
 select * into room from public.training_rooms where id=p_id for update;
 host:=s->>'role'='owner' and (s->>'manager_id' is null or s->>'manager_id'=room.host_manager_id::text);
 if not coalesce(host,false) and not coalesce(s->>'training_id'=p_id::text and s->>'role'='editor' and exists(select 1 from public.training_seats seat where seat.room_id=p_id and s->'participant_ids' ? seat.participant_id::text),false) then raise exception 'Nur Lobby-Spieler dürfen das Match starten' using errcode='42501';end if;
 if room.phase<>'waiting' then raise exception 'Die Lobby ist nicht startbereit' using errcode='55000';end if;
 select jsonb_agg(seat.participant_id order by seat.position),count(*) into roster,occupied from public.training_seats seat join public.account_player_links l on l.access_id=seat.access_id join public.player_access_codes p on p.id=l.access_id and p.version=l.version and p.enabled where seat.room_id=p_id;
 if occupied not between 1 and 6 then raise exception 'Bitte ein bis sechs Spieler auswählen.' using errcode='22023';end if;
 if exists(select 1 from public.training_seats seat join public.account_player_links l on l.access_id=seat.access_id where seat.room_id=p_id and not public.training_seat_ready(seat.session_hash,seat.participant_id)) then raise exception 'Alle Spieler müssen bereit sein.' using errcode='55000';end if;
 if p_game->>'practice' is distinct from 'around-clock' or p_game->>'phase' is distinct from 'playing' or p_game->>'version' is distinct from '1' or p_game->'rules' is distinct from st->'scoring' or p_game->'current'<>'[]'::jsonb or p_game->'turns'<>'[]'::jsonb then raise exception 'Ungültiger Spielstart' using errcode='22023';end if;
 if occupied>1 then
  if p_game->'players' is distinct from roster or coalesce((p_game->>'solo')::boolean,true) or p_game->>'starter'<>'0' then raise exception 'Spielerliste inzwischen geändert.' using errcode='40001';end if;
 else
  if not coalesce((p_game->>'solo')::boolean,false) or jsonb_array_length(p_game->'players')<>2 or p_game->'players'->>(p_game->>'starter')::integer is distinct from roster->>0 or exists(select 1 from jsonb_array_elements_text(p_game->'players') pid where not exists(select 1 from jsonb_array_elements(st->'participants') p where p->>'id'=pid)) then raise exception 'Ungültiger Solo-Spieler.' using errcode='22023';end if;
 end if;
 if p_game->>'activePlayer' is distinct from p_game->'players'->>(p_game->>'starter')::integer then raise exception 'Ungültiger Startspieler.' using errcode='22023';end if;
 m:=st->'matches'->0||jsonb_build_object('players',p_game->'players','status','running');
 st:=jsonb_set(st,'{matches}',jsonb_build_array(m))||jsonb_build_object('status','running','startedAt',now(),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,status='running',version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 insert into public.match_games(tournament_id,match_id,state,version) values(p_id,room.match_id,p_game,1);
 update public.training_rooms set phase='playing',updated_at=now() where id=p_id;
end $$;
revoke all on function public.sync_tournament(jsonb),public.sync_tournament_clock_base(jsonb),public.clock_free_seat(uuid),public.training_add_local_clock_base(text,uuid,text),public.social_invite_clock_base(text,uuid,uuid),public.accept_account_invitation_clock_base(text,uuid),public.start_training_match_clock_base(text,uuid,jsonb),public.training_details_clock_base(text,uuid,text) from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('clock_multiplayer_ready','training_add_local','training_remove_clock_player','social_invite','accept_account_invitation','training_details','start_training_match') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

-- Run after 020. Local players exist only inside their training room.
begin;
alter table public.training_seats add column if not exists is_local boolean not null default false;
create or replace function public.training_modes_ready() returns boolean language sql security definer set search_path='' as $$ select true $$;
create or replace function public.account_play_session(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);pc public.player_access_codes;child text;parent public.sessions;cached jsonb;players uuid[];accesses uuid[];versions jsonb;begin
 select * into parent from public.sessions where token_hash=p_hash;
 select p.* into pc from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version join public.tournaments t on t.id=p.tournament_id join public.tournament_credentials c on c.tournament_id=t.id where l.manager_id=account and p.tournament_id=p_id and p.enabled and c.editor_enabled and t.status<>'archived' order by (select position from public.training_seats where room_id=p_id and access_id=p.id) nulls last,p.id limit 1;
 if pc.id is null then return null;end if;
 players:=array[pc.participant_id];accesses:=array[pc.id];versions:=jsonb_build_object(pc.id::text,pc.version);
 if exists(select 1 from public.training_rooms where id=p_id and host_manager_id=account) then
  select array_agg(p.participant_id order by seat.position),array_agg(p.id order by seat.position),jsonb_object_agg(p.id::text,p.version) into players,accesses,versions
  from public.training_seats seat join public.player_access_codes p on p.id=seat.access_id join public.account_player_links l on l.access_id=p.id and l.version=p.version
  where seat.room_id=p_id and l.manager_id=account and p.enabled and (seat.position=0 or seat.is_local);
 end if;
 child:=p_hash||':'||p_id::text;cached:=public.read_session(child);
 if cached is not null and cached->'participant_ids'=to_jsonb(players) then
  update public.training_seats set session_hash=child where room_id=p_id and access_id=any(accesses) and session_hash is distinct from child;return cached;
 end if;
 insert into public.sessions(token_hash,role,manager_id,tournament_id,credential_version,expires_at,participant_id,participant_ids,playing_tournament_id,player_access_id,player_access_ids,player_access_versions,account_session_hash,training_id)
 select child,'editor',t.manager_id,p_id,pc.version,parent.expires_at,pc.participant_id,players,p_id,pc.id,accesses,versions,p_hash,r.id from public.tournaments t left join public.training_rooms r on r.id=t.id where t.id=p_id
 on conflict(token_hash) do update set manager_id=excluded.manager_id,training_id=excluded.training_id,expires_at=excluded.expires_at,credential_version=excluded.credential_version,participant_id=excluded.participant_id,participant_ids=excluded.participant_ids,player_access_id=excluded.player_access_id,player_access_ids=excluded.player_access_ids,player_access_versions=excluded.player_access_versions;
 update public.training_seats set session_hash=child where room_id=p_id and access_id=any(accesses) and session_hash is distinct from child;
 return public.read_session(child);
end $$;

create or replace function public.training_add_local(p_hash text,p_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
declare host uuid;seat public.training_seats;st jsonb;name text:=trim(p_name);begin
 perform public.training_host(p_hash,p_id);
 -- Serialize with invitations, removal and match start on the tournament first.
 select state into st from public.tournaments where id=p_id for update;
 select host_manager_id into host from public.training_rooms where id=p_id and phase='waiting' for update;
 if host is null then raise exception 'Nur zwischen Matches möglich.' using errcode='55000';end if;
 if st->>'trainingMode'='around-clock' then raise exception 'Around the Clock ist ein Solotraining.' using errcode='22023';end if;
 if name is null or length(name) not between 1 and 40 or name ~ '[[:cntrl:]]' or exists(select 1 from jsonb_array_elements(st->'participants') p where lower(p->>'name')=lower(name)) then raise exception 'Bitte einen anderen Namen mit 1–40 Zeichen wählen.' using errcode='22023';end if;
 select * into seat from public.training_seats where room_id=p_id and position=1;
 if exists(select 1 from public.account_player_links where access_id=seat.access_id) then raise exception 'Der zweite Platz ist bereits belegt.' using errcode='55000';end if;
 update public.training_seats set is_local=true where room_id=p_id and position=1;
 insert into public.account_player_links(access_id,manager_id,version) select id,host,version from public.player_access_codes where id=seat.access_id;
 st:=st||jsonb_build_object('participants',(select jsonb_agg(case when p->>'id'=seat.participant_id::text then p||jsonb_build_object('name',name) else p end order by ord) from jsonb_array_elements(st->'participants') with ordinality x(p,ord)),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 -- Discard old single-player child sessions; derive both seats from the parent.
 delete from public.sessions where tournament_id=p_id and role='editor' and account_session_hash in(select token_hash from public.sessions where role='owner' and coalesce(manager_id,'00000000-0000-4000-8000-000000000001')=host);
 delete from public.training_invitations where room_id=p_id;
 perform public.account_play_session(p_hash,p_id);
end $$;
do $$ begin
 if to_regprocedure('public.reset_game_training_modes_base(uuid,text,text,jsonb,integer)') is null then alter function public.reset_game(uuid,text,text,jsonb,integer) rename to reset_game_training_modes_base;end if;
 if to_regprocedure('public.training_next_modes_base(text,uuid,jsonb)') is null then alter function public.training_next(text,uuid,jsonb) rename to training_next_modes_base;end if;
 if to_regprocedure('public.training_details_modes_base(text,uuid,text)') is null then alter function public.training_details(text,uuid,text) rename to training_details_modes_base;end if;
 if to_regprocedure('public.training_remove_player_modes_base(text,uuid,text,text)') is null then alter function public.training_remove_player(text,uuid,text,text) rename to training_remove_player_modes_base;end if;
 if to_regprocedure('public.social_invite_modes_base(text,uuid,uuid)') is null then alter function public.social_invite(text,uuid,uuid) rename to social_invite_modes_base;end if;
end $$;
create or replace function public.training_details(p_hash text,p_id uuid,p_account_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.training_details_modes_base(p_hash,p_id,p_account_hash);
 return result||jsonb_build_object('modesReady',true,'seats',(select jsonb_agg(x||jsonb_build_object('local',seat.is_local,'accountId',case when seat.is_local then null else x->'accountId' end) order by seat.position) from jsonb_array_elements(result->'seats')x join public.training_seats seat on seat.room_id=p_id and seat.participant_id=(x->>'participantId')::uuid));
end $$;
create or replace function public.training_remove_player(p_hash text,p_id uuid,p_code_hash text,p_secret text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tournaments where id=p_id for update;
 perform public.training_remove_player_modes_base(p_hash,p_id,p_code_hash,p_secret);
 update public.training_seats set is_local=false where room_id=p_id and position=1;
end $$;
create or replace function public.training_next(p_hash text,p_id uuid,p_rules jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.training_host(p_hash,p_id);perform 1 from public.tournaments where id=p_id for update;
 if exists(select 1 from public.tournaments where id=p_id and state->>'trainingMode'='around-clock') and p_rules<>'{"start":501,"out":"single","legsToWin":1}'::jsonb then raise exception 'Ungültige Trainingsregeln.' using errcode='22023';end if;
 perform public.training_next_modes_base(p_hash,p_id,p_rules);
end $$;
create or replace function public.reset_game(p_id uuid,p_match text,p_hash text,p_state jsonb,p_expected integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.training_rooms where id=p_id and match_id=p_match) then
  p_state:=p_state||jsonb_build_object('status','planned','winner',null,'startedAt',null);
 end if;
 perform public.reset_game_training_modes_base(p_id,p_match,p_hash,p_state,p_expected);
 update public.training_rooms set phase='waiting',updated_at=now() where id=p_id and match_id=p_match;
end $$;
create or replace function public.social_invite(p_hash text,p_room uuid,p_friend uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.training_host(p_hash,p_room);perform 1 from public.tournaments where id=p_room for update;
 if exists(select 1 from public.tournaments where id=p_room and state->>'trainingMode'='around-clock') or exists(select 1 from public.training_seats where room_id=p_room and is_local) then raise exception 'Diese Lobby hat keinen freien Mitspielerplatz.' using errcode='55000';end if;
 perform public.social_invite_modes_base(p_hash,p_room,p_friend);
end $$;
create or replace function public.start_training_match(p_hash text,p_id uuid,p_game jsonb) returns void language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;st jsonb;s jsonb:=public.read_session(p_hash);host boolean;solo boolean:=coalesce((p_game->>'solo')::boolean,false);begin
 perform 1 from public.tournaments where id=p_id for update;select * into room from public.training_rooms where id=p_id for update;
 host:=s->>'role'='owner' and (s->>'manager_id' is null or s->>'manager_id'=room.host_manager_id::text);
 if not coalesce(host,false) and not coalesce(s->>'training_id'=p_id::text and s->>'role'='editor' and exists(select 1 from public.training_seats seat where seat.room_id=p_id and s->'participant_ids' ? seat.participant_id::text),false) then raise exception 'Nur Lobby-Spieler dürfen das Match starten' using errcode='42501';end if;
 if room.phase<>'waiting' then raise exception 'Die Lobby ist nicht startbereit' using errcode='55000';end if;
 if solo and (p_game->'players'->>coalesce((p_game->>'starter')::integer,-1)) is distinct from (select participant_id::text from public.training_seats where room_id=p_id and position=0) then raise exception 'Ungültiger Solo-Spieler.' using errcode='22023';end if;
 if solo and exists(select 1 from public.training_seats seat join public.account_player_links l on l.access_id=seat.access_id where seat.room_id=p_id and seat.position=1) then raise exception 'Für Solo muss der zweite Platz frei sein.' using errcode='55000';end if;
 if (select count(*) from public.training_seats seat where seat.room_id=p_id and (not solo or seat.position=0) and public.training_seat_ready(seat.session_hash,seat.participant_id))<>(case when solo then 1 else 2 end) then raise exception 'Beide Spieler müssen bereit sein' using errcode='55000';end if;
 select state into st from public.tournaments where id=p_id for update;
 if p_game->'players' is distinct from st->'matches'->0->'players' or p_game->'rules' is distinct from st->'scoring' or p_game->>'phase' is distinct from (case when solo then 'playing' else 'bull' end) or p_game->>'version' is distinct from '1' then raise exception 'Ungültiger Spielstart' using errcode='22023';end if;
 if coalesce(st->>'trainingMode','x01')='around-clock' then
  if not solo or p_game->>'practice' is distinct from 'around-clock' then raise exception 'Around the Clock ist ein Solotraining.' using errcode='22023';end if;
 elsif p_game ? 'practice' then raise exception 'Ungültiger Trainingsmodus.' using errcode='22023';end if;
 st:=jsonb_set(st,'{matches,0,status}','"running"')||jsonb_build_object('status','running','startedAt',now(),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,status='running',version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 insert into public.match_games(tournament_id,match_id,state,version) values(p_id,room.match_id,p_game,1);
 update public.training_rooms set phase='playing',updated_at=now() where id=p_id;
end $$;
revoke all on function public.training_details_modes_base(text,uuid,text),public.training_remove_player_modes_base(text,uuid,text,text),public.social_invite_modes_base(text,uuid,uuid),public.training_next_modes_base(text,uuid,jsonb),public.reset_game_training_modes_base(uuid,text,text,jsonb,integer) from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('reset_game','training_modes_ready','training_next','training_add_local','account_play_session','training_details','training_remove_player','social_invite','start_training_match') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

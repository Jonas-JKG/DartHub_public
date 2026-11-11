-- Run after 022. Adds two account-only solo practice modes.
begin;
create or replace function public.practice_modes_ready() returns boolean language sql security definer set search_path='' as $$select true$$;
do $$ begin
 if to_regprocedure('public.training_details_practice_base(text,uuid,text)') is null then alter function public.training_details(text,uuid,text) rename to training_details_practice_base;end if;
 if to_regprocedure('public.training_add_local_practice_base(text,uuid,text)') is null then alter function public.training_add_local(text,uuid,text) rename to training_add_local_practice_base;end if;
 if to_regprocedure('public.social_invite_practice_base(text,uuid,uuid)') is null then alter function public.social_invite(text,uuid,uuid) rename to social_invite_practice_base;end if;
end $$;
create or replace function public.training_details(p_hash text,p_id uuid,p_account_hash text default null) returns jsonb language sql security definer set search_path='' as $$select public.training_details_practice_base(p_hash,p_id,p_account_hash)||jsonb_build_object('practiceModesReady',true)$$;
create or replace function public.training_add_local(p_hash text,p_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.training_host(p_hash,p_id);perform 1 from public.tournaments where id=p_id for update;
 if exists(select 1 from public.tournaments where id=p_id and state->>'trainingMode' in ('segments','checkout')) then raise exception 'Dieser Modus ist ein Solotraining.' using errcode='55000';end if;
 perform public.training_add_local_practice_base(p_hash,p_id,p_name);
end $$;
create or replace function public.social_invite(p_hash text,p_room uuid,p_friend uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.training_host(p_hash,p_room);perform 1 from public.tournaments where id=p_room for update;
 if exists(select 1 from public.tournaments where id=p_room and state->>'trainingMode' in ('segments','checkout')) then raise exception 'Dieser Modus ist ein Solotraining.' using errcode='55000';end if;
 perform public.social_invite_practice_base(p_hash,p_room,p_friend);
end $$;
create or replace function public.start_training_match_clock_base(p_hash text,p_id uuid,p_game jsonb) returns void language plpgsql security definer set search_path='' as $$
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
 elsif st->>'trainingMode' in ('segments','checkout') then
  if not solo or p_game->>'practice' is distinct from st->>'trainingMode' or p_game->'turns' is distinct from '[]'::jsonb or p_game->'current' is distinct from '[]'::jsonb or p_game->'practiceSettings' is distinct from st->'practiceSettings' or p_game->>'activePlayer' is distinct from p_game->'players'->>(p_game->>'starter')::integer then raise exception 'Ungültiger Trainingsstart.' using errcode='22023';end if;
  if st->>'trainingMode'='segments' and (jsonb_typeof(p_game->'practiceSettings'->'segments') is distinct from 'array' or jsonb_array_length(p_game->'practiceSettings'->'segments') not between 1 and 20 or exists(select 1 from jsonb_array_elements_text(p_game->'practiceSettings'->'segments') n where n::integer not between 1 and 20)) then raise exception 'Ungültige Segmente.' using errcode='22023';end if;
  if st->>'trainingMode'='checkout' and (jsonb_typeof(p_game->'checkoutTargets') is distinct from 'array' or jsonb_array_length(p_game->'checkoutTargets')<>10 or exists(select 1 from jsonb_array_elements_text(p_game->'checkoutTargets') n where n::integer not between 40 and 170)) then raise exception 'Ungültige Checkout-Aufgaben.' using errcode='22023';end if;
 elsif p_game ? 'practice' then raise exception 'Ungültiger Trainingsmodus.' using errcode='22023';end if;
 st:=jsonb_set(st,'{matches,0,status}','"running"')||jsonb_build_object('status','running','startedAt',now(),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,status='running',version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 insert into public.match_games(tournament_id,match_id,state,version) values(p_id,room.match_id,p_game,1);
 update public.training_rooms set phase='playing',updated_at=now() where id=p_id;
end $$;

revoke all on function public.training_details_practice_base(text,uuid,text),public.training_add_local_practice_base(text,uuid,text),public.social_invite_practice_base(text,uuid,uuid),public.start_training_match_clock_base(text,uuid,jsonb) from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('practice_modes_ready','training_details','training_add_local','social_invite') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

-- After 011, 012 and 013. No secrets or existing account deletion.
begin;
create table if not exists public.training_rooms (
 id uuid primary key references public.tournaments(id) on delete cascade,
 host_manager_id uuid not null references public.managers(id),
 invite_hash text unique, invite_secret text, phase text not null default 'waiting' check(phase in('waiting','playing','closed')),
 round integer not null default 1, match_id text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.sessions add column if not exists training_id uuid references public.training_rooms(id) on delete cascade;
alter table public.sessions add column if not exists account_session_hash text references public.sessions(token_hash) on delete cascade;
create table if not exists public.account_player_links (
 access_id uuid primary key references public.player_access_codes(id) on delete cascade,
 manager_id uuid not null references public.managers(id), version integer not null,
 created_at timestamptz not null default now()
);
create table if not exists public.training_seats (
 room_id uuid not null references public.training_rooms(id) on delete cascade,
 position integer not null check(position in(0,1)), participant_id uuid not null,
 access_id uuid not null references public.player_access_codes(id) on delete cascade,
 session_hash text references public.sessions(token_hash) on delete set null,
 primary key(room_id,position),unique(room_id,participant_id)
);
create table if not exists public.training_results (
 room_id uuid not null references public.training_rooms(id) on delete cascade,
 round integer not null, game jsonb not null, names jsonb not null, finished_at timestamptz not null default now(),
 primary key(room_id,round)
);
create table if not exists public.friendships (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.managers(id), receiver_id uuid not null references public.managers(id),
 status text not null default 'pending' check(status in('pending','accepted')),created_at timestamptz not null default now(),check(sender_id<>receiver_id)
);
create unique index if not exists friendships_pair on public.friendships(least(sender_id,receiver_id),greatest(sender_id,receiver_id));
create table if not exists public.manager_presence (
 session_hash text primary key references public.sessions(token_hash) on delete cascade,
 manager_id uuid not null references public.managers(id),last_seen timestamptz not null default now()
);
create index if not exists manager_presence_account on public.manager_presence(manager_id,last_seen);
create table if not exists public.training_invitations (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.training_rooms(id) on delete cascade,
 sender_id uuid not null references public.managers(id),receiver_id uuid not null references public.managers(id),created_at timestamptz not null default now(),
 unique(room_id,receiver_id)
);
alter table public.managers add column if not exists friend_link_hash text unique;
alter table public.managers add column if not exists friend_secret text;
do $$ declare c record;tab text;begin
 for c in select conname from pg_constraint where conrelid='public.tournaments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%jsonb_array_length%' and pg_get_constraintdef(oid) like '%participants%' loop execute format('alter table public.tournaments drop constraint %I',c.conname);end loop;
 alter table public.tournaments add constraint tournament_participant_count check(case when state->>'kind'='training' then jsonb_array_length(state->'participants')=2 else jsonb_array_length(state->'participants') between 3 and 20 end);
 foreach tab in array array['training_rooms','account_player_links','training_seats','training_results','friendships','manager_presence','training_invitations'] loop
  execute format('alter table public.%I enable row level security',tab);execute format('revoke all on public.%I from public,anon,authenticated',tab);execute format('grant all on public.%I to service_role',tab);
 end loop;
 if to_regprocedure('public.read_session_context_base(text)') is null then alter function public.read_session(text) rename to read_session_context_base;end if;
 if to_regprocedure('public.login_player_session_training_base(text,text,timestamptz,boolean)') is null then alter function public.login_player_session(text,text,timestamptz,boolean) rename to login_player_session_training_base;end if;
 if to_regprocedure('public.add_device_player_training_base(text,text,boolean)') is null then alter function public.add_device_player(text,text,boolean) rename to add_device_player_training_base;end if;
 if to_regprocedure('public.prepare_manager_deletion_social_base(text,uuid)') is null then alter function public.prepare_manager_deletion(text,uuid) rename to prepare_manager_deletion_social_base;end if;
end $$;
create or replace function public.read_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;parent jsonb;begin
 s:=public.read_session_context_base(p_hash);if s is null then return null;end if;
 if s->>'training_id' is not null and not exists(select 1 from public.training_rooms where id=(s->>'training_id')::uuid and phase<>'closed') then return null;end if;
 if s->>'account_session_hash' is not null then
  parent:=public.read_session_context_base(s->>'account_session_hash');if parent is null or parent->>'role'<>'owner' or parent->>'account_session_hash' is not null then return null;end if;
  s:=s||jsonb_build_object('account_manager_id',coalesce(parent->>'manager_id','00000000-0000-4000-8000-000000000001'));
  if s->>'role'='editor' and exists(select 1 from jsonb_array_elements_text(coalesce(s->'player_access_ids','[]')||jsonb_build_array(s->>'player_access_id')) aid
   where not exists(select 1 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.access_id=aid::uuid and l.manager_id=(s->>'account_manager_id')::uuid)) then return null;end if;
 end if;
 return s;
end $$;
create or replace function public.social_account(p_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare s jsonb;begin s:=public.read_session(p_hash);if s is null or s->>'role'<>'owner' then raise exception 'Bitte mit deinem bestätigten Konto anmelden' using errcode='42501';end if;return coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001');end $$;
create or replace function public.social_schema_ready() returns boolean language sql security definer set search_path='' as $$select true$$;
create or replace function public.link_player_account(p_hash text,p_code_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);pc public.player_access_codes;existing public.account_player_links;begin
 select p.* into pc from public.player_access_codes p join public.tournaments t on t.id=p.tournament_id join public.tournament_credentials c on c.tournament_id=t.id join public.managers m on m.id=t.manager_id
 where p.code_hash=p_code_hash and p.enabled and c.editor_enabled and t.status<>'archived' and m.enabled and m.approved and m.deletion_requested_at is null for update of p;
 if not found then raise exception 'Spieler-Code ungültig oder nicht verfügbar' using errcode='42501';end if;
 delete from public.account_player_links where access_id=pc.id and version<>pc.version;
 select * into existing from public.account_player_links where access_id=pc.id;
 if found and existing.manager_id<>account then raise exception 'Dieser Code ist bereits mit einem anderen Konto verknüpft' using errcode='42501';end if;
 insert into public.account_player_links(access_id,manager_id,version) values(pc.id,account,pc.version) on conflict(access_id) do update set version=excluded.version;
 return pc.id;
end $$;
create or replace function public.account_linked_tournaments(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);result jsonb;begin
 select coalesce(jsonb_agg(item),'[]') into result from (
 select t.state||jsonb_build_object('managerId',t.manager_id,'managerName',m.name,'linkedParticipantIds',jsonb_agg(pc.participant_id)) item
 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id join public.tournaments t on t.id=pc.tournament_id join public.managers m on m.id=t.manager_id join public.tournament_credentials c on c.tournament_id=t.id
 where l.manager_id=account and l.version=pc.version and pc.enabled and c.editor_enabled and m.enabled and m.approved and m.deletion_requested_at is null and t.status<>'archived' and coalesce(t.state->>'kind','tournament')<>'training'
 group by t.id,m.name) q;return result;
end $$;
create or replace function public.login_player_session(p_code_hash text,p_token_hash text,p_expires timestamptz,p_takeover boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;room uuid;begin
 result:=public.login_player_session_training_base(p_code_hash,p_token_hash,p_expires,p_takeover);if result is null then return null;end if;
 select r.id into room from public.training_rooms r where r.id=(result->>'tournamentId')::uuid and r.phase<>'closed';
 if room is not null then
  update public.sessions set training_id=room where token_hash=p_token_hash;
  update public.training_seats set session_hash=p_token_hash where room_id=room and participant_id=(result->>'participantId')::uuid;
  result:=result||jsonb_build_object('trainingId',room);
 end if;return result;
end $$;
-- Create a scoped player session while preserving the signed-in manager session.
create or replace function public.add_device_player(p_hash text,p_code_hash text,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);begin
 if s->>'account_session_hash' is not null then perform public.link_player_account(s->>'account_session_hash',p_code_hash);end if;
 perform public.add_device_player_training_base(p_hash,p_code_hash,p_takeover);
 s:=public.read_session(p_hash);
 if s->>'training_id' is not null then update public.training_seats set session_hash=p_hash where room_id=(s->>'training_id')::uuid and coalesce(s->'participant_ids','[]') ? participant_id::text;end if;
end $$;
create or replace function public.training_seat_ready(p_hash text,p_player uuid) returns boolean language sql security definer set search_path='' as $$select coalesce(public.read_session(p_hash)->'participant_ids' ? p_player::text,false)$$;
create or replace function public.activate_account_players(p_hash text,p_id uuid,p_players uuid[],p_token_hash text,p_expires timestamptz,p_takeover boolean default false,p_old_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);pc public.player_access_codes;first_code boolean:=true;pid uuid;s jsonb;begin
 perform 1 from public.tournaments where id=p_id for update;
 if p_players is null or cardinality(p_players) not between 1 and 20 or (select count(distinct x) from unnest(p_players) x)<>cardinality(p_players) then raise exception 'Ungültige Spielerauswahl' using errcode='22023';end if;
 if p_old_hash is not null then delete from public.sessions where token_hash=p_old_hash and account_session_hash=p_hash;end if;
 foreach pid in array p_players loop
  select p.* into pc from public.player_access_codes p join public.account_player_links l on l.access_id=p.id where l.manager_id=account and l.version=p.version and p.enabled and p.tournament_id=p_id and p.participant_id=pid;
  if not found then raise exception 'Für jeden Spieler ist ein verknüpfter Code erforderlich' using errcode='42501';end if;
  if first_code then
   s:=public.login_player_session(pc.code_hash,p_token_hash,p_expires,p_takeover);if s is null then raise exception 'Code nicht mehr verfügbar' using errcode='42501';end if;
   update public.sessions set account_session_hash=p_hash where token_hash=p_token_hash;first_code:=false;
  else perform public.add_device_player(p_token_hash,pc.code_hash,p_takeover);end if;
 end loop;
 -- Release the manager's old device selection without overwriting its saved choice.
 update public.sessions set participant_id=null,participant_ids='{}',playing_tournament_id=null where token_hash=p_hash;
end $$;
create or replace function public.training_host(p_hash text,p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if not exists(select 1 from public.training_rooms where id=p_id and (host_manager_id=account or account='00000000-0000-4000-8000-000000000001')) then raise exception 'Nur der Lobby-Ersteller darf diese Aktion ausführen' using errcode='42501';end if;return account;
end $$;
create or replace function public.create_training_room(p_hash text,p_state jsonb,p_credentials jsonb,p_invite_hash text,p_invite_secret text,p_token_hash text,p_expires timestamptz,p_old_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);room_id uuid:=(p_state->>'id')::uuid;pc public.player_access_codes;position integer:=0;member jsonb;begin
 if p_state->>'kind' is distinct from 'training' or jsonb_array_length(p_state->'participants')<>2 or jsonb_array_length(p_state->'matches')<>1 or p_state->>'status'<>'planned' then raise exception 'Ungültige Trainings-Lobby' using errcode='22023';end if;
 perform public.create_tournament(p_state,p_credentials,p_hash);
 insert into public.training_rooms(id,host_manager_id,invite_hash,invite_secret,match_id) values(room_id,account,p_invite_hash,p_invite_secret,p_state->'matches'->0->>'id');
 for member in select value from jsonb_array_elements(p_state->'participants') loop
  select * into pc from public.player_access_codes where tournament_id=room_id and participant_id=(member->>'id')::uuid;
  insert into public.training_seats(room_id,position,participant_id,access_id) values(room_id,position,(member->>'id')::uuid,pc.id);position:=position+1;
 end loop;
 select * into pc from public.player_access_codes where tournament_id=room_id and participant_id=(p_state->'participants'->0->>'id')::uuid;
 insert into public.account_player_links(access_id,manager_id,version) values(pc.id,account,pc.version);
 perform public.activate_account_players(p_hash,room_id,array[pc.participant_id],p_token_hash,p_expires,false,p_old_hash);
end $$;
create or replace function public.training_room_access(p_hash text,p_id uuid,p_account_hash text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);account uuid;begin
 if p_account_hash is not null then begin account:=public.social_account(p_account_hash);exception when sqlstate '42501' then account:=null;end;end if;
 if exists(select 1 from public.training_rooms where id=p_id and (host_manager_id=account or account='00000000-0000-4000-8000-000000000001')) then return true;end if;
 return coalesce(s is not null and s->>'training_id'=p_id::text,false);
end $$;
create or replace function public.join_training_room(p_id uuid,p_invite_hash text,p_code_hash text,p_account_hash text,p_token_hash text,p_expires timestamptz,p_name text,p_takeover boolean default false,p_old_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;seat public.training_seats;pc public.player_access_codes;account uuid;valid_link boolean;v_state jsonb;other_sid jsonb;result jsonb;begin
 select * into room from public.training_rooms where id=p_id for update;if not found or room.phase='closed' then raise exception 'Lobby nicht verfügbar' using errcode='42501';end if;
 if p_account_hash is not null then account:=public.social_account(p_account_hash);end if;
 valid_link:=p_invite_hash is not null and p_invite_hash=room.invite_hash;
 if p_code_hash is not null then select * into pc from public.player_access_codes where tournament_id=p_id and code_hash=p_code_hash and enabled;end if;
 if pc.id is not null then select * into seat from public.training_seats where room_id=p_id and access_id=pc.id;
 elsif account=room.host_manager_id then select * into seat from public.training_seats where room_id=p_id and position=0;
 elsif valid_link then select * into seat from public.training_seats where room_id=p_id and position=1;
 else raise exception 'Einladungslink oder Spieler-Code erforderlich' using errcode='42501';end if;
 if seat.access_id is null then raise exception 'Spieler-Code ungültig' using errcode='42501';end if;
 select * into pc from public.player_access_codes where id=seat.access_id and enabled;
 if pc.id is null then raise exception 'Spieler-Code ungültig' using errcode='42501';end if;
 if seat.session_hash is not null then other_sid:=public.read_session(seat.session_hash);end if;
 if other_sid is not null and p_code_hash is null and not exists(select 1 from public.account_player_links where access_id=pc.id and manager_id=account and version=pc.version) then raise exception 'Der Platz ist belegt. Zum Gerätewechsel den persönlichen Spieler-Code verwenden.' using errcode='42501';end if;
 if account is not null then
  if exists(select 1 from public.account_player_links where access_id=pc.id and manager_id<>account) then raise exception 'Dieser Spieler ist mit einem anderen Konto verknüpft' using errcode='42501';end if;
  insert into public.account_player_links(access_id,manager_id,version) values(pc.id,account,pc.version) on conflict(access_id) do update set version=excluded.version;
 end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Bitte einen Spielernamen eingeben' using errcode='22023';end if;
 select t.state into v_state from public.tournaments t where t.id=p_id;
 if room.phase='waiting' then
  if exists(select 1 from jsonb_array_elements(v_state->'participants') m where m->>'id'<>seat.participant_id::text and lower(m->>'name')=lower(trim(p_name))) then raise exception 'Bitte unterschiedliche Spielernamen verwenden' using errcode='22023';end if;
  v_state:=v_state||jsonb_build_object('participants',(select jsonb_agg(case when m->>'id'=seat.participant_id::text then jsonb_set(m,'{name}',to_jsonb(trim(p_name))) else m end) from jsonb_array_elements(v_state->'participants') m),'version',(v_state->>'version')::integer+1,'updatedAt',now());
  update public.tournaments set state=v_state,version=(v_state->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(v_state);
 end if;
 if p_old_hash is not null and p_account_hash is not null then delete from public.sessions where token_hash=p_old_hash and account_session_hash=p_account_hash;end if;
 result:=public.login_player_session(pc.code_hash,p_token_hash,p_expires,p_takeover);if result is null then raise exception 'Spieler-Code ungültig' using errcode='42501';end if;
 if account is not null then update public.sessions set account_session_hash=p_account_hash where token_hash=p_token_hash;update public.sessions set participant_id=null,participant_ids='{}',playing_tournament_id=null where token_hash=p_account_hash;end if;
 update public.training_seats set session_hash=p_token_hash where room_id=p_id and access_id=pc.id;
 update public.training_rooms set updated_at=now() where id=p_id;
end $$;
create or replace function public.start_training_match(p_hash text,p_id uuid,p_game jsonb) returns void language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;v_state jsonb;begin
 perform public.training_host(p_hash,p_id);select * into room from public.training_rooms where id=p_id for update;
 if room.phase<>'waiting' then raise exception 'Die Lobby ist nicht startbereit' using errcode='55000';end if;
 if (select count(*) from public.training_seats s where room_id=p_id and public.training_seat_ready(s.session_hash,s.participant_id))<>2 then raise exception 'Beide Spieler müssen der Lobby beitreten' using errcode='55000';end if;
 select t.state into v_state from public.tournaments t where t.id=p_id for update;
 if p_game->'players'<>v_state->'matches'->0->'players' or p_game->'rules'<>v_state->'scoring' or p_game->>'phase'<>'bull' or p_game->>'version'<>'1' then raise exception 'Ungültiger Spielstart' using errcode='22023';end if;
 v_state:=jsonb_set(v_state,'{matches,0,status}','"running"')||jsonb_build_object('status','running','version',(v_state->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=v_state,status='running',version=(v_state->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(v_state);
 insert into public.match_games(tournament_id,match_id,state,version) values(p_id,room.match_id,p_game,1);
 update public.training_rooms set phase='playing',updated_at=now() where id=p_id;
end $$;
create or replace function public.training_details(p_hash text,p_id uuid,p_account_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;result jsonb;begin
 if not public.training_room_access(p_hash,p_id,p_account_hash) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 select * into room from public.training_rooms where id=p_id;
 select jsonb_build_object('id',r.id,'phase',r.phase,'round',r.round,'matchId',r.match_id,'hostManagerId',r.host_manager_id,'tournament',t.state,
 'seats',coalesce((select jsonb_agg(jsonb_build_object('position',s.position,'participantId',s.participant_id,'ready',public.training_seat_ready(s.session_hash,s.participant_id),'accountId',l.manager_id) order by s.position) from public.training_seats s left join public.account_player_links l on l.access_id=s.access_id and l.version=(select version from public.player_access_codes where id=s.access_id) where s.room_id=r.id),'[]'::jsonb),
 'game',(select state from public.match_games where tournament_id=r.id and match_id=r.match_id),
 'lastResult',(select jsonb_build_object('game',g.game,'names',g.names,'round',g.round) from public.training_results g where g.room_id=r.id order by round desc limit 1)) into result
 from public.training_rooms r join public.tournaments t on t.id=r.id where r.id=p_id;
 return result;
end $$;
create or replace function public.training_preview(p_id uuid,p_invite_hash text) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('name',t.state->>'name','host',m.name,'scoring',t.state->'scoring','phase',r.phase)
 from public.training_rooms r join public.tournaments t on t.id=r.id join public.managers m on m.id=r.host_manager_id
 where r.id=p_id and r.phase<>'closed' and r.invite_hash=p_invite_hash and m.enabled and m.deletion_requested_at is null
$$;
create or replace function public.training_next(p_hash text,p_id uuid,p_rules jsonb) returns void language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;g jsonb;st jsonb;new_match text;begin
 perform public.training_host(p_hash,p_id);select * into room from public.training_rooms where id=p_id for update;
 if room.phase='closed' then raise exception 'Lobby geschlossen' using errcode='55000';end if;
 select state into g from public.match_games where tournament_id=p_id and match_id=room.match_id;
 if g is not null and g->>'phase'<>'finished' then raise exception 'Bitte zuerst das laufende Match beenden' using errcode='55000';end if;
 select state into st from public.tournaments where id=p_id for update;
 if g is not null then
  insert into public.training_results(room_id,round,game,names) values(p_id,room.round,g,st->'participants') on conflict do nothing;
  room.round:=room.round+1;
 end if;
 new_match:='training-'||room.round;
 st:=st||jsonb_build_object('scoring',p_rules,'winner',null,'startedAt',null,'status','planned','version',(st->>'version')::integer+1,'updatedAt',now(),
 'matches',jsonb_build_array(st->'matches'->0||jsonb_build_object('id',new_match,'legs',jsonb_build_array(null,null),'status','pending','winner',null,'forfeited',null)));
 update public.tournaments set state=st,status='planned',version=(st->>'version')::integer,updated_at=now() where id=p_id;
 perform public.sync_tournament(st);
 delete from public.match_games where tournament_id=p_id;
 update public.training_rooms set phase='waiting',round=room.round,match_id=new_match,updated_at=now() where id=p_id;
end $$;
create or replace function public.close_training_room(p_hash text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare g jsonb;room public.training_rooms;begin
 perform public.training_host(p_hash,p_id);select * into room from public.training_rooms where id=p_id for update;
 select state into g from public.match_games where tournament_id=p_id and match_id=room.match_id;
 if g->>'phase'='finished' then insert into public.training_results(room_id,round,game,names) select p_id,room.round,g,state->'participants' from public.tournaments where id=p_id on conflict do nothing;end if;
 update public.training_rooms set phase='closed',invite_hash=null,invite_secret=null,updated_at=now() where id=p_id;
 update public.tournaments set status='archived',state=jsonb_set(state,'{status}','"archived"') where id=p_id;
 delete from public.sessions where training_id=p_id;
 delete from public.training_invitations where room_id=p_id;
end $$;
create or replace function public.training_remove_guest(p_hash text,p_id uuid,p_code_hash text,p_secret text) returns void language plpgsql security definer set search_path='' as $$
declare aid uuid;pid uuid;begin
 perform public.training_host(p_hash,p_id);perform 1 from public.training_rooms where id=p_id and phase='waiting' for update;
 if not found then raise exception 'Nur zwischen Matches möglich' using errcode='55000';end if;
 select access_id,participant_id into aid,pid from public.training_seats where room_id=p_id and position=1;
 update public.sessions set participant_ids=array_remove(participant_ids,pid),participant_id=(array_remove(participant_ids,pid))[1],player_access_ids=array_remove(player_access_ids,aid),player_access_versions=player_access_versions-aid::text where role='editor' and player_access_id<>aid and aid=any(player_access_ids);
 delete from public.sessions where role='editor' and (player_access_id=aid or aid=any(player_access_ids));
 delete from public.account_player_links where access_id=aid;
 update public.player_access_codes set code_hash=p_code_hash,code_secret=p_secret,version=version+1 where id=aid;
 update public.training_seats set session_hash=null where room_id=p_id and position=1;
end $$;
create or replace function public.social_snapshot(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return jsonb_build_object('accountId',account,'name',(select name from public.managers where id=account),
 'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'accountId',m.id,'name',m.name,'status',f.status,'incoming',f.receiver_id=account,
 'online',case when f.status='accepted' then exists(select 1 from public.manager_presence pr where pr.manager_id=m.id and pr.last_seen>now()-interval '90 seconds' and public.read_session(pr.session_hash) is not null) else false end)),'[]') from public.friendships f join public.managers m on m.id=case when f.sender_id=account then f.receiver_id else f.sender_id end where (f.sender_id=account or f.receiver_id=account) and m.enabled and m.deletion_requested_at is null),
 'links',(select coalesce(jsonb_agg(jsonb_build_object('accessId',pc.id,'tournamentId',t.id,'name',t.state->>'name','training',coalesce(t.state->>'kind','')='training','participantId',pc.participant_id,'player',(select p->>'name' from jsonb_array_elements(t.state->'participants') p where p->>'id'=pc.participant_id::text))),'[]') from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version join public.tournaments t on t.id=pc.tournament_id join public.managers m on m.id=t.manager_id join public.tournament_credentials c on c.tournament_id=t.id where l.manager_id=account and pc.enabled and c.editor_enabled and t.status<>'archived' and m.enabled and m.deletion_requested_at is null),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'roomId',r.id,'name',t.state->>'name','from',m.name)),'[]') from public.training_invitations i join public.training_rooms r on r.id=i.room_id join public.tournaments t on t.id=r.id join public.managers m on m.id=i.sender_id where i.receiver_id=account and r.phase<>'closed' and exists(select 1 from public.friendships f where f.status='accepted' and least(f.sender_id,f.receiver_id)=least(i.sender_id,account) and greatest(f.sender_id,f.receiver_id)=greatest(i.sender_id,account))));
end $$;
create or replace function public.social_presence(p_hash text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 insert into public.manager_presence(session_hash,manager_id,last_seen) values(p_hash,account,now()) on conflict(session_hash) do update set last_seen=now();
 delete from public.manager_presence where last_seen<now()-interval '1 day';
end $$;
create or replace function public.social_friend_link(p_hash text,p_link_hash text,p_secret text) returns text language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);result text;begin
 perform 1 from public.managers where id=account for update;
 update public.managers set friend_link_hash=p_link_hash,friend_secret=p_secret where id=account and friend_secret is null;
 select friend_secret into result from public.managers where id=account;return result;
end $$;
-- Context targets are visible only to members or the manager of that tournament.
create or replace function public.social_context(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if not exists(select 1 from public.tournaments t join public.managers m on m.id=t.manager_id where t.id=p_id and t.status<>'archived' and m.enabled and m.deletion_requested_at is null and
 (t.manager_id=account or account='00000000-0000-4000-8000-000000000001' or exists(select 1 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.manager_id=account and pc.tournament_id=p_id and pc.enabled))) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name)),'[]') from public.managers m where m.id<>account and m.enabled and m.deletion_requested_at is null and (m.id=(select manager_id from public.tournaments where id=p_id) or exists(select 1 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.manager_id=m.id and pc.tournament_id=p_id and pc.enabled) or exists(select 1 from public.sessions s where s.role='owner' and coalesce(s.manager_id,'00000000-0000-4000-8000-000000000001')=m.id and s.playing_tournament_id=p_id and s.participant_id is not null and public.read_session(s.token_hash) is not null)));
end $$;
create or replace function public.social_request(p_hash text,p_link_hash text default null,p_target uuid default null,p_context uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);target uuid;begin
 if p_link_hash is not null then select id into target from public.managers where friend_link_hash=p_link_hash and enabled and approved and deletion_requested_at is null;
 elsif p_context is not null and exists(select 1 from jsonb_array_elements(public.social_context(p_hash,p_context)) x where x->>'id'=p_target::text) then target:=p_target;end if;
 if target is null or target=account then raise exception 'Freundschaftslink oder Teilnehmer ungültig' using errcode='42501';end if;
 insert into public.friendships(sender_id,receiver_id) values(account,target) on conflict do nothing;
end $$;
create or replace function public.social_friend_action(p_hash text,p_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if p_action='accept' then update public.friendships set status='accepted' where id=p_id and receiver_id=account and status='pending';
 elsif p_action='remove' then delete from public.friendships where id=p_id and (sender_id=account or receiver_id=account);
 else raise exception 'Ungültige Aktion' using errcode='22023';end if;
 if not found then raise exception 'Anfrage nicht verfügbar' using errcode='42501';end if;
end $$;
create or replace function public.social_invite(p_hash text,p_room uuid,p_friend uuid) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.training_host(p_hash,p_room);begin
 if not exists(select 1 from public.training_rooms where id=p_room and phase<>'closed') or not exists(select 1 from public.friendships where status='accepted' and least(sender_id,receiver_id)=least(account,p_friend) and greatest(sender_id,receiver_id)=greatest(account,p_friend)) then raise exception 'Freund oder Lobby nicht verfügbar' using errcode='42501';end if;
 insert into public.training_invitations(room_id,sender_id,receiver_id) values(p_room,account,p_friend) on conflict(room_id,receiver_id) do update set created_at=now();
end $$;
create or replace function public.social_invitation_secret(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select jsonb_build_object('roomId',r.id,'secret',r.invite_secret) from public.training_invitations i join public.training_rooms r on r.id=i.room_id where i.id=p_id and i.receiver_id=account and r.phase<>'closed' and exists(select 1 from public.friendships where status='accepted' and least(sender_id,receiver_id)=least(account,i.sender_id) and greatest(sender_id,receiver_id)=greatest(account,i.sender_id)));
end $$;
create or replace function public.prepare_manager_deletion(p_hash text,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare room record;begin
 if p_id='00000000-0000-4000-8000-000000000001' or public.social_account(p_hash)<>'00000000-0000-4000-8000-000000000001' then raise exception 'Nur der Owner' using errcode='42501';end if;
 for room in select id from public.training_rooms where host_manager_id=p_id loop perform public.close_training_room(p_hash,room.id);end loop;
 delete from public.training_invitations where sender_id=p_id or receiver_id=p_id;
 delete from public.friendships where sender_id=p_id or receiver_id=p_id;
 delete from public.account_player_links where manager_id=p_id;
 delete from public.manager_presence where manager_id=p_id;
 update public.managers set friend_link_hash=null,friend_secret=null where id=p_id;
 return public.prepare_manager_deletion_social_base(p_hash,p_id);
end $$;

create or replace function public.autodarts_profile(p_hash text,p_operation text,p_secret text default null,p_board text default null,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb;manager uuid;player uuid;profile public.saved_autodarts;account_key text;
begin
 s:=public.read_session(p_hash);
 if s is null then raise exception 'Nicht angemeldet' using errcode='28000';end if;
 if s->>'role'='owner' then manager:=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001');account_key:='manager:'||manager;
 elsif s->>'role'='editor' and s->>'account_manager_id' is not null then manager:=(s->>'account_manager_id')::uuid;account_key:='manager:'||manager;
 elsif s->>'role'='editor' and s->>'player_access_id' is not null then player:=(s->>'player_access_id')::uuid;account_key:='player:'||player;
 else raise exception 'Keine Berechtigung' using errcode='42501';end if;
 select * into profile from public.saved_autodarts where manager_id=manager or player_access_id=player for update;
 if p_operation='read' then
  return jsonb_build_object('accountKey',account_key,'linked',profile.id is not null,'boardId',profile.board_id,'autoConnect',coalesce(profile.auto_connect,false));
 elsif p_operation='unlink' then
  delete from public.saved_autodarts where id=profile.id;return jsonb_build_object('ok',true);
 elsif p_operation='pause' then
  update public.saved_autodarts set auto_connect=false,updated_at=now() where id=profile.id;return jsonb_build_object('ok',true);
 elsif p_operation='link' then
  if p_secret is null or length(p_secret) not between 1 and 8000 then raise exception 'Ungültige Verknüpfung' using errcode='22023';end if;
  if profile.id is null then insert into public.saved_autodarts(manager_id,player_access_id,refresh_secret) values(manager,player,p_secret);
  else update public.saved_autodarts set refresh_secret=p_secret,board_id=null,auto_connect=false,lease=null,lease_until=null,updated_at=now() where id=profile.id;end if;
  return jsonb_build_object('ok',true);
 elsif p_operation='claim' then
  if profile.id is null then return null;end if;
  if p_lease is null then raise exception 'Ungültige Verbindung' using errcode='22023';end if;
  if profile.lease_until>now() then return jsonb_build_object('busy',true);end if;
  update public.saved_autodarts set lease=p_lease,lease_until=now()+interval '60 seconds' where id=profile.id;
  return jsonb_build_object('accountKey',account_key,'secret',profile.refresh_secret,'boardId',profile.board_id,'autoConnect',profile.auto_connect);
 elsif p_operation='finish' then
  if p_secret is null or length(p_secret) not between 1 and 8000 then raise exception 'Ungültige Verknüpfung' using errcode='22023';end if;
  update public.saved_autodarts set refresh_secret=p_secret,board_id=coalesce(p_board,board_id),auto_connect=case when p_board is null then auto_connect else true end,lease=null,lease_until=null,updated_at=now() where id=profile.id and lease=p_lease;
  return jsonb_build_object('ok',found);
 elsif p_operation='release' then
  update public.saved_autodarts set lease=null,lease_until=null where id=profile.id and lease=p_lease;return jsonb_build_object('ok',true);
 end if;
 raise exception 'Ungültige Operation' using errcode='22023';
end $$;

create or replace function public.unlink_player_account(p_hash text,p_access uuid) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 delete from public.account_player_links where access_id=p_access and manager_id=account;
 if not found then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 delete from public.sessions where player_access_id=p_access and account_session_hash=p_hash;
end $$;
create or replace function public.my_training_rooms(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'host',r.host_manager_id=account,'phase',r.phase,'round',r.round,'tournament',jsonb_build_object('state',t.state)) order by r.updated_at desc),'[]') from public.training_rooms r join public.tournaments t on t.id=r.id where r.host_manager_id=account or (r.phase<>'closed' and exists(select 1 from public.training_seats seat join public.account_player_links l on l.access_id=seat.access_id join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where seat.room_id=r.id and l.manager_id=account and pc.enabled)));
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'social_%' or p.proname like '%training%' or p.proname in('add_device_player','read_session','read_session_context_base','login_player_session','activate_account_players','account_linked_tournaments','link_player_account','unlink_player_account','autodarts_profile','prepare_manager_deletion','prepare_manager_deletion_social_base')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;

-- Run once in the existing V2 project BEFORE enabling MANAGER_AUTH_ENABLED.
-- Repeatable; preserves tournaments. Old shared player sessions are revoked.
begin;
create table if not exists public.managers (
 id uuid primary key, email text not null, name text not null,
 enabled boolean not null default true, approved boolean not null default true,
 live_token_hash text unique, live_secret text,
 created_at timestamptz not null default now()
);
insert into public.managers(id,email,name) values('00000000-0000-4000-8000-000000000001','owner','Owner') on conflict(id) do nothing;
alter table public.tournaments add column if not exists manager_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.managers(id);
create index if not exists tournaments_manager on public.tournaments(manager_id);
update public.tournaments set state=jsonb_set(state,'{managerId}',to_jsonb(manager_id::text)) where state->>'managerId' is distinct from manager_id::text;
update public.public_tournament_snapshots p set state=t.state from public.tournaments t where p.id=t.id;
create table if not exists public.player_access_codes (
 id uuid primary key default gen_random_uuid(), tournament_id uuid not null references public.tournaments(id) on delete cascade,
 participant_id uuid not null, code_hash text not null unique, code_secret text not null,
 version integer not null default 1, enabled boolean not null default true,
 unique(tournament_id,participant_id)
);
alter table public.sessions add column if not exists manager_id uuid references public.managers(id);
alter table public.sessions add column if not exists player_access_id uuid references public.player_access_codes(id) on delete cascade;
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.sessions'::regclass and contype='c' loop execute format('alter table public.sessions drop constraint %I',c.conname);end loop;
end $$;
delete from public.sessions where role='admin';
alter table public.sessions add constraint session_roles check(role in ('owner','editor','viewer'));
alter table public.sessions add constraint session_scope check((role='editor' and tournament_id is not null) or (role in ('owner','viewer') and tournament_id is null));
-- Do not delete newly issued personal sessions when this migration is repeated.
delete from public.sessions where role='editor' and player_access_id is null;
revoke all on public.public_tournament_snapshots,public.public_live_state,public.match_games from public,anon,authenticated;
drop policy if exists public_snapshots_read on public.public_tournament_snapshots;
drop policy if exists public_live_read on public.public_live_state;
drop policy if exists public_games_read on public.match_games;
alter table public.managers enable row level security;
alter table public.player_access_codes enable row level security;
revoke all on public.managers,public.player_access_codes from public,anon,authenticated;
grant all on public.managers,public.player_access_codes to service_role;

create or replace function public.read_session(p_hash text) returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(s) from public.sessions s
 left join public.managers manager on manager.id=s.manager_id
 left join public.tournaments t on t.id=s.tournament_id
 left join public.tournament_credentials c on c.tournament_id=s.tournament_id
 left join public.player_access_codes pc on pc.id=s.player_access_id
 where s.token_hash=p_hash and s.expires_at>now() and (
  (s.role='owner' and (s.manager_id is null or (manager.enabled and manager.approved))) or
  (s.role='viewer' and manager.enabled and manager.approved) or
  (s.role='editor' and manager.enabled and manager.approved and s.manager_id=t.manager_id and c.editor_enabled and pc.enabled
    and pc.tournament_id=s.tournament_id and pc.participant_id=s.participant_id and s.participant_ids=array[pc.participant_id] and s.credential_version=pc.version)
 );
$$;
create or replace function public.assert_session(p_hash text,p_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;begin
 s:=public.read_session(p_hash);if s is null then raise exception 'Nicht angemeldet' using errcode='28000';end if;
 if s->>'role'='owner' then
  if s->>'manager_id' is not null and p_id is not null and not exists(select 1 from public.tournaments where id=p_id and manager_id=(s->>'manager_id')::uuid) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
  return s;
 end if;
 if s->>'role'='editor' and p_action='score' and p_id is not null and s->>'tournament_id'=p_id::text then return s;end if;
 raise exception 'Keine Berechtigung' using errcode='42501';
end $$;
create or replace function public.replace_player_codes(p_id uuid,p_codes jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p jsonb;state jsonb;begin
 select t.state into state from public.tournaments t where t.id=p_id;
 if jsonb_typeof(p_codes) is distinct from 'array' or jsonb_array_length(p_codes)<>jsonb_array_length(state->'participants') then raise exception 'Ungültige Spielercodes' using errcode='22023';end if;
 delete from public.sessions where tournament_id=p_id and role='editor';
 delete from public.player_access_codes where tournament_id=p_id;
 for p in select value from jsonb_array_elements(p_codes) loop
  if not exists(select 1 from jsonb_array_elements(state->'participants') member where member->>'id'=p->>'participant_id') or (p->>'code_hash') !~ '^[a-f0-9]{64}$' or nullif(p->>'code_secret','') is null then raise exception 'Ungültige Spielercodes' using errcode='22023';end if;
  insert into public.player_access_codes(tournament_id,participant_id,code_hash,code_secret) values(p_id,(p->>'participant_id')::uuid,p->>'code_hash',p->>'code_secret');
 end loop;
end $$;
do $$ begin
 if to_regprocedure('public.create_tournament_legacy(jsonb,jsonb,text)') is null then alter function public.create_tournament(jsonb,jsonb,text) rename to create_tournament_legacy;end if;
 if to_regprocedure('public.save_tournament_scoped_base(jsonb,integer,text,text,jsonb)') is null then alter function public.save_tournament(jsonb,integer,text,text,jsonb) rename to save_tournament_scoped_base;end if;
 if to_regprocedure('public.choose_device_players_base(text,uuid,uuid[],boolean)') is null then alter function public.choose_device_players(text,uuid,uuid[],boolean) rename to choose_device_players_base;end if;
end $$;
create or replace function public.create_tournament(p_state jsonb,p_credentials jsonb,p_session_hash text) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;manager uuid;begin
 s:=public.assert_session(p_session_hash,null,'create');manager:=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001');
 if p_state->>'managerId' is distinct from manager::text then raise exception 'Fremder Manager-Bereich' using errcode='42501';end if;
 perform public.create_tournament_legacy(p_state,p_credentials,p_session_hash);
 update public.tournaments set manager_id=manager where id=(p_state->>'id')::uuid;
 perform public.replace_player_codes((p_state->>'id')::uuid,p_credentials->'player_codes');
end $$;
create or replace function public.save_tournament(p_state jsonb,p_expected integer,p_session_hash text,p_action text,p_detail jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare manager uuid;begin
 perform public.assert_session(p_session_hash,(p_state->>'id')::uuid,p_action);
 select manager_id into manager from public.tournaments where id=(p_state->>'id')::uuid;
 if p_state->>'managerId' is distinct from manager::text then raise exception 'Manager-Zuordnung kann nicht geändert werden' using errcode='42501';end if;
 perform public.save_tournament_scoped_base(p_state,p_expected,p_session_hash,p_action,p_detail-'player_codes');
 if p_detail->>'action'='redraw' then perform public.replace_player_codes((p_state->>'id')::uuid,p_detail->'player_codes');end if;
end $$;
create or replace function public.choose_device_players(p_hash text,p_id uuid,p_players uuid[],p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;begin
 s:=public.assert_session(p_hash,p_id,'score');
 if s->>'role'='editor' and p_players is distinct from array[(s->>'participant_id')::uuid] then raise exception 'Der Code gilt nur für deinen Spieler' using errcode='42501';end if;
 perform public.choose_device_players_base(p_hash,p_id,p_players,p_takeover);
end $$;
create or replace function public.choose_tournament_player(p_hash text,p_id uuid,p_player uuid,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin perform public.choose_device_players(p_hash,p_id,case when p_player is null then '{}'::uuid[] else array[p_player] end,p_takeover);end $$;
create or replace function public.claim_player(p_hash text,p_player uuid,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;begin s:=public.read_session(p_hash);if s is null or s->>'role'<>'editor' then raise exception 'Bitte als Spieler anmelden' using errcode='42501';end if;perform public.choose_device_players(p_hash,(s->>'tournament_id')::uuid,array[p_player],p_takeover);end $$;
create or replace function public.private_list_archived(p_session_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_session_hash);result jsonb;begin
 if s is null or s->>'role'<>'owner' then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 select coalesce(jsonb_agg(state),'[]') into result from public.tournaments where status='archived' and (s->>'manager_id' is null or manager_id=(s->>'manager_id')::uuid);return result;
end $$;
create or replace function public.manage_player_codes(p_id uuid,p_hash text,p_codes jsonb) returns void language plpgsql security definer set search_path='' as $$
begin perform public.assert_session(p_hash,p_id,'access');perform 1 from public.tournaments where id=p_id for update;perform public.replace_player_codes(p_id,p_codes);end $$;
create or replace function public.login_player_session(p_code_hash text,p_token_hash text,p_expires timestamptz,p_takeover boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare pc public.player_access_codes;manager uuid;other public.sessions;remaining uuid[];begin
 select * into pc from public.player_access_codes where code_hash=p_code_hash and enabled;
 if not found then return null;end if;
 select manager_id into manager from public.tournaments where id=pc.tournament_id and status<>'archived' for update;
 if not found then return null;end if;
 if not exists(select 1 from public.managers where id=manager and enabled and approved) or not exists(select 1 from public.tournament_credentials where tournament_id=pc.tournament_id and editor_enabled) then return null;end if;
 -- Re-read after taking the tournament lock, so revocation wins over login.
 select * into pc from public.player_access_codes where id=pc.id and code_hash=p_code_hash and enabled;
 if not found then return null;end if;
 for other in select * from public.sessions where coalesce(playing_tournament_id,tournament_id)=pc.tournament_id and role in ('owner','editor') and expires_at>now() and pc.participant_id=any(participant_ids) loop
  if not p_takeover then raise exception 'PLAYER_IN_USE' using errcode='55000';end if;
  remaining:=array_remove(other.participant_ids,pc.participant_id);
  if other.role='editor' then delete from public.sessions where token_hash=other.token_hash;
  else update public.sessions set participant_ids=remaining,participant_id=remaining[1],playing_tournament_id=case when cardinality(remaining)=0 then null else playing_tournament_id end where token_hash=other.token_hash;end if;
 end loop;
 insert into public.sessions(token_hash,role,tournament_id,credential_version,expires_at,participant_id,participant_ids,manager_id,player_access_id)
 values(p_token_hash,'editor',pc.tournament_id,pc.version,p_expires,pc.participant_id,array[pc.participant_id],manager,pc.id);
 return jsonb_build_object('tournamentId',pc.tournament_id,'participantId',pc.participant_id);
end $$;
create or replace function public.ensure_player_codes(p_id uuid,p_hash text,p_codes jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_session(p_hash,p_id,'access');perform 1 from public.tournaments where id=p_id for update;
 if (select count(*) from public.player_access_codes where tournament_id=p_id)=(select jsonb_array_length(state->'participants') from public.tournaments where id=p_id) then return;end if;
 perform public.replace_player_codes(p_id,p_codes);
end $$;
create or replace function public.manager_schema_ready() returns boolean language sql security definer set search_path='' as $$ select true $$;
-- Every privileged helper remains inaccessible to browser roles.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_session','assert_session','replace_player_codes','create_tournament','create_tournament_legacy','save_tournament','save_tournament_scoped_base','choose_device_players','choose_device_players_base','choose_tournament_player','claim_player','private_list_archived','manage_player_codes','ensure_player_codes','login_player_session','manager_schema_ready') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.signature::text like '%_legacy(%' or f.signature::text like '%_base(%' or f.signature::text like '%replace_player_codes(%' then execute format('revoke all on function %s from service_role',f.signature);else execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;

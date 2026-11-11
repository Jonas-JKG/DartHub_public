-- After 011 and 012. Repeatable; preserves tournaments and existing player codes.
begin;
alter table public.sessions add column if not exists player_access_ids uuid[] not null default '{}';
alter table public.sessions add column if not exists remembered_tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.sessions add column if not exists remembered_participant_ids uuid[] not null default '{}';
alter table public.sessions add column if not exists player_access_versions jsonb not null default '{}';
alter table public.managers add column if not exists deletion_requested_at timestamptz;
alter table public.managers add column if not exists auth_deleted_at timestamptz;
create table if not exists public.manager_player_choices (
 manager_id uuid not null references public.managers(id) on delete cascade,
 tournament_id uuid not null references public.tournaments(id) on delete cascade,
 participant_ids uuid[] not null default '{}', updated_at timestamptz not null default now(),
 primary key(manager_id,tournament_id)
);
-- Preserve the currently selected players of existing management sessions, too.
insert into public.manager_player_choices(manager_id,tournament_id,participant_ids)
 select distinct on(coalesce(s.manager_id,'00000000-0000-4000-8000-000000000001'::uuid),s.playing_tournament_id)
  coalesce(s.manager_id,'00000000-0000-4000-8000-000000000001'::uuid),s.playing_tournament_id,s.participant_ids
 from public.sessions s join public.tournaments t on t.id=s.playing_tournament_id
 where s.role='owner' and s.expires_at>now() and cardinality(s.participant_ids)>0 and (s.manager_id is null or s.manager_id=t.manager_id)
 order by coalesce(s.manager_id,'00000000-0000-4000-8000-000000000001'::uuid),s.playing_tournament_id,s.expires_at desc
 on conflict(manager_id,tournament_id) do nothing;
update public.sessions set remembered_tournament_id=playing_tournament_id,remembered_participant_ids=participant_ids where role='owner' and remembered_tournament_id is null and playing_tournament_id is not null;
alter table public.manager_player_choices enable row level security;
revoke all on public.manager_player_choices from public,anon,authenticated;
grant all on public.manager_player_choices to service_role;
update public.tournaments t set state=jsonb_set(t.state,'{createdByName}',to_jsonb(m.name)) from public.managers m where t.manager_id=m.id and not(t.state ? 'createdByName');
update public.public_tournament_snapshots p set state=t.state from public.tournaments t where p.id=t.id and p.state is distinct from t.state;

create or replace function public.read_session(p_hash text) returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('authorized_participant_ids',case when s.role='editor' then
  (select coalesce(jsonb_agg(pc.participant_id),'[]') from public.player_access_codes pc where pc.id=any(case when cardinality(s.player_access_ids)>0 then s.player_access_ids else array[s.player_access_id] end)) else to_jsonb(s.participant_ids) end)
 from public.sessions s
 left join public.managers manager on manager.id=s.manager_id
 left join public.tournaments t on t.id=s.tournament_id
 left join public.tournament_credentials c on c.tournament_id=s.tournament_id
 left join public.player_access_codes anchor on anchor.id=s.player_access_id
 where s.token_hash=p_hash and s.expires_at>now() and (
  (s.role='owner' and (s.manager_id is null or (manager.enabled and manager.approved and manager.deletion_requested_at is null))) or
  (s.role='viewer' and manager.enabled and manager.approved and manager.deletion_requested_at is null) or
  (s.role='editor' and manager.enabled and manager.approved and manager.deletion_requested_at is null and s.manager_id=t.manager_id and c.editor_enabled and t.status<>'archived'
    and anchor.enabled and anchor.tournament_id=s.tournament_id and s.credential_version=anchor.version
    and cardinality(s.participant_ids)>0 and s.participant_id=any(s.participant_ids)
    and not exists(select 1 from unnest(case when cardinality(s.player_access_ids)>0 then s.player_access_ids else array[s.player_access_id] end) a
      left join public.player_access_codes pc on pc.id=a
      where pc.id is null or not pc.enabled or pc.tournament_id<>s.tournament_id or pc.version<>coalesce((s.player_access_versions->>a::text)::integer,case when a=s.player_access_id then s.credential_version else -1 end))
    and not exists(select 1 from unnest(s.participant_ids) p where not exists(select 1 from public.player_access_codes pc where pc.participant_id=p and pc.id=any(case when cardinality(s.player_access_ids)>0 then s.player_access_ids else array[s.player_access_id] end)))
  )
 );
$$;
create or replace function public.choose_device_players(p_hash text,p_id uuid,p_players uuid[],p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;begin
 perform 1 from public.tournaments where id=p_id for update;
 s:=public.assert_session(p_hash,p_id,'score');
 if s->>'role'='editor' and exists(select 1 from unnest(p_players) p where not(coalesce(s->'authorized_participant_ids','[]') ? p::text)) then raise exception 'Für jeden Spieler ist sein eigener Code erforderlich' using errcode='42501';end if;
 perform public.choose_device_players_base(p_hash,p_id,p_players,p_takeover);
 if s->>'role'='owner' then
  update public.sessions set remembered_tournament_id=p_id,remembered_participant_ids=p_players where token_hash=p_hash;
  insert into public.manager_player_choices(manager_id,tournament_id,participant_ids) values(coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001'),p_id,p_players)
   on conflict(manager_id,tournament_id) do update set participant_ids=excluded.participant_ids,updated_at=now();
 end if;
end $$;
create or replace function public.add_device_player(p_hash text,p_code_hash text,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;pc public.player_access_codes;players uuid[];begin
 s:=public.read_session(p_hash);
 if s is null or s->>'role'<>'editor' then raise exception 'Bitte mit Spieler-Code anmelden' using errcode='42501';end if;
 perform 1 from public.tournaments where id=(s->>'tournament_id')::uuid for update;
 s:=public.read_session(p_hash);if s is null then raise exception 'Sitzung abgelaufen' using errcode='28000';end if;
 select * into pc from public.player_access_codes where code_hash=p_code_hash and enabled and tournament_id=(s->>'tournament_id')::uuid;
 if not found then raise exception 'Spielercode ungültig oder gehört zu einem anderen Turnier' using errcode='42501';end if;
 update public.sessions set player_access_ids=array(select distinct a from unnest(case when cardinality(player_access_ids)>0 then player_access_ids else array[player_access_id] end||array[pc.id]) a),
  player_access_versions=jsonb_build_object(player_access_id::text,credential_version)||player_access_versions||jsonb_build_object(pc.id::text,pc.version) where token_hash=p_hash;
 select array_agg(distinct p) into players from unnest(array(select jsonb_array_elements_text(s->'participant_ids')::uuid)||array[pc.participant_id]) p;
 perform public.choose_device_players(p_hash,(s->>'tournament_id')::uuid,players,p_takeover);
end $$;
create or replace function public.restore_manager_player(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;choice public.manager_player_choices;begin
 s:=public.read_session(p_hash);if s is null or s->>'role'<>'owner' then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 select c.* into choice from public.manager_player_choices c join public.tournaments t on t.id=c.tournament_id
  where c.manager_id=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001') and t.status<>'archived'
   and (s->>'manager_id' is null or t.manager_id=(s->>'manager_id')::uuid)
   and not exists(select 1 from unnest(c.participant_ids) p where not exists(select 1 from jsonb_array_elements(t.state->'participants') member where member->>'id'=p::text))
  order by c.updated_at desc limit 1;
 if choice.tournament_id is null then return null;end if;
 update public.sessions set remembered_tournament_id=choice.tournament_id,remembered_participant_ids=choice.participant_ids where token_hash=p_hash;
 begin perform public.choose_device_players(p_hash,choice.tournament_id,choice.participant_ids,false);
 exception when sqlstate 'P0001' or sqlstate '55000' then if sqlerrm='PLAYER_IN_USE' then return jsonb_build_object('needsTakeover',true,'tournamentId',choice.tournament_id);else raise;end if;end;
 return jsonb_build_object('tournamentId',choice.tournament_id,'participantIds',choice.participant_ids);
end $$;
-- Serialize new tournament creation with manager deletion.
do $$ begin if to_regprocedure('public.create_tournament_manager_base(jsonb,jsonb,text)') is null then alter function public.create_tournament(jsonb,jsonb,text) rename to create_tournament_manager_base;end if;end $$;
create or replace function public.create_tournament(p_state jsonb,p_credentials jsonb,p_session_hash text) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;begin
 s:=public.read_session(p_session_hash);
 perform 1 from public.managers where id=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001') for update;
 perform public.create_tournament_manager_base(p_state,p_credentials,p_session_hash);
end $$;
create or replace function public.prepare_manager_deletion(p_hash text,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare s jsonb;m public.managers;begin
 s:=public.read_session(p_hash);if s is null or s->>'role'<>'owner' or s->>'manager_id' is not null or p_id='00000000-0000-4000-8000-000000000001' then raise exception 'Nur der Owner darf Manager löschen' using errcode='42501';end if;
 select * into m from public.managers where id=p_id for update;if not found then return false;end if;
 update public.managers set enabled=false,approved=false,deletion_requested_at=coalesce(deletion_requested_at,now()),live_token_hash=null,live_secret=null where id=p_id;
 delete from public.sessions where manager_id=p_id;
 delete from public.saved_autodarts where manager_id=p_id or player_access_id in(select pc.id from public.player_access_codes pc join public.tournaments t on pc.tournament_id=t.id where t.manager_id=p_id);
 delete from public.manager_player_choices where manager_id=p_id;
 update public.tournament_credentials set editor_enabled=false where tournament_id in(select id from public.tournaments where manager_id=p_id);
 delete from public.player_access_codes where tournament_id in(select id from public.tournaments where manager_id=p_id);
 update public.tournaments set manager_id='00000000-0000-4000-8000-000000000001',version=version+1,updated_at=now(),state=state||jsonb_build_object('managerId','00000000-0000-4000-8000-000000000001','createdByName',coalesce(state->>'createdByName',m.name),'version',version+1,'updatedAt',now()) where manager_id=p_id;
 update public.public_tournament_snapshots p set state=t.state from public.tournaments t where p.id=t.id and p.state is distinct from t.state;
 return true;
end $$;
create or replace function public.manage_manager_status(p_hash text,p_id uuid,p_operation text) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;begin
 s:=public.read_session(p_hash);if s is null or s->>'role'<>'owner' or s->>'manager_id' is not null or p_id='00000000-0000-4000-8000-000000000001' then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 if p_operation not in ('enable','disable','approve') then raise exception 'Ungültige Operation';end if;
 update public.managers set enabled=case when p_operation='approve' then enabled else p_operation='enable' end,approved=case when p_operation='approve' then true else approved end where id=p_id and deletion_requested_at is null;
 if not found then raise exception 'Manager nicht verfügbar oder zur Löschung gesperrt' using errcode='42501';end if;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_session','choose_device_players','add_device_player','restore_manager_player','create_tournament','create_tournament_manager_base','prepare_manager_deletion','manage_manager_status') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.signature::text like '%create_tournament_manager_base(%' then execute format('revoke all on function %s from service_role',f.signature);else execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;

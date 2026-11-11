-- Execute the entire migration in Supabase SQL Editor. No application secrets here.
begin;
create table public.tournaments (
  id uuid primary key, state jsonb not null, version integer not null check(version > 0),
  status text not null check(status in ('planned','running','completed','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(jsonb_typeof(state->'participants')='array'),
  check(jsonb_array_length(state->'participants') between 3 and 20),
  check(state->>'id'=id::text)
);
create table public.players (id uuid primary key, name text not null check(length(name) between 1 and 80));
create table public.tournament_participants (
  tournament_id uuid references public.tournaments on delete cascade,
  id uuid references public.players, name text not null, position integer not null,
  primary key(tournament_id,id), unique(tournament_id,position)
);
create table public.groups (
  tournament_id uuid references public.tournaments on delete cascade, id text not null,
  name text not null, primary key(tournament_id,id)
);
create table public.group_memberships (
  tournament_id uuid not null, group_id text not null, participant_id uuid not null,
  primary key(tournament_id,participant_id),
  foreign key(tournament_id,group_id) references public.groups on delete cascade,
  foreign key(tournament_id,participant_id) references public.tournament_participants on delete cascade
);
create table public.knockout_rounds (
  tournament_id uuid references public.tournaments on delete cascade, number integer check(number>0),
  primary key(tournament_id,number)
);
create table public.group_qualifications (
  tournament_id uuid not null, group_id text not null, rank integer not null check(rank>0), participant_id uuid not null,
  primary key(tournament_id,group_id,rank), unique(tournament_id,participant_id),
  foreign key(tournament_id,group_id) references public.groups on delete cascade,
  foreign key(tournament_id,participant_id) references public.tournament_participants on delete cascade
);
create table public.matches (
  tournament_id uuid references public.tournaments on delete cascade, id text not null,
  phase text not null check(phase in ('group','knockout')), group_id text, round_number integer,
  position integer not null, status text not null check(status in ('pending','running','finished')),
  automatic boolean not null, player_a uuid, player_b uuid,
  primary key(tournament_id,id),
  foreign key(tournament_id,group_id) references public.groups,
  foreign key(tournament_id,round_number) references public.knockout_rounds,
  foreign key(tournament_id,player_a) references public.tournament_participants,
  foreign key(tournament_id,player_b) references public.tournament_participants,
  check(player_a is null or player_b is null or player_a<>player_b),
  check((phase='group' and group_id is not null and round_number is null) or (phase='knockout' and group_id is null and round_number is not null)),
  check(status='pending' or automatic or (player_a is not null and player_b is not null))
);
create table public.match_slots (
  tournament_id uuid not null, match_id text not null, slot integer check(slot in (0,1)),
  source_kind text not null check(source_kind in ('participant','winner','bye')), source_id text,
  primary key(tournament_id,match_id,slot),
  foreign key(tournament_id,match_id) references public.matches on delete cascade
);
create unique index unique_group_pair on public.matches(tournament_id,least(player_a,player_b),greatest(player_a,player_b)) where phase='group';
create table public.match_dependencies (
  tournament_id uuid not null, source_match text not null, target_match text not null, target_slot integer check(target_slot in (0,1)),
  primary key(tournament_id,target_match,target_slot),
  foreign key(tournament_id,source_match) references public.matches on delete cascade,
  foreign key(tournament_id,target_match) references public.matches on delete cascade,
  check(source_match<>target_match)
);
create table public.match_results (
  tournament_id uuid not null, match_id text not null, legs_a integer check(legs_a between 0 and 9999), legs_b integer check(legs_b between 0 and 9999),
  winner uuid, forfeited uuid,
  primary key(tournament_id,match_id),
  foreign key(tournament_id,match_id) references public.matches on delete cascade,
  foreign key(tournament_id,winner) references public.tournament_participants,
  foreign key(tournament_id,forfeited) references public.tournament_participants,
  check((legs_a is null)=(legs_b is null)), check(forfeited is null or (winner is not null and winner<>forfeited))
);
create table public.group_ranking_decisions (
  tournament_id uuid not null, group_id text not null, tie_key text not null, participant_order jsonb not null,
  primary key(tournament_id,group_id,tie_key), foreign key(tournament_id,group_id) references public.groups on delete cascade
);
create table public.tournament_credentials (
  tournament_id uuid primary key references public.tournaments on delete cascade,
  admin_hash text not null, admin_version integer not null default 1,
  editor_link_hash text not null unique, editor_pin_hash text not null, editor_secret text not null,
  editor_enabled boolean not null default true, editor_version integer not null default 1
);
create table public.sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  role text not null check(role in ('owner','admin','editor')),
  tournament_id uuid references public.tournaments on delete cascade,
  credential_version integer not null, expires_at timestamptz not null,
  check((role='owner' and tournament_id is null) or (role<>'owner' and tournament_id is not null))
);
create index sessions_expiry on public.sessions(expires_at);
create table public.login_rate_limits (key text primary key, attempts integer not null, reset_at timestamptz not null);
create table public.audit_events (
  id bigint generated always as identity primary key, tournament_id uuid,
  actor_role text not null, actor_session text not null, action text not null,
  before_state jsonb, after_state jsonb, detail jsonb, created_at timestamptz not null default now()
);
create index audit_tournament on public.audit_events(tournament_id,created_at desc);
create table public.public_tournament_snapshots (
  id uuid primary key references public.tournaments on delete cascade, state jsonb not null,
  archived boolean not null, version integer not null, updated_at timestamptz not null
);
create table public.public_live_state (
  id integer primary key check(id=1), tournament_id uuid, version bigint not null default 0
);
insert into public.public_live_state(id) values(1);

-- Browser roles can only read public snapshots and the live pointer.
do $$ declare tab text; begin
  foreach tab in array array['tournaments','players','tournament_participants','groups','group_memberships','group_qualifications','knockout_rounds','matches','match_slots','match_dependencies','match_results','group_ranking_decisions','tournament_credentials','sessions','login_rate_limits','audit_events','public_tournament_snapshots','public_live_state'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from anon, authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;
grant select on public.public_tournament_snapshots,public.public_live_state to anon,authenticated;
create policy public_snapshots_read on public.public_tournament_snapshots for select to anon,authenticated using(not archived);
create policy public_live_read on public.public_live_state for select to anon,authenticated using(true);

create function public.read_session(p_hash text) returns jsonb language sql security definer set search_path='' as $$
  select to_jsonb(s) from public.sessions s left join public.tournament_credentials c on c.tournament_id=s.tournament_id
  where s.token_hash=p_hash and s.expires_at>now() and
    (s.role='owner' or (s.role='admin' and s.credential_version=c.admin_version) or
      (s.role='editor' and c.editor_enabled and s.credential_version=c.editor_version));
$$;
create function public.assert_session(p_hash text,p_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  s:=public.read_session(p_hash);
  if s is null then raise exception 'Nicht angemeldet' using errcode='28000'; end if;
  if s->>'role'='owner' then return s; end if;
  if s->>'tournament_id'<>p_id::text or p_id is null then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
  if s->>'role'='admin' and p_action in ('score','manage','access') then return s; end if;
  if s->>'role'='editor' and p_action='score' then return s; end if;
  raise exception 'Keine Berechtigung' using errcode='42501';
end $$;

create function public.sync_tournament(p_state jsonb) returns void language plpgsql security definer set search_path='' as $$
declare tid uuid := (p_state->>'id')::uuid; p jsonb; g jsonb; m jsonb; s jsonb; d record; pos integer:=0; i integer; qpos integer:=0; qslot text; begin
  delete from public.matches where tournament_id=tid;
  delete from public.group_memberships where tournament_id=tid;
  delete from public.group_qualifications where tournament_id=tid;
  delete from public.group_ranking_decisions where tournament_id=tid;
  delete from public.groups where tournament_id=tid;
  delete from public.knockout_rounds where tournament_id=tid;
  delete from public.tournament_participants where tournament_id=tid;
  for p in select value from jsonb_array_elements(p_state->'participants') loop
    insert into public.players(id,name) values((p->>'id')::uuid,p->>'name') on conflict(id) do update set name=excluded.name;
    insert into public.tournament_participants values(tid,(p->>'id')::uuid,p->>'name',pos); pos:=pos+1;
  end loop;
  for g in select value from jsonb_array_elements(p_state->'groups') loop
    insert into public.groups values(tid,g->>'id',g->>'name');
    for p in select value from jsonb_array_elements(g->'participants') loop
      insert into public.group_memberships values(tid,g->>'id',(p#>>'{}')::uuid);
    end loop;
    for d in select key,value from jsonb_each(g->'decisions') loop
      insert into public.group_ranking_decisions values(tid,g->>'id',d.key,d.value);
    end loop;
  end loop;
  insert into public.knockout_rounds select distinct tid,(value->>'round')::integer from jsonb_array_elements(p_state->'matches') where value->>'phase'='knockout';
  for m in select value from jsonb_array_elements(p_state->'matches') loop
    insert into public.matches values(tid,m->>'id',m->>'phase',m->>'groupId',case when m->>'phase'='knockout' then (m->>'round')::integer else null end,(m->>'position')::integer,m->>'status',(m->>'automatic')::boolean,(m->'players'->>0)::uuid,(m->'players'->>1)::uuid);
    if m->>'status'='finished' then
      if m->>'winner' is null or not (m->>'winner' is not distinct from m->'players'->>0 or m->>'winner' is not distinct from m->'players'->>1) then raise exception 'Ungültiger Gewinner'; end if;
      if (m->>'automatic')::boolean and (m->>'phase'<>'knockout' or ((m->'players'->>0 is null)=(m->'players'->>1 is null)) or m->'legs'->>0 is not null or m->'legs'->>1 is not null) then raise exception 'Ungültiges Freilos'; end if;
      if not (m->>'automatic')::boolean and m->>'forfeited' is null and
        (m->'legs'->>0 is null or m->'legs'->>1 is null or (m->'legs'->>0)::integer=(m->'legs'->>1)::integer or
        m->>'winner'<>case when (m->'legs'->>0)::integer>(m->'legs'->>1)::integer then m->'players'->>0 else m->'players'->>1 end) then raise exception 'Ungültiges Endergebnis'; end if;
    elsif m->>'winner' is not null or m->>'forfeited' is not null then raise exception 'Offenes Match mit Gewinner'; end if;
    if m->>'forfeited' is not null and m->>'forfeited' not in (m->'players'->>0,m->'players'->>1) then raise exception 'Ungültige Aufgabe'; end if;
    insert into public.match_results values(tid,m->>'id',(m->'legs'->>0)::integer,(m->'legs'->>1)::integer,(m->>'winner')::uuid,(m->>'forfeited')::uuid);
  end loop;
  if p_state->>'mode'='groups' then
    for m in select value from jsonb_array_elements(p_state->'matches') where value->>'phase'='knockout' and value->>'round'='1' order by (value->>'position')::integer loop
      for s in select value from jsonb_array_elements(m->'sources') where value->>'kind'='participant' loop
        qslot:=p_state->'knockoutSeeds'->>qpos;
        insert into public.group_qualifications values(tid,split_part(qslot,':',1),split_part(qslot,':',2)::integer,(s->>'id')::uuid);
        qpos:=qpos+1;
      end loop;
    end loop;
  end if;
  for m in select value from jsonb_array_elements(p_state->'matches') loop
    for i in 0..1 loop
      s:=m->'sources'->i;
      insert into public.match_slots values(tid,m->>'id',i,s->>'kind',s->>'id');
      if s->>'kind'='winner' then
        if not exists(select 1 from public.matches source where source.tournament_id=tid and source.id=s->>'id' and source.phase='knockout' and source.round_number<(m->>'round')::integer) then raise exception 'Ungültige Match-Abhängigkeit'; end if;
        insert into public.match_dependencies values(tid,s->>'id',m->>'id',i);
      end if;
    end loop;
  end loop;
  insert into public.public_tournament_snapshots values(tid,p_state,p_state->>'status'='archived',(p_state->>'version')::integer,(p_state->>'updatedAt')::timestamptz)
    on conflict(id) do update set state=excluded.state,archived=excluded.archived,version=excluded.version,updated_at=excluded.updated_at;
  update public.public_live_state set tournament_id=(select id from public.tournaments where status<>'archived' order by (status='running') desc,case when status='running' then (state->>'startedAt')::timestamptz else updated_at end desc,id limit 1),version=version+1 where id=1;
end $$;

create function public.create_tournament(p_state jsonb,p_credentials jsonb,p_session_hash text) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; tid uuid:=(p_state->>'id')::uuid; begin
  s:=public.assert_session(p_session_hash,null,'create');
  insert into public.tournaments values(tid,p_state,1,p_state->>'status',(p_state->>'createdAt')::timestamptz,(p_state->>'updatedAt')::timestamptz);
  insert into public.tournament_credentials(tournament_id,admin_hash,admin_version,editor_link_hash,editor_pin_hash,editor_secret,editor_enabled,editor_version)
    values(tid,p_credentials->>'admin_hash',1,p_credentials->>'editor_link_hash',p_credentials->>'editor_pin_hash',p_credentials->>'editor_secret',true,1);
  perform public.sync_tournament(p_state);
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,after_state) values(tid,s->>'role',p_session_hash,'create',p_state);
end $$;
create function public.save_tournament(p_state jsonb,p_expected integer,p_session_hash text,p_action text,p_detail jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; old public.tournaments; tid uuid:=(p_state->>'id')::uuid; begin
  s:=public.assert_session(p_session_hash,tid,p_action);
  select * into old from public.tournaments where id=tid for update;
  if not found then raise exception 'Turnier nicht gefunden' using errcode='P0002'; end if;
  if old.version<>p_expected then raise exception 'Das Turnier wurde inzwischen geändert. Bitte aktuellen Stand laden.' using errcode='40001'; end if;
  if (p_state->>'version')::integer<>p_expected+1 then raise exception 'Ungültige Version'; end if;
  if s->>'role'='editor' then
    if old.status='archived' or old.status='planned' or p_state->>'status' not in ('running','completed') or
      (old.state - array['matches','winner','version','updatedAt','status','groups']) <> (p_state - array['matches','winner','version','updatedAt','status','groups']) or
      old.state->'groups'<>p_state->'groups' and not (
        (select jsonb_agg(value-'decisions') from jsonb_array_elements(old.state->'groups')) is not distinct from
        (select jsonb_agg(value-'decisions') from jsonb_array_elements(p_state->'groups')) and
        not exists(select 1 from jsonb_array_elements(p_state->'groups') newer
          join jsonb_array_elements(old.state->'groups') older on newer.value->>'id'=older.value->>'id'
          where newer.value->'decisions'<>'{}'::jsonb and newer.value->'decisions'<>older.value->'decisions')
      ) then raise exception 'Strukturelle Änderung nicht erlaubt' using errcode='42501'; end if;
  end if;
  update public.tournaments set state=p_state,version=p_expected+1,status=p_state->>'status',updated_at=(p_state->>'updatedAt')::timestamptz where id=tid;
  perform public.sync_tournament(p_state);
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,before_state,after_state,detail) values(tid,s->>'role',p_session_hash,p_action,old.state,p_state,p_detail);
end $$;
create function public.delete_tournament(p_id uuid,p_expected integer,p_session_hash text) returns void language plpgsql security definer set search_path='' as $$
declare old public.tournaments; s jsonb; begin
  s:=public.assert_session(p_session_hash,p_id,'delete');
  select * into old from public.tournaments where id=p_id for update;
  if old.version is null then raise exception 'Nicht gefunden'; end if;
  if old.version<>p_expected then raise exception 'Versionskonflikt' using errcode='40001'; end if;
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,before_state) values(p_id,s->>'role',p_session_hash,'delete',old.state);
  delete from public.tournaments where id=p_id;
  delete from public.players where not exists(select 1 from public.tournament_participants p where p.id=players.id);
  update public.public_live_state set tournament_id=(select id from public.tournaments where status<>'archived' order by (status='running') desc,case when status='running' then (state->>'startedAt')::timestamptz else updated_at end desc,id limit 1),version=version+1 where id=1;
end $$;
create function public.private_list_archived(p_session_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_session_hash); result jsonb; begin
  if s is null or s->>'role' not in ('owner','admin') then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
  select coalesce(jsonb_agg(state),'[]') into result from public.tournaments where status='archived' and (s->>'role'='owner' or id::text=s->>'tournament_id'); return result;
end $$;
create function public.consume_login_attempt(p_key text,p_max integer) returns boolean language plpgsql security definer set search_path='' as $$
declare count integer; begin
  insert into public.login_rate_limits values(p_key,1,now()+interval '15 minutes')
    on conflict(key) do update set attempts=case when login_rate_limits.reset_at<=now() then 1 else login_rate_limits.attempts+1 end,
      reset_at=case when login_rate_limits.reset_at<=now() then now()+interval '15 minutes' else login_rate_limits.reset_at end returning attempts into count;
  return count<=p_max;
end $$;
create function public.manage_access(p_id uuid,p_session_hash text,p_action text,p_admin_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  s:=public.assert_session(p_session_hash,p_id,'access');
  perform 1 from public.tournament_credentials where tournament_id=p_id for update;
  if p_action='admin' and p_admin_hash is not null then update public.tournament_credentials set admin_hash=p_admin_hash,admin_version=admin_version+1 where tournament_id=p_id;
  elsif p_action in ('enable','disable','revoke') then update public.tournament_credentials set editor_version=editor_version+1,editor_enabled=case when p_action='disable' then false when p_action='enable' then true else editor_enabled end where tournament_id=p_id;
  else raise exception 'Ungültige Zugangsaktion'; end if;
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,detail) values(p_id,s->>'role',p_session_hash,'access',jsonb_build_object('action',p_action));
end $$;
create function public.installation_health() returns jsonb language sql set search_path='' as $$ select jsonb_build_object('schema_version',1,'ready',true); $$;

-- All RPCs are callable only by the server key. Helpers are not browser endpoints.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_session','assert_session','sync_tournament','create_tournament','save_tournament','delete_tournament','private_list_archived','consume_login_attempt','manage_access','installation_health') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='public_tournament_snapshots') then alter publication supabase_realtime add table public.public_tournament_snapshots; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='public_live_state') then alter publication supabase_realtime add table public.public_live_state; end if;
end $$;
commit;

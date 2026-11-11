-- VERSION 2: Gesamte Datei ausführen. Enthält auch das vorherige Scoring-Update 007.
begin;
-- Spieler-Auswahl, Geräteübernahme und Live-Scoring.
-- Gesamten Inhalt im SQL Editor des VERSION-2-Supabase-Projekts ausführen.
alter table public.sessions add column if not exists participant_id uuid;
create unique index if not exists one_device_per_player on public.sessions(tournament_id,participant_id) where role='editor' and participant_id is not null;
create table if not exists public.match_games (
  tournament_id uuid not null references public.tournaments on delete cascade,
  match_id text not null, state jsonb not null, version integer not null check(version>0),
  updated_at timestamptz not null default now(), primary key(tournament_id,match_id)
);
alter table public.match_games enable row level security;
revoke all on public.match_games from anon,authenticated;
grant select on public.match_games to anon,authenticated;
grant all on public.match_games to service_role;
drop policy if exists public_games_read on public.match_games;
create policy public_games_read on public.match_games for select to anon,authenticated using(
  exists(select 1 from public.public_tournament_snapshots p where p.id=tournament_id and not p.archived)
);
create or replace function public.read_session(p_hash text) returns jsonb language sql security definer set search_path='' as $$
  select to_jsonb(s) from public.sessions s left join public.tournament_credentials c on c.tournament_id=s.tournament_id
  where s.token_hash=p_hash and s.expires_at>now() and
    (s.role='owner' or (s.role='editor' and c.editor_enabled and s.credential_version=c.editor_version));
$$;
create or replace function public.claim_player(p_hash text,p_player uuid,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; tid uuid; begin
  s:=public.read_session(p_hash);
  if s is null or s->>'role'<>'editor' then raise exception 'Nicht als Spieler angemeldet' using errcode='28000'; end if;
  tid:=(s->>'tournament_id')::uuid;
  perform 1 from public.tournaments where id=tid for update;
  s:=public.read_session(p_hash);
  if s is null or s->>'role'<>'editor' then raise exception 'Sitzung wurde beendet' using errcode='28000'; end if;
  if not exists(select 1 from public.tournaments t,jsonb_array_elements(t.state->'participants') p where t.id=tid and p->>'id'=p_player::text) then raise exception 'Spieler gehört nicht zum Turnier' using errcode='42501'; end if;
  if not p_takeover and exists(select 1 from public.sessions where tournament_id=tid and participant_id=p_player and token_hash<>p_hash and expires_at>now()) then raise exception 'PLAYER_IN_USE' using errcode='P0001'; end if;
  delete from public.sessions where tournament_id=tid and participant_id=p_player and token_hash<>p_hash;
  update public.sessions set participant_id=p_player where token_hash=p_hash;
end $$;
-- Wrap the existing transaction without exposing the helper to API clients.
do $$ begin
  if to_regprocedure('public.save_tournament_base(jsonb,integer,text,text,jsonb)') is null then
    alter function public.save_tournament(jsonb,integer,text,text,jsonb) rename to save_tournament_base;
  end if;
end $$;
revoke all on function public.save_tournament_base(jsonb,integer,text,text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.save_tournament(p_state jsonb,p_expected integer,p_session_hash text,p_action text,p_detail jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; tid uuid:=(p_state->>'id')::uuid; original jsonb; selected_match jsonb; begin
  select state into original from public.tournaments where id=tid for update;
  s:=public.assert_session(p_session_hash,tid,p_action);
  if s->>'role'='editor' then
    if s->>'participant_id' is null or p_detail->>'matchId' is null then raise exception 'Bitte zuerst einen Spieler auswählen' using errcode='42501'; end if;
    select m into selected_match from jsonb_array_elements(original->'matches') m where m->>'id'=p_detail->>'matchId';
    if selected_match is null or not (selected_match->'players' ? (s->>'participant_id')) then raise exception 'Nur eigene Matches dürfen bearbeitet werden' using errcode='42501'; end if;
  end if;
  if exists(select 1 from public.match_games g where g.tournament_id=tid and g.state->>'phase'<>'finished' and
    (p_detail->>'action' in ('redraw','status') or g.match_id=p_detail->>'matchId' or coalesce(p_detail->'resets','[]'::jsonb) ? g.match_id))
  then raise exception 'Ein betroffenes Match wird gerade gespielt. Bitte zuerst beenden oder als Admin zurücksetzen.' using errcode='55000'; end if;
  perform public.save_tournament_base(p_state,p_expected,p_session_hash,p_action,p_detail);
  delete from public.match_games where tournament_id=tid and (match_id=p_detail->>'matchId' or coalesce(p_detail->'resets','[]'::jsonb) ? match_id or p_detail->>'action'='redraw');
end $$;
create or replace function public.write_game(p_id uuid,p_match text,p_expected integer,p_hash text,p_state jsonb,p_tournament jsonb default null,p_tournament_expected integer default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; t public.tournaments; g public.match_games; m jsonb; begin
  select * into t from public.tournaments where id=p_id for update;
  s:=public.read_session(p_hash);
  if s is null or s->>'role'<>'editor' or s->>'participant_id' is null or s->>'tournament_id'<>p_id::text then raise exception 'Bitte als Spieler anmelden' using errcode='42501'; end if;
  if not found or t.status<>'running' then raise exception 'Das Turnier ist nicht aktiv' using errcode='55000'; end if;
  select value into m from jsonb_array_elements(t.state->'matches') where value->>'id'=p_match;
  if m is null or (m->>'automatic')::boolean or m->>'status'='finished' or m->'players'->>0 is null or m->'players'->>1 is null or not (m->'players' ? (s->>'participant_id')) then raise exception 'Dieses Match darfst du nicht spielen' using errcode='42501'; end if;
  if p_state->'players'<>m->'players' or (p_state->>'version')::integer<>p_expected+1 then raise exception 'Ungültiger Spielstand' using errcode='22023'; end if;
  select * into g from public.match_games where tournament_id=p_id and match_id=p_match for update;
  if found then
    if g.version<>p_expected then raise exception 'Spielstand inzwischen geändert' using errcode='40001'; end if;
    if g.state->>'phase'='finished' or (g.state->>'phase'='playing' and g.state->>'activePlayer'<>s->>'participant_id') then raise exception 'Du bist nicht an der Reihe' using errcode='42501'; end if;
  else
    if p_expected<>0 or p_state->>'phase'<>'bull' then raise exception 'Spielstand inzwischen geändert' using errcode='40001'; end if;
    if exists(select 1 from public.match_games other where other.tournament_id=p_id and other.state->>'phase'<>'finished' and other.state->'players' ? (s->>'participant_id')) then raise exception 'Du spielst bereits ein anderes Match' using errcode='55000'; end if;
    if exists(select 1 from public.match_games other where other.tournament_id=p_id and other.state->>'phase'<>'finished' and (other.state->'players' ? (m->'players'->>0) or other.state->'players' ? (m->'players'->>1))) then raise exception 'Ein Gegner spielt bereits ein anderes Match' using errcode='55000'; end if;
  end if;
  if p_tournament is not null then
    if (p_tournament->>'id')::uuid<>p_id or p_tournament_expected<>t.version then raise exception 'Turnier inzwischen geändert' using errcode='40001'; end if;
    perform public.save_tournament_base(p_tournament,p_tournament_expected,p_hash,'score',jsonb_build_object('action','game','matchId',p_match));
  end if;
  insert into public.match_games values(p_id,p_match,p_state,p_expected+1,now())
    on conflict(tournament_id,match_id) do update set state=excluded.state,version=excluded.version,updated_at=excluded.updated_at;
end $$;
create or replace function public.reset_game(p_id uuid,p_match text,p_hash text,p_state jsonb,p_expected integer) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  s:=public.assert_session(p_hash,p_id,'delete');
  perform 1 from public.tournaments where id=p_id for update;
  perform public.save_tournament_base(p_state,p_expected,p_hash,'manage',jsonb_build_object('action','reset-game','matchId',p_match));
  delete from public.match_games where tournament_id=p_id and match_id=p_match;
end $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('read_session','claim_player','save_tournament','write_game','reset_game') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='match_games') then
    alter publication supabase_realtime add table public.match_games;
  end if;
end $$;
notify pgrst,'reload schema';

-- Admin darf optional als Spieler teilnehmen, ohne Verwaltungsrechte zu verlieren.
alter table public.sessions add column if not exists playing_tournament_id uuid references public.tournaments(id) on delete set null;
drop index if exists public.one_device_per_player;
create unique index one_device_per_player on public.sessions((coalesce(playing_tournament_id,tournament_id)),participant_id) where role in ('owner','editor') and participant_id is not null;
create or replace function public.choose_tournament_player(p_hash text,p_id uuid,p_player uuid,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  perform 1 from public.tournaments where id=p_id for update;
  if not found then raise exception 'Turnier nicht verfügbar' using errcode='P0002'; end if;
  s:=public.read_session(p_hash);
  if s is null or s->>'role' not in ('owner','editor') then raise exception 'Bitte anmelden' using errcode='28000'; end if;
  if s->>'role'='editor' and ((s->>'tournament_id')::uuid<>p_id or p_player is null) then raise exception 'Nur Spieler des eigenen Turniers wählen' using errcode='42501'; end if;
  if p_player is null then
    update public.sessions set participant_id=null,playing_tournament_id=null where token_hash=p_hash;
    return;
  end if;
  if not exists(select 1 from public.tournaments t,jsonb_array_elements(t.state->'participants') p where t.id=p_id and p->>'id'=p_player::text and t.status<>'archived') then raise exception 'Spieler gehört nicht zu einem verfügbaren Turnier' using errcode='42501'; end if;
  if not p_takeover and exists(select 1 from public.sessions where coalesce(playing_tournament_id,tournament_id)=p_id and participant_id=p_player and token_hash<>p_hash and expires_at>now()) then raise exception 'PLAYER_IN_USE' using errcode='P0001'; end if;
  -- Bei einer Übernahme bleiben die Verwaltungsrechte anderer Admin-Geräte erhalten.
  update public.sessions set participant_id=null,playing_tournament_id=null where role='owner' and playing_tournament_id=p_id and participant_id=p_player and token_hash<>p_hash;
  delete from public.sessions where role='editor' and tournament_id=p_id and participant_id=p_player and token_hash<>p_hash;
  update public.sessions set participant_id=p_player,playing_tournament_id=case when role='owner' then p_id else null end where token_hash=p_hash;
end $$;
revoke all on function public.choose_tournament_player(text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.choose_tournament_player(text,uuid,uuid,boolean) to service_role;

create or replace function public.write_game(p_id uuid,p_match text,p_expected integer,p_hash text,p_state jsonb,p_tournament jsonb default null,p_tournament_expected integer default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; t public.tournaments; g public.match_games; m jsonb; begin
  select * into t from public.tournaments where id=p_id for update;
  s:=public.read_session(p_hash);
  if s is null or s->>'role' not in ('owner','editor') or s->>'participant_id' is null or coalesce(s->>'playing_tournament_id',s->>'tournament_id')<>p_id::text then raise exception 'Bitte als Spieler anmelden' using errcode='42501'; end if;
  if not found or t.status<>'running' then raise exception 'Das Turnier ist nicht aktiv' using errcode='55000'; end if;
  select value into m from jsonb_array_elements(t.state->'matches') where value->>'id'=p_match;
  if m is null or (m->>'automatic')::boolean or m->>'status'='finished' or m->'players'->>0 is null or m->'players'->>1 is null or not (m->'players' ? (s->>'participant_id')) then raise exception 'Dieses Match darfst du nicht spielen' using errcode='42501'; end if;
  if p_state->'players'<>m->'players' or (p_state->>'version')::integer<>p_expected+1 then raise exception 'Ungültiger Spielstand' using errcode='22023'; end if;
  select * into g from public.match_games where tournament_id=p_id and match_id=p_match for update;
  if found then
    if g.version<>p_expected then raise exception 'Spielstand inzwischen geändert' using errcode='40001'; end if;
    if g.state->>'phase'='finished' or (g.state->>'phase'='playing' and g.state->>'activePlayer'<>s->>'participant_id') then raise exception 'Du bist nicht an der Reihe' using errcode='42501'; end if;
  else
    if p_expected<>0 or p_state->>'phase'<>'bull' then raise exception 'Spielstand inzwischen geändert' using errcode='40001'; end if;
    if exists(select 1 from public.match_games other where other.tournament_id=p_id and other.state->>'phase'<>'finished' and other.state->'players' ? (s->>'participant_id')) then raise exception 'Du spielst bereits ein anderes Match' using errcode='55000'; end if;
    if exists(select 1 from public.match_games other where other.tournament_id=p_id and other.state->>'phase'<>'finished' and (other.state->'players' ? (m->'players'->>0) or other.state->'players' ? (m->'players'->>1))) then raise exception 'Ein Gegner spielt bereits ein anderes Match' using errcode='55000'; end if;
  end if;
  if p_tournament is not null then
    if (p_tournament->>'id')::uuid<>p_id or p_tournament_expected<>t.version then raise exception 'Turnier inzwischen geändert' using errcode='40001'; end if;
    perform public.save_tournament_base(p_tournament,p_tournament_expected,p_hash,'score',jsonb_build_object('action','game','matchId',p_match));
  end if;
  insert into public.match_games values(p_id,p_match,p_state,p_expected+1,now())
    on conflict(tournament_id,match_id) do update set state=excluded.state,version=excluded.version,updated_at=excluded.updated_at;
end $$;

notify pgrst,'reload schema';
commit;

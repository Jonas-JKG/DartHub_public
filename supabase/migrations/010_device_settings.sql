-- VERSION 2: Gemeinsames aktuelles Scheibenbild. Vollständig im SQL Editor ausführen.
-- Nur das letzte Bild je Spieler/Match wird gespeichert. Keine Autodarts-Zugangsdaten.
begin;
create table if not exists public.match_board_images (
  tournament_id uuid not null, match_id text not null, player_id uuid not null,
  session_hash text not null, connection_id uuid not null,
  visit_key text not null, image text, revision uuid not null,
  frame_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(tournament_id,match_id,player_id),
  foreign key(tournament_id,match_id) references public.match_games(tournament_id,match_id) on delete cascade,
  check(image is null or (length(image)<=1400000 and image ~ '^data:image/(jpeg|png|webp);base64,'))
);
alter table public.match_board_images enable row level security;
revoke all on public.match_board_images from anon,authenticated;
grant all on public.match_board_images to service_role;
create or replace function public.write_board_image(p_id uuid,p_match text,p_hash text,p_connection uuid,p_visit text,p_operation text,p_image text,p_frame_at timestamptz) returns boolean language plpgsql security definer set search_path='' as $$
declare s jsonb; g jsonb; pid uuid; tid uuid; current_visit text;
begin
  s:=public.read_session(p_hash);
  if s is null or s->>'role' not in ('owner','editor') or s->>'participant_id' is null then raise exception 'Bitte als Spieler anmelden' using errcode='42501'; end if;
  pid:=(s->>'participant_id')::uuid;
  tid:=(case when s->>'role'='owner' then s->>'playing_tournament_id' else s->>'tournament_id' end)::uuid;
  if tid is distinct from p_id then raise exception 'Falsches Turnier' using errcode='42501'; end if;
  select state into g from public.match_games where tournament_id=p_id and match_id=p_match;
  if g is null or not (g->'players' ? pid::text) then raise exception 'Nur eigene Matches' using errcode='42501'; end if;
  if p_operation='clear' then
    update public.match_board_images set image=null,updated_at=now(),frame_at=now(),revision=gen_random_uuid()
      where tournament_id=p_id and match_id=p_match and player_id=pid and connection_id=p_connection;
    return true;
  end if;
  current_visit:=(g->>'phase')||':'||(case when g->>'phase'='bull' then g->>'bullRound' else jsonb_array_length(g->'turns')::text end);
  if g->>'phase' not in ('bull','playing') or current_visit is distinct from p_visit or (g->>'phase'='playing' and g->>'activePlayer' is distinct from pid::text) then return false; end if;
  if p_operation='heartbeat' then
    update public.match_board_images set updated_at=now() where tournament_id=p_id and match_id=p_match and player_id=pid and session_hash=p_hash and connection_id=p_connection and visit_key=p_visit and image is not null;
    return true;
  end if;
  if p_operation<>'frame' or p_image is null or length(p_image)>1400000 or p_image !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'Ungültiges Bild'; end if;
  insert into public.match_board_images(tournament_id,match_id,player_id,session_hash,connection_id,visit_key,image,revision,frame_at,updated_at)
    values(p_id,p_match,pid,p_hash,p_connection,p_visit,p_image,gen_random_uuid(),p_frame_at,now())
    on conflict(tournament_id,match_id,player_id) do update set session_hash=excluded.session_hash,connection_id=excluded.connection_id,visit_key=excluded.visit_key,image=excluded.image,revision=excluded.revision,frame_at=excluded.frame_at,updated_at=now()
    where public.match_board_images.frame_at<=excluded.frame_at;
  return true;
end $$;
revoke all on function public.write_board_image(uuid,text,text,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.write_board_image(uuid,text,text,uuid,text,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;

-- VERSION 2: Mehrere Spieler auf einem Gerät und zwischengespeicherte leere Scheibe.
begin;
alter table public.sessions add column if not exists participant_ids uuid[] not null default '{}';
update public.sessions set participant_ids=array[participant_id] where participant_id is not null and cardinality(participant_ids)=0;
create or replace function public.choose_device_players(p_hash text,p_id uuid,p_players uuid[],p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; other record; remaining uuid[];
begin
 perform 1 from public.tournaments where id=p_id for update;
 if not found then raise exception 'Turnier nicht verfügbar' using errcode='P0002'; end if;
 s:=public.read_session(p_hash);
 if s is null or s->>'role' not in ('owner','editor') or (s->>'role'='editor' and (s->>'tournament_id')::uuid<>p_id) then raise exception 'Bitte anmelden' using errcode='42501'; end if;
 if p_players is null or cardinality(p_players)>20 or (cardinality(p_players)=0 and s->>'role'<>'owner') or exists(select 1 from unnest(p_players) p where p is null) or (select count(distinct p) from unnest(p_players) p)<>cardinality(p_players) then raise exception 'Ungültige Spielerauswahl' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_players) p where not exists(select 1 from public.tournaments t,jsonb_array_elements(t.state->'participants') v where t.id=p_id and v->>'id'=p::text and t.status<>'archived')) then raise exception 'Spieler gehört nicht zum Turnier' using errcode='42501'; end if;
 if not p_takeover and exists(select 1 from public.sessions where token_hash<>p_hash and coalesce(playing_tournament_id,tournament_id)=p_id and expires_at>now() and (participant_ids && p_players or participant_id=any(p_players))) then raise exception 'PLAYER_IN_USE' using errcode='P0001'; end if;
 for other in select * from public.sessions where token_hash<>p_hash and coalesce(playing_tournament_id,tournament_id)=p_id and (participant_ids && p_players or participant_id=any(p_players)) for update loop
   remaining:=array(select distinct x from unnest(case when cardinality(other.participant_ids)>0 then other.participant_ids else array[other.participant_id] end) x where x is not null and not(x=any(p_players)));
   if cardinality(remaining)=0 and other.role='editor' then delete from public.sessions where token_hash=other.token_hash;
   else update public.sessions set participant_ids=remaining,participant_id=remaining[1],playing_tournament_id=case when role='owner' and cardinality(remaining)=0 then null else playing_tournament_id end where token_hash=other.token_hash; end if;
 end loop;
 update public.sessions set participant_ids=p_players,participant_id=p_players[1],playing_tournament_id=case when role='owner' and cardinality(p_players)>0 then p_id else null end where token_hash=p_hash;
end $$;
create or replace function public.choose_tournament_player(p_hash text,p_id uuid,p_player uuid,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.choose_device_players(p_hash,p_id,case when p_player is null then '{}'::uuid[] else array[p_player] end,p_takeover);
end $$;
create or replace function public.claim_player(p_hash text,p_player uuid,p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;begin s:=public.read_session(p_hash);if s is null or s->>'role'<>'editor' then raise exception 'Bitte als Spieler anmelden' using errcode='42501';end if;perform public.choose_device_players(p_hash,(s->>'tournament_id')::uuid,array[p_player],p_takeover);end $$;
create or replace function public.begin_device_action(p_hash text,p_id uuid,p_actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s jsonb;original uuid;begin
 perform 1 from public.tournaments where id=p_id for update;
 perform 1 from public.sessions where token_hash=p_hash for update;
 s:=public.read_session(p_hash);
 if s is null or s->>'role' not in ('owner','editor') or coalesce(s->>'playing_tournament_id',s->>'tournament_id') is distinct from p_id::text or p_actor is null or not(coalesce(s->'participant_ids','[]'::jsonb) ? p_actor::text or s->>'participant_id'=p_actor::text) then raise exception 'Spieler ist diesem Gerät nicht zugeordnet' using errcode='42501';end if;
 original:=(s->>'participant_id')::uuid;update public.sessions set participant_id=p_actor where token_hash=p_hash;return original;
end $$;
create or replace function public.write_device_game(p_id uuid,p_match text,p_expected integer,p_hash text,p_actor uuid,p_state jsonb,p_tournament jsonb default null,p_tournament_expected integer default null) returns void language plpgsql security definer set search_path='' as $$
declare original uuid;begin original:=public.begin_device_action(p_hash,p_id,p_actor);perform public.write_game(p_id,p_match,p_expected,p_hash,p_state,p_tournament,p_tournament_expected);update public.sessions set participant_id=original where token_hash=p_hash;end $$;
create or replace function public.save_device_tournament(p_state jsonb,p_expected integer,p_session_hash text,p_actor uuid,p_action text,p_detail jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare original uuid;begin original:=public.begin_device_action(p_session_hash,(p_state->>'id')::uuid,p_actor);perform public.save_tournament(p_state,p_expected,p_session_hash,p_action,p_detail);update public.sessions set participant_id=original where token_hash=p_session_hash;end $$;
alter table public.match_board_images add column if not exists empty_image text;
alter table public.match_board_images add column if not exists empty_revision uuid;
alter table public.match_board_images drop constraint if exists empty_image_size;
alter table public.match_board_images add constraint empty_image_size check(empty_image is null or (length(empty_image)<=1400000 and empty_image ~ '^data:image/(jpeg|png|webp);base64,'));
create or replace function public.write_cached_board_image(p_id uuid,p_match text,p_hash text,p_actor uuid,p_connection uuid,p_visit text,p_operation text,p_image text,p_frame_at timestamptz,p_empty boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare original uuid; accepted boolean;g jsonb;begin
 original:=public.begin_device_action(p_hash,p_id,p_actor);
 select state into g from public.match_games where tournament_id=p_id and match_id=p_match;
 if g is null or not(g->'players' ? p_actor::text) then raise exception 'Nur eigene Matches' using errcode='42501';end if;
 if p_empty and p_operation='frame' then
  insert into public.match_board_images(tournament_id,match_id,player_id,session_hash,connection_id,visit_key,image,revision,frame_at,updated_at,empty_image,empty_revision) values(p_id,p_match,p_actor,p_hash,p_connection,p_visit,null,gen_random_uuid(),p_frame_at,now(),p_image,gen_random_uuid())
   on conflict(tournament_id,match_id,player_id) do update set empty_image=excluded.empty_image,empty_revision=excluded.empty_revision,session_hash=excluded.session_hash,connection_id=excluded.connection_id,image=null,revision=excluded.revision,frame_at=excluded.frame_at,updated_at=now() where public.match_board_images.frame_at<=excluded.frame_at;
  accepted:=true;
 else accepted:=public.write_board_image(p_id,p_match,p_hash,p_connection,p_visit,p_operation,p_image,p_frame_at);
 end if;
 if p_operation='clear' then update public.match_board_images set image=null,empty_image=null,empty_revision=null,revision=gen_random_uuid(),updated_at=now(),frame_at=now() where tournament_id=p_id and match_id=p_match and session_hash=p_hash and connection_id=p_connection;end if;
 update public.sessions set participant_id=original where token_hash=p_hash;
 return accepted;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('choose_device_players','choose_tournament_player','claim_player','begin_device_action','write_device_game','save_device_tournament','write_cached_board_image') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;

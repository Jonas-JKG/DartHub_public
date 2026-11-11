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

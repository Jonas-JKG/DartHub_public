-- After 024: private DartDeck camera frames, separate from scores and room versions.
begin;
create table if not exists public.dartdeck_board_images(
 room_id uuid not null references public.dartdeck_rooms(id) on delete cascade,
 match_id uuid not null,player_id uuid not null references public.dartdeck_members(id) on delete cascade,
 session_hash text not null,connection_id uuid not null,visit_key text not null,
 image text,empty_image text,revision uuid not null default gen_random_uuid(),empty_revision uuid,
 frame_at timestamptz not null,updated_at timestamptz not null default now(),
 primary key(room_id,match_id,player_id)
);
alter table public.dartdeck_board_images enable row level security;
revoke all on public.dartdeck_board_images from public,anon,authenticated;
grant all on public.dartdeck_board_images to service_role;
create or replace function public.write_dartdeck_image(p_hash text,p_id uuid,p_match uuid,p_actor uuid,p_connection uuid,p_visit text,p_operation text,p_image text,p_frame_at timestamptz,p_empty boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);r public.dartdeck_rooms;saved boolean;begin
 select * into r from public.dartdeck_rooms where id=p_id for update;
 if not exists(select 1 from public.dartdeck_members where room_id=p_id and id=p_actor and accepted and controller_id=account) then raise exception 'Nur eigene Spielerbilder' using errcode='42501';end if;
 if r.phase<>'playing' or r.game->>'id' is distinct from p_match::text then return false;end if;
 if p_operation='clear' then
  delete from public.dartdeck_board_images where room_id=p_id and match_id=p_match and player_id=p_actor and session_hash=p_hash and connection_id=p_connection;return found;
 end if;
 if p_visit is distinct from (r.game->>'id')||':'||jsonb_array_length(r.game->'visits')::text||':'||(r.game->>'nonce') then return false;end if;
 if p_operation='heartbeat' then
  update public.dartdeck_board_images set updated_at=now() where room_id=p_id and match_id=p_match and player_id=p_actor and session_hash=p_hash and connection_id=p_connection and visit_key=p_visit;return found;
 end if;
 if p_operation<>'frame' or p_image is null or length(p_image)>1400000 or p_image !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'Ungültiges Bild' using errcode='22023';end if;
 if not p_empty and r.game->'players'->((r.game->>'active')::integer)->>'id' is distinct from p_actor::text then return false;end if;
 insert into public.dartdeck_board_images(room_id,match_id,player_id,session_hash,connection_id,visit_key,image,empty_image,empty_revision,frame_at)
 values(p_id,p_match,p_actor,p_hash,p_connection,p_visit,case when p_empty then null else p_image end,case when p_empty then p_image end,case when p_empty then gen_random_uuid() end,p_frame_at)
 on conflict(room_id,match_id,player_id) do update set session_hash=excluded.session_hash,connection_id=excluded.connection_id,visit_key=excluded.visit_key,image=excluded.image,
 empty_image=coalesce(excluded.empty_image,public.dartdeck_board_images.empty_image),empty_revision=coalesce(excluded.empty_revision,public.dartdeck_board_images.empty_revision),revision=gen_random_uuid(),frame_at=excluded.frame_at,updated_at=now()
 where public.dartdeck_board_images.frame_at<=excluded.frame_at;
 saved:=found;return saved;
end $$;
revoke all on function public.write_dartdeck_image(text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.write_dartdeck_image(text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,boolean) to service_role;
notify pgrst,'reload schema';
commit;

-- Run after 011_manager_accounts.sql. Repeatable; no existing access is changed.
begin;
create table if not exists public.saved_autodarts (
 id uuid primary key default gen_random_uuid(),
 manager_id uuid unique references public.managers(id) on delete cascade,
 player_access_id uuid unique references public.player_access_codes(id) on delete cascade,
 refresh_secret text not null check(length(refresh_secret) between 1 and 8000),
 board_id text check(length(board_id) between 1 and 100),
 auto_connect boolean not null default false,
 lease uuid, lease_until timestamptz,
 updated_at timestamptz not null default now(),
 check((manager_id is not null) <> (player_access_id is not null))
);
alter table public.saved_autodarts enable row level security;
revoke all on public.saved_autodarts from public,anon,authenticated;
grant all on public.saved_autodarts to service_role;

-- All profile keys come from read_session, never from a client-supplied account ID.
-- A short lease serializes token rotation across devices and Vercel instances.
create or replace function public.autodarts_profile(p_hash text,p_operation text,p_secret text default null,p_board text default null,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb;manager uuid;player uuid;profile public.saved_autodarts;account_key text;
begin
 s:=public.read_session(p_hash);
 if s is null then raise exception 'Nicht angemeldet' using errcode='28000';end if;
 if s->>'role'='owner' then manager:=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001');account_key:='manager:'||manager;
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
revoke all on function public.autodarts_profile(text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.autodarts_profile(text,text,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;

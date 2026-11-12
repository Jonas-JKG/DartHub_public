-- Run after 027. Camera names are unique per account; player sessions stay signed in.
begin;
lock table public.camera_devices in share row exclusive mode;
create or replace function public.camera_name_key(p_name text) returns text
language sql immutable strict parallel safe set search_path=pg_catalog as $$
 select lower(btrim(regexp_replace(normalize(p_name,NFC),'[[:space:]]+',' ','g')))
$$;
-- Preserve device IDs, configuration and recordings. Keep the first name and
-- disambiguate later duplicates, avoiding names already used by another device.
do $$
declare r record;last_owner uuid;used text[]:='{}';base text;candidate text;suffix text;n integer;
begin
 for r in select id,owner_id,name from public.camera_devices order by owner_id,updated_at,id loop
  if last_owner is distinct from r.owner_id then used:='{}';last_owner:=r.owner_id;end if;
  base:=btrim(regexp_replace(normalize(r.name,NFC),'[[:space:]]+',' ','g'));
  if base='' then base:='Handykamera';end if;
  candidate:=base;n:=2;
  if public.camera_name_key(candidate)=any(used) then
   loop
    suffix:=' ('||n||')';candidate:=rtrim(left(base,50-length(suffix)))||suffix;
    exit when not(public.camera_name_key(candidate)=any(used)) and not exists(
     select 1 from public.camera_devices c where c.owner_id=r.owner_id and c.id<>r.id and public.camera_name_key(c.name)=public.camera_name_key(candidate));
    n:=n+1;
   end loop;
  end if;
  if candidate is distinct from r.name then update public.camera_devices set name=candidate where id=r.id;end if;
  used:=array_append(used,public.camera_name_key(candidate));
 end loop;
end $$;
create unique index if not exists camera_owner_name_unique on public.camera_devices(owner_id,public.camera_name_key(name));
create or replace function public.normalize_camera_name() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 new.name:=btrim(regexp_replace(normalize(new.name,NFC),'[[:space:]]+',' ','g'));
 if new.name='' then raise exception 'Bitte einen Kameranamen eingeben.' using errcode='22023';end if;
 return new;
end $$;
drop trigger if exists camera_normalize_name on public.camera_devices;
create trigger camera_normalize_name before insert or update of name on public.camera_devices for each row execute function public.normalize_camera_name();
revoke all on function public.camera_name_key(text),public.normalize_camera_name() from public,anon,authenticated;
grant execute on function public.camera_name_key(text),public.normalize_camera_name() to service_role;
-- Only currently valid player logins are carried forward; expired/revoked
-- sessions are never resurrected. Global Admin sessions retain their deadline.
update public.sessions s set expires_at='infinity'::timestamptz
 where s.role='owner' and s.manager_id is not null and s.account_session_hash is null
 and s.expires_at>now() and s.expires_at<>'infinity'::timestamptz and public.read_session(s.token_hash) is not null;
update public.sessions child set expires_at=parent.expires_at
 from public.sessions parent where child.account_session_hash=parent.token_hash
 and child.expires_at>now() and parent.expires_at='infinity'::timestamptz;
commit;

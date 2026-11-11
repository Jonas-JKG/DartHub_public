-- Run after 019. Existing handles and account IDs are preserved.
begin;
update public.managers set name='Admin' where id='00000000-0000-4000-8000-000000000001' and name='Owner';
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.managers'::regclass and contype='c' and pg_get_constraintdef(oid) like '%public_handle%' loop
 execute format('alter table public.managers drop constraint %I',c.conname);end loop;
end $$;
alter table public.managers add constraint managers_public_handle_check check(public_handle is null or public_handle ~ '^[a-zäöüß0-9_]{3,24}$');
create or replace function public.username_search_key(p_value text) returns text language sql immutable set search_path='' as $$
 select replace(replace(replace(replace(lower(normalize(trim(p_value),NFC)),'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss')
$$;
create or replace function public.reserve_player_username(p_handle text,p_email_key text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 p_handle:=lower(normalize(trim(p_handle),NFC));
 if p_handle !~ '^[a-zäöüß0-9_]{3,24}$' then raise exception 'Nutzername: 3–24 Zeichen, Buchstaben einschließlich Umlauten, Zahlen oder Unterstrich.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('username:'||p_handle));
 if exists(select 1 from public.managers where public_handle=p_handle) then return false;end if;
 delete from public.username_reservations where handle=p_handle and expires_at<=now();
 if exists(select 1 from public.username_reservations where handle=p_handle and email_key<>p_email_key) then return false;end if;
 insert into public.username_reservations values(p_handle,p_email_key,now()+interval '24 hours') on conflict(handle) do update set expires_at=excluded.expires_at;return true;
end $$;
create or replace function public.social_set_handle(p_hash text,p_handle text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 p_handle:=lower(normalize(trim(p_handle),NFC));
 if p_handle !~ '^[a-zäöüß0-9_]{3,24}$' then raise exception 'Nutzername: 3–24 Zeichen, Buchstaben einschließlich Umlauten, Zahlen oder Unterstrich.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('username:'||p_handle));
 if exists(select 1 from public.username_reservations where handle=p_handle and expires_at>now()) and not exists(select 1 from public.managers where id=account and public_handle=p_handle) then raise exception 'Dieser Nutzername ist bereits vergeben oder reserviert.' using errcode='22023';end if;
 begin update public.managers set public_handle=p_handle where id=account;exception when unique_violation then raise exception 'Dieser Nutzername ist bereits vergeben.' using errcode='22023';end;
end $$;
create or replace function public.player_search(p_hash text,p_query text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);query text:=public.username_search_key(p_query);begin
 if length(p_query)>24 or p_query<>'' and lower(normalize(p_query,NFC)) !~ '^[a-zäöüß0-9_]+$' then return '[]';end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)-'rank' order by q.friend desc,q.rank,q.handle),'[]') from(select m.id,m.public_handle as handle,m.public_handle as name,m.id=account as self,
 exists(select 1 from public.friendships f where f.status='accepted' and ((f.sender_id=account and f.receiver_id=m.id) or (f.receiver_id=account and f.sender_id=m.id))) friend,
 case when m.public_handle=lower(normalize(p_query,NFC)) then 0 when starts_with(public.username_search_key(m.public_handle),query) then 1 else 2 end as rank
 from public.managers m where m.enabled and m.approved and m.deletion_requested_at is null and m.public_handle is not null
 and (p_query='' or strpos(public.username_search_key(m.public_handle),query)>0)
 and (p_query<>'' or m.id=account or exists(select 1 from public.friendships f where f.status='accepted' and ((f.sender_id=account and f.receiver_id=m.id) or (f.receiver_id=account and f.sender_id=m.id))))
 order by friend desc,rank,m.public_handle limit 20)q);
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('username_search_key','reserve_player_username','social_set_handle','player_search') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

-- Run after 017. Preserve accounts, friendships and all tournament results.
begin;
alter table public.managers add column if not exists email_verified_at timestamptz;
alter table public.managers add column if not exists email_verified_address text;
alter table public.managers add column if not exists email_verification_required boolean not null default false;
-- An automatically confirmed Auth timestamp alone is not evidence of an email click.
-- Supabase installations have auth.users; local migration tests may not.
do $$ begin if to_regclass('auth.users') is not null then
 execute $sql$update public.managers m set
 email_verified_at=case when u.email_confirmed_at>=u.confirmation_sent_at and u.confirmation_sent_at is not null then u.email_confirmed_at else null end,
 email_verified_address=case when u.email_confirmed_at>=u.confirmation_sent_at and u.confirmation_sent_at is not null then lower(trim(u.email)) else null end,
 email_verification_required=not coalesce(u.email_confirmed_at>=u.confirmation_sent_at and u.confirmation_sent_at is not null,false)
 from auth.users u where u.id=m.id and m.id<>'00000000-0000-4000-8000-000000000001' and m.email_verified_at is null$sql$;
 end if;end $$;
do $$ begin if to_regprocedure('public.read_session_email_base(text)') is null then alter function public.read_session(text) rename to read_session_email_base;end if;end $$;
create or replace function public.read_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session_email_base(p_hash);account uuid;begin
 if s is null then return null;end if;
 account:=coalesce((s->>'account_manager_id')::uuid,(s->>'manager_id')::uuid);
 if account is not null and exists(select 1 from public.managers where id=account and email_verification_required) then return null;end if;
 return s;
end $$;
revoke all on function public.read_session_email_base(text) from public,anon,authenticated,service_role;
revoke all on function public.read_session(text) from public,anon,authenticated;
grant execute on function public.read_session(text) to service_role;
create or replace function public.social_snapshot(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return jsonb_build_object('accountId',account,'name',(select coalesce(public_handle,name) from public.managers where id=account),
 'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'accountId',m.id,'name',coalesce(m.public_handle,m.name),'status',f.status,'incoming',f.receiver_id=account,
 'online',case when f.status='accepted' then exists(select 1 from public.manager_presence pr where pr.manager_id=m.id and pr.last_seen>now()-interval '90 seconds' and public.read_session(pr.session_hash) is not null) else false end)),'[]') from public.friendships f join public.managers m on m.id=case when f.sender_id=account then f.receiver_id else f.sender_id end where (f.sender_id=account or f.receiver_id=account) and m.enabled and m.deletion_requested_at is null),
 'invitations',(select coalesce(jsonb_agg(x),'[]') from (
 select jsonb_build_object('id',i.id,'roomId',r.id,'name',t.state->>'name','from',coalesce(m.public_handle,m.name),'kind','training') x from public.training_invitations i join public.training_rooms r on r.id=i.room_id join public.tournaments t on t.id=r.id join public.managers m on m.id=i.sender_id where i.receiver_id=account and r.phase='waiting' and m.enabled and m.deletion_requested_at is null
 union all
 select jsonb_build_object('id',n.id,'roomId',t.id,'name',t.state->>'name','from',coalesce(m.public_handle,m.name),'kind','tournament') from public.tournament_account_notices n join public.tournaments t on t.id=n.tournament_id join public.managers m on m.id=t.manager_id where n.account_id=account and t.status<>'archived' and m.enabled and exists(select 1 from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version where l.manager_id=account and p.tournament_id=t.id and p.enabled)
 )q));
end $$;
create or replace function public.social_context(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if not exists(select 1 from public.tournaments t join public.managers m on m.id=t.manager_id where t.id=p_id and t.status<>'archived' and m.enabled and m.deletion_requested_at is null and
 (t.manager_id=account or account='00000000-0000-4000-8000-000000000001' or exists(select 1 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.manager_id=account and pc.tournament_id=p_id and pc.enabled))) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(m.public_handle,m.name))),'[]') from public.managers m where m.id<>account and m.enabled and m.deletion_requested_at is null and (m.id=(select manager_id from public.tournaments where id=p_id) or exists(select 1 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.manager_id=m.id and pc.tournament_id=p_id and pc.enabled) or exists(select 1 from public.sessions s where s.role='owner' and coalesce(s.manager_id,'00000000-0000-4000-8000-000000000001')=m.id and s.playing_tournament_id=p_id and s.participant_id is not null and public.read_session(s.token_hash) is not null)));
end $$;
create or replace function public.social_search_handle(p_hash text,p_handle text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select jsonb_build_object('id',id,'name',coalesce(public_handle,name),'handle',public_handle) from public.managers where public_handle=p_handle and id<>account and enabled and approved and deletion_requested_at is null);
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('social_snapshot','social_context','social_search_handle') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

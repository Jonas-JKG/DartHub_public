-- Run after 015. Existing accounts, friendships and saved Autodarts profiles stay intact.
begin;
create table if not exists public.account_email_cooldowns(key text primary key,until_at timestamptz not null);
create table if not exists public.username_reservations(handle text primary key,email_key text not null,expires_at timestamptz not null);
-- Account ownership replaces the old one-device-per-player restriction.
drop index if exists public.one_device_per_player;
do $$ declare tab text;begin
 foreach tab in array array['account_email_cooldowns','username_reservations'] loop
 execute format('alter table public.%I enable row level security',tab);execute format('revoke all on public.%I from public,anon,authenticated',tab);execute format('grant all on public.%I to service_role',tab);end loop;
 if to_regprocedure('public.read_session_player_base(text)') is null then alter function public.read_session(text) rename to read_session_player_base;end if;
end $$;
-- Old anonymous player/guest cookies must no longer authorize any endpoint.
create or replace function public.read_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare raw public.sessions;s jsonb;begin
 select * into raw from public.sessions where token_hash=p_hash;
 if not found or raw.role='viewer' or raw.guest_id is not null or raw.role='editor' and raw.account_session_hash is null then return null;end if;
 if raw.account_session_hash is not null and not exists(select 1 from public.sessions a where a.token_hash=raw.account_session_hash and a.role='owner' and a.guest_id is null and a.expires_at>now()) then return null;end if;
 s:=public.read_session_player_base(p_hash);
 if s->>'role'='owner' and s->>'manager_id' is not null then s:=s||jsonb_build_object('participant_id',null,'participant_ids','[]'::jsonb,'playing_tournament_id',null);end if;
 return s;
end $$;
create or replace function public.player_schema_ready() returns boolean language sql security definer set search_path='' as $$select true$$;
create or replace function public.account_email_wait(p_key text,p_claim boolean default false,p_seconds integer default 60) returns integer language plpgsql security definer set search_path='' as $$
declare remaining integer;begin
 perform pg_advisory_xact_lock(hashtext(p_key));
 select greatest(0,ceil(extract(epoch from until_at-now())))::integer into remaining from public.account_email_cooldowns where key=p_key;
 if coalesce(remaining,0)>0 then return remaining;end if;
 if p_claim then insert into public.account_email_cooldowns values(p_key,now()+make_interval(secs=>least(3600,greatest(1,p_seconds)))) on conflict(key) do update set until_at=excluded.until_at;end if;
 return 0;
end $$;
create or replace function public.account_email_backoff(p_key text,p_seconds integer) returns void language sql security definer set search_path='' as $$
 insert into public.account_email_cooldowns values(p_key,now()+make_interval(secs=>least(3600,greatest(1,p_seconds)))) on conflict(key) do update set until_at=greatest(public.account_email_cooldowns.until_at,excluded.until_at)
$$;
create or replace function public.reserve_player_username(p_handle text,p_email_key text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_handle !~ '^[a-z0-9_]{3,24}$' then raise exception 'Nutzername: 3–24 Zeichen, Buchstaben, Zahlen oder Unterstrich.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('username:'||p_handle));
 if exists(select 1 from public.managers where public_handle=p_handle) then return false;end if;
 delete from public.username_reservations where handle=p_handle and expires_at<=now();
 if exists(select 1 from public.username_reservations where handle=p_handle and email_key<>p_email_key) then return false;end if;
 insert into public.username_reservations values(p_handle,p_email_key,now()+interval '24 hours') on conflict(handle) do update set expires_at=excluded.expires_at;return true;
end $$;
do $$ begin if to_regprocedure('public.social_set_handle_player_base(text,text)') is null then alter function public.social_set_handle(text,text) rename to social_set_handle_player_base;end if;end $$;
create or replace function public.social_set_handle(p_hash text,p_handle text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 perform pg_advisory_xact_lock(hashtext('username:'||p_handle));
 if exists(select 1 from public.username_reservations where handle=p_handle and expires_at>now()) and not exists(select 1 from public.managers where id=account and public_handle=p_handle) then raise exception 'Dieser Nutzername ist bereits vergeben oder reserviert.' using errcode='22023';end if;
 perform public.social_set_handle_player_base(p_hash,p_handle);
end $$;
-- Only public usernames are searchable; no e-mail addresses or account secrets.
create or replace function public.player_search(p_hash text,p_query text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select coalesce(jsonb_agg(to_jsonb(q) order by q.friend desc,q.handle),'[]') from(select m.id,m.public_handle as handle,m.name,
 exists(select 1 from public.friendships f where f.status='accepted' and ((f.sender_id=account and f.receiver_id=m.id) or (f.receiver_id=account and f.sender_id=m.id))) friend
 from public.managers m where m.enabled and m.approved and m.deletion_requested_at is null and m.public_handle is not null
 and (m.public_handle like replace(replace(lower(trim(p_query)),'_','\_'),'%','\%')||'%' or p_query='')
 and (p_query<>'' or m.id=account or exists(select 1 from public.friendships f where f.status='accepted' and ((f.sender_id=account and f.receiver_id=m.id) or (f.receiver_id=account and f.sender_id=m.id))))
 order by friend desc,m.public_handle limit 20)q);
end $$;
-- Assign actual accounts in the same transaction that creates a tournament.
create or replace function public.create_account_tournament(p_hash text,p_state jsonb,p_credentials jsonb,p_accounts uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare pid uuid;aid uuid;member jsonb;i integer:=1;begin
 perform public.social_account(p_hash);
 if cardinality(p_accounts) is distinct from jsonb_array_length(p_state->'participants') or (select count(distinct x) from unnest(p_accounts)x)<>cardinality(p_accounts) then raise exception 'Bitte jeden Spieler genau einmal auswählen.' using errcode='22023';end if;
 for member in select value from jsonb_array_elements(p_state->'participants') loop
 aid:=p_accounts[i];
 if not exists(select 1 from public.managers where id=aid and enabled and approved and deletion_requested_at is null and public_handle=member->>'name') then raise exception 'Spielerkonto nicht verfügbar. Auswahl bitte neu laden.' using errcode='22023';end if;i:=i+1;
 end loop;
 perform public.create_tournament(p_state,p_credentials,p_hash);i:=1;
 for member in select value from jsonb_array_elements(p_state->'participants') loop
 insert into public.account_player_links(access_id,manager_id,version) select id,p_accounts[i],version from public.player_access_codes where tournament_id=(p_state->>'id')::uuid and participant_id=(member->>'id')::uuid;i:=i+1;
 end loop;
end $$;
-- A scoped session is derived only from this account's assigned participant.
-- It supports returning on another device without a personal player code.
create or replace function public.account_play_session(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);pc public.player_access_codes;child text;parent public.sessions;cached jsonb;begin
 if account='00000000-0000-4000-8000-000000000001' then return null;end if;
 select * into parent from public.sessions where token_hash=p_hash;
 select p.* into pc from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version join public.tournaments t on t.id=p.tournament_id join public.tournament_credentials c on c.tournament_id=t.id where l.manager_id=account and p.tournament_id=p_id and p.enabled and c.editor_enabled and t.status<>'archived' limit 1;
 if pc.id is null then return null;end if;
 child:=p_hash||':'||p_id::text;cached:=public.read_session(child);if cached is not null and cached->>'participant_id'=pc.participant_id::text then return cached;end if;
 insert into public.sessions(token_hash,role,manager_id,tournament_id,credential_version,expires_at,participant_id,participant_ids,playing_tournament_id,player_access_id,player_access_ids,player_access_versions,account_session_hash,training_id)
 select child,'editor',t.manager_id,p_id,pc.version,parent.expires_at,pc.participant_id,array[pc.participant_id],p_id,pc.id,array[pc.id],jsonb_build_object(pc.id::text,pc.version),p_hash,r.id from public.tournaments t left join public.training_rooms r on r.id=t.id where t.id=p_id
 on conflict(token_hash) do update set manager_id=excluded.manager_id,training_id=excluded.training_id,expires_at=excluded.expires_at,credential_version=excluded.credential_version,participant_id=excluded.participant_id,participant_ids=excluded.participant_ids,player_access_id=excluded.player_access_id,player_access_ids=excluded.player_access_ids,player_access_versions=excluded.player_access_versions;
 update public.training_seats set session_hash=child where room_id=p_id and access_id=pc.id and session_hash is distinct from child;
 return public.read_session(child);
end $$;
-- Joining via a link cannot claim another account's participant.
create or replace function public.join_account_invitation(p_hash text,p_code_hash text,p_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);tid uuid;seat public.training_seats;pc public.player_access_codes;st jsonb;username text;begin
 select tournament_id into tid from public.room_invitations where code_hash=p_code_hash and enabled and (p_id is null or tournament_id=p_id);
 if tid is null then select id into tid from public.training_rooms where invite_hash=p_code_hash and phase<>'closed' and (p_id is null or id=p_id);end if;
 if tid is null or not public.invitation_access(p_hash,tid,p_code_hash) then raise exception 'Einladung ungültig oder abgelaufen.' using errcode='42501';end if;
 perform 1 from public.tournaments where id=tid for update;
 if account='00000000-0000-4000-8000-000000000001' then return jsonb_build_object('id',tid,'training',exists(select 1 from public.training_rooms where id=tid));end if;
 if not exists(select 1 from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version where p.tournament_id=tid and l.manager_id=account) then
  select s.* into seat from public.training_seats s join public.training_rooms r on r.id=s.room_id where s.room_id=tid and r.phase='waiting' and not exists(select 1 from public.account_player_links l where l.access_id=s.access_id) order by s.position limit 1;
  if seat.access_id is null then raise exception 'Du bist hier noch nicht als Spieler eingetragen. Bitte den Ersteller kontaktieren.' using errcode='42501';end if;
  select * into pc from public.player_access_codes where id=seat.access_id;
  select coalesce(public_handle,name) into username from public.managers where id=account;
  select state into st from public.tournaments where id=tid;
  st:=st||jsonb_build_object('participants',(select jsonb_agg(case when x->>'id'=seat.participant_id::text then x||jsonb_build_object('name',username) else x end) from jsonb_array_elements(st->'participants')x),'version',(st->>'version')::integer+1,'updatedAt',now());
  update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=tid;perform public.sync_tournament(st);
  insert into public.account_player_links(access_id,manager_id,version) values(pc.id,account,pc.version);
 end if;
 perform public.account_play_session(p_hash,tid);
 return jsonb_build_object('id',tid,'training',exists(select 1 from public.training_rooms where id=tid));
end $$;
create or replace function public.tournament_account_players(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if not exists(select 1 from public.tournaments where id=p_id and (manager_id=account or account='00000000-0000-4000-8000-000000000001')) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'handle',m.public_handle,'name',m.name)),'[]') from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version join public.managers m on m.id=l.manager_id where p.tournament_id=p_id and m.public_handle is not null);
end $$;
do $$ begin if to_regprocedure('public.save_tournament_accounts_base(jsonb,integer,text,text,jsonb)') is null then alter function public.save_tournament(jsonb,integer,text,text,jsonb) rename to save_tournament_accounts_base;end if;end $$;
create or replace function public.save_tournament(p_state jsonb,p_expected integer,p_session_hash text,p_action text,p_detail jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare accounts uuid[];member jsonb;i integer:=1;begin
 if p_detail->>'action'='redraw' then
  select array_agg(x::uuid order by ord) into accounts from jsonb_array_elements_text(p_detail->'accounts') with ordinality a(x,ord);
  if cardinality(accounts) is distinct from jsonb_array_length(p_state->'participants') or (select count(distinct x) from unnest(accounts)x)<>cardinality(accounts) then raise exception 'Bitte Spielerkonten auswählen.' using errcode='22023';end if;
  for member in select value from jsonb_array_elements(p_state->'participants') loop
   if not exists(select 1 from public.managers where id=accounts[i] and public_handle=member->>'name' and enabled and approved and deletion_requested_at is null) then raise exception 'Spielerkonto nicht verfügbar.' using errcode='22023';end if;i:=i+1;
  end loop;
 end if;
 perform public.save_tournament_accounts_base(p_state,p_expected,p_session_hash,p_action,p_detail);
 if accounts is not null then
  delete from public.account_player_links where access_id in(select id from public.player_access_codes where tournament_id=(p_state->>'id')::uuid);i:=1;
  for member in select value from jsonb_array_elements(p_state->'participants') loop
   insert into public.account_player_links(access_id,manager_id,version) select id,accounts[i],version from public.player_access_codes where tournament_id=(p_state->>'id')::uuid and participant_id=(member->>'id')::uuid;i:=i+1;
  end loop;
 end if;
end $$;
create table if not exists public.tournament_spectator_links(tournament_id uuid primary key references public.tournaments(id) on delete cascade,token_hash text unique not null,secret text not null);
alter table public.tournament_spectator_links enable row level security;
revoke all on public.tournament_spectator_links from public,anon,authenticated;
grant all on public.tournament_spectator_links to service_role;
create or replace function public.manage_spectator_link(p_hash text,p_id uuid,p_token_hash text,p_secret text) returns text language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);result text;begin
 perform 1 from public.tournaments where id=p_id and (manager_id=account or account='00000000-0000-4000-8000-000000000001') for update;
 if not found then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 insert into public.tournament_spectator_links values(p_id,p_token_hash,p_secret) on conflict(tournament_id) do nothing;
 select secret into result from public.tournament_spectator_links where tournament_id=p_id;return result;
end $$;
-- Retire pending legacy identity transfers; account assignments are now explicit.
delete from public.player_claim_requests;
-- Revoke old guest sessions, retaining their data for a deliberate future migration.
delete from public.sessions where role='viewer' or guest_id is not null or role='editor' and account_session_hash is null;
-- This migration introduces no public table grants or anonymous RPC access.
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('read_session','read_session_player_base','player_schema_ready','account_email_wait','account_email_backoff','reserve_player_username','player_search','create_account_tournament','account_play_session','join_account_invitation','save_tournament','save_tournament_accounts_base','tournament_account_players','manage_spectator_link','social_set_handle','social_set_handle_player_base') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
commit;

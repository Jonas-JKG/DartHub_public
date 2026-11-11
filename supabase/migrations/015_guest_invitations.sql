-- Run after 014. Existing player codes remain valid during the transition.
begin;
create table if not exists public.guest_profiles(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 80),enabled boolean not null default true,created_at timestamptz not null default now());
alter table public.sessions add column if not exists guest_id uuid references public.guest_profiles(id) on delete cascade;
create table if not exists public.guest_player_links(access_id uuid primary key references public.player_access_codes(id) on delete cascade,guest_id uuid not null references public.guest_profiles(id) on delete cascade,version integer not null,created_at timestamptz not null default now());
create table if not exists public.room_invitations(tournament_id uuid primary key references public.tournaments(id) on delete cascade,code_hash text not null unique,code_secret text not null,enabled boolean not null default true);
create table if not exists public.player_claim_requests(id uuid primary key default gen_random_uuid(),access_id uuid not null references public.player_access_codes(id) on delete cascade,manager_id uuid references public.managers(id),guest_id uuid references public.guest_profiles(id) on delete cascade,version integer not null,status text not null default 'pending' check(status in('pending','approved')),created_at timestamptz not null default now(),check(num_nonnulls(manager_id,guest_id)=1));
create unique index if not exists player_claim_manager on public.player_claim_requests(access_id,manager_id);
create unique index if not exists player_claim_guest on public.player_claim_requests(access_id,guest_id);
alter table public.managers add column if not exists public_handle text unique check(public_handle is null or public_handle ~ '^[a-z0-9_]{3,24}$');
do $$ declare tab text;begin
 foreach tab in array array['guest_profiles','guest_player_links','room_invitations','player_claim_requests'] loop execute format('alter table public.%I enable row level security',tab);execute format('revoke all on public.%I from public,anon,authenticated',tab);execute format('grant all on public.%I to service_role',tab);end loop;
 if to_regprocedure('public.read_session_identity_base(text)') is null then alter function public.read_session(text) rename to read_session_identity_base;end if;
end $$;
create or replace function public.read_guest_session(p_hash text) returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('role','guest','guest_name',g.name) from public.sessions s join public.guest_profiles g on g.id=s.guest_id where s.token_hash=p_hash and s.role='viewer' and s.account_session_hash is null and s.expires_at>now() and g.enabled
$$;
create or replace function public.read_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;parent_hash text;parent jsonb;action jsonb;begin
 s:=public.read_guest_session(p_hash);if s is not null then return s;end if;
 select account_session_hash into parent_hash from public.sessions where token_hash=p_hash;
 if parent_hash is not null then
  parent:=public.read_guest_session(parent_hash);
  if parent is not null then
   s:=public.read_session_context_base(p_hash);if s is null then return null;end if;
   if s->>'training_id' is not null and not exists(select 1 from public.training_rooms where id=(s->>'training_id')::uuid and phase<>'closed') then return null;end if;
   if exists(select 1 from jsonb_array_elements_text(coalesce(s->'player_access_ids','[]')||jsonb_build_array(s->>'player_access_id')) aid where not exists(select 1 from public.guest_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.access_id=aid::uuid and l.guest_id=(parent->>'guest_id')::uuid)) then return null;end if;
   return s||jsonb_build_object('guest_id',parent->>'guest_id','guest_name',parent->>'guest_name');
  end if;
 end if;
 s:=public.read_session_identity_base(p_hash);
 if s->>'role'='owner' and s->>'manager_id' is null then
  s:=s||jsonb_build_object('participant_ids',coalesce(s->'remembered_participant_ids','[]'),'participant_id',s->'remembered_participant_ids'->>0,'playing_tournament_id',case when jsonb_array_length(coalesce(s->'remembered_participant_ids','[]'))>0 then s->>'remembered_tournament_id' else null end);
  action:=nullif(current_setting('dartbracket.owner_action',true),'')::jsonb;
  if action->>'hash'=p_hash then s:=s||jsonb_build_object('participant_id',action->>'actor','participant_ids',jsonb_build_array(action->>'actor'),'playing_tournament_id',action->>'id');end if;
 end if;return s;
end $$;
create or replace function public.identity_schema_ready() returns boolean language sql security definer set search_path='' as $$select true$$;
create or replace function public.create_guest_identity(p_hash text,p_name text,p_expires timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare gid uuid;begin
 if length(trim(p_name)) not between 1 and 80 or p_expires>now()+interval '366 days' or p_expires<=now() then raise exception 'Bitte einen Gastnamen eingeben' using errcode='22023';end if;
 insert into public.guest_profiles(name) values(trim(p_name)) returning id into gid;
 insert into public.sessions(token_hash,role,guest_id,credential_version,expires_at) values(p_hash,'viewer',gid,1,p_expires);return gid;
end $$;
create or replace function public.identity_info(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);begin
 if s is null or s->>'role' not in('owner','guest') then raise exception 'Bitte anmelden oder als Gast fortfahren' using errcode='42501';end if;
 return jsonb_build_object('managerId',case when s->>'role'='owner' then coalesce(s->>'manager_id','00000000-0000-4000-8000-000000000001') else null end,'guestId',case when s->>'role'='guest' then s->>'guest_id' else null end,'owner',s->>'role'='owner' and s->>'manager_id' is null);
end $$;
create or replace function public.identity_owns_player(p_identity jsonb,p_access uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.account_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.access_id=p_access and l.manager_id=(p_identity->>'managerId')::uuid)
 or exists(select 1 from public.guest_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version where l.access_id=p_access and l.guest_id=(p_identity->>'guestId')::uuid)
$$;
create or replace function public.manage_room_invitation(p_hash text,p_id uuid,p_code_hash text,p_secret text) returns text language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);secret text;begin
 perform 1 from public.tournaments where id=p_id and (manager_id=account or account='00000000-0000-4000-8000-000000000001') and status<>'archived' for update;if not found then raise exception 'Nur der Ersteller oder Owner darf einladen' using errcode='42501';end if;
 insert into public.room_invitations(tournament_id,code_hash,code_secret) values(p_id,p_code_hash,p_secret) on conflict(tournament_id) do nothing;
 select code_secret into secret from public.room_invitations where tournament_id=p_id and enabled;return secret;
end $$;
create or replace function public.invitation_access(p_hash text,p_id uuid,p_code_hash text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);begin
 return (identity->>'owner')::boolean or exists(select 1 from public.tournaments t join public.tournament_credentials c on c.tournament_id=t.id join public.managers m on m.id=t.manager_id left join public.room_invitations i on i.tournament_id=t.id left join public.training_rooms r on r.id=t.id where t.id=p_id and ((i.code_hash=p_code_hash and i.enabled) or (r.invite_hash=p_code_hash and r.phase<>'closed')) and t.status<>'archived' and c.editor_enabled and m.enabled and m.approved and m.deletion_requested_at is null and coalesce(r.phase,'waiting')<>'closed');
end $$;
create or replace function public.invitation_preview(p_hash text,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;identity jsonb:=public.identity_info(p_hash);result jsonb;begin
 select tournament_id into tid from public.room_invitations where code_hash=p_code_hash and enabled;
 if tid is null or not public.invitation_access(p_hash,tid,p_code_hash) then raise exception 'Einladung ungültig oder nicht mehr verfügbar' using errcode='42501';end if;
 select jsonb_build_object('id',t.id,'name',t.state->>'name','training',t.state->>'kind'='training','manager',m.name,'rules',t.state->'scoring','players',(select jsonb_agg(jsonb_build_object('id',pc.participant_id,'name',p->>'name','mine',public.identity_owns_player(identity,pc.id),'occupied',exists(select 1 from public.account_player_links l where l.access_id=pc.id and l.version=pc.version) or exists(select 1 from public.guest_player_links l where l.access_id=pc.id and l.version=pc.version) or exists(select 1 from public.sessions s where pc.participant_id=any(s.participant_ids) and coalesce(s.playing_tournament_id,s.tournament_id)=t.id and s.expires_at>now() and public.read_session(s.token_hash) is not null))) from public.player_access_codes pc join lateral jsonb_array_elements(t.state->'participants') p on p->>'id'=pc.participant_id::text where pc.tournament_id=t.id and pc.enabled)) into result from public.tournaments t join public.managers m on m.id=t.manager_id where t.id=tid;return result;
end $$;
create or replace function public.identity_activate_players(p_hash text,p_id uuid,p_players uuid[],p_token_hash text,p_expires timestamptz,p_takeover boolean default false,p_old_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);pc public.player_access_codes;pid uuid;first_code boolean:=true;result jsonb;begin
 if identity->>'guestId' is null then perform public.activate_account_players(p_hash,p_id,p_players,p_token_hash,p_expires,p_takeover,p_old_hash);return;end if;
 perform 1 from public.tournaments where id=p_id for update;
 if p_players is null or cardinality(p_players) not between 1 and 20 or (select count(distinct x) from unnest(p_players) x)<>cardinality(p_players) then raise exception 'Ungültige Spielerauswahl' using errcode='22023';end if;
 if p_old_hash is not null then delete from public.sessions where token_hash=p_old_hash and account_session_hash=p_hash;end if;
 foreach pid in array p_players loop
  select * into pc from public.player_access_codes where tournament_id=p_id and participant_id=pid and enabled;
  if not public.identity_owns_player(identity,pc.id) then raise exception 'Spieler gehört nicht zu diesem Gastzugang' using errcode='42501';end if;
  if first_code then result:=public.login_player_session(pc.code_hash,p_token_hash,p_expires,p_takeover);if result is null then raise exception 'Spieler nicht verfügbar' using errcode='42501';end if;update public.sessions set account_session_hash=p_hash where token_hash=p_token_hash;first_code:=false;
  else perform public.add_device_player_training_base(p_token_hash,pc.code_hash,p_takeover);end if;
 end loop;
 update public.training_seats set session_hash=p_token_hash where room_id=p_id and participant_id=any(p_players);
end $$;
create or replace function public.claim_invitation_player(p_hash text,p_id uuid,p_code_hash text,p_player uuid,p_token_hash text,p_expires timestamptz,p_takeover boolean default false,p_old_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);pc public.player_access_codes;occupied boolean;approved boolean;request_id uuid;st jsonb;guest_name text;begin
 if not public.invitation_access(p_hash,p_id,p_code_hash) then raise exception 'Einladung ungültig' using errcode='42501';end if;
 perform 1 from public.tournaments where id=p_id for update;
 if (identity->>'owner')::boolean then return jsonb_build_object('ok',true,'owner',true);end if;
 select * into pc from public.player_access_codes where tournament_id=p_id and participant_id=p_player and enabled for update;
 if not found then raise exception 'Spieler nicht verfügbar' using errcode='42501';end if;
 delete from public.guest_player_links where access_id=pc.id and version<>pc.version;delete from public.account_player_links where access_id=pc.id and version<>pc.version;delete from public.player_claim_requests where access_id=pc.id and version<>pc.version;
 occupied:=not public.identity_owns_player(identity,pc.id) and (exists(select 1 from public.account_player_links where access_id=pc.id and version=pc.version) or exists(select 1 from public.guest_player_links where access_id=pc.id and version=pc.version) or exists(select 1 from public.sessions s where coalesce(s.playing_tournament_id,s.tournament_id)=p_id and pc.participant_id=any(s.participant_ids) and s.expires_at>now() and public.read_session(s.token_hash) is not null));
 select exists(select 1 from public.player_claim_requests where access_id=pc.id and version=pc.version and status='approved' and (manager_id=(identity->>'managerId')::uuid or guest_id=(identity->>'guestId')::uuid)) into approved;
 if occupied and not p_takeover then return jsonb_build_object('needsTakeover',true,'online',public.player_holder_online(pc.id));end if;
 if occupied and public.player_holder_online(pc.id) and not approved then
  select id into request_id from public.player_claim_requests where access_id=pc.id and (manager_id=(identity->>'managerId')::uuid or guest_id=(identity->>'guestId')::uuid);
  if request_id is null then insert into public.player_claim_requests(access_id,manager_id,guest_id,version) values(pc.id,(identity->>'managerId')::uuid,(identity->>'guestId')::uuid,pc.version) returning id into request_id;end if;
  return jsonb_build_object('pending',true,'requestId',request_id);
 end if;
 if occupied then
  delete from public.sessions where role='editor' and (player_access_id=pc.id or pc.id=any(player_access_ids));
  update public.sessions set participant_id=null,participant_ids='{}',playing_tournament_id=null where role='owner' and playing_tournament_id=p_id and pc.participant_id=any(participant_ids);
  delete from public.account_player_links where access_id=pc.id;delete from public.guest_player_links where access_id=pc.id;
  update public.player_access_codes set version=version+1 where id=pc.id returning * into pc;
 end if;
 if identity->>'guestId' is not null then insert into public.guest_player_links(access_id,guest_id,version) values(pc.id,(identity->>'guestId')::uuid,pc.version) on conflict(access_id) do update set version=excluded.version;
 else insert into public.account_player_links(access_id,manager_id,version) values(pc.id,(identity->>'managerId')::uuid,pc.version) on conflict(access_id) do update set version=excluded.version;end if;
 -- A free training seat adopts the guest/account name; tournament names stay intact.
 select state into st from public.tournaments where id=p_id;
 if st->>'kind'='training' and st->>'status'='planned' then
  if identity->>'guestId' is not null then select name into guest_name from public.guest_profiles where id=(identity->>'guestId')::uuid;else select name into guest_name from public.managers where id=(identity->>'managerId')::uuid;end if;
  if exists(select 1 from jsonb_array_elements(st->'participants') x where x->>'id'<>p_player::text and lower(x->>'name')=lower(guest_name)) then guest_name:=left(guest_name,74)||' (Gast)';end if;
  st:=st||jsonb_build_object('participants',(select jsonb_agg(case when x->>'id'=p_player::text then x||jsonb_build_object('name',guest_name) else x end) from jsonb_array_elements(st->'participants') x),'version',(st->>'version')::integer+1,'updatedAt',now());
  update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 end if;
 perform public.identity_activate_players(p_hash,p_id,array[p_player],p_token_hash,p_expires,p_takeover,p_old_hash);
 delete from public.player_claim_requests where access_id=pc.id and (manager_id=(identity->>'managerId')::uuid or guest_id=(identity->>'guestId')::uuid);
 return jsonb_build_object('ok',true,'training',st->>'kind'='training');
end $$;
create or replace function public.guest_linked_tournaments(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);begin
 return (select coalesce(jsonb_agg(item),'[]') from(select t.state||jsonb_build_object('managerId',t.manager_id,'managerName',m.name,'linkedParticipantIds',jsonb_agg(pc.participant_id)) item from public.guest_player_links l join public.player_access_codes pc on pc.id=l.access_id and pc.version=l.version join public.tournaments t on t.id=pc.tournament_id join public.managers m on m.id=t.manager_id join public.tournament_credentials c on c.tournament_id=t.id where l.guest_id=(identity->>'guestId')::uuid and pc.enabled and c.editor_enabled and t.status<>'archived' and m.enabled and m.approved and m.deletion_requested_at is null and coalesce(t.state->>'kind','')<>'training' group by t.id,m.name)q);
end $$;
create table if not exists public.identity_presence(session_hash text primary key references public.sessions(token_hash) on delete cascade,last_seen timestamptz not null default now());
create table if not exists public.match_presence(session_hash text not null references public.sessions(token_hash) on delete cascade,tournament_id uuid not null references public.tournaments(id) on delete cascade,match_id text not null,players uuid[] not null,last_seen timestamptz not null default now(),primary key(session_hash,tournament_id,match_id));
create index if not exists match_presence_lookup on public.match_presence(tournament_id,match_id,last_seen);
create index if not exists guest_links_identity on public.guest_player_links(guest_id);
create index if not exists account_links_identity on public.account_player_links(manager_id);
alter table public.identity_presence enable row level security;alter table public.match_presence enable row level security;
revoke all on public.identity_presence,public.match_presence from public,anon,authenticated;grant all on public.identity_presence,public.match_presence to service_role;
create or replace function public.identity_heartbeat(p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin if public.read_session(p_hash) is null then raise exception 'Nicht angemeldet' using errcode='28000';end if;insert into public.identity_presence(session_hash) values(p_hash) on conflict(session_hash) do update set last_seen=now();delete from public.identity_presence where last_seen<now()-interval '1 day';end $$;
create or replace function public.identity_controls_access(p_hash text,p_access uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);identity jsonb;pc public.player_access_codes;begin
 if s is null then return false;end if;
 if s->>'role'='owner' and s->>'manager_id' is null then return public.identity_owns_player(public.identity_info(p_hash),p_access);end if;
 if s->>'role' in('owner','guest') then identity:=public.identity_info(p_hash);if public.identity_owns_player(identity,p_access) then return true;end if;end if;
 select * into pc from public.player_access_codes where id=p_access;
 return coalesce(s->'participant_ids' ? pc.participant_id::text and coalesce(s->>'playing_tournament_id',s->>'tournament_id')=pc.tournament_id::text,false);
end $$;
create or replace function public.player_holder_online(p_access uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.identity_presence pr where pr.last_seen>now()-interval '45 seconds' and public.identity_controls_access(pr.session_hash,p_access)) or exists(select 1 from public.match_presence pr join public.player_access_codes pc on pc.id=p_access and pc.tournament_id=pr.tournament_id where pr.last_seen>now()-interval '15 seconds' and pc.participant_id=any(pr.players) and public.identity_controls_access(pr.session_hash,p_access))
$$;
create or replace function public.review_player_claim(p_hash text,p_request uuid,p_accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare aid uuid;begin
 select r.access_id into aid from public.player_claim_requests r join public.player_access_codes pc on pc.id=r.access_id and pc.version=r.version where r.id=p_request for update of r;
 if aid is null or not public.identity_controls_access(p_hash,aid) then raise exception 'Nur der bisherige Spieler kann den Wechsel freigeben' using errcode='42501';end if;
 if p_accept then update public.player_claim_requests set status='approved' where id=p_request;else delete from public.player_claim_requests where id=p_request;end if;
end $$;
-- Owner choices are preferences, never reservations that evict a real player.
do $$ begin if to_regprocedure('public.choose_device_players_identity_base(text,uuid,uuid[],boolean)') is null then alter function public.choose_device_players(text,uuid,uuid[],boolean) rename to choose_device_players_identity_base;end if;end $$;
create or replace function public.choose_device_players(p_hash text,p_id uuid,p_players uuid[],p_takeover boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);begin
 perform 1 from public.tournaments where id=p_id and status<>'archived' for update;if not found then raise exception 'Turnier nicht verfügbar' using errcode='42501';end if;
 if s->>'role'='owner' and s->>'manager_id' is null then
  if p_players is null or cardinality(p_players)>20 or exists(select 1 from unnest(p_players) p where p is null) or (select count(distinct p) from unnest(p_players) p)<>cardinality(p_players) or exists(select 1 from unnest(p_players) p where not exists(select 1 from public.tournaments t,jsonb_array_elements(t.state->'participants') x where t.id=p_id and x->>'id'=p::text)) then raise exception 'Ungültige Spielerauswahl' using errcode='22023';end if;
  update public.sessions set remembered_tournament_id=p_id,remembered_participant_ids=p_players,participant_id=null,participant_ids='{}',playing_tournament_id=null where token_hash=p_hash;
  insert into public.manager_player_choices(manager_id,tournament_id,participant_ids) values('00000000-0000-4000-8000-000000000001',p_id,p_players) on conflict(manager_id,tournament_id) do update set participant_ids=excluded.participant_ids,updated_at=now();return;
 end if;
 if s->>'role'='owner' and exists(select 1 from public.player_access_codes pc where pc.tournament_id=p_id and pc.participant_id=any(p_players) and (exists(select 1 from public.guest_player_links where access_id=pc.id and version=pc.version) or exists(select 1 from public.account_player_links where access_id=pc.id and version=pc.version and manager_id<>(s->>'manager_id')::uuid) or (public.player_holder_online(pc.id) and not(coalesce(s->'participant_ids','[]') ? pc.participant_id::text)))) then if not p_takeover then raise exception 'PLAYER_IN_USE' using errcode='P0001';end if;raise exception 'Bitte über die gemeinsame Einladung beitreten und den Spielerwechsel freigeben lassen' using errcode='42501';end if;
 perform public.choose_device_players_identity_base(p_hash,p_id,p_players,p_takeover);
end $$;
update public.sessions set remembered_tournament_id=playing_tournament_id,remembered_participant_ids=participant_ids where role='owner' and manager_id is null and cardinality(participant_ids)>0;
update public.sessions set participant_id=null,participant_ids='{}',playing_tournament_id=null where role='owner' and manager_id is null;
create or replace function public.identity_snapshot(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);begin
 if s is null then return jsonb_build_object('signedIn',false);end if;
 return jsonb_build_object('signedIn',true,'role',case when s->>'role'='owner' then case when s->>'manager_id' is null then 'owner' else 'manager' end when s->>'role'='guest' then 'guest' else 'player' end,'name',case when s->>'role'='guest' then s->>'guest_name' when s->>'role'='owner' then (select name from public.managers where id=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001')) else 'Spieler' end,
 'takeovers',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',coalesce(m.name,g.name),'tournament',t.state->>'name','player',(select x->>'name' from jsonb_array_elements(t.state->'participants') x where x->>'id'=pc.participant_id::text))),'[]') from public.player_claim_requests r join public.player_access_codes pc on pc.id=r.access_id and pc.version=r.version join public.tournaments t on t.id=pc.tournament_id left join public.managers m on m.id=r.manager_id left join public.guest_profiles g on g.id=r.guest_id where r.status='pending' and public.identity_controls_access(p_hash,pc.id) and not public.identity_owns_player(jsonb_build_object('managerId',r.manager_id,'guestId',r.guest_id),pc.id)));
end $$;
create or replace function public.social_set_handle(p_hash text,p_handle text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if p_handle !~ '^[a-z0-9_]{3,24}$' then raise exception '3–24 Zeichen: Kleinbuchstaben, Zahlen oder Unterstrich' using errcode='22023';end if;
 begin update public.managers set public_handle=p_handle where id=account;exception when unique_violation then raise exception 'Dieser Nutzername ist bereits vergeben' using errcode='22023';end;
end $$;
create or replace function public.social_search_handle(p_hash text,p_handle text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select jsonb_build_object('id',id,'name',name,'handle',public_handle) from public.managers where public_handle=p_handle and id<>account and enabled and approved and deletion_requested_at is null);
end $$;
-- An exact public handle is an intentional friend request, not a public directory.
create or replace function public.social_request_handle(p_hash text,p_handle text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);target jsonb:=public.social_search_handle(p_hash,p_handle);begin
 if target is null then raise exception 'Nutzername nicht gefunden' using errcode='42501';end if;
 insert into public.friendships(sender_id,receiver_id) values(account,(target->>'id')::uuid) on conflict do nothing;
end $$;
create or replace function public.start_training_match(p_hash text,p_id uuid,p_game jsonb) returns void language plpgsql security definer set search_path='' as $$
declare room public.training_rooms;st jsonb;s jsonb:=public.read_session(p_hash);host boolean;begin
 select * into room from public.training_rooms where id=p_id for update;
 host:=s->>'role'='owner' and (s->>'manager_id' is null or s->>'manager_id'=room.host_manager_id::text);
 if not coalesce(host,false) and not coalesce(s->>'training_id'=p_id::text and s->>'role'='editor' and exists(select 1 from public.training_seats seat where seat.room_id=p_id and s->'participant_ids' ? seat.participant_id::text),false) then raise exception 'Nur Lobby-Spieler dürfen das Match starten' using errcode='42501';end if;
 if room.phase<>'waiting' then raise exception 'Die Lobby ist nicht startbereit' using errcode='55000';end if;
 if (select count(*) from public.training_seats seat where seat.room_id=p_id and public.training_seat_ready(seat.session_hash,seat.participant_id))<>2 then raise exception 'Beide Spieler müssen bereit sein' using errcode='55000';end if;
 select state into st from public.tournaments where id=p_id for update;
 if p_game->'players' is distinct from st->'matches'->0->'players' or p_game->'rules' is distinct from st->'scoring' or p_game->>'phase' is distinct from 'bull' or p_game->>'version' is distinct from '1' then raise exception 'Ungültiger Spielstart' using errcode='22023';end if;
 st:=jsonb_set(st,'{matches,0,status}','"running"')||jsonb_build_object('status','running','startedAt',now(),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,status='running',version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 insert into public.match_games(tournament_id,match_id,state,version) values(p_id,room.match_id,p_game,1);
 update public.training_rooms set phase='playing',updated_at=now() where id=p_id;
end $$;

alter table public.saved_autodarts add column if not exists guest_id uuid unique references public.guest_profiles(id) on delete cascade;
do $$ declare c record;begin for c in select conname from pg_constraint where conrelid='public.saved_autodarts'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%manager_id%' or pg_get_constraintdef(oid) like '%num_nonnulls%') loop execute format('alter table public.saved_autodarts drop constraint %I',c.conname);end loop;end $$;
alter table public.saved_autodarts add constraint saved_autodarts_identity check(num_nonnulls(manager_id,player_access_id,guest_id)=1);
create or replace function public.autodarts_profile(p_hash text,p_operation text,p_secret text default null,p_board text default null,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb;manager uuid;player uuid;guest uuid;profile public.saved_autodarts;account_key text;
begin
 s:=public.read_session(p_hash);
 if s is null then raise exception 'Nicht angemeldet' using errcode='28000';end if;
 if s->>'guest_id' is not null and s->>'role' in('guest','editor') then guest:=(s->>'guest_id')::uuid;account_key:='guest:'||guest;
 elsif s->>'role'='owner' then manager:=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001');account_key:='manager:'||manager;
 elsif s->>'role'='editor' and s->>'account_manager_id' is not null then manager:=(s->>'account_manager_id')::uuid;account_key:='manager:'||manager;
 elsif s->>'role'='editor' and s->>'player_access_id' is not null then player:=(s->>'player_access_id')::uuid;account_key:='player:'||player;
 else raise exception 'Keine Berechtigung' using errcode='42501';end if;
 select * into profile from public.saved_autodarts where manager_id=manager or player_access_id=player or guest_id=guest for update;
 if p_operation='read' then
  return jsonb_build_object('accountKey',account_key,'linked',profile.id is not null,'boardId',profile.board_id,'autoConnect',coalesce(profile.auto_connect,false));
 elsif p_operation='unlink' then
  delete from public.saved_autodarts where id=profile.id;return jsonb_build_object('ok',true);
 elsif p_operation='pause' then
  update public.saved_autodarts set auto_connect=false,updated_at=now() where id=profile.id;return jsonb_build_object('ok',true);
 elsif p_operation='link' then
  if p_secret is null or length(p_secret) not between 1 and 8000 then raise exception 'Ungültige Verknüpfung' using errcode='22023';end if;
  if profile.id is null then insert into public.saved_autodarts(manager_id,player_access_id,guest_id,refresh_secret) values(manager,player,guest,p_secret);
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


create or replace function public.match_player_presence(p_hash text,p_id uuid,p_match text,p_players uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);st jsonb;m jsonb;begin
 select state into st from public.tournaments where id=p_id for update;
 if s is null or s->>'role' not in('editor','owner') then raise exception 'Nicht als Spieler angemeldet' using errcode='42501';end if;
 select x into m from jsonb_array_elements(st->'matches') x where x->>'id'=p_match;
 if m is null then raise exception 'Match nicht verfügbar' using errcode='42501';end if;
 if (s->>'role'='owner' and s->>'manager_id' is null) or s->>'account_manager_id'='00000000-0000-4000-8000-000000000001' then p_players:='{}';
 elsif coalesce(s->>'playing_tournament_id',s->>'tournament_id')<>p_id::text or exists(select 1 from unnest(p_players) pid where not coalesce(s->'participant_ids' ? pid::text,false) or not(m->'players' ? pid::text)) then raise exception 'Nur die eigenen Spieler können als anwesend gemeldet werden' using errcode='42501';end if;
 insert into public.match_presence(session_hash,tournament_id,match_id,players) values(p_hash,p_id,p_match,p_players) on conflict(session_hash,tournament_id,match_id) do update set players=excluded.players,last_seen=now();
end $$;
create or replace function public.owner_available_players(p_hash text,p_id uuid,p_match text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);m jsonb;begin
 if s is null or s->>'role'<>'owner' or s->>'manager_id' is not null then raise exception 'Nur der Owner' using errcode='42501';end if;
 select x into m from public.tournaments t,jsonb_array_elements(t.state->'matches') x where t.id=p_id and t.status<>'archived' and x->>'id'=p_match;
 if m is null then return '[]';end if;
 return (select coalesce(jsonb_agg(pid),'[]') from jsonb_array_elements_text(m->'players') pid where pid is not null and not exists(select 1 from public.match_presence pr where pr.tournament_id=p_id and pr.match_id=p_match and pr.players @> array[pid::uuid] and pr.last_seen>now()-interval '15 seconds' and public.read_session(pr.session_hash) is not null));
end $$;
create or replace function public.write_owner_game(p_id uuid,p_match text,p_expected integer,p_hash text,p_actor uuid,p_state jsonb,p_tournament jsonb default null,p_tournament_expected integer default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tournaments where id=p_id for update;
 if not(public.owner_available_players(p_hash,p_id,p_match) ? p_actor::text) then raise exception 'Dieser Spieler steuert seine Seite selbst. Du schaust zu.' using errcode='42501';end if;
 perform set_config('dartbracket.owner_action',jsonb_build_object('hash',p_hash,'id',p_id,'actor',p_actor)::text,true);
 perform public.write_game(p_id,p_match,p_expected,p_hash,p_state,p_tournament,p_tournament_expected);
 perform set_config('dartbracket.owner_action','',true);
end $$;
create or replace function public.write_owner_board_image(p_id uuid,p_match text,p_hash text,p_actor uuid,p_connection uuid,p_visit text,p_operation text,p_image text,p_frame_at timestamptz,p_empty boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare accepted boolean;old_player uuid;begin
 perform 1 from public.tournaments where id=p_id for update;
 select participant_id into old_player from public.sessions where token_hash=p_hash for update;
 if not(public.owner_available_players(p_hash,p_id,p_match) ? p_actor::text) then raise exception 'Spieler ist selbst anwesend' using errcode='42501';end if;
 perform set_config('dartbracket.owner_action',jsonb_build_object('hash',p_hash,'id',p_id,'actor',p_actor)::text,true);
 accepted:=public.write_cached_board_image(p_id,p_match,p_hash,p_actor,p_connection,p_visit,p_operation,p_image,p_frame_at,p_empty);
 update public.sessions set participant_id=old_player where token_hash=p_hash;
 perform set_config('dartbracket.owner_action','',true);return accepted;
end $$;
create or replace function public.identity_player_links(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);begin
 return (select coalesce(jsonb_agg(jsonb_build_object('accessId',pc.id,'tournamentId',t.id,'name',t.state->>'name','training',coalesce(t.state->>'kind','')='training','participantId',pc.participant_id,'player',(select p->>'name' from jsonb_array_elements(t.state->'participants') p where p->>'id'=pc.participant_id::text))),'[]') from public.player_access_codes pc join public.tournaments t on t.id=pc.tournament_id join public.tournament_credentials c on c.tournament_id=t.id join public.managers m on m.id=t.manager_id where public.identity_owns_player(identity,pc.id) and pc.enabled and c.editor_enabled and t.status<>'archived' and m.enabled and m.approved and m.deletion_requested_at is null);
end $$;
create or replace function public.identity_unlink_player(p_hash text,p_access uuid) returns void language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);begin
 if not public.identity_owns_player(identity,p_access) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 delete from public.guest_player_links where access_id=p_access and guest_id=(identity->>'guestId')::uuid;
 delete from public.account_player_links where access_id=p_access and manager_id=(identity->>'managerId')::uuid;
 delete from public.sessions where role='editor' and (player_access_id=p_access or p_access=any(player_access_ids));
end $$;
create or replace function public.my_training_rooms(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);begin
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'host',(identity->>'owner')::boolean or r.host_manager_id=(identity->>'managerId')::uuid,'phase',r.phase,'round',r.round,'tournament',jsonb_build_object('state',t.state)) order by r.updated_at desc),'[]') from public.training_rooms r join public.tournaments t on t.id=r.id join public.managers m on m.id=t.manager_id where (identity->>'owner')::boolean or r.host_manager_id=(identity->>'managerId')::uuid or (r.phase<>'closed' and m.enabled and m.approved and m.deletion_requested_at is null and exists(select 1 from public.training_seats seat where seat.room_id=r.id and public.identity_owns_player(identity,seat.access_id))));
end $$;
create or replace function public.invitation_claim_status(p_hash text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity jsonb:=public.identity_info(p_hash);result jsonb;begin
 select jsonb_build_object('status',r.status) into result from public.player_claim_requests r join public.player_access_codes pc on pc.id=r.access_id and pc.version=r.version where r.id=p_request and (r.manager_id=(identity->>'managerId')::uuid or r.guest_id=(identity->>'guestId')::uuid);return coalesce(result,jsonb_build_object('status','missing'));
end $$;
create or replace function public.social_self_handle(p_hash text) returns text language sql security definer set search_path='' as $$select public_handle from public.managers where id=public.social_account(p_hash)$$;
create or replace function public.identity_code_claimed(p_code_hash text) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.player_access_codes pc where pc.code_hash=p_code_hash and (exists(select 1 from public.account_player_links l where l.access_id=pc.id and l.version=pc.version) or exists(select 1 from public.guest_player_links l where l.access_id=pc.id and l.version=pc.version) or public.player_holder_online(pc.id)))
$$;
-- Legacy personal-code endpoints must not bypass a guest's ownership or an online holder's approval.
do $$ begin if to_regprocedure('public.link_player_account_identity_base(text,text)') is null then alter function public.link_player_account(text,text) rename to link_player_account_identity_base;end if;end $$;
create or replace function public.link_player_account(p_hash text,p_code_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);pc public.player_access_codes;begin
 perform 1 from public.tournaments where id=(select tournament_id from public.player_access_codes where code_hash=p_code_hash) for update;
 select * into pc from public.player_access_codes where code_hash=p_code_hash;
 if exists(select 1 from public.guest_player_links where access_id=pc.id and version=pc.version) or (public.player_holder_online(pc.id) and not exists(select 1 from public.account_player_links where access_id=pc.id and manager_id=account and version=pc.version)) then raise exception 'Bitte die gemeinsame Einladung verwenden und den Spielerwechsel freigeben lassen' using errcode='42501';end if;
 return public.link_player_account_identity_base(p_hash,p_code_hash);
end $$;
do $$ begin if to_regprocedure('public.prepare_manager_deletion_identity_base(text,uuid)') is null then alter function public.prepare_manager_deletion(text,uuid) rename to prepare_manager_deletion_identity_base;end if;end $$;
create or replace function public.prepare_manager_deletion(p_hash text,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if public.social_account(p_hash)<>'00000000-0000-4000-8000-000000000001' or p_id='00000000-0000-4000-8000-000000000001' then raise exception 'Nur der Owner darf Manager löschen' using errcode='42501';end if;
 delete from public.player_claim_requests where manager_id=p_id;update public.managers set public_handle=null where id=p_id;
 return public.prepare_manager_deletion_identity_base(p_hash,p_id);
end $$;
do $$ begin if to_regprocedure('public.write_game_presence_base(uuid,text,integer,text,jsonb,jsonb,integer)') is null then alter function public.write_game(uuid,text,integer,text,jsonb,jsonb,integer) rename to write_game_presence_base;end if;end $$;
create or replace function public.write_game(p_id uuid,p_match text,p_expected integer,p_hash text,p_state jsonb,p_tournament jsonb default null,p_tournament_expected integer default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_hash);players uuid[];begin
 if s->>'role' in('editor','owner') and not(s->>'role'='owner' and s->>'manager_id' is null) and coalesce(s->>'account_manager_id','')<>'00000000-0000-4000-8000-000000000001' then
  select coalesce(array_agg(pid::uuid),'{}') into players from jsonb_array_elements_text(coalesce(s->'participant_ids','[]')) pid where p_state->'players' ? pid;
  perform public.match_player_presence(p_hash,p_id,p_match,players);
 end if;
 perform public.write_game_presence_base(p_id,p_match,p_expected,p_hash,p_state,p_tournament,p_tournament_expected);
end $$;
create or replace function public.rotate_room_invitation(p_hash text,p_id uuid,p_code_hash text,p_secret text) returns text language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 perform 1 from public.tournaments where id=p_id and status<>'archived' and (manager_id=account or account='00000000-0000-4000-8000-000000000001') for update;
 if not found then raise exception 'Nur Ersteller oder Owner dürfen die Einladung erneuern' using errcode='42501';end if;
 insert into public.room_invitations(tournament_id,code_hash,code_secret) values(p_id,p_code_hash,p_secret) on conflict(tournament_id) do update set code_hash=excluded.code_hash,code_secret=excluded.code_secret,enabled=true;
 update public.training_rooms set invite_hash=null,invite_secret=null where id=p_id;
 return p_secret;
end $$;
create or replace function public.social_invitation_secret(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select jsonb_build_object('roomId',r.id,'secret',coalesce(code.code_secret,r.invite_secret),'kind',case when code.code_secret is not null then 'code' else 'legacy' end) from public.training_invitations i join public.training_rooms r on r.id=i.room_id left join public.room_invitations code on code.tournament_id=r.id and code.enabled where i.id=p_id and i.receiver_id=account and r.phase<>'closed' and exists(select 1 from public.friendships where status='accepted' and least(sender_id,receiver_id)=least(account,i.sender_id) and greatest(sender_id,receiver_id)=greatest(account,i.sender_id)));
end $$;
create or replace function public.social_dismiss_invitation(p_hash text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 delete from public.training_invitations where id=p_id and receiver_id=account;if not found then raise exception 'Einladung nicht verfügbar' using errcode='42501';end if;
end $$;
create or replace function public.adopt_legacy_guest(p_old_hash text,p_guest_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare old_session jsonb:=public.read_session(p_old_hash);guest jsonb:=public.read_guest_session(p_guest_hash);aid text;pc public.player_access_codes;begin
 if old_session is null or old_session->>'role'<>'editor' or old_session->>'account_session_hash' is not null or guest is null then return false;end if;
 perform 1 from public.tournaments where id=(old_session->>'tournament_id')::uuid for update;
 old_session:=public.read_session(p_old_hash);if old_session is null then return false;end if;
 for aid in select distinct value from jsonb_array_elements_text(coalesce(old_session->'player_access_ids','[]')||jsonb_build_array(old_session->>'player_access_id')) loop
  select * into pc from public.player_access_codes where id=aid::uuid for update;
  if pc.id is null or exists(select 1 from public.account_player_links where access_id=pc.id and version=pc.version) or exists(select 1 from public.guest_player_links where access_id=pc.id and version=pc.version) then return false;end if;
 end loop;
 for aid in select distinct value from jsonb_array_elements_text(coalesce(old_session->'player_access_ids','[]')||jsonb_build_array(old_session->>'player_access_id')) loop
  select * into pc from public.player_access_codes where id=aid::uuid;
  delete from public.guest_player_links where access_id=pc.id and version<>pc.version;
  insert into public.guest_player_links(access_id,guest_id,version) values(pc.id,(guest->>'guest_id')::uuid,pc.version);
 end loop;
 update public.sessions set account_session_hash=p_guest_hash where token_hash=p_old_hash;return true;
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'identity_%' or p.proname like '%invitation%' or p.proname like '%guest%' or p.proname like '%player_claim%' or p.proname in('choose_device_players','choose_device_players_identity_base','link_player_account','link_player_account_identity_base','write_game','write_game_presence_base','prepare_manager_deletion','prepare_manager_deletion_identity_base','my_training_rooms','match_player_presence','owner_available_players','write_owner_game','write_owner_board_image','read_session','read_session_identity_base','player_holder_online','social_self_handle','social_set_handle','social_search_handle','social_request_handle','start_training_match','autodarts_profile')) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';
commit;

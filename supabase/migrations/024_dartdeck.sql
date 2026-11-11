-- DartDeck: separate lobbies, account invitations, local players and atomic game writes.
-- Run after 023_practice_modes.sql. Existing tournaments/training are retained.
begin;
create table if not exists public.dartdeck_rooms(
 id uuid primary key default gen_random_uuid(),host_id uuid not null references public.managers(id),
 phase text not null default 'waiting' check(phase in('waiting','playing','finished')),
 settings jsonb not null,game jsonb,last_game jsonb,version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.dartdeck_members(
 id uuid primary key default gen_random_uuid(),room_id uuid not null references public.dartdeck_rooms(id) on delete cascade,
 account_id uuid references public.managers(id),controller_id uuid not null references public.managers(id),
 name text not null check(length(name) between 1 and 40),local boolean not null default false,
 accepted boolean not null default false,position bigint generated always as identity,
 unique(room_id,account_id),check((local and account_id is null) or (not local and account_id=controller_id))
);
create index if not exists dartdeck_member_account on public.dartdeck_members(account_id,room_id);
create index if not exists dartdeck_room_host on public.dartdeck_rooms(host_id,updated_at);
alter table public.dartdeck_rooms enable row level security;
alter table public.dartdeck_members enable row level security;
revoke all on public.dartdeck_rooms,public.dartdeck_members from public,anon,authenticated;
grant all on public.dartdeck_rooms,public.dartdeck_members to service_role;
grant usage,select on sequence public.dartdeck_members_position_seq to service_role;
create or replace function public.dartdeck_lobby(p_hash text,p_operation text,p_id uuid,p_expected integer default null,p_target uuid default null,p_name text default null,p_settings jsonb default null) returns uuid language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);r public.dartdeck_rooms;username text;member public.dartdeck_members;begin
 if p_operation='create' or p_operation='settings' then
  if p_settings is null or jsonb_typeof(p_settings->'rounds') is distinct from 'number' or jsonb_typeof(p_settings->'difficulty') is distinct from 'string' or (p_settings->>'rounds')::numeric<>trunc((p_settings->>'rounds')::numeric) or (p_settings->>'rounds')::integer not between 1 and 50 or p_settings->>'difficulty' not in('easy','mixed','hard') or not(p_settings ? 'rounds' and p_settings ? 'difficulty') then raise exception 'Ungültige Spieleinstellungen' using errcode='22023';end if;
 end if;
 if p_operation='create' then
  select left(coalesce(public_handle,name),40) into username from public.managers where id=account;
  insert into public.dartdeck_rooms(id,host_id,settings) values(p_id,account,p_settings);
  insert into public.dartdeck_members(room_id,account_id,controller_id,name,accepted) values(p_id,account,account,username,true);return p_id;
 end if;
 select * into r from public.dartdeck_rooms where id=p_id for update;
 if r.id is null then raise exception 'Lobby nicht gefunden' using errcode='P0002';end if;
 if r.host_id<>account and account<>'00000000-0000-4000-8000-000000000001' then raise exception 'Nur der Ersteller oder Admin verwaltet die Lobby' using errcode='42501';end if;
 if r.version is distinct from p_expected then raise exception 'Lobby inzwischen geändert' using errcode='40001';end if;
 if p_operation='delete' then delete from public.dartdeck_rooms where id=p_id;return p_id;end if;
 if p_operation='rematch' then
  if r.phase<>'finished' then raise exception 'Bitte die Partie zuerst beenden' using errcode='55000';end if;
  update public.dartdeck_rooms set last_game=game,game=null,phase='waiting',version=version+1,updated_at=now() where id=p_id;return p_id;
 end if;
 if r.phase<>'waiting' then raise exception 'Die Teilnehmerliste ist während der Partie gesperrt' using errcode='55000';end if;
 if p_operation='invite' then
  select left(coalesce(public_handle,name),40) into username from public.managers where id=p_target and enabled and approved and deletion_requested_at is null and email_verification_version=1 and email_verified_at is not null and email_verified_address=lower(trim(email)) and not email_verification_required;
  if username is null then raise exception 'Bitte ein bestätigtes Spielerkonto auswählen' using errcode='22023';end if;
  if exists(select 1 from public.dartdeck_members where room_id=p_id and account_id=p_target) then raise exception 'Dieser Spieler ist bereits dabei oder eingeladen' using errcode='55000';end if;
  insert into public.dartdeck_members(room_id,account_id,controller_id,name) values(p_id,p_target,p_target,username);
 elsif p_operation='local' then
  username:=trim(p_name);
  if username is null or length(username) not between 1 and 40 or username ~ '[[:cntrl:]]' or exists(select 1 from public.dartdeck_members where room_id=p_id and lower(name)=lower(username)) then raise exception 'Bitte einen anderen Namen mit 1–40 Zeichen wählen' using errcode='22023';end if;
  insert into public.dartdeck_members(room_id,controller_id,name,local,accepted) values(p_id,r.host_id,username,true,true);
 elsif p_operation='remove' then
  select * into member from public.dartdeck_members where id=p_target and room_id=p_id;
  if member.id is null or member.account_id=r.host_id then raise exception 'Dieser Spieler kann nicht entfernt werden' using errcode='42501';end if;
  delete from public.dartdeck_members where id=p_target and room_id=p_id;
 elsif p_operation='settings' then update public.dartdeck_rooms set settings=p_settings where id=p_id;
 else raise exception 'Unbekannte Lobby-Aktion' using errcode='22023';end if;
 update public.dartdeck_rooms set version=version+1,updated_at=now() where id=p_id;return p_id;
end $$;
create or replace function public.write_dartdeck(p_hash text,p_id uuid,p_expected integer,p_actor uuid,p_action text,p_game jsonb) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);r public.dartdeck_rooms;roster jsonb;begin
 select * into r from public.dartdeck_rooms where id=p_id for update;
 if r.id is null then raise exception 'Lobby nicht gefunden' using errcode='P0002';end if;
 if r.version<>p_expected then raise exception 'Spielstand inzwischen geändert' using errcode='40001';end if;
 if p_action='start' then
  if account<>r.host_id and account<>'00000000-0000-4000-8000-000000000001' then raise exception 'Nur der Ersteller oder Admin startet' using errcode='42501';end if;
  if r.phase<>'waiting' then raise exception 'Die Partie läuft bereits' using errcode='55000';end if;
  if exists(select 1 from public.dartdeck_members where room_id=p_id and not accepted) then raise exception 'Bitte zuerst offene Einladungen prüfen' using errcode='55000';end if;
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'accountId',account_id,'controllerId',controller_id) order by position) into roster from public.dartdeck_members where room_id=p_id and accepted;
  if p_game->'players' is distinct from roster or p_game->'settings' is distinct from r.settings or p_game->>'phase'<>'playing' then raise exception 'Teilnehmer oder Einstellungen inzwischen geändert' using errcode='40001';end if;
  delete from public.dartdeck_members where room_id=p_id and not accepted;
 else
  if r.phase<>'playing' or p_action not in('dart','undo','next','vote-skip') then raise exception 'Die Partie läuft nicht' using errcode='55000';end if;
  if not exists(select 1 from public.dartdeck_members where room_id=p_id and id=p_actor and controller_id=account and accepted) then raise exception 'Nur eigene Spieler dürfen handeln' using errcode='42501';end if;
  if p_action<>'vote-skip' and r.game->'players'->((r.game->>'active')::integer)->>'id'<>p_actor::text then raise exception 'Du bist nicht an der Reihe' using errcode='42501';end if;
  if p_game->>'id' is distinct from r.game->>'id' or p_game->'players' is distinct from r.game->'players' or p_game->'settings' is distinct from r.game->'settings' or p_game->'deck' is distinct from r.game->'deck' then raise exception 'Strukturelle Änderung nicht erlaubt' using errcode='42501';end if;
 end if;
 if p_game->>'phase' not in('playing','finished') then raise exception 'Ungültiger Spielstand' using errcode='22023';end if;
 update public.dartdeck_rooms set game=p_game,phase=p_game->>'phase',version=version+1,updated_at=now() where id=p_id;
end $$;
-- Existing Friends notifications and Accept/Dismiss buttons also handle DartDeck.
do $$ begin
 if to_regprocedure('public.social_snapshot_dartdeck_base(text)') is null then alter function public.social_snapshot(text) rename to social_snapshot_dartdeck_base;end if;
 if to_regprocedure('public.accept_invitation_dartdeck_base(text,uuid)') is null then alter function public.accept_account_invitation(text,uuid) rename to accept_invitation_dartdeck_base;end if;
 if to_regprocedure('public.dismiss_invitation_dartdeck_base(text,uuid)') is null then alter function public.social_dismiss_invitation(text,uuid) rename to dismiss_invitation_dartdeck_base;end if;
end $$;
create or replace function public.social_snapshot(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);s jsonb;invitations jsonb;begin
 s:=public.social_snapshot_dartdeck_base(p_hash);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'roomId',r.id,'name','DartDeck','from',coalesce(m.public_handle,m.name),'kind','dartdeck')),'[]') into invitations from public.dartdeck_members p join public.dartdeck_rooms r on r.id=p.room_id join public.managers m on m.id=r.host_id where p.account_id=account and not p.accepted and r.phase='waiting' and m.enabled and m.approved and m.deletion_requested_at is null;
 return s||jsonb_build_object('invitations',coalesce(s->'invitations','[]')||invitations);
end $$;
create or replace function public.accept_account_invitation(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);member public.dartdeck_members;begin
 select * into member from public.dartdeck_members where id=p_id;
 if member.id is null then return public.accept_invitation_dartdeck_base(p_hash,p_id);end if;
 if member.account_id<>account or member.account_id is null then raise exception 'Diese Einladung gehört einem anderen Konto' using errcode='42501';end if;
 perform 1 from public.dartdeck_rooms where id=member.room_id and phase='waiting' for update;
 if not found then raise exception 'Die Lobby ist nicht mehr offen' using errcode='55000';end if;
 update public.dartdeck_members set accepted=true where id=p_id and account_id=account;
 if not found then raise exception 'Einladung nicht mehr verfügbar' using errcode='42501';end if;
 update public.dartdeck_rooms set version=version+1,updated_at=now() where id=member.room_id;
 return jsonb_build_object('redirect','/dartdeck/'||member.room_id::text);
end $$;
create or replace function public.social_dismiss_invitation(p_hash text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);member public.dartdeck_members;begin
 select * into member from public.dartdeck_members where id=p_id;
 if member.id is null then perform public.dismiss_invitation_dartdeck_base(p_hash,p_id);return;end if;
 if member.account_id<>account or member.account_id is null or member.accepted then raise exception 'Keine offene Einladung für dieses Konto' using errcode='42501';end if;
 perform 1 from public.dartdeck_rooms where id=member.room_id and phase='waiting' for update;
 if not found then raise exception 'Die Lobby ist nicht mehr offen' using errcode='55000';end if;
 delete from public.dartdeck_members where id=p_id and account_id=account and not accepted;
 update public.dartdeck_rooms set version=version+1,updated_at=now() where id=member.room_id;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('dartdeck_lobby','write_dartdeck','social_snapshot','accept_account_invitation','social_dismiss_invitation') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('social_snapshot_dartdeck_base','accept_invitation_dartdeck_base','dismiss_invitation_dartdeck_base') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

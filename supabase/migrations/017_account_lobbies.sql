-- After 016. Existing accounts, results, friendships and Autodarts profiles stay intact.
-- Only spectator URLs remain shareable. Internal participant bindings are not login codes.
begin;
alter table public.managers add column if not exists onboarding_completed_at timestamptz;
do $$ begin
 if to_regprocedure('public.account_identity(text)') is null then
 update public.managers set onboarding_completed_at=now() where public_handle is not null;
 end if;
end $$;
alter table public.tournaments add column if not exists match_generation integer not null default 0;
alter table public.tournaments drop constraint if exists tournament_participant_count;
alter table public.tournaments add constraint tournament_participant_count check(
 case when state->>'kind'='training' then jsonb_array_length(state->'participants')=2
 when state->>'setupPhase'='lobby' then status='planned' and jsonb_array_length(state->'participants') between 0 and 20 and state->'matches'='[]'::jsonb and state->'groups'='[]'::jsonb
 else jsonb_array_length(state->'participants') between 3 and 20 end);
create or replace function public.account_identity(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);m public.managers;begin
 select * into m from public.managers where id=account;
 return jsonb_build_object('signedIn',true,'role','owner','id',account,'handle',m.public_handle,'owner',account='00000000-0000-4000-8000-000000000001','setupRequired',account<>'00000000-0000-4000-8000-000000000001' and (m.public_handle is null or m.onboarding_completed_at is null));
end $$;
create or replace function public.complete_account_setup(p_hash text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if not exists(select 1 from public.managers where id=account and public_handle is not null) then raise exception 'Bitte zuerst einen eindeutigen Nutzernamen speichern.' using errcode='22023';end if;
 update public.managers set onboarding_completed_at=coalesce(onboarding_completed_at,now()) where id=account;
end $$;
create or replace function public.player_search(p_hash text,p_query text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return (select coalesce(jsonb_agg(to_jsonb(q) order by q.friend desc,q.handle),'[]') from(select m.id,m.public_handle as handle,m.name,m.id=account as self,
 exists(select 1 from public.friendships f where f.status='accepted' and ((f.sender_id=account and f.receiver_id=m.id) or (f.receiver_id=account and f.sender_id=m.id))) friend
 from public.managers m where m.enabled and m.approved and m.deletion_requested_at is null and m.public_handle is not null
 and (m.public_handle like replace(replace(lower(trim(p_query)),'_','\_'),'%','\%')||'%' or p_query='')
 and (p_query<>'' or m.id=account or exists(select 1 from public.friendships f where f.status='accepted' and ((f.sender_id=account and f.receiver_id=m.id) or (f.receiver_id=account and f.sender_id=m.id))))
 order by friend desc,m.public_handle limit 20)q);
end $$;
create or replace function public.account_play_session(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);pc public.player_access_codes;child text;parent public.sessions;cached jsonb;begin
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
create or replace function public.tournament_account_players(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 if not exists(select 1 from public.tournaments where id=p_id and (manager_id=account or account='00000000-0000-4000-8000-000000000001')) then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'handle',m.public_handle,'name',m.name,'participantId',p.participant_id,'self',m.id=account) order by member.ord),'[]') from public.tournaments t cross join lateral jsonb_array_elements(t.state->'participants') with ordinality member(value,ord) join public.player_access_codes p on p.tournament_id=t.id and p.participant_id=(member.value->>'id')::uuid join public.account_player_links l on l.access_id=p.id and l.version=p.version join public.managers m on m.id=l.manager_id where t.id=p_id);
end $$;
create or replace function public.save_account_lobby(p_hash text,p_state jsonb,p_expected integer,p_accounts uuid[],p_access jsonb) returns void language plpgsql security definer set search_path='' as $$
declare old public.tournaments;account uuid:=public.social_account(p_hash);begin
 select * into old from public.tournaments where id=(p_state->>'id')::uuid for update;
 if old.id is null or (old.manager_id<>account and account<>'00000000-0000-4000-8000-000000000001') then raise exception 'Keine Berechtigung' using errcode='42501';end if;
 if old.state->>'setupPhase' is distinct from 'lobby' or old.status<>'planned' or p_state->>'setupPhase' is distinct from 'lobby' or p_state->>'status'<>'planned' then raise exception 'Das Turnier wurde bereits ausgelost.' using errcode='55000';end if;
 -- Empty drafts have no account assignments. The older account wrapper treats
 -- an empty array_agg as NULL, so use its scoped transaction for this case.
 if cardinality(p_accounts)=0 and jsonb_array_length(p_state->'participants')=0 then
  perform public.save_tournament_accounts_base(p_state,p_expected,p_hash,'manage',jsonb_build_object('action','redraw','player_codes',p_access));
 else
  perform public.save_tournament(p_state,p_expected,p_hash,'manage',jsonb_build_object('action','redraw','accounts',to_jsonb(p_accounts),'player_codes',p_access));
 end if;
end $$;
-- Invitations are server-side records addressed to a specific account, not bearer links.
create table if not exists public.tournament_account_notices(
 id uuid primary key default gen_random_uuid(),tournament_id uuid not null references public.tournaments(id) on delete cascade,
 account_id uuid not null references public.managers(id),unique(tournament_id,account_id));
alter table public.tournament_account_notices enable row level security;
revoke all on public.tournament_account_notices from public,anon,authenticated;
grant all on public.tournament_account_notices to service_role;
create or replace function public.notify_tournament_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.tournament_account_notices(tournament_id,account_id)
 select t.id,new.manager_id from public.player_access_codes p join public.tournaments t on t.id=p.tournament_id where p.id=new.access_id and coalesce(t.state->>'kind','')<>'training' and t.manager_id<>new.manager_id on conflict do nothing;
 return new;
end $$;
drop trigger if exists notify_tournament_account on public.account_player_links;
create trigger notify_tournament_account after insert on public.account_player_links for each row execute function public.notify_tournament_account();
create or replace function public.social_invite(p_hash text,p_room uuid,p_friend uuid) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.training_host(p_hash,p_room);begin
 perform 1 from public.tournaments where id=p_room for update;
 if p_friend=account or not exists(select 1 from public.managers where id=p_friend and public_handle is not null and enabled and approved and deletion_requested_at is null) or not exists(select 1 from public.training_rooms where id=p_room and phase='waiting') then raise exception 'Spieler oder Lobby nicht verfügbar.' using errcode='22023';end if;
 insert into public.training_invitations(room_id,sender_id,receiver_id) values(p_room,account,p_friend) on conflict(room_id,receiver_id) do update set created_at=now();
end $$;
create or replace function public.training_remove_player(p_hash text,p_id uuid,p_code_hash text,p_secret text) returns void language plpgsql security definer set search_path='' as $$
declare st jsonb;pid uuid;begin
 perform public.training_remove_guest(p_hash,p_id,p_code_hash,p_secret);
 select participant_id into pid from public.training_seats where room_id=p_id and position=1;
 select state into st from public.tournaments where id=p_id for update;
 st:=st||jsonb_build_object('participants',(select jsonb_agg(case when x->>'id'=pid::text then x||jsonb_build_object('name','Mitspieler') else x end) from jsonb_array_elements(st->'participants')x),'version',(st->>'version')::integer+1,'updatedAt',now());
 update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=p_id;perform public.sync_tournament(st);
 delete from public.training_invitations where room_id=p_id;
end $$;
create or replace function public.accept_account_invitation(p_hash text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);inv public.training_invitations;seat public.training_seats;pc public.player_access_codes;st jsonb;username text;tid uuid;begin
 select tournament_id into tid from public.tournament_account_notices where id=p_id and account_id=account;
 if tid is not null then
  if not exists(select 1 from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version where l.manager_id=account and p.tournament_id=tid and p.enabled) then raise exception 'Du bist nicht mehr als Spieler eingetragen.' using errcode='42501';end if;
  delete from public.tournament_account_notices where id=p_id;
  return jsonb_build_object('redirect','/tournaments/'||tid::text);
 end if;
 select * into inv from public.training_invitations where id=p_id and receiver_id=account;
 if inv.id is null then raise exception 'Einladung nicht verfügbar.' using errcode='42501';end if;
 perform 1 from public.tournaments where id=inv.room_id for update;
 if not exists(select 1 from public.training_rooms where id=inv.room_id and phase='waiting') then raise exception 'Die Lobby ist nicht mehr offen.' using errcode='55000';end if;
 if not exists(select 1 from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version where l.manager_id=account and p.tournament_id=inv.room_id) then
  select s.* into seat from public.training_seats s where s.room_id=inv.room_id and not exists(select 1 from public.account_player_links l where l.access_id=s.access_id) order by position limit 1;
  if seat.access_id is null then raise exception 'Die Lobby ist bereits voll.' using errcode='55000';end if;
  select * into pc from public.player_access_codes where id=seat.access_id;
  select coalesce(public_handle,name) into username from public.managers where id=account;
  select state into st from public.tournaments where id=inv.room_id;
  st:=st||jsonb_build_object('participants',(select jsonb_agg(case when x->>'id'=seat.participant_id::text then x||jsonb_build_object('name',username) else x end) from jsonb_array_elements(st->'participants')x),'version',(st->>'version')::integer+1,'updatedAt',now());
  update public.tournaments set state=st,version=(st->>'version')::integer,updated_at=now() where id=inv.room_id;perform public.sync_tournament(st);
  insert into public.account_player_links(access_id,manager_id,version) values(pc.id,account,pc.version);
 end if;
 perform public.account_play_session(p_hash,inv.room_id);
 delete from public.training_invitations where room_id=inv.room_id;
 return jsonb_build_object('redirect','/training/'||inv.room_id::text);
end $$;
create or replace function public.social_dismiss_invitation(p_hash text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 delete from public.training_invitations where id=p_id and receiver_id=account;
 delete from public.tournament_account_notices where id=p_id and account_id=account;
end $$;
create or replace function public.social_snapshot(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare account uuid:=public.social_account(p_hash);begin
 return jsonb_build_object('accountId',account,'name',(select name from public.managers where id=account),
 'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'accountId',m.id,'name',m.name,'status',f.status,'incoming',f.receiver_id=account,
 'online',case when f.status='accepted' then exists(select 1 from public.manager_presence pr where pr.manager_id=m.id and pr.last_seen>now()-interval '90 seconds' and public.read_session(pr.session_hash) is not null) else false end)),'[]') from public.friendships f join public.managers m on m.id=case when f.sender_id=account then f.receiver_id else f.sender_id end where (f.sender_id=account or f.receiver_id=account) and m.enabled and m.deletion_requested_at is null),
 'invitations',(select coalesce(jsonb_agg(x),'[]') from (
 select jsonb_build_object('id',i.id,'roomId',r.id,'name',t.state->>'name','from',coalesce(m.public_handle,m.name),'kind','training') x from public.training_invitations i join public.training_rooms r on r.id=i.room_id join public.tournaments t on t.id=r.id join public.managers m on m.id=i.sender_id where i.receiver_id=account and r.phase='waiting' and m.enabled and m.deletion_requested_at is null
 union all
 select jsonb_build_object('id',n.id,'roomId',t.id,'name',t.state->>'name','from',coalesce(m.public_handle,m.name),'kind','tournament') from public.tournament_account_notices n join public.tournaments t on t.id=n.tournament_id join public.managers m on m.id=t.manager_id where n.account_id=account and t.status<>'archived' and m.enabled and exists(select 1 from public.account_player_links l join public.player_access_codes p on p.id=l.access_id and p.version=l.version where l.manager_id=account and p.tournament_id=t.id and p.enabled)
 )q));
end $$;
-- Lifetime match counts survive redraws and lobby/tournament deletion. No provider data.
create table if not exists public.player_match_history(
 account_id uuid not null references public.managers(id),event_key text not null,finished_at timestamptz not null default now(),primary key(account_id,event_key));
alter table public.player_match_history enable row level security;
revoke all on public.player_match_history from public,anon,authenticated;
grant all on public.player_match_history to service_role;
create or replace function public.record_account_matches(p_id uuid,p_state jsonb,p_round integer default null) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.player_match_history(account_id,event_key)
 select distinct l.manager_id,p_id::text||':'||case when p_round is not null then 'round:'||p_round::text else 'draw:'||(select match_generation::text from public.tournaments where id=p_id) end||':'||(m->>'id')
 from jsonb_array_elements(p_state->'matches') m join public.player_access_codes p on p.tournament_id=p_id and (m->'players') ? p.participant_id::text join public.account_player_links l on l.access_id=p.id and l.version=p.version
 where m->>'status'='finished' and coalesce((m->>'automatic')::boolean,false)=false on conflict do nothing;
end $$;
create or replace function public.capture_account_matches() returns trigger language plpgsql security definer set search_path='' as $$
declare st jsonb;tid uuid;r integer;begin
 if tg_table_name='training_results' then
  select state into st from public.tournaments where id=new.room_id;
  st:=jsonb_set(st,'{matches}',jsonb_build_array(jsonb_build_object('id',new.game->>'id','players',new.game->'players','status','finished','automatic',false)));
  -- The scoring game's id is not the match key; the room has a stable match id.
  st:=jsonb_set(st,'{matches,0,id}',to_jsonb((select match_id from public.training_rooms where id=new.room_id)));
  perform public.record_account_matches(new.room_id,st,new.round);return new;
 end if;
 if tg_op='DELETE' then st:=old.state;tid:=old.id;else st:=new.state;tid:=new.id;end if;
 select round into r from public.training_rooms where id=tid;
 perform public.record_account_matches(tid,st,r);
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists capture_account_matches on public.tournaments;
create trigger capture_account_matches before update or delete on public.tournaments for each row execute function public.capture_account_matches();
drop trigger if exists capture_training_account_matches on public.training_results;
create trigger capture_training_account_matches after insert on public.training_results for each row execute function public.capture_account_matches();
do $$ declare t record;r record;st jsonb;begin
 for t in select tx.id,tx.state,tr.round from public.tournaments tx left join public.training_rooms tr on tr.id=tx.id loop perform public.record_account_matches(t.id,t.state,t.round);end loop;
 for r in select g.*,tr.match_id from public.training_results g join public.training_rooms tr on tr.id=g.room_id loop
  -- Historical rounds did not snapshot account IDs. Only attribute them when
  -- the saved participant name still matches the currently linked account.
  insert into public.player_match_history(account_id,event_key)
  select l.manager_id,r.room_id::text||':round:'||r.round::text||':'||r.match_id from public.player_access_codes p join public.account_player_links l on l.access_id=p.id and l.version=p.version join public.managers m on m.id=l.manager_id
  where p.tournament_id=r.room_id and r.game->'players' ? p.participant_id::text and exists(select 1 from jsonb_array_elements(r.names) n where n->>'id'=p.participant_id::text and n->>'name' in(m.public_handle,m.name)) on conflict do nothing;
 end loop;
end $$;
create or replace function public.admin_player_accounts(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.social_account(p_hash)<>'00000000-0000-4000-8000-000000000001' then raise exception 'Nur der Owner verwaltet Spieler.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') from(select m.id,m.email,m.name,m.public_handle,m.enabled,m.approved,m.created_at,m.deletion_requested_at,
 (select count(*) from public.tournaments t where t.manager_id=m.id and coalesce(t.state->>'kind','')<>'training') tournaments,
 (select count(*) from public.tournaments t where t.manager_id=m.id and coalesce(t.state->>'kind','')<>'training' and t.status='running') running_tournaments,
 (select count(*) from public.player_match_history h where h.account_id=m.id) played_matches
 from public.managers m where m.id<>'00000000-0000-4000-8000-000000000001' and m.auth_deleted_at is null)q);
end $$;
-- A new draw is a new set of matches; corrections/reset of one match keep
-- the same identity so a finished result is not counted twice.
do $$ begin if to_regprocedure('public.save_tournament_lobbies_base(jsonb,integer,text,text,jsonb)') is null then alter function public.save_tournament(jsonb,integer,text,text,jsonb) rename to save_tournament_lobbies_base;end if;end $$;
create or replace function public.save_tournament(p_state jsonb,p_expected integer,p_session_hash text,p_action text,p_detail jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_detail->>'action'='redraw' then
  perform public.assert_session(p_session_hash,(p_state->>'id')::uuid,'manage');
  perform 1 from public.tournaments where id=(p_state->>'id')::uuid for update;
  update public.tournaments set match_generation=match_generation+1 where id=(p_state->>'id')::uuid and state->>'setupPhase' is distinct from 'lobby';
 end if;
 perform public.save_tournament_lobbies_base(p_state,p_expected,p_session_hash,p_action,p_detail);
end $$;
revoke all on function public.save_tournament_lobbies_base(jsonb,integer,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.save_tournament(jsonb,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_tournament(jsonb,integer,text,text,jsonb) to service_role;
-- Retire bearer invitations and guest/code entry RPCs. Historical migrations and
-- internal scoring helpers remain for existing results and account bindings.
update public.room_invitations set enabled=false;
update public.training_rooms set invite_hash=null,invite_secret=null;
update public.managers set friend_link_hash=null,friend_secret=null;
update public.sessions set participant_id=null,participant_ids='{}',playing_tournament_id=null where role='owner' and account_session_hash is null;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('account_identity','complete_account_setup','player_search','account_play_session','tournament_account_players','save_account_lobby','social_invite','training_remove_player','accept_account_invitation','social_snapshot','social_dismiss_invitation','admin_player_accounts','notify_tournament_account','record_account_matches','capture_account_matches') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%guest%' or p.proname like '%player_claim%' or p.proname in('identity_activate_players','claim_invitation_player','identity_player_links','identity_unlink_player','identity_snapshot','identity_heartbeat','identity_info','identity_controls_access','identity_owns_player','player_holder_online','join_account_invitation','manage_room_invitation','rotate_room_invitation','invitation_preview','invitation_access','social_invitation_secret','social_friend_link','link_player_account','unlink_player_account','choose_device_players','choose_tournament_player','claim_player','add_device_player','login_player_session','manage_editor_access','manage_player_codes','ensure_player_codes','restore_manager_player','activate_account_players','join_training_room','training_preview','close_training_room')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;

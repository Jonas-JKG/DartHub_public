-- Nur Owner und Score-Editor; PIN-Wechsel und Abmeldung erfolgen atomar.
-- Gesamten Inhalt im Supabase SQL Editor ausführen. Turniere bleiben erhalten.
begin;
create or replace function public.read_session(p_hash text) returns jsonb language sql security definer set search_path='' as $$
  select to_jsonb(s) from public.sessions s left join public.tournament_credentials c on c.tournament_id=s.tournament_id
  where s.token_hash=p_hash and s.expires_at>now() and
    (s.role='owner' or (s.role='editor' and c.editor_enabled and s.credential_version=c.editor_version));
$$;
create or replace function public.assert_session(p_hash text,p_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  s:=public.read_session(p_hash);
  if s is null then raise exception 'Nicht angemeldet' using errcode='28000'; end if;
  if s->>'role'='owner' then return s; end if;
  if s->>'tournament_id'<>p_id::text or p_id is null then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
  if s->>'role'='editor' and p_action='score' then return s; end if;
  raise exception 'Keine Berechtigung' using errcode='42501';
end $$;
drop function if exists public.manage_access(uuid,text,text,text);
create or replace function public.manage_editor_access(p_id uuid,p_session_hash text,p_action text,p_pin_hash text default null,p_secret text default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  s:=public.assert_session(p_session_hash,p_id,'access');
  perform 1 from public.tournament_credentials where tournament_id=p_id for update;
  if not found then raise exception 'Turnier nicht gefunden' using errcode='P0002'; end if;
  if p_action='revoke' and nullif(p_pin_hash,'') is not null and nullif(p_secret,'') is not null then
    update public.tournament_credentials set editor_pin_hash=p_pin_hash,editor_secret=p_secret,editor_version=editor_version+1 where tournament_id=p_id;
  elsif p_action in ('enable','disable') and p_pin_hash is null and p_secret is null then
    update public.tournament_credentials set editor_version=editor_version+1,editor_enabled=(p_action='enable') where tournament_id=p_id;
  else raise exception 'Ungültige Zugangsaktion' using errcode='22023'; end if;
  delete from public.sessions where tournament_id=p_id and role='editor';
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,detail) values(p_id,s->>'role',p_session_hash,'access',jsonb_build_object('action',p_action));
end $$;
create or replace function public.private_list_archived(p_session_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session(p_session_hash); result jsonb; begin
  if s is null or s->>'role'<>'owner' then raise exception 'Keine Berechtigung' using errcode='42501'; end if;
  select coalesce(jsonb_agg(state),'[]') into result from public.tournaments where status='archived'; return result;
end $$;
delete from public.sessions where role='admin';
update public.tournament_credentials set admin_hash='' where admin_hash<>'';
revoke all on function public.manage_editor_access(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.manage_editor_access(uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;

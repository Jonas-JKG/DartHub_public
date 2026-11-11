-- Gemeinsame Anmeldung mit Admin-Passwort oder Editor-PIN.
-- Gesamte Datei im Supabase SQL Editor ausführen. Bestehende PINs bleiben erhalten.
begin;
alter table public.tournament_credentials add column if not exists editor_code_hash text;
create unique index if not exists unique_editor_code on public.tournament_credentials(editor_code_hash);
create or replace function public.create_tournament(p_state jsonb,p_credentials jsonb,p_session_hash text) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; tid uuid:=(p_state->>'id')::uuid; begin
  s:=public.assert_session(p_session_hash,null,'create');
  insert into public.tournaments values(tid,p_state,1,p_state->>'status',(p_state->>'createdAt')::timestamptz,(p_state->>'updatedAt')::timestamptz);
  insert into public.tournament_credentials(tournament_id,admin_hash,admin_version,editor_link_hash,editor_pin_hash,editor_secret,editor_enabled,editor_version,editor_code_hash)
    values(tid,'',1,p_credentials->>'editor_link_hash',p_credentials->>'editor_pin_hash',p_credentials->>'editor_secret',true,1,p_credentials->>'editor_code_hash');
  perform public.sync_tournament(p_state);
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,after_state) values(tid,s->>'role',p_session_hash,'create',p_state);
end $$;
drop function if exists public.manage_editor_access(uuid,text,text,text,text);
create or replace function public.manage_editor_access(p_id uuid,p_session_hash text,p_action text,p_pin_hash text default null,p_secret text default null,p_code_hash text default null) returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; begin
  s:=public.assert_session(p_session_hash,p_id,'access');
  perform 1 from public.tournament_credentials where tournament_id=p_id for update;
  if not found then raise exception 'Turnier nicht gefunden' using errcode='P0002'; end if;
  if p_action='revoke' and nullif(p_pin_hash,'') is not null and nullif(p_secret,'') is not null and p_code_hash ~ '^[a-f0-9]{64}$' then
    update public.tournament_credentials set editor_pin_hash=p_pin_hash,editor_secret=p_secret,editor_code_hash=p_code_hash,editor_version=editor_version+1 where tournament_id=p_id;
  elsif p_action in ('enable','disable') and p_pin_hash is null and p_secret is null and p_code_hash is null then
    update public.tournament_credentials set editor_version=editor_version+1,editor_enabled=(p_action='enable') where tournament_id=p_id;
  else raise exception 'Ungültige Zugangsaktion' using errcode='22023'; end if;
  delete from public.sessions where tournament_id=p_id and role='editor';
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,detail) values(p_id,s->>'role',p_session_hash,'access',jsonb_build_object('action',p_action));
end $$;
revoke all on function public.manage_editor_access(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.manage_editor_access(uuid,text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;

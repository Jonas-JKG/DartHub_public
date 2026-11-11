-- Repariert ausschließlich die Löschfunktion. Vorhandene Turniere bleiben erhalten.
-- Die gesamte Datei im Supabase SQL Editor ausführen.
begin;
create or replace function public.delete_tournament(p_id uuid,p_expected integer,p_session_hash text) returns void language plpgsql security definer set search_path='' as $$
declare old public.tournaments; s jsonb; begin
  s:=public.assert_session(p_session_hash,p_id,'delete');
  select * into old from public.tournaments where id=p_id for update;
  if not found then raise exception 'Turnier nicht gefunden' using errcode='P0002'; end if;
  if old.version<>p_expected then raise exception 'Versionskonflikt' using errcode='40001'; end if;
  insert into public.audit_events(tournament_id,actor_role,actor_session,action,before_state) values(p_id,s->>'role',p_session_hash,'delete',old.state);
  -- Ergebnisse, Slots und Abhängigkeiten verschwinden vor den Teilnehmern.
  delete from public.matches where tournament_id=p_id;
  delete from public.tournaments where id=p_id;
  delete from public.players where not exists(select 1 from public.tournament_participants p where p.id=players.id);
  update public.public_live_state set tournament_id=(select id from public.tournaments where status<>'archived' order by (status='running') desc,case when status='running' then (state->>'startedAt')::timestamptz else updated_at end desc,id limit 1),version=version+1 where id=1;
end $$;
revoke all on function public.delete_tournament(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.delete_tournament(uuid,integer,text) to service_role;
notify pgrst,'reload schema';
commit;

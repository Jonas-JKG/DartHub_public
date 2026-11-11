-- Run after 026. Separate media from scoring and provide lightweight, leased reads.
begin;
alter table public.camera_devices add column if not exists media_generation bigint not null default -1;
alter table public.camera_devices add column if not exists image_revision bigint not null default -1;
alter table public.camera_devices add column if not exists preview_revision bigint not null default -1;
alter table public.camera_devices add column if not exists frame_received_at timestamptz;
alter table public.camera_devices add column if not exists diagnostics jsonb not null default '{}';
create or replace function public.camera_sync(p_hash text,p_operation text,p_device uuid,p_data jsonb default '{}',p_rate_key text default '') returns jsonb language plpgsql security definer set search_path=public as $$
declare s jsonb;uid uuid;d public.camera_devices;result jsonb;old_frame bigint;fresh_image boolean;fresh_preview boolean;
begin
 s:=public.read_session(p_hash);
 if s is null or s->>'role'<>'owner' or not public.camera_allowed(p_hash) then raise exception 'Kamera nicht freigeschaltet oder Sitzung abgelaufen.' using errcode='42501';end if;
 uid:=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001'::uuid);
 if p_operation not in ('report','snapshot','media','diagnostic') or length(p_rate_key)<32 then raise exception 'Ungültige Kameraanfrage.' using errcode='22023';end if;
 if not public.consume_login_attempt(p_rate_key,case when p_operation='media' then 1800 else 6000 end) then raise exception 'Zu viele Kameraanfragen.' using errcode='54000';end if;
 select * into d from public.camera_devices where id=p_device and owner_id=uid for update;
 if not found then raise exception 'Kamera nicht verfügbar.' using errcode='42501';end if;
 if p_operation='report' then
  old_frame:=d.frame_id;result:=public.camera_transport(p_hash,'report',p_device,p_data);
  select * into d from public.camera_devices where id=p_device;
  if d.frame_id>old_frame then update public.camera_devices set frame_received_at=clock_timestamp() where id=p_device;end if;
  return result||jsonb_build_object('accepted',d.seq=(p_data->>'seq')::bigint,'delivery_version',1);
 elsif p_operation='media' then
  if d.producer<>(p_data->>'producer')::uuid then raise exception 'Kamera ist in einem anderen Tab geöffnet.' using errcode='40001';end if;
  if d.media_generation<>d.generation then d.image_revision:=-1;d.preview_revision:=-1;end if;
  fresh_image:=p_data ? 'image' and (p_data->>'imageRevision')::bigint>d.image_revision;
  fresh_preview:=p_data ? 'preview' and (p_data->>'previewRevision')::bigint>d.preview_revision;
  update public.camera_devices set media_generation=d.generation,
   image=case when fresh_image then p_data->>'image' else image end,
   preview=case when fresh_preview then p_data->>'preview' else preview end,
   image_revision=case when fresh_image then (p_data->>'imageRevision')::bigint else d.image_revision end,
   preview_revision=case when fresh_preview then (p_data->>'previewRevision')::bigint else d.preview_revision end,
   image_seq=image_seq+case when fresh_image or fresh_preview then 1 else 0 end where id=p_device;
  return jsonb_build_object('ok',true,'delivery_version',1);
 else
  if p_operation='diagnostic' then
   if (p_data->>'generation')::bigint<>d.generation or (d.controller is not null and d.controller is distinct from (p_data->>'controller')::uuid) then raise exception 'Kameraverbindung wurde erneuert.' using errcode='40001';end if;
   update public.camera_devices set diagnostics=p_data->'diagnostics' where id=p_device;return '{"ok":true}';
  end if;
  if d.controller is distinct from (p_data->>'controller')::uuid or d.lease_until<=now() or d.lease_until is null or d.binding->>'session_hash' is distinct from p_hash then raise exception 'Kamera bitte erneut mit dem Match verbinden.' using errcode='55000';end if;
  return (to_jsonb(d)-'owner_id'-'producer'-'controller'-'lease_until'-'image'-'preview')||jsonb_build_object('binding',d.binding-'session_hash','delivery_version',1,'allowed',true,'ok',true);
 end if;
end $$;
revoke all on function public.camera_sync(text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.camera_sync(text,text,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;

-- Account-gated camera transport. No anonymous access and no direct game-state writes.
-- Run after 025_dartdeck_images.sql. Camera access is off for existing player accounts.
alter table public.managers add column if not exists camera_enabled boolean not null default false;
create table if not exists public.camera_devices(
 id uuid primary key,owner_id uuid not null references public.managers(id) on delete cascade,
 name text not null check(length(name) between 1 and 50),producer uuid not null,
 generation bigint not null default 0,seq bigint not null default 0,image_seq bigint not null default 0,frame_id bigint not null default 0,status text not null default 'idle',error text not null default '',
 observation jsonb not null default '{"located":false,"tips":[]}',image text,preview text,
 config jsonb not null default '{"zoom":1,"lens":0,"model":"s_960","camera":"","run":true,"armed":false}',config_version integer not null default 0,
 actual jsonb not null default '{}',updated_at timestamptz not null default now(),
 binding jsonb,controller uuid,lease_until timestamptz
);
create index if not exists camera_owner_idx on public.camera_devices(owner_id);
create index if not exists camera_binding_idx on public.camera_devices using gin(binding) where binding is not null;
alter table public.camera_devices enable row level security;
revoke all on public.camera_devices from public,anon,authenticated;
create or replace function public.camera_allowed(p_hash text) returns boolean language plpgsql security definer set search_path=public as $$
declare s jsonb;
begin s:=public.read_session(p_hash);if s is null or s->>'role'<>'owner' then return false;end if;
 if s->>'manager_id' is null then return true;end if;
 return exists(select 1 from public.managers where id=(s->>'manager_id')::uuid and camera_enabled and enabled and approved and deletion_requested_at is null);
end $$;
create or replace function public.camera_transport(p_hash text,p_operation text,p_device uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare s jsonb;uid uuid;d public.camera_devices;v bigint;
begin s:=public.read_session(p_hash);if s is null or s->>'role'<>'owner' then raise exception 'Bitte anmelden.' using errcode='28000';end if;
 uid:=coalesce((s->>'manager_id')::uuid,'00000000-0000-4000-8000-000000000001'::uuid);
 if p_operation='grant' then
  if s->>'manager_id' is not null then raise exception 'Nur der Admin darf Kamerazugriff freischalten.' using errcode='42501';end if;
  update public.managers set camera_enabled=coalesce((p_data->>'enabled')::boolean,false) where id=p_device;
  if not found then raise exception 'Konto nicht gefunden.' using errcode='22023';end if;
  if not coalesce((p_data->>'enabled')::boolean,false) then delete from public.camera_devices where owner_id=p_device;end if;
  return '{"ok":true}';
 end if;
 if not public.camera_allowed(p_hash) then
  if p_operation='list' then return '{"allowed":false,"devices":[]}';end if;
  raise exception 'Kameraerkennung ist für dieses Konto nicht freigeschaltet.' using errcode='42501';
 end if;
 if p_operation='list' then return jsonb_build_object('allowed',true,'account',uid,'devices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'error',error,'updated_at',updated_at,'seq',seq,'config',config,'config_version',config_version,'actual',actual,'binding',binding-'session_hash','busy',lease_until>now())) from public.camera_devices where owner_id=uid),'[]'::jsonb));end if;
 if p_operation='register' then
  perform 1 from public.managers where id=uid for update;
  if (select count(*) from public.camera_devices where owner_id=uid)>=4 and not exists(select 1 from public.camera_devices where id=p_device and owner_id=uid) then raise exception 'Höchstens vier Kamerageräte pro Konto.' using errcode='22023';end if;
  insert into public.camera_devices(id,owner_id,name,producer) values(p_device,uid,p_data->>'name',(p_data->>'producer')::uuid) on conflict(id) do nothing;
 end if;
 select * into d from public.camera_devices where id=p_device and owner_id=uid for update;
 if not found then raise exception 'Kamera nicht verfügbar.' using errcode='42501';end if;
 if p_operation='register' then update public.camera_devices set producer=(p_data->>'producer')::uuid,name=p_data->>'name',generation=generation+1,seq=0,frame_id=0,status='idle',error='',observation='{"located":false,"tips":[]}',image=null,preview=null,updated_at=now() where id=d.id;
 elsif p_operation='report' then
  if d.producer<>(p_data->>'producer')::uuid then raise exception 'Kamera ist in einem anderen Tab geöffnet.' using errcode='40001';end if;
  v:=(p_data->>'seq')::bigint;if v<=d.seq then return jsonb_build_object('ok',true,'config',d.config,'config_version',d.config_version);end if;
  update public.camera_devices set seq=v,frame_id=(p_data->>'frameId')::bigint,status=p_data->>'status',error=coalesce(p_data->>'error',''),observation=p_data->'observation',image=coalesce(p_data->>'image',image),preview=coalesce(p_data->>'preview',preview),image_seq=case when p_data ? 'preview' then image_seq+1 else image_seq end,actual=coalesce(p_data->'actual','{}'),updated_at=now() where id=d.id;
  return jsonb_build_object('ok',true,'config',d.config,'config_version',d.config_version);
 elsif p_operation='control' then update public.camera_devices set config=p_data->'config',config_version=config_version+1 where id=d.id;
 elsif p_operation='claim' then
  if d.lease_until>now() and d.controller<>(p_data->>'controller')::uuid then raise exception 'Diese Kamera wird bereits von einem anderen Spielgerät verwendet.' using errcode='55000';end if;
  update public.camera_devices set controller=(p_data->>'controller')::uuid,lease_until=now()+interval '12 seconds',binding=(p_data->'binding')||jsonb_build_object('session_hash',p_hash) where id=d.id;
 elsif p_operation='release' then update public.camera_devices set controller=null,lease_until=null,binding=null where id=d.id and controller=(p_data->>'controller')::uuid;
 elsif p_operation='delete' then delete from public.camera_devices where id=d.id;return '{"ok":true}';
 elsif p_operation<>'get' then raise exception 'Ungültige Kameraaktion.' using errcode='22023';end if;
 select * into d from public.camera_devices where id=p_device;
 return (to_jsonb(d)-'owner_id'-'producer'-'controller'-'lease_until'-'image')-case when p_operation='claim' and coalesce((p_data->>'previewRevision')::bigint,-1)=d.image_seq then 'preview' else '_no_field_' end||jsonb_build_object('binding',d.binding-'session_hash','allowed',true,'ok',true);
end $$;
revoke all on function public.camera_allowed(text),public.camera_transport(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.camera_allowed(text),public.camera_transport(text,text,uuid,jsonb) to service_role;

-- Run after 018. Only an email-link/OTP callback validated by Auth may set version 1.
-- Timestamps imported by 018 are deliberately NOT treated as proof.
begin;
alter table public.managers add column if not exists email_verification_version smallint not null default 0 check (email_verification_version between 0 and 1);
update public.managers set email_verification_required=true
 where id<>'00000000-0000-4000-8000-000000000001' and email_verification_version=0;
do $$ begin
 if to_regprocedure('public.read_session_strict_email_base(text)') is null then
  alter function public.read_session(text) rename to read_session_strict_email_base;
 end if;
end $$;
create or replace function public.read_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=public.read_session_strict_email_base(p_hash);account uuid;
begin
 if s is null then return null;end if;
 account:=coalesce((s->>'account_manager_id')::uuid,(s->>'manager_id')::uuid);
 if account is not null and account<>'00000000-0000-4000-8000-000000000001' and not exists(select 1 from public.managers m where m.id=account
  and m.email_verification_version=1 and m.email_verified_at is not null
  and m.email_verified_address=lower(trim(m.email)) and not m.email_verification_required) then return null;end if;
 return s;
end $$;
revoke all on function public.read_session_strict_email_base(text) from public,anon,authenticated,service_role;
revoke all on function public.read_session(text) from public,anon,authenticated;
grant execute on function public.read_session(text) to service_role;
-- Diagnostic events never contain email addresses, names, passwords or tokens.
create table if not exists public.account_mail_events(
 id uuid primary key,created_at timestamptz not null default now(),
 operation text not null check(operation in('signup','resend','recover')),
 stage text not null check(stage in('create-account','request-mail')),
 outcome text not null check(outcome in('accepted','rejected')),
 provider_code text,provider_status integer
);
alter table public.account_mail_events enable row level security;
revoke all on public.account_mail_events from public,anon,authenticated;
grant select,insert,delete on public.account_mail_events to service_role;
notify pgrst,'reload schema';
commit;

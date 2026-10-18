create table public.invited_emails (
  email text primary key
    check (email = lower(email))
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now()
);

alter table public.invited_emails enable row level security;
alter table public.invited_emails force row level security;
revoke all on table public.invited_emails from anon, authenticated;
grant select, insert on table public.invited_emails to service_role;

create function public.invited_emails_cap()
returns trigger language plpgsql set search_path = '' as $$
begin
  lock table public.invited_emails in share row exclusive mode;
  if exists (select 1 from public.invited_emails where email = new.email) then
    return new;
  end if;
  if (select count(*) from public.invited_emails) >= 11 then
    raise exception 'invited_emails is limited to 11 rows' using errcode = 'AL001';
  end if;
  return new;
end $$;

create trigger invited_emails_cap
  before insert on public.invited_emails
  for each row execute function public.invited_emails_cap();

create function public.before_user_created_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(event->'user'->>'email'));
begin
  if v_email is null
     or not exists (select 1 from public.invited_emails where email = v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'message', 'Cadastro permitido apenas para convidados.',
      'http_code', 403));
  end if;
  return '{}'::jsonb;
end $$;

grant usage on schema public to supabase_auth_admin;
grant select on table public.invited_emails to supabase_auth_admin;
grant execute on function public.before_user_created_hook to supabase_auth_admin;
revoke execute on function public.before_user_created_hook from authenticated, anon, public;

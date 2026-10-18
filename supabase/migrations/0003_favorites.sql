create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  stop_id text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, stop_id)
);

alter table public.favorites enable row level security;
alter table public.favorites force row level security;
revoke all on table public.favorites from anon, authenticated;
grant select on table public.favorites to authenticated;

create policy favorites_select on public.favorites
  for select to authenticated using (user_id = (select auth.uid()));

create function public.add_favorite(p_stop_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.stops where id = p_stop_id) then
    raise exception 'unknown stop %', p_stop_id using errcode = 'AL002';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  if exists (select 1 from public.favorites where user_id = v_user and stop_id = p_stop_id) then
    return;
  end if;
  if (select count(*) from public.favorites where user_id = v_user) >= 50 then
    raise exception 'favorites are limited to 50' using errcode = 'AL003';
  end if;
  insert into public.favorites (user_id, stop_id, position)
  values (
    v_user,
    p_stop_id,
    coalesce((select max(position) + 1 from public.favorites where user_id = v_user), 0));
end $$;

create function public.remove_favorite(p_stop_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.favorites where user_id = auth.uid() and stop_id = p_stop_id;
end $$;

create function public.reorder_favorites(p_stop_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  if cardinality(p_stop_ids) <> (select count(distinct id) from unnest(p_stop_ids) as id)
     or array(select stop_id from public.favorites where user_id = v_user order by stop_id)
        <> array(select id from unnest(p_stop_ids) as id order by id) then
    raise exception 'the new order must list every favorite once' using errcode = 'AL004';
  end if;
  update public.favorites f
     set position = o.ord - 1
    from unnest(p_stop_ids) with ordinality as o (stop_id, ord)
   where f.user_id = v_user and f.stop_id = o.stop_id;
end $$;

create or replace function public.get_stop(p_stop_id text, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::integer * 60 + extract(minute from ts)::integer as minute,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as today,
      case extract(isodow from ts - interval '1 day') when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end
        as yesterday
    from local_time
  ),
  lines as (
    select
      r.id as route_id,
      r.short_name,
      r.long_name,
      r.mode,
      r.color,
      r.text_color,
      sr.direction_id,
      sr.headsign,
      (select round(1 / sum(1.0 / h.headway_s))::integer
         from public.headways h
        where h.route_id = sr.route_id
          and h.direction_id = sr.direction_id
          and ((h.day_type = c.today and c.minute >= h.start_min and c.minute < h.end_min)
            or (h.day_type = c.yesterday and c.minute + 1440 >= h.start_min and c.minute + 1440 < h.end_min)))
        as headway_s
    from public.stop_routes sr
    join public.routes r on r.id = sr.route_id
    cross join clock c
    where sr.stop_id = p_stop_id
  )
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'mode', s.mode,
    'lat', s.lat,
    'lon', s.lon,
    'favorite', exists (select 1 from public.favorites f where f.user_id = auth.uid() and f.stop_id = s.id),
    'lines', coalesce(
      (select jsonb_agg(to_jsonb(l) order by l.headway_s is null, l.short_name, l.direction_id) from lines l),
      '[]'::jsonb))
  from public.stops s
  where s.id = p_stop_id
$$;

create function public.get_favorites(p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('stop_id', f.stop_id, 'stop', public.get_stop(f.stop_id, p_at))
      order by f.position),
    '[]'::jsonb)
  from public.favorites f
  where f.user_id = auth.uid()
$$;

revoke execute on function public.add_favorite, public.remove_favorite, public.reorder_favorites, public.get_favorites
  from public, anon;
grant execute on function public.add_favorite, public.remove_favorite, public.reorder_favorites, public.get_favorites
  to authenticated;

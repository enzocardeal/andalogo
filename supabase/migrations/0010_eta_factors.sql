create table public.eta_factors (
  day_type text not null check (day_type in ('weekday', 'saturday', 'sunday')),
  hour smallint not null check (hour between 0 and 23),
  factor real not null,
  segments integer not null,
  updated_at timestamptz not null default now(),
  primary key (day_type, hour)
);

alter table public.eta_factors enable row level security;
alter table public.eta_factors force row level security;
revoke all on table public.eta_factors from anon, authenticated;
grant select on table public.eta_factors to authenticated;

create policy eta_factors_select on public.eta_factors for select to authenticated using (true);

create function public.refresh_eta_factors(p_day_type text, p_hour integer)
returns void language sql set search_path = '' as $$
  insert into public.eta_factors (day_type, hour, factor, segments, updated_at)
  select
    p_day_type,
    p_hour,
    percentile_cont(0.5) within group (
      order by u.pace * (p.stop_offsets_m[array_length(p.stop_offsets_m, 1)] - p.stop_offsets_m[1]) / (p.run_time_s * 1000.0)),
    count(*),
    now()
  from public.eta_paces e
  join public.route_patterns p
    on p.route_id = e.route_id
   and p.direction_id = e.direction_id
   and e.stops_key = md5(array_to_string(p.stop_ids, ','))
  cross join lateral unnest(e.pace_s_per_km, e.samples) as u (pace, n)
  where e.day_type = p_day_type
    and e.hour = p_hour
    and u.n >= 1
    and p.run_time_s > 0
    and p.stop_offsets_m[array_length(p.stop_offsets_m, 1)] > p.stop_offsets_m[1]
  having count(*) > 0
  on conflict (day_type, hour) do update
    set factor = excluded.factor, segments = excluded.segments, updated_at = excluded.updated_at
$$;

revoke execute on function public.refresh_eta_factors from public, anon, authenticated;

create function public.eta_factor(p_day_type text, p_hour integer)
returns real language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select f.factor from public.eta_factors f where f.day_type = p_day_type and f.hour = p_hour and f.segments >= 200),
    (select (percentile_cont(0.5) within group (order by f.factor))::real from public.eta_factors f where f.segments >= 200))
$$;

revoke execute on function public.eta_factor from public, anon;
grant execute on function public.eta_factor to authenticated;

select public.refresh_eta_factors(b.day_type, b.hour) from (select distinct day_type, hour from public.eta_paces) b;

create or replace function public.get_stop_eta(p_stop_id text, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::smallint as hour,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as day_type
    from local_time
  ),
  bucket as (
    select c.hour, c.day_type, public.eta_factor(c.day_type, c.hour) as factor from clock c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'route_id', p.route_id,
      'direction_id', p.direction_id,
      'polyline', p.polyline,
      'stop_offsets_m', p.stop_offsets_m,
      'stop_indexes', i.indexes,
      'run_time_s', p.run_time_s,
      'circular', not exists (
        select 1 from public.route_patterns o where o.route_id = p.route_id and o.direction_id <> p.direction_id),
      'paces', e.pace_s_per_km,
      'samples', e.samples,
      'factor', c.factor)
    order by p.route_id, p.direction_id), '[]'::jsonb)
  from bucket c
  cross join public.stop_routes sr
  join public.routes r on r.id = sr.route_id
  join public.route_patterns p on p.route_id = sr.route_id and p.direction_id = sr.direction_id
  cross join lateral (
    select array_agg(o.ord - 1 order by o.ord) as indexes
    from unnest(p.stop_ids) with ordinality as o (stop_id, ord)
    where o.stop_id = p_stop_id
  ) i
  left join public.eta_paces e
    on e.route_id = p.route_id
   and e.direction_id = p.direction_id
   and e.day_type = c.day_type
   and e.hour = c.hour
   and e.stops_key = md5(array_to_string(p.stop_ids, ','))
  where sr.stop_id = p_stop_id
    and r.feed = 'sptrans'
    and r.mode = 'bus'
    and p.stop_offsets_m is not null
    and i.indexes is not null
$$;

create or replace function public.get_line_eta(p_route_id text, p_direction_id integer, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::smallint as hour,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as day_type
    from local_time
  ),
  bucket as (
    select c.hour, c.day_type, public.eta_factor(c.day_type, c.hour) as factor from clock c
  )
  select jsonb_build_object(
      'route_id', p.route_id,
      'direction_id', p.direction_id,
      'polyline', p.polyline,
      'stop_offsets_m', p.stop_offsets_m,
      'run_time_s', p.run_time_s,
      'circular', not exists (
        select 1 from public.route_patterns o where o.route_id = p.route_id and o.direction_id <> p.direction_id),
      'paces', e.pace_s_per_km,
      'samples', e.samples,
      'factor', c.factor)
  from bucket c
  cross join public.route_patterns p
  join public.routes r on r.id = p.route_id
  left join public.eta_paces e
    on e.route_id = p.route_id
   and e.direction_id = p.direction_id
   and e.day_type = c.day_type
   and e.hour = c.hour
   and e.stops_key = md5(array_to_string(p.stop_ids, ','))
  where p.route_id = p_route_id
    and p.direction_id = p_direction_id
    and r.feed = 'sptrans'
    and r.mode = 'bus'
    and p.stop_offsets_m is not null
$$;

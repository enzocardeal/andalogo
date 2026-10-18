create table public.eta_paces (
  route_id text not null,
  direction_id smallint not null check (direction_id in (0, 1)),
  day_type text not null check (day_type in ('weekday', 'saturday', 'sunday')),
  hour smallint not null check (hour between 0 and 23),
  stops_key text not null,
  pace_s_per_km smallint[] not null,
  samples real[] not null,
  updated_at timestamptz not null default now(),
  primary key (route_id, direction_id, day_type, hour)
);

alter table public.eta_paces enable row level security;
alter table public.eta_paces force row level security;
revoke all on table public.eta_paces from anon, authenticated;
grant select on table public.eta_paces to authenticated;

create policy eta_paces_select on public.eta_paces for select to authenticated using (true);

drop function public.get_stop_eta(text);

create function public.get_stop_eta(p_stop_id text, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::smallint as hour,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as day_type
    from local_time
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
      'samples', e.samples)
    order by p.route_id, p.direction_id), '[]'::jsonb)
  from clock c
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

revoke execute on function public.get_stop_eta from public, anon;
grant execute on function public.get_stop_eta to authenticated;

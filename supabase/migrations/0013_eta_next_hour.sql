create or replace function public.get_stop_eta(p_stop_id text, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      date_trunc('hour', ts) at time zone 'America/Sao_Paulo' as hour_start,
      extract(hour from ts)::smallint as hour,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as day_type,
      extract(hour from ts + interval '1 hour')::smallint as next_hour,
      case extract(isodow from ts + interval '1 hour') when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as next_day_type
    from local_time
  ),
  bucket as (
    select
      c.*,
      public.eta_factor(c.day_type, c.hour) as factor,
      public.eta_factor(c.next_day_type, c.next_hour) as next_factor
    from clock c
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
      'factor', c.factor,
      'next_paces', n.pace_s_per_km,
      'next_samples', n.samples,
      'next_factor', c.next_factor,
      'hour_start', c.hour_start)
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
  left join public.eta_paces n
    on n.route_id = p.route_id
   and n.direction_id = p.direction_id
   and n.day_type = c.next_day_type
   and n.hour = c.next_hour
   and n.stops_key = md5(array_to_string(p.stop_ids, ','))
  where sr.stop_id = p_stop_id
    and r.feed = 'sptrans'
    and r.mode = 'bus'
    and p.stop_offsets_m is not null
    and i.indexes is not null
$$;
